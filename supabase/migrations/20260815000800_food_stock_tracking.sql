-- Stock / low-stock tracking for vendor menu items (doc §17-19, the part of
-- "bulk menu & inventory" that was still missing: CSV import/export is
-- frontend-only, but stock tracking needs real columns + real decrement/
-- restock logic wired into the order lifecycle, not just a UI field).
--
-- Design: tracking is opt-in per item (track_stock). Untracked items behave
-- exactly as before (stock_quantity stays null, nothing decrements). This
-- keeps every existing canteen's menu working unchanged -- a vendor has to
-- explicitly turn tracking on for an item before any of this applies.

alter table public.food_items add column if not exists track_stock boolean not null default false;
alter table public.food_items add column if not exists stock_quantity integer;
alter table public.food_items add column if not exists low_stock_threshold integer not null default 5;

do $$ begin
  alter table public.food_items add constraint food_items_stock_quantity_check check (stock_quantity is null or stock_quantity >= 0);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.food_items add constraint food_items_low_stock_threshold_check check (low_stock_threshold >= 0);
exception when duplicate_object then null;
end $$;

-- =========================================================
-- adjust_stock_for_order -- shared helper called from both directions:
-- p_direction = -1 to consume stock (order paid), +1 to restore it (order
-- rejected/cancelled after payment). Only touches items that have opted
-- into tracking (track_stock and a non-null stock_quantity) -- untracked
-- items are left alone. Consuming stock down to 0 auto-flips `available`
-- to false so the item drops off the student menu without the vendor
-- having to notice and do it by hand; restoring stock does NOT auto-flip
-- it back to true (the vendor may have hidden it for an unrelated reason),
-- matching the existing manual-toggle UI.
--
-- SECURITY DEFINER, execute revoked from anon/authenticated below -- only
-- reachable via record_payment_event (service_role only) and
-- transition_order_status (SECURITY DEFINER itself, runs as owner), never
-- directly from the browser.
-- =========================================================

create or replace function public.adjust_stock_for_order(p_order_id uuid, p_direction integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
begin
  for v_item in
    select oi.food_item_id, oi.quantity
    from public.order_items oi
    where oi.order_id = p_order_id
  loop
    update public.food_items
      set stock_quantity = greatest(coalesce(stock_quantity, 0) + p_direction * v_item.quantity, 0),
          available = case
            when p_direction < 0 and coalesce(stock_quantity, 0) + p_direction * v_item.quantity <= 0 then false
            else available
          end
      where id = v_item.food_item_id
        and track_stock
        and stock_quantity is not null;
  end loop;
end;
$$;

revoke execute on function public.adjust_stock_for_order(uuid, integer) from public, anon, authenticated;

-- =========================================================
-- Wire stock consumption into record_payment_event -- the moment an order
-- actually clears payment and gets forwarded to the vendor queue is the
-- only point stock should be consumed (not at create_food_order, which can
-- be abandoned mid-checkout and would otherwise reserve stock that's never
-- actually bought). Recreated with the identical signature so this doesn't
-- create a second overload (see 20260814002700's fix for why that matters).
-- =========================================================

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
    select * into v_order from public.orders where id = v_payment.order_id for update;

    if v_order.status = 'PAYMENT_PENDING' then
      update public.orders set status = 'PAID', payment_status = 'paid' where id = v_order.id;
      insert into public.order_status_history (order_id, from_status, to_status, reason)
      values (v_order.id, 'PAYMENT_PENDING', 'PAID', 'gateway webhook verified');

      -- Immediately mark RECEIVED so the vendor queue picks it up; ACCEPT
      -- still requires an explicit vendor action via transition_order_status.
      update public.orders set status = 'RECEIVED' where id = v_order.id;
      insert into public.order_status_history (order_id, from_status, to_status, reason)
      values (v_order.id, 'PAID', 'RECEIVED', 'auto-forwarded to vendor queue');

      perform public.adjust_stock_for_order(v_order.id, -1);
    end if;
  elsif p_status = 'failed' then
    update public.orders set payment_status = 'failed' where id = v_payment.order_id;
  end if;

  return v_payment;
end;
$$;

revoke execute on function public.record_payment_event(text, text, text, boolean, jsonb) from public, anon, authenticated;

-- =========================================================
-- Wire stock restoration into transition_order_status -- only when the
-- order had actually already consumed stock (i.e. it had passed PAID at
-- some point). CREATED/PAYMENT_PENDING -> CANCELLED never decremented
-- anything, so those must NOT restock or every abandoned checkout would
-- over-credit inventory. v_from_status (captured before the UPDATE, same
-- as 20260814002700's own fix) doubles as that check.
--
-- Based on the LATEST prior version of this function
-- (20260814002700_fix_order_status_history_from_status.sql: per-canteen
-- ownership check from 002401 + the from_status-audit-trail fix), not the
-- original in 20260814000300 -- recreating from an older copy would have
-- silently reintroduced both already-fixed bugs. Recreated with the
-- identical signature so this doesn't create a second overload.
-- =========================================================

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

  if p_to_status in ('REJECTED', 'CANCELLED') and v_from_status not in ('CREATED', 'PAYMENT_PENDING') then
    perform public.adjust_stock_for_order(p_order_id, 1);
  end if;

  return v_order;
end;
$$;
