-- =============================================================================
-- 0024: VENDOR ORDER QUEUE -- scope order visibility/management to the
-- owning canteen (doc §13, §16).
-- =============================================================================
-- transition_order_status() and the orders_read/order_items_read/
-- order_status_history_read policies (0003/0011) only ever checked the
-- blanket 'food.orders.read'/'food.orders.update' permission -- which every
-- vendor account holds (0002 grants it to the whole 'vendor' role, not
-- per-canteen). With more than one real vendor account now provisioned
-- (0022/scripts/setup-vendor-accounts.mjs), that meant Udupi Canteen's
-- login could read and drive the status of Tango Canteen's orders. Fix both
-- ends: RLS (read) and the RPC (write) now also check canteens.owner_id.
-- current_user_is_admin() keeps full cross-canteen access for staff/admins.

drop policy if exists "orders_read" on public.orders;
create policy "orders_read" on public.orders for select to authenticated
  using (
    user_id = auth.uid()
    or public.current_user_is_admin()
    or (
      public.has_permission(auth.uid(),'food.orders.read')
      and exists (select 1 from public.canteens c where c.id = orders.canteen_id and c.owner_id = auth.uid())
    )
  );

drop policy if exists "order_items_read" on public.order_items;
create policy "order_items_read" on public.order_items for select to authenticated
  using (exists (
    select 1 from public.orders o
    join public.canteens c on c.id = o.canteen_id
    where o.id = order_items.order_id
      and (o.user_id = auth.uid() or public.current_user_is_admin()
        or (public.has_permission(auth.uid(),'food.orders.read') and c.owner_id = auth.uid()))
  ));

drop policy if exists "order_status_history_read" on public.order_status_history;
create policy "order_status_history_read" on public.order_status_history for select to authenticated
  using (exists (
    select 1 from public.orders o
    join public.canteens c on c.id = o.canteen_id
    where o.id = order_status_history.order_id
      and (o.user_id = auth.uid() or public.current_user_is_admin()
        or (public.has_permission(auth.uid(),'food.orders.read') and c.owner_id = auth.uid()))
  ));

drop policy if exists "order_pickup_tokens_read" on public.order_pickup_tokens;
create policy "order_pickup_tokens_read" on public.order_pickup_tokens for select to authenticated
  using (
    exists (select 1 from public.orders o where o.id = order_pickup_tokens.order_id and o.user_id = auth.uid())
    or public.current_user_is_admin()
    or exists (
      select 1 from public.orders o join public.canteens c on c.id = o.canteen_id
      where o.id = order_pickup_tokens.order_id
        and public.has_permission(auth.uid(),'food.orders.update') and c.owner_id = auth.uid()
    )
  );

-- transition_order_status(): same ownership check, now enforced in the
-- write path itself rather than relying on RLS alone (RLS has no UPDATE
-- policy on orders -- this SECURITY DEFINER function is the only writer,
-- so it has to be the one place authorization is actually correct).
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

  update public.orders set status = p_to_status where id = p_order_id returning * into v_order;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, p_to_status, v_user, p_reason);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_value, new_value, reason)
  values (v_user, 'order.status.change', 'order', p_order_id::text,
          jsonb_build_object('status', v_order.status), jsonb_build_object('status', p_to_status), p_reason);

  return v_order;
end;
$$;

-- redeem_pickup_token() has the same gap -- any vendor could redeem any
-- canteen's pickup code. Scope it the same way.
create or replace function public.redeem_pickup_token(p_token text)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_token public.order_pickup_tokens;
  v_order public.orders;
  v_can_manage boolean;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;

  select * into v_token from public.order_pickup_tokens where token = p_token for update;
  if not found then
    raise exception 'PICKUP_TOKEN_INVALID: token not recognised';
  end if;
  if v_token.used_at is not null then
    raise exception 'PICKUP_TOKEN_USED: this code has already been redeemed';
  end if;
  if v_token.expires_at < now() then
    raise exception 'PICKUP_TOKEN_EXPIRED: this code has expired';
  end if;

  select * into v_order from public.orders where id = v_token.order_id for update;

  v_can_manage := public.current_user_is_admin()
    or (
      public.has_permission(v_user, 'food.orders.update')
      and exists (select 1 from public.canteens c where c.id = v_order.canteen_id and c.owner_id = v_user)
    );
  if not v_can_manage then
    raise exception 'Not authorized to redeem pickup tokens for this canteen';
  end if;

  if v_order.status <> 'READY' then
    raise exception 'ORDER_NOT_READY: order is not ready for pickup';
  end if;

  update public.order_pickup_tokens set used_at = now(), used_by = v_user where id = v_token.id;
  update public.orders set status = 'COMPLETED' where id = v_order.id returning * into v_order;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by, reason)
  values (v_order.id, 'READY', 'COMPLETED', v_user, 'pickup token redeemed');

  return v_order;
end;
$$;

-- The vendor order-queue UI reads orders with embedded order_items in one
-- PostgREST call (`orders?select=*,order_items(*)`), which works under the
-- policies above with no extra RPC needed. Index the query shape it uses.
create index if not exists orders_canteen_created_idx on public.orders(canteen_id, created_at desc);
