-- =============================================================================
-- 0027: FIX transition_order_status() RECORDING from_status = to_status
-- =============================================================================
-- Pre-existing bug (present since 0003, carried forward unnoticed into the
-- vendor-order-queue ownership fix in 20260814002401): the UPDATE ran first
-- with `returning * into v_order`, so v_order.status was already the NEW
-- status by the time the order_status_history INSERT read it as
-- `from_status`. Every transition recorded in the audit trail looked like a
-- no-op (e.g. "PREPARING -> PREPARING" instead of "ACCEPTED -> PREPARING").
-- orders.status itself was never wrong -- only the history log was corrupt.
-- Found live while testing the vendor order queue
-- (tests/live/05-vendor-order-queue.spec.js).

create or replace function public.transition_order_status(
  p_order_id uuid,
  p_to_status text,
  p_reason text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_order public.orders;
  v_from_status text;
  v_is_owner boolean;
  v_can_manage boolean;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found';
  end if;

  v_is_owner := v_order.user_id = v_user;
  v_can_manage := public.current_user_is_admin()
    or (
      public.has_permission(v_user, 'food.orders.update')
      and exists (select 1 from public.canteens c where c.id = v_order.canteen_id and c.owner_id = v_user)
    );

  if p_to_status = 'CANCEL_REQUESTED' then
    if not v_is_owner and not v_can_manage then
      raise exception 'Not authorized to cancel this order';
    end if;
  elsif p_to_status = 'PAID' then
    raise exception 'PAID may only be set by payment verification';
  else
    if not v_can_manage then
      raise exception 'Not authorized to update this order';
    end if;
  end if;

  if not exists (
    select 1 from public.order_status_transitions
    where from_status = v_order.status and to_status = p_to_status
  ) then
    raise exception 'ORDER_INVALID_TRANSITION: cannot move % -> %', v_order.status, p_to_status;
  end if;

  v_from_status := v_order.status;

  update public.orders set status = p_to_status where id = p_order_id returning * into v_order;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_from_status, p_to_status, v_user, p_reason);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_value, new_value, reason)
  values (v_user, 'order.status.change', 'order', p_order_id::text,
          jsonb_build_object('status', v_from_status), jsonb_build_object('status', p_to_status), p_reason);

  return v_order;
end;
$$;

-- One-time backfill: nothing can recover the true from_status of past rows
-- (the bad value already overwrote it), but the obviously-wrong self-loop
-- rows (from_status = to_status) are worse than just deleting them --
-- they'd otherwise render as fake "PREPARING -> PREPARING" no-op entries in
-- any future order-history UI. orders.status itself is untouched.
delete from public.order_status_history where from_status = to_status;
