-- =============================================================================
-- CAMPUS STORE AS REAL COMMERCE (doc §28)
-- Was entirely fake: `storeItems` in src/App.jsx is a hardcoded JS array,
-- "Store" reads/writes nothing, and there is no vendor ownership of it at
-- all. This gives it its own schema, deliberately parallel to (but
-- separate from) food_ordering.sql rather than reusing `orders` --
-- `orders.canteen_id` is `not null`, and bending that live, heavily-used
-- table to also cover a different kind of merchant is a bigger and riskier
-- change than just mirroring the same proven pattern with its own tables.
-- No online payment step here (pay-at-pickup, same shape as print_jobs) --
-- Razorpay integration for this module is a separate, larger undertaking
-- not in scope for this pass.
-- =============================================================================

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid references public.campuses(id) on delete cascade,
  owner_id uuid references public.profiles(id) on delete set null,
  name text not null,
  category text not null default 'General'
    check (category in ('Stationery', 'Books', 'Electronics', 'Merch', 'Printing Supplies', 'General')),
  subtitle text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (campus_id, name)
);

create table if not exists public.store_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  description text,
  price numeric(10,2) not null default 0 check (price >= 0),
  image_url text,
  category text,
  available boolean not null default true,
  active boolean not null default true, -- never hard-delete items with order history, same reasoning as food_items
  sku text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, name)
);

drop trigger if exists store_items_set_updated_at on public.store_items;
create trigger store_items_set_updated_at
before update on public.store_items
for each row execute function public.set_updated_at();

create index if not exists stores_campus_idx on public.stores(campus_id);
create index if not exists store_items_store_idx on public.store_items(store_id);

-- =========================================================
-- ORDER STATE MACHINE -- simpler than food's (no payment gateway leg):
-- PLACED -> PACKED -> READY -> COMPLETED, with CANCEL_REQUESTED/CANCELLED
-- as an escape hatch, same shape as print_jobs's queue.
-- =========================================================

create table if not exists public.store_order_status_transitions (
  from_status text not null,
  to_status text not null,
  primary key (from_status, to_status)
);

insert into public.store_order_status_transitions (from_status, to_status) values
  ('PLACED', 'PACKED'), ('PLACED', 'CANCEL_REQUESTED'),
  ('PACKED', 'READY'), ('PACKED', 'CANCEL_REQUESTED'),
  ('READY', 'COMPLETED'),
  ('CANCEL_REQUESTED', 'CANCELLED'), ('CANCEL_REQUESTED', 'PACKED')
on conflict do nothing;

create table if not exists public.store_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  store_id uuid not null references public.stores(id),
  status text not null default 'PLACED'
    check (status in ('PLACED', 'PACKED', 'READY', 'COMPLETED', 'CANCEL_REQUESTED', 'CANCELLED')),
  subtotal numeric(10,2) not null default 0,
  platform_fee numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  pickup_code text,
  notes text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists store_orders_user_idempotency_idx
  on public.store_orders(user_id, idempotency_key) where idempotency_key is not null;

drop trigger if exists store_orders_set_updated_at on public.store_orders;
create trigger store_orders_set_updated_at
before update on public.store_orders
for each row execute function public.set_updated_at();

create table if not exists public.store_order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.store_orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by uuid references public.profiles(id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.store_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.store_orders(id) on delete cascade,
  store_item_id uuid not null references public.store_items(id),
  item_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(10,2) not null,
  total_price numeric(10,2) not null
);

create index if not exists store_orders_user_idx on public.store_orders(user_id);
create index if not exists store_orders_store_idx on public.store_orders(store_id);
create index if not exists store_order_items_order_idx on public.store_order_items(order_id);

-- =========================================================
-- RLS
-- =========================================================

alter table public.stores enable row level security;
alter table public.store_items enable row level security;
alter table public.store_order_status_transitions enable row level security;
alter table public.store_orders enable row level security;
alter table public.store_order_status_history enable row level security;
alter table public.store_order_items enable row level security;

