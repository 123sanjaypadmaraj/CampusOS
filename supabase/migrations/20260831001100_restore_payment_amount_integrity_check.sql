-- =============================================================================
-- FIX (real regression, found while scoping a concurrent-payment load test for
-- paid events): 20260831000800_paid_events.sql's `create or replace function
-- record_payment_event(...)` was based on a copy of the function that predates
-- 20260824000700_payment_webhook_hardening.sql -- the same "stale copy"
-- mistake as the CANCELLED/restore_store_order_stock regression the
-- payment-hardening pass found and fixed on 24 Aug (see that migration's own
-- header). It silently dropped the amount-mismatch defense-in-depth check
-- (v_amount_mismatch / v_expected_amount / v_entity_amount) entirely, despite
-- that migration's own comment claiming "byte-for-byte unchanged for the
-- existing two targets" -- it was NOT unchanged, and the gap applies to all
-- three targets (orders, print jobs, and the new event-registration branch),
-- not just the new one.
--
-- Confirmed actually broken live on staging before writing this fix: re-ran
-- the pre-existing scripts/live-check-payment-and-store-billing.mjs, which
-- already asserted this behaviour -- "An amount-mismatched capture does NOT
-- flip the order to PAID" FAILED (order landed on status=RECEIVED,
-- payment_status=paid despite a deliberately wrong captured amount). Since
-- this migration is applied on both staging and production (confirmed in
-- sync as of 6c303d4 / 149 migrations), the gap is live in production right
-- now, on real money, across every payment target -- not just paid events.
--
-- Fix: restore the exact 24 Aug check, computed once after the payment row
-- update (same as before), and gate all three branches (order, print_job,
-- event_registration) on `not v_amount_mismatch` instead of just the first
-- two. Everything else in the function (the event_registration branch added
-- 31 Aug, the 'failed' branch) is unchanged.
-- =============================================================================

create or replace function public.record_payment_event(
  p_gateway_order_id text,
  p_gateway_payment_id text,
  p_status text,
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
  v_reg public.event_registrations;
  v_event public.events;
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
    -- create_payment_order()/create_print_payment_order()/
    -- create_event_payment_order() actually asked Razorpay to charge (rupees,
    -- hence the *100). Any well-formed payload carries this; a missing/
    -- unparseable amount is treated as a mismatch rather than silently trusted.
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

    elsif not v_amount_mismatch and v_payment.event_registration_id is not null then
      select * into v_reg from public.event_registrations where id = v_payment.event_registration_id for update;

      if v_reg.status = 'confirmed' and v_reg.payment_status in ('pending','failed') then
        update public.event_registrations
          set payment_status = 'paid', payment_id = v_payment.id
          where id = v_reg.id;

        -- A retried-after-failure attempt may have left a stale ticket from
        -- an earlier partial run; start clean, same defensive pattern
        -- register_for_event already uses for a revived cancelled row.
        delete from public.event_tickets where registration_id = v_reg.id;
        insert into public.event_tickets (event_id, registration_id) values (v_reg.event_id, v_reg.id);

        select * into v_event from public.events where id = v_reg.event_id;
        insert into public.notifications (user_id, type, title, body, action_type, action_id)
        values (v_reg.user_id, 'event', 'Payment confirmed',
                'Your payment for ' || coalesce(v_event.title, 'the event') || ' is confirmed -- your ticket is ready.',
                'event', v_reg.event_id::text);
      end if;
    end if;

  elsif p_status = 'failed' then
    if v_payment.order_id is not null then
      update public.orders set payment_status = 'failed' where id = v_payment.order_id;
    elsif v_payment.event_registration_id is not null then
      update public.event_registrations set payment_status = 'failed' where id = v_payment.event_registration_id;
    end if;
    -- A failed print-job payment needs no state change -- the job just stays
    -- AWAITING_PAYMENT so the student can retry, and expires on its own.
  end if;

  return v_payment;
end;
$$;

revoke execute on function public.record_payment_event(text, text, text, boolean, jsonb) from public, anon, authenticated;
