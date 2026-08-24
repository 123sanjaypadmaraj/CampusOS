-- =============================================================================
-- PAYMENT GATEWAY HARDENING (readiness-audit phase 04's engineering-doable
-- subset: "Webhook signature hardening review before cutover"). A live
-- Razorpay account isn't needed to do this review or test it -- Test Mode
-- webhooks carry the same signed payload shape as live ones.
--
-- Review of supabase/functions/razorpay-webhook/index.ts found the HMAC
-- verification itself sound (constant-time-ish comparison, secret required,
-- signature checked before the payload is trusted at all). Two real gaps:
--
-- 1. record_payment_event() -- the only place payment_status/print_jobs
--    ever become "paid"/"UPLOADED" -- never checked that the captured
--    amount in the webhook payload actually matches what create_payment_
--    order()/create_razorpay-order asked Razorpay to charge. A signature-
--    verified webhook is authentically from Razorpay, but that alone
--    doesn't guarantee the amount inside it is the amount this specific
--    order/print job is owed -- e.g. a merchant-side manual partial capture
--    (Razorpay supports capturing less than the authorized amount via its
--    own API) would otherwise still flip the order fully PAID. Fixed below:
--    an amount mismatch on a captured payment is recorded (the payments/
--    payment_events rows are still written -- something real did happen)
--    but does NOT flip the order/print job to paid, and is logged loudly
--    via log_server_error so it surfaces through the existing observability
--    error-rate alert (20260819001400) for a human to look at. Deliberately
--    not a hard `raise exception` -- that would 500 the webhook and make
--    Razorpay retry the same (still-mismatched) event forever.
--
-- 2. The Edge Function itself (fixed in the same commit, not by migration):
--    no cap on request body size before parsing, and no staleness check on
--    the payload's own `created_at`, so a signature that leaked (e.g. an
--    old webhook secret compromised then rotated) stays replayable
--    indefinitely. See razorpay-webhook/index.ts.
-- =============================================================================

create or replace function public.record_payment_event(
  p_gateway_order_id text,
  p_gateway_payment_id text,
  p_status text,               -- 'authorized' | 'captured' | 'failed'
  p_signature_verified boolean,
  p_raw_payload jsonb
)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments;
  v_order public.orders;
  v_job public.print_jobs;
  v_entity_amount numeric;
  v_expected_amount numeric;
  v_amount_mismatch boolean := false;
begin
  select * into v_payment from public.payments where gateway_order_id = p_gateway_order_id for update;
  if not found then
    raise exception 'Unknown gateway_order_id %', p_gateway_order_id;
  end if;

  update public.payments
    set gateway_payment_id = p_gateway_payment_id,
        status = p_status,
        signature_verified = p_signature_verified,
        raw_payload = p_raw_payload
    where id = v_payment.id
    returning * into v_payment;

  insert into public.payment_events (payment_id, event_type, payload)
  values (v_payment.id, p_status, p_raw_payload);

  if p_status = 'captured' and p_signature_verified then

    -- Defense in depth: the webhook entity's amount (paise) must match what
    -- create_payment_order()/create_print_payment_order() actually asked
    -- Razorpay to charge (rupees, hence the *100). Any well-formed payload
    -- carries this; a missing/unparseable amount is treated as a mismatch
    -- rather than silently trusted.
    v_expected_amount := round(v_payment.amount * 100);
    begin
      v_entity_amount := (p_raw_payload #>> '{payload,payment,entity,amount}')::numeric;
    exception when others then
      v_entity_amount := null;
    end;

    if v_entity_amount is null or v_entity_amount <> v_expected_amount then
      v_amount_mismatch := true;
      perform public.log_server_error(
        'record_payment_event: captured amount does not match the payment owed for gateway_order_id ' || p_gateway_order_id,
        null, 'payment', 'error',
        jsonb_build_object(
          'payment_id', v_payment.id, 'gateway_order_id', p_gateway_order_id,
          'gateway_payment_id', p_gateway_payment_id,
          'expected_amount_paise', v_expected_amount, 'entity_amount_paise', v_entity_amount
        )
      );
    end if;

    if not v_amount_mismatch and v_payment.order_id is not null then
      select * into v_order from public.orders where id = v_payment.order_id for update;

      if v_order.status = 'PAYMENT_PENDING' then
        update public.orders set status = 'PAID', payment_status = 'paid' where id = v_order.id;
        insert into public.order_status_history (order_id, from_status, to_status, reason)
        values (v_order.id, 'PAYMENT_PENDING', 'PAID', 'gateway webhook verified');

        update public.orders set status = 'RECEIVED' where id = v_order.id;
        insert into public.order_status_history (order_id, from_status, to_status, reason)
        values (v_order.id, 'PAID', 'RECEIVED', 'auto-forwarded to vendor queue');
      end if;

    elsif not v_amount_mismatch and v_payment.print_job_id is not null then
      select * into v_job from public.print_jobs where id = v_payment.print_job_id for update;

      if v_job.status = 'AWAITING_PAYMENT' then
        update public.print_jobs
          set status = 'UPLOADED', payment_id = v_payment.id, expires_at = now() + interval '14 days'
          where id = v_job.id;
      end if;
    end if;

  elsif p_status = 'failed' then
    if v_payment.order_id is not null then
      update public.orders set payment_status = 'failed' where id = v_payment.order_id;
    end if;
    -- A failed print-job payment needs no state change -- the job just stays
    -- AWAITING_PAYMENT so the student can retry, and expires on its own.
    -- A failed food-order payment also needs no stock action here: stock was
    -- reserved at checkout and stays reserved so the student can retry
    -- payment on the same order; it's released by transition_order_status
    -- (if staff/the student cancels) or expire_stale_food_orders (if the
    -- checkout is simply abandoned).
  end if;

  return v_payment;
end;
$$;

revoke execute on function public.record_payment_event(text, text, text, boolean, jsonb) from public, anon, authenticated;