create policy "stores_read" on public.stores for select to anon, authenticated using (active);
create policy "stores_write" on public.stores for all to authenticated
  using (public.current_user_is_admin() or (public.has_permission(auth.uid(), 'store.menu.write') and owner_id = auth.uid()))
  with check (public.current_user_is_admin() or (public.has_permission(auth.uid(), 'store.menu.write') and owner_id = auth.uid()));

create policy "store_items_read" on public.store_items for select to anon, authenticated using (active);
create policy "store_items_write" on public.store_items for all to authenticated
  using (
    public.current_user_is_admin()
    or (
      public.has_permission(auth.uid(), 'store.menu.write')
      and exists (select 1 from public.stores s where s.id = store_items.store_id and s.owner_id = auth.uid())
    )
  )
  with check (
    public.current_user_is_admin()
    or (
      public.has_permission(auth.uid(), 'store.menu.write')
      and exists (select 1 from public.stores s where s.id = store_items.store_id and s.owner_id = auth.uid())
    )
  );

create policy "store_order_status_transitions_read" on public.store_order_status_transitions for select to authenticated using (true);

-- Reads only -- writes are RPC-only (create_store_order / transition_store_order_status),
-- same "no insert/update policy for authenticated" pattern as orders/bookings.
create policy "store_orders_read" on public.store_orders for select to authenticated
  using (
    user_id = auth.uid()
    or public.current_user_is_admin()
    or (public.has_permission(auth.uid(), 'store.orders.read') and exists (select 1 from public.stores s where s.id = store_orders.store_id and s.owner_id = auth.uid()))
  );

create policy "store_order_status_history_read" on public.store_order_status_history for select to authenticated
  using (exists (
    select 1 from public.store_orders so
    where so.id = store_order_status_history.order_id
      and (so.user_id = auth.uid() or public.current_user_is_admin()
           or exists (select 1 from public.stores s where s.id = so.store_id and s.owner_id = auth.uid()))
  ));

create policy "store_order_items_read" on public.store_order_items for select to authenticated
  using (exists (
    select 1 from public.store_orders so
    where so.id = store_order_items.order_id
      and (so.user_id = auth.uid() or public.current_user_is_admin()
           or exists (select 1 from public.stores s where s.id = so.store_id and s.owner_id = auth.uid()))
  ));

-- =========================================================
-- PERMISSIONS
-- =========================================================

insert into public.permissions (key, description) values
  ('store.menu.write', 'Create/edit/archive campus store items'),
  ('store.orders.read', 'View orders for a campus store'),
  ('store.orders.update', 'Advance a campus store order through its state machine')
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.key = 'vendor' and p.key in ('store.menu.write', 'store.orders.read', 'store.orders.update')
on conflict do nothing;

-- =========================================================
-- RPC: create_store_order -- the only supported way to place a store
-- order. Mirrors create_food_order()'s shape: idempotent, row-locks
-- store_items to price off a fresh read, writes order+items atomically.
-- =========================================================

