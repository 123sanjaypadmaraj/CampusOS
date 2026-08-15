-- =============================================================================
-- CAMPUS STORE: stock/inventory tracking, product variants, and store
-- analytics (doc §28, closing 3 of the 8 gaps found against the full
-- commerce list -- user explicitly prioritized these three; real payments,
-- promotions, returns/refunds, delivery, and multi-staff-per-store are
-- deliberately still deferred).
--
-- Stock tracking mirrors 20260815000800_food_stock_tracking.sql's shape
-- (opt-in per item via track_stock, untouched items behave exactly as
-- before). Unlike food, store orders have no payment-gateway leg (pay at
-- pickup, see 20260815000100_campus_store.sql) -- PLACED *is* the confirmed-
-- order moment, so stock is decremented right inside create_store_order
-- rather than at a separate payment-capture step, and restored whenever an
-- order reaches CANCELLED (which food only does conditionally, because food
-- can be cancelled before payment ever decremented anything -- store orders
-- have no such pre-decrement state).
--
-- Variants are new: a single-attribute option per item (e.g. size/colour),
-- each with its own price and, optionally, its own stock. Deliberately not
-- a full multi-attribute (size x colour) matrix -- this store's catalog
-- (merch, stationery, books) doesn't need that complexity yet.
-- =============================================================================

-- =========================================================
-- STOCK TRACKING (store_items) -- identical shape to food_items'.
-- =========================================================

alter table public.store_items add column if not exists track_stock boolean not null default false;
alter table public.store_items add column if not exists stock_quantity integer;
alter table public.store_items add column if not exists low_stock_threshold integer not null default 5;

do $$ begin
  alter table public.store_items add constraint store_items_stock_quantity_check check (stock_quantity is null or stock_quantity >= 0);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.store_items add constraint store_items_low_stock_threshold_check check (low_stock_threshold >= 0);
exception when duplicate_object then null;
end $$;

-- =========================================================
-- PRODUCT VARIANTS
-- =========================================================

create table if not exists public.store_item_variants (
  id uuid primary key default gen_random_uuid(),
  store_item_id uuid not null references public.store_items(id) on delete cascade,
  name text not null, -- e.g. "Small", "Red", "500ml"
  price numeric(10,2) not null default 0 check (price >= 0),
  sku text,
  available boolean not null default true,
  active boolean not null default true, -- archive flag; order history keeps its own item_name/variant_name snapshot regardless
  track_stock boolean not null default false,
  stock_quantity integer,
  low_stock_threshold integer not null default 5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_item_id, name)
);

do $$ begin
  alter table public.store_item_variants add constraint store_item_variants_stock_quantity_check check (stock_quantity is null or stock_quantity >= 0);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.store_item_variants add constraint store_item_variants_low_stock_threshold_check check (low_stock_threshold >= 0);
exception when duplicate_object then null;
end $$;

drop trigger if exists store_item_variants_set_updated_at on public.store_item_variants;
create trigger store_item_variants_set_updated_at
before update on public.store_item_variants
for each row execute function public.set_updated_at();

create index if not exists store_item_variants_item_idx on public.store_item_variants(store_item_id);

alter table public.store_item_variants enable row level security;

-- Same "active only, availability shown not hidden" convention as
-- store_items_read (unavailable/out-of-stock variants still render, just
-- greyed out client-side).
create policy "store_item_variants_read" on public.store_item_variants for select to anon, authenticated
  using (active and exists (select 1 from public.store_items si where si.id = store_item_variants.store_item_id and si.active));

create policy "store_item_variants_write" on public.store_item_variants for all to authenticated
  using (
    public.current_user_is_admin()
    or (
      public.has_permission(auth.uid(), 'store.menu.write')
      and exists (
        select 1 from public.store_items si
        join public.stores s on s.id = si.store_id
        where si.id = store_item_variants.store_item_id and s.owner_id = auth.uid()
      )
    )
  )
  with check (
    public.current_user_is_admin()
    or (
      public.has_permission(auth.uid(), 'store.menu.write')
      and exists (
        select 1 from public.store_items si
        join public.stores s on s.id = si.store_id
        where si.id = store_item_variants.store_item_id and s.owner_id = auth.uid()
      )
    )
  );

-- Order-item snapshot columns. variant_id is ON DELETE SET NULL (unlike
-- store_item_id, which has no ON DELETE clause and so blocks a hard delete
-- via FK violation once order history exists) -- a variant can always be
-- hard-deleted; item_name/variant_name text snapshots keep order history
-- readable even after that.
alter table public.store_order_items add column if not exists variant_id uuid references public.store_item_variants(id) on delete set null;
alter table public.store_order_items add column if not exists variant_name text;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'store_item_variants'
  ) then
    execute 'alter publication supabase_realtime add table public.store_item_variants';
  end if;
end $$;

