-- =============================================================================
-- CAMPUS STORE, part 5: GST configuration, invoice generation, and a
-- self-service settlement report -- bringing Store up to the same
-- settlement/invoice depth food_billing_payouts.sql (20260817000700) already
-- gave Food (readiness-audit phase 04's engineering-doable subset: the
-- KYC/live-Razorpay-account half of "real payment gateway" is user-blocked,
-- but this doesn't need a live account -- Store has never taken an online
-- payment at all, see 20260815000100's note, so there's nothing to gate on).
--
-- Deliberately NOT mirrored: a vendor_payouts-equivalent. Food's payout
-- system exists because Razorpay holds the customer's money and the
-- platform then pays the vendor out of it. Store is pay-at-pickup -- the
-- vendor collects cash/UPI directly from the student at handover, so no
-- money ever passes through the platform for a payout to release. An
-- invoice (for GST record-keeping) and a sales report (for the vendor's
-- own bookkeeping) are still real gaps; a payout ledger would be modeling
-- money movement that doesn't happen here.
--
-- Also fixes a real regression found while reading transition_store_order_
-- status to extend it: 20260815000900 added a restore_store_order_stock()
-- call on the CANCELLED transition (so a cancelled order's stock isn't
-- lost forever); 20260819000300 (vendor manager accounts) redefined the
-- same function -- to switch its ownership check to the new is_store_owner()
-- helper -- from what was evidently an older copy that predates the stock-
-- restore fix, silently dropping that call. restore_store_order_stock()
-- itself was untouched and still exists; nothing has called it since 19
-- Aug. Every tracked-stock item on a store order cancelled since then has
-- permanently lost that stock. Restored below, on top of the current
-- (is_store_owner-based) function body -- no unrelated behavior change.
-- =============================================================================

-- =========================================================
-- GST configuration -- same self-editable-by-owner shape as canteens.gst_number
-- /gst_registered (20260817000700); stores_write already lets the owner
-- update their own row, no new RPC needed.
-- =========================================================

alter table public.stores add column if not exists gst_number text;
alter table public.stores add column if not exists gst_registered boolean not null default false;

-- =========================================================
-- Tax on store items -- store_items never had a tax_rate at all (food_items
-- has carried one since 20260814000300). Same column shape, same 5% GST
-- default. store_order_items.total_price already existed; store_orders
-- gets tax_amount alongside subtotal/platform_fee/total, matching orders'
-- shape.
-- =========================================================

alter table public.store_items add column if not exists tax_rate numeric(5,4) not null default 0.05;
alter table public.store_orders add column if not exists tax_amount numeric(10,2) not null default 0;

-- =========================================================
-- create_store_order -- recreated with the identical (uuid, jsonb, text,
-- text) signature as the current (20260815000900) body, adding tax
-- computation. Tax is charged off the parent item's tax_rate regardless of
-- which variant was ordered, same convention food uses (food_item_variants
-- carries no tax_rate of its own either -- see 20260817000500/20260824000200).
-- Everything else here -- variant handling, stock decrement, idempotency --
-- is unchanged from the current body.
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
  v_tax numeric(10,2) := 0;
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

    select id, name, price, store_id, available, active, track_stock, stock_quantity, tax_rate
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
    v_tax := v_tax + (v_unit_price * v_qty * v_product.tax_rate);
  end loop;

  v_total := round(v_subtotal + v_tax + v_platform_fee, 2);

  update public.store_orders
    set subtotal = round(v_subtotal, 2), tax_amount = round(v_tax, 2), platform_fee = v_platform_fee, total = v_total
    where id = v_order.id
    returning * into v_order;

  insert into public.store_order_status_history (order_id, from_status, to_status, changed_by)
  values (v_order.id, null, 'PLACED', v_user);

  return v_order;
end;
$$;

grant execute on function public.create_store_order(uuid, jsonb, text, text) to authenticated;

-- =========================================================
-- Regression fix: transition_store_order_status -- identical to the current
-- (20260819000300) body, with the CANCELLED -> restore_store_order_stock()
-- call (20260815000900) reinstated. See header note.
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

  v_is_owner_vendor := public.has_permission(v_user, 'store.orders.update') and public.is_store_owner(v_user, v_order.store_id);

  if v_order.user_id = v_user and p_to_status = 'CANCEL_REQUESTED' then
    null;
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

grant execute on function public.transition_store_order_status(uuid, text, text) to authenticated;

-- =========================================================
-- INVOICES -- one per store order, generated on demand, idempotent (unique
-- on order_id). Gated on COMPLETED rather than a payment_status (store
-- orders don't have one -- pay-at-pickup means the "money changed hands"
-- moment food gates on is, here, the pickup itself).
-- =========================================================