create or replace function public.create_store_order(
  p_store_id uuid,
  p_items jsonb, -- [{ "store_item_id": uuid, "quantity": int }]
  p_notes text default '',
  p_idempotency_key text default null
)
returns public.store_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_order public.store_orders;
  v_existing public.store_orders;
  v_item jsonb;
  v_product record;
  v_qty integer;
  v_subtotal numeric(10,2) := 0;
  v_platform_fee numeric(10,2) := 0;
  v_total numeric(10,2) := 0;
  v_pickup_code text;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;

  if not public.check_rate_limit(v_user, 'store_orders', 20, 3600) then
    raise exception 'RATE_LIMITED: too many orders placed, slow down';
  end if;

  if p_idempotency_key is not null then
    select * into v_existing from public.store_orders
      where user_id = v_user and idempotency_key = p_idempotency_key;
    if found then
      return v_existing;
    end if;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Cart is empty';
  end if;

  v_pickup_code := lpad((floor(random() * 1000000))::text, 6, '0');

  insert into public.store_orders (user_id, store_id, status, notes, pickup_code, idempotency_key)
  values (v_user, p_store_id, 'PLACED', coalesce(p_notes, ''), v_pickup_code, p_idempotency_key)
  returning * into v_order;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := coalesce((v_item->>'quantity')::integer, 0);
    if v_qty <= 0 then
      raise exception 'Invalid quantity for item %', v_item->>'store_item_id';
    end if;

    select id, name, price, store_id, available, active
      into v_product
      from public.store_items
      where id = (v_item->>'store_item_id')::uuid
      for update;

    if not found or not v_product.active then
      raise exception 'ORDER_ITEM_UNAVAILABLE: % is no longer sold here', coalesce(v_product.name, 'Item');
    end if;

    if not v_product.available then
      raise exception 'ORDER_ITEM_UNAVAILABLE: % is currently out of stock', v_product.name;
    end if;

    if v_product.store_id <> p_store_id then
      raise exception 'ORDER_SINGLE_STORE: all items must come from the same store';
    end if;

    insert into public.store_order_items (order_id, store_item_id, item_name, quantity, unit_price, total_price)
    values (v_order.id, v_product.id, v_product.name, v_qty, v_product.price, v_product.price * v_qty);

    v_subtotal := v_subtotal + (v_product.price * v_qty);
  end loop;

  v_total := round(v_subtotal + v_platform_fee, 2);

  update public.store_orders
    set subtotal = round(v_subtotal, 2), platform_fee = v_platform_fee, total = v_total
    where id = v_order.id
    returning * into v_order;

  insert into public.store_order_status_history (order_id, from_status, to_status, changed_by)
  values (v_order.id, null, 'PLACED', v_user);

  return v_order;
end;
$$;

-- =========================================================
-- RPC: transition_store_order_status -- server-enforced state machine.
-- Students may only request CANCEL_REQUESTED on their own order. The
-- owning store's vendor (store.orders.update) or an admin drives the rest.
-- =========================================================

create or replace function public.transition_store_order_status(
  p_order_id uuid,
  p_to_status text,
  p_reason text default null
)
returns public.store_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_order public.store_orders;
  v_is_owner_vendor boolean;
  v_from_status text;
begin
  if v_user is null then raise exception 'Sign in required'; end if;

  select * into v_order from public.store_orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;

  v_is_owner_vendor := public.has_permission(v_user, 'store.orders.update')
    and exists (select 1 from public.stores s where s.id = v_order.store_id and s.owner_id = v_user);

  if v_order.user_id = v_user and p_to_status = 'CANCEL_REQUESTED' then
    null; -- a student may always request cancellation of their own order
  elsif v_is_owner_vendor or public.current_user_is_admin() then
    null;
  else
    raise exception 'Not authorized to update this order';
  end if;

  if not exists (
    select 1 from public.store_order_status_transitions
    where from_status = v_order.status and to_status = p_to_status
  ) then
    raise exception 'Invalid transition % -> %', v_order.status, p_to_status;
  end if;

  v_from_status := v_order.status;

  update public.store_orders set status = p_to_status where id = p_order_id returning * into v_order;

  insert into public.store_order_status_history (order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_from_status, p_to_status, v_user, p_reason);

  perform public.create_notification(
    v_order.user_id, 'Store order updated',
    'Order ' || upper(left(v_order.id::text, 8)) || ' is now ' || replace(initcap(lower(p_to_status)), '_', ' '),
    'order', 'store_order', v_order.id::text
  );

  return v_order;
end;
$$;

grant execute on function public.create_store_order(uuid, jsonb, text, text) to authenticated;
grant execute on function public.transition_store_order_status(uuid, text, text) to authenticated;

-- =========================================================
-- Suspension enforcement + realtime, same idioms already used everywhere
-- else in this schema.
-- =========================================================

drop trigger if exists store_orders_reject_if_suspended on public.store_orders;
create trigger store_orders_reject_if_suspended
before insert on public.store_orders
for each row execute function public.reject_if_suspended();

do $$
declare
  t text;
  tables text[] := array['stores', 'store_items', 'store_orders'];
begin
  foreach t in array tables loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