-- =========================================================
-- create_store_order -- rebuilt to support variants and to actually
-- decrement stock. Recreated with the identical signature (uuid, jsonb,
-- text, text) so this doesn't create a second overload (see
-- 20260814002700's fix for why that matters). p_items entries may now
-- optionally carry "variant_id"; price/name/stock come from the variant
-- when present, from the parent item otherwise.
-- =========================================================

create or replace function public.create_store_order(
  p_store_id uuid,
  p_items jsonb, -- [{ "store_item_id": uuid, "variant_id": uuid|null, "quantity": int }]
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
  v_variant record;
  v_variant_id uuid;
  v_qty integer;
  v_unit_price numeric(10,2);
  v_item_name text;
  v_variant_name text;
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

    select id, name, price, store_id, available, active, track_stock, stock_quantity
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

    v_variant_id := nullif(v_item->>'variant_id', '')::uuid;
    v_unit_price := v_product.price;
    v_item_name := v_product.name;
    v_variant_name := null;

    if v_variant_id is not null then
      select id, store_item_id, name, price, available, active, track_stock, stock_quantity
        into v_variant
        from public.store_item_variants
        where id = v_variant_id
        for update;

      if not found or not v_variant.active or v_variant.store_item_id <> v_product.id then
        raise exception 'ORDER_ITEM_UNAVAILABLE: that option is no longer available for %', v_product.name;
      end if;

      if not v_variant.available then
        raise exception 'ORDER_ITEM_UNAVAILABLE: % (%) is currently out of stock', v_product.name, v_variant.name;
      end if;

      if v_variant.track_stock and coalesce(v_variant.stock_quantity, 0) < v_qty then
        raise exception 'ORDER_ITEM_UNAVAILABLE: not enough stock of % (%) left', v_product.name, v_variant.name;
      end if;

      v_unit_price := v_variant.price;
      v_variant_name := v_variant.name;
      v_item_name := v_product.name || ' (' || v_variant.name || ')';

      if v_variant.track_stock then
        update public.store_item_variants
          set stock_quantity = stock_quantity - v_qty,
              available = case when stock_quantity - v_qty <= 0 then false else available end
          where id = v_variant.id;
      end if;
    else
      if v_product.track_stock and coalesce(v_product.stock_quantity, 0) < v_qty then
        raise exception 'ORDER_ITEM_UNAVAILABLE: not enough stock of % left', v_product.name;
      end if;

      if v_product.track_stock then
        update public.store_items
          set stock_quantity = stock_quantity - v_qty,
              available = case when stock_quantity - v_qty <= 0 then false else available end
          where id = v_product.id;
      end if;
    end if;

    insert into public.store_order_items (order_id, store_item_id, variant_id, item_name, variant_name, quantity, unit_price, total_price)
    values (v_order.id, v_product.id, v_variant_id, v_item_name, v_variant_name, v_qty, v_unit_price, v_unit_price * v_qty);

    v_subtotal := v_subtotal + (v_unit_price * v_qty);
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
-- restore_store_order_stock -- restores stock for every tracked item/
-- variant on an order. Called only from transition_store_order_status
-- below, when an order reaches CANCELLED. Unlike food (which only restores
-- if the order had passed a payment step), store orders always decrement
-- at PLACED, so cancellation always restores. Does NOT auto-flip
-- available back to true (the vendor may have hidden it for an unrelated
-- reason), matching food's convention.
-- =========================================================

create or replace function public.restore_store_order_stock(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
begin
  for v_item in
    select store_item_id, variant_id, quantity
    from public.store_order_items
    where order_id = p_order_id
  loop
    if v_item.variant_id is not null then
      update public.store_item_variants
        set stock_quantity = stock_quantity + v_item.quantity
        where id = v_item.variant_id and track_stock and stock_quantity is not null;
    else
      update public.store_items
        set stock_quantity = stock_quantity + v_item.quantity
        where id = v_item.store_item_id and track_stock and stock_quantity is not null;
    end if;
  end loop;
end;
$$;

revoke execute on function public.restore_store_order_stock(uuid) from public, anon, authenticated;

-- =========================================================
-- transition_store_order_status -- recreated with the identical signature,
-- based on the latest (and, per grep, only) prior version in
-- 20260815000100_campus_store.sql, plus a stock-restore call on CANCELLED.
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

  if p_to_status = 'CANCELLED' then
    perform public.restore_store_order_stock(p_order_id);
  end if;

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
-- STORE ANALYTICS -- reuses vendor_gmv_series()/vendor_sla_summary() from
-- 20260814005000_analytics.sql (confirmed via grep to be the only prior
-- definition of each) by adding a third owner-lookup branch alongside the
-- existing canteen/print-shop ones, so StoreDashboard.jsx can mount the
-- same VendorAnalytics component the other two vendor types already use.
-- Store orders have no payment_status (pay-at-pickup); COMPLETED is the
-- revenue-realized signal. SLA target is a flat 24h PLACED->COMPLETED
-- (pickup merch, not perishable food -- no stated target in the doc).
-- =========================================================

create or replace function public.vendor_gmv_series(p_days integer default 30)
returns table (day date, gmv numeric, orders_count bigint, aov numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_canteen uuid;
  v_print_campus uuid;
  v_store uuid;
begin
  if v_user is null then raise exception 'Sign in required'; end if;

  select id into v_canteen from public.canteens where owner_id = v_user limit 1;
  if v_canteen is not null then
    return query
      select gs.d::date,
        coalesce(sum(o.total), 0)::numeric,
        count(o.id),
        case when count(o.id) > 0 then round(sum(o.total) / count(o.id), 2) else 0 end
      from generate_series(current_date - (greatest(p_days,1) - 1), current_date, interval '1 day') gs(d)
      left join public.orders o on o.canteen_id = v_canteen and o.created_at::date = gs.d::date and o.payment_status = 'paid'
      group by gs.d
      order by gs.d;
    return;
  end if;

  select campus_id into v_print_campus from public.print_rate_card where owner_id = v_user limit 1;
  if v_print_campus is not null then
    return query
      select gs.d::date,
        coalesce(sum(pj.price), 0)::numeric,
        count(pj.id),
        case when count(pj.id) > 0 then round(sum(pj.price) / count(pj.id), 2) else 0 end
      from generate_series(current_date - (greatest(p_days,1) - 1), current_date, interval '1 day') gs(d)
      left join public.print_jobs pj on pj.campus_id = v_print_campus and pj.created_at::date = gs.d::date and pj.status not in ('CANCELLED','FAILED')
      group by gs.d
      order by gs.d;
    return;
  end if;

  select id into v_store from public.stores where owner_id = v_user limit 1;
  if v_store is not null then
    return query
      select gs.d::date,
        coalesce(sum(so.total), 0)::numeric,
        count(so.id),
        case when count(so.id) > 0 then round(sum(so.total) / count(so.id), 2) else 0 end
      from generate_series(current_date - (greatest(p_days,1) - 1), current_date, interval '1 day') gs(d)
      left join public.store_orders so on so.store_id = v_store and so.created_at::date = gs.d::date and so.status = 'COMPLETED'
      group by gs.d
      order by gs.d;
    return;
  end if;

  raise exception 'No vendor profile (canteen, print shop, or store) assigned to this account';
end;
$$;

grant execute on function public.vendor_gmv_series(integer) to authenticated;

create or replace function public.vendor_sla_summary(p_days integer default 30)
returns table (domain text, total bigint, within_sla bigint, breached bigint, avg_minutes numeric, sla_met_pct numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_canteen uuid;
  v_print_campus uuid;
  v_store uuid;
begin
  if v_user is null then raise exception 'Sign in required'; end if;

  select id into v_canteen from public.canteens where owner_id = v_user limit 1;
  if v_canteen is not null then
    return query
      select 'food_order'::text,
        count(*),
        count(*) filter (where updated_at - created_at <= interval '30 minutes'),
        count(*) filter (where updated_at - created_at > interval '30 minutes'),
        round(avg(extract(epoch from (updated_at - created_at)) / 60)::numeric, 1),
        case when count(*) > 0 then round(100.0 * count(*) filter (where updated_at - created_at <= interval '30 minutes') / count(*), 1) else null end
      from public.orders
      where canteen_id = v_canteen and status in ('COMPLETED','DELIVERED')
        and created_at >= now() - (greatest(p_days,1) || ' days')::interval;
    return;
  end if;

  select campus_id into v_print_campus from public.print_rate_card where owner_id = v_user limit 1;
  if v_print_campus is not null then
    return query
      select 'print_job'::text,
        count(*),
        count(*) filter (where updated_at - created_at <= interval '120 minutes'),
        count(*) filter (where updated_at - created_at > interval '120 minutes'),
        round(avg(extract(epoch from (updated_at - created_at)) / 60)::numeric, 1),
        case when count(*) > 0 then round(100.0 * count(*) filter (where updated_at - created_at <= interval '120 minutes') / count(*), 1) else null end
      from public.print_jobs
      where campus_id = v_print_campus and status in ('READY','COLLECTED')
        and created_at >= now() - (greatest(p_days,1) || ' days')::interval;
    return;
  end if;

  select id into v_store from public.stores where owner_id = v_user limit 1;
  if v_store is not null then
    return query
      select 'store_order'::text,
        count(*),
        count(*) filter (where updated_at - created_at <= interval '24 hours'),
        count(*) filter (where updated_at - created_at > interval '24 hours'),
        round(avg(extract(epoch from (updated_at - created_at)) / 60)::numeric, 1),
        case when count(*) > 0 then round(100.0 * count(*) filter (where updated_at - created_at <= interval '24 hours') / count(*), 1) else null end
      from public.store_orders
      where store_id = v_store and status = 'COMPLETED'
        and created_at >= now() - (greatest(p_days,1) || ' days')::interval;
    return;
  end if;

  raise exception 'No vendor profile (canteen, print shop, or store) assigned to this account';
end;
$$;

grant execute on function public.vendor_sla_summary(integer) to authenticated;