create sequence if not exists public.store_order_invoice_seq;

create table if not exists public.store_order_invoices (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.store_orders(id) on delete cascade,
  invoice_number text not null unique,
  store_id uuid not null references public.stores(id),
  user_id uuid not null references public.profiles(id),
  subtotal numeric(10,2) not null,
  tax_amount numeric(10,2) not null,
  cgst_amount numeric(10,2) not null default 0,
  sgst_amount numeric(10,2) not null default 0,
  platform_fee numeric(10,2) not null default 0,
  total numeric(10,2) not null,
  gst_number text,
  issued_at timestamptz not null default now()
);

alter table public.store_order_invoices enable row level security;

drop policy if exists "store_order_invoices_read" on public.store_order_invoices;
create policy "store_order_invoices_read" on public.store_order_invoices for select to authenticated
  using (
    user_id = auth.uid()
    or public.current_user_is_admin()
    or public.is_store_owner(auth.uid(), store_id)
  );
-- No insert/update/delete policy for authenticated -- generate_store_order_invoice() only.

create or replace function public.generate_store_order_invoice(p_order_id uuid)
returns public.store_order_invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_order public.store_orders;
  v_store public.stores;
  v_existing public.store_order_invoices;
  v_invoice public.store_order_invoices;
  v_cgst numeric(10,2);
  v_sgst numeric(10,2);
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;

  select * into v_order from public.store_orders where id = p_order_id;
  if not found then
    raise exception 'Order not found';
  end if;

  if not (v_order.user_id = v_user or public.current_user_is_admin() or public.is_store_owner(v_user, v_order.store_id)) then
    raise exception 'Not authorized to view this order''s invoice';
  end if;

  if v_order.status <> 'COMPLETED' then
    raise exception 'INVOICE_NOT_READY: invoice is available once the order has been picked up';
  end if;

  select * into v_existing from public.store_order_invoices where order_id = p_order_id;
  if found then
    return v_existing;
  end if;

  select * into v_store from public.stores where id = v_order.store_id;

  if v_store.gst_registered then
    v_cgst := round(v_order.tax_amount / 2, 2);
    v_sgst := v_order.tax_amount - v_cgst;
  else
    v_cgst := 0;
    v_sgst := 0;
  end if;

  insert into public.store_order_invoices (
    order_id, invoice_number, store_id, user_id, subtotal, tax_amount, cgst_amount, sgst_amount,
    platform_fee, total, gst_number
  ) values (
    p_order_id,
    'SINV-' || to_char(now(), 'YYYYMM') || '-' || lpad(nextval('public.store_order_invoice_seq')::text, 6, '0'),
    v_order.store_id, v_order.user_id, v_order.subtotal, v_order.tax_amount, v_cgst, v_sgst,
    v_order.platform_fee, v_order.total,
    case when v_store.gst_registered then v_store.gst_number else null end
  )
  on conflict (order_id) do nothing
  returning * into v_invoice;

  if v_invoice.id is null then
    select * into v_invoice from public.store_order_invoices where order_id = p_order_id;
  end if;

  return v_invoice;
end;
$$;

grant execute on function public.generate_store_order_invoice(uuid) to authenticated;

-- =========================================================
-- RPC: store_settlement_report -- self-service sales report for the store
-- OWNER (financial, so owner-only, not manager staff -- same posture as
-- vendor_settlement_report / food_billing_payouts.sql's header note). Every
-- COMPLETED order in the window; no refund leg (no online payment to refund)
-- and no payout leg (see the migration header for why).
-- =========================================================

create or replace function public.store_settlement_report(p_start date, p_end date)
returns table (
  row_type text,
  occurred_on date,
  order_id uuid,
  description text,
  gross_amount numeric,
  platform_fee numeric,
  net_amount numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_store uuid;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;

  select id into v_store from public.stores where owner_id = v_user limit 1;
  if v_store is null and not public.current_user_is_admin() then
    raise exception 'No store assigned to this account';
  end if;

  return query
  select
    'order'::text as row_type, so.updated_at::date as occurred_on, so.id as order_id,
    ('Order ' || upper(left(so.id::text, 8)))::text as description,
    (so.subtotal + so.tax_amount)::numeric as gross_amount, so.platform_fee::numeric as platform_fee,
    (so.subtotal + so.tax_amount - so.platform_fee)::numeric as net_amount
  from public.store_orders so
  where so.store_id = v_store and so.status = 'COMPLETED'
    and so.updated_at::date between p_start and p_end
  order by occurred_on;
end;
$$;

grant execute on function public.store_settlement_report(date, date) to authenticated;
