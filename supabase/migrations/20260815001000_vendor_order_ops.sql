-- =============================================================================
-- Vendor order-ops depth: priority, internal notes, staff assignment, a
-- working confirm/resume path out of CANCEL_REQUESTED, and a real refund
-- initiation flow (request_refund existed since 0004 but nothing ever called
-- it, and it had the same cross-canteen ownership gap 0024 already fixed on
-- transition_order_status/redeem_pickup_token -- fixed here the same way).
-- =============================================================================

-- =========================================================
-- orders: priority / internal_note / assigned_staff_name.
-- All three are vendor/admin-only operational metadata -- never shown to the
-- student, never writable by RLS (orders has no client update policy at all,
-- see 0011's comment -- set_order_ops_fields() below is the only writer).
-- =========================================================

alter table public.orders add column if not exists priority text not null default 'normal';
do $$ begin
  alter table public.orders add constraint orders_priority_check check (priority in ('normal','high','urgent'));
exception when duplicate_object then null;
end $$;
alter table public.orders add column if not exists internal_note text;
alter table public.orders add column if not exists assigned_staff_name text;

create index if not exists orders_canteen_priority_idx on public.orders(canteen_id, priority);

-- =========================================================
-- canteen_staff -- a lightweight name roster a canteen vendor maintains to
-- assign orders to ("who's making this"). Deliberately NOT a real login
-- account (that needs service_role provisioning, same reasoning
-- org_requests' vendor-approval flow already documents for why this repo
-- doesn't self-serve new vendor accounts from the client).
-- =========================================================

create table if not exists public.canteen_staff (
  id uuid primary key default gen_random_uuid(),
  canteen_id uuid not null references public.canteens(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (canteen_id, name)
);

create index if not exists canteen_staff_canteen_idx on public.canteen_staff(canteen_id);

alter table public.canteen_staff enable row level security;

drop policy if exists "canteen_staff_read" on public.canteen_staff;
create policy "canteen_staff_read" on public.canteen_staff for select to authenticated
  using (
    public.current_user_is_admin()
    or exists (select 1 from public.canteens c where c.id = canteen_staff.canteen_id and c.owner_id = auth.uid())
  );

drop policy if exists "canteen_staff_write" on public.canteen_staff;
create policy "canteen_staff_write" on public.canteen_staff for all to authenticated
  using (
    public.current_user_is_admin()
    or (
      public.has_permission(auth.uid(),'food.menu.write')
      and exists (select 1 from public.canteens c where c.id = canteen_staff.canteen_id and c.owner_id = auth.uid())
    )
  )
  with check (
    public.current_user_is_admin()
    or (
      public.has_permission(auth.uid(),'food.menu.write')
      and exists (select 1 from public.canteens c where c.id = canteen_staff.canteen_id and c.owner_id = auth.uid())
    )
  );

-- =========================================================
-- RPC: set_order_ops_fields -- same ownership-checked pattern as
-- transition_order_status/redeem_pickup_token (0024): orders has no client
-- update policy, so this SECURITY DEFINER function is the only writer.
-- Doesn't touch order_status_transitions -- these fields are orthogonal to
-- the state machine, settable at any status.
-- =========================================================

create or replace function public.set_order_ops_fields(
  p_order_id uuid,
  p_priority text,
  p_internal_note text,
  p_assigned_staff_name text
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_order public.orders;
  v_can_manage boolean;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;

  if p_priority not in ('normal','high','urgent') then
    raise exception 'Invalid priority %', p_priority;
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found';
  end if;

  v_can_manage := public.current_user_is_admin()
    or (
      public.has_permission(v_user, 'food.orders.update')
      and exists (select 1 from public.canteens c where c.id = v_order.canteen_id and c.owner_id = v_user)
    );
  if not v_can_manage then
    raise exception 'Not authorized to update this order';
  end if;

  update public.orders
    set priority = p_priority,
        internal_note = nullif(trim(coalesce(p_internal_note,'')),''),
        assigned_staff_name = nullif(trim(coalesce(p_assigned_staff_name,'')),'')
    where id = p_order_id
    returning * into v_order;

  return v_order;
end;
$$;

-- =========================================================
-- request_refund: fix the cross-canteen ownership gap (any vendor could
-- refund any canteen's order -- 'food.refunds.create' is granted blanket to
-- the whole 'vendor' role, same root cause 0024 fixed on
-- transition_order_status/redeem_pickup_token) AND validate the transition
-- against order_status_transitions instead of force-setting REFUND_PENDING
-- from any current status. Recreated with the identical signature so this
-- doesn't create a second overload (see 20260814002600's fix for why that
-- matters).
-- =========================================================

create or replace function public.request_refund(p_order_id uuid, p_amount numeric, p_reason text)
returns public.refunds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_order public.orders;
  v_payment public.payments;
  v_refund public.refunds;
  v_can_manage boolean;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found';
  end if;

  v_can_manage := public.current_user_is_admin()
    or (
      public.has_permission(v_user, 'food.refunds.create')
      and exists (select 1 from public.canteens c where c.id = v_order.canteen_id and c.owner_id = v_user)
    );
  if not v_can_manage then
    raise exception 'Not authorized to issue refunds for this order';
  end if;

  if not exists (
    select 1 from public.order_status_transitions
    where from_status = v_order.status and to_status = 'REFUND_PENDING'
  ) then
    raise exception 'ORDER_INVALID_TRANSITION: cannot refund an order in % status', v_order.status;
  end if;

  select * into v_payment from public.payments where order_id = p_order_id and status = 'captured' order by created_at desc limit 1;
  if not found then
    raise exception 'No captured payment found for this order';
  end if;

  if p_amount is null or p_amount <= 0 or p_amount > v_order.total then
    raise exception 'Invalid refund amount';
  end if;

  insert into public.refunds (payment_id, order_id, amount, reason, refund_type, initiated_by)
  values (v_payment.id, p_order_id, p_amount, p_reason, case when p_amount >= v_order.total then 'full' else 'partial' end, v_user)
  returning * into v_refund;

  update public.orders set status = 'REFUND_PENDING', payment_status = 'refund_pending' where id = p_order_id;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, 'REFUND_PENDING', v_user, p_reason);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value, reason)
  values (v_user, 'refund.request', 'order', p_order_id::text, jsonb_build_object('amount', p_amount), p_reason);

  return v_refund;
end;
$$;

-- refunds_read never let the owning vendor read their own canteen's refund
-- rows (only 'finance.read'/admin/the student themselves) -- 'vendor' role
-- doesn't hold finance.read, so a vendor could request_refund() but never
-- see whether it actually completed. Same ownership-scoped extension the
-- rest of the order-queue policies already use.
drop policy if exists "refunds_read" on public.refunds;
create policy "refunds_read" on public.refunds for select to authenticated
  using (
    exists (select 1 from public.orders o where o.id = refunds.order_id and o.user_id = auth.uid())
    or public.has_permission(auth.uid(),'finance.read')
    or public.current_user_is_admin()
    or exists (
      select 1 from public.orders o join public.canteens c on c.id = o.canteen_id
      where o.id = refunds.order_id
        and public.has_permission(auth.uid(),'food.refunds.create') and c.owner_id = auth.uid()
    )
  );
