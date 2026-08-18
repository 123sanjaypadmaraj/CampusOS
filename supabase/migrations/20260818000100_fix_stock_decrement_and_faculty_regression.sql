-- =============================================================================
-- Full-app bug-check pass (2026-08-18): two real regressions found live on
-- staging by re-running the existing scripts/live-check-*.mjs suite, both
-- caused by a later CREATE OR REPLACE silently reverting an earlier fix
-- because it was built on an older base rather than the then-latest version
-- (the exact "recreate from latest, not original" pitfall this repo's own
-- migration comments have flagged repeatedly before).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. record_payment_event: 20260817001200_printing_v2.sql recreated this
-- function to branch on order-vs-print-job, but its "order-side behaviour is
-- byte-for-byte unchanged" claim was wrong -- it was rebuilt on
-- 20260814000400_payments.sql's ORIGINAL body, from before
-- 20260815000800_food_stock_tracking.sql added the
-- `perform public.adjust_stock_for_order(v_order.id, -1)` call on the
-- PAYMENT_PENDING -> PAID transition. Net effect: paying for any food order
-- silently stopped decrementing stock for track_stock items platform-wide
-- (confirmed live -- scripts/live-check-food-stock.mjs 5/10 failing,
-- scripts/live-check-food-hardening.mjs 4/42 failing, all from this one
-- root cause: no stock_adjustments audit row, stock_quantity never moves,
-- auto-hide-at-zero never fires, vendor_inventory_report shows zero
-- consumption). Recreated here from printing_v2's current (latest) body with
-- only that one call restored -- everything else, including the print-job
-- branch, is untouched.
-- ---------------------------------------------------------------------------

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

    if v_payment.order_id is not null then
      select * into v_order from public.orders where id = v_payment.order_id for update;

      if v_order.status = 'PAYMENT_PENDING' then
        update public.orders set status = 'PAID', payment_status = 'paid' where id = v_order.id;
        insert into public.order_status_history (order_id, from_status, to_status, reason)
        values (v_order.id, 'PAYMENT_PENDING', 'PAID', 'gateway webhook verified');

        update public.orders set status = 'RECEIVED' where id = v_order.id;
        insert into public.order_status_history (order_id, from_status, to_status, reason)
        values (v_order.id, 'PAID', 'RECEIVED', 'auto-forwarded to vendor queue');

        perform public.adjust_stock_for_order(v_order.id, -1);
      end if;

    elsif v_payment.print_job_id is not null then
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
  end if;

  return v_payment;
end;
$$;

revoke execute on function public.record_payment_event(text, text, text, boolean, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. admin_set_user_role / profiles_role_check: 20260817001100_permission_
-- audit_fixes.sql already fixed the 'faculty' role having been dropped from
-- the allow-list by 20260817000400_food_vendor_staff.sql's own recreate --
-- but a live check (scripts/live-check-academic-module.mjs) shows the LIVE
-- staging function still matches 000400's broken version, not 001100's fix,
-- meaning 001100 was never actually applied here despite this repo's own
-- notes recording it as applied. Re-running it (byte-identical to 001100,
-- both idempotent CREATE OR REPLACE) rather than guessing why it didn't
-- land -- cheaper than investigating an already-fixed migration's history,
-- and safe either way.
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_user_role(p_target_user uuid, p_new_role text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_role text;
begin
  if not public.has_permission(auth.uid(), 'users.roles.manage') and not public.current_user_is_admin() then
    raise exception 'Not authorized to change roles';
  end if;

  if p_new_role not in ('student','club_admin','vendor','vendor_staff','facilities_staff','faculty','college_admin','super_admin') then
    raise exception 'Invalid role %', p_new_role;
  end if;

  select role into v_old_role from public.profiles where id = p_target_user for update;

  perform set_config('campusos.allow_role_change', 'true', true);
  update public.profiles set role = p_new_role where id = p_target_user;
  perform set_config('campusos.allow_role_change', 'false', true);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_value, new_value, reason)
  values (auth.uid(), 'role.change', 'profile', p_target_user::text,
          jsonb_build_object('role', v_old_role), jsonb_build_object('role', p_new_role), p_reason);
end;
$$;

do $$ begin
  alter table public.profiles drop constraint if exists profiles_role_check;
  alter table public.profiles add constraint profiles_role_check
    check (role in ('student','club_admin','vendor','vendor_staff','facilities_staff','faculty','college_admin','super_admin'));
exception when others then null;
end $$;
