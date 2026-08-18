-- =============================================================================
-- FOOD ORDERING hardening, part 3/4: stock adjustment audit trail + vendor
-- inventory reports. Builds on 20260815000800_food_stock_tracking.sql (opt-in
-- track_stock) and 20260817000500_food_menu_depth.sql (variants) -- every
-- stock change, whichever of the 4 causes triggers it, now leaves a row
-- behind: who/when/why/how much/resulting balance.
-- =============================================================================

create table if not exists public.stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  food_item_id uuid not null references public.food_items(id) on delete cascade,
  variant_id uuid references public.food_item_variants(id) on delete set null,
  delta integer not null,
  resulting_quantity integer,
  source text not null check (source in ('order_consume','order_restore','manual_restock','manual_correction')),
  reason text,
  order_id uuid references public.orders(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists stock_adjustments_item_idx on public.stock_adjustments(food_item_id, created_at desc);
create index if not exists stock_adjustments_variant_idx on public.stock_adjustments(variant_id, created_at desc) where variant_id is not null;

alter table public.stock_adjustments enable row level security;

drop policy if exists "stock_adjustments_read" on public.stock_adjustments;
create policy "stock_adjustments_read" on public.stock_adjustments for select to authenticated
  using (
    public.current_user_is_admin()
    or exists (select 1 from public.food_items fi where fi.id = stock_adjustments.food_item_id and public.can_manage_canteen_orders(auth.uid(), fi.canteen_id))
  );
-- No insert/update/delete policy for authenticated -- only written by the
-- SECURITY DEFINER functions below, which bypass RLS by running as owner.

-- =========================================================
-- adjust_stock_for_order -- rebuilt to also handle a variant-level
-- decrement/restore (order_items.variant_id, added by the menu-depth
-- migration) and to log every real movement into stock_adjustments.
-- Recreated with the identical signature so this doesn't create a second
-- overload; still revoked from anon/authenticated below (only reachable via
-- record_payment_event / transition_order_status).
-- =========================================================

create or replace function public.adjust_stock_for_order(p_order_id uuid, p_direction integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line record;
  v_new_qty integer;
  v_source text;
begin
  v_source := case when p_direction < 0 then 'order_consume' else 'order_restore' end;

  for v_line in
    select oi.food_item_id, oi.variant_id, oi.quantity
    from public.order_items oi
    where oi.order_id = p_order_id
  loop
    if v_line.variant_id is not null then
      update public.food_item_variants
        set stock_quantity = greatest(coalesce(stock_quantity, 0) + p_direction * v_line.quantity, 0),
            available = case
              when p_direction < 0 and coalesce(stock_quantity, 0) + p_direction * v_line.quantity <= 0 then false
              else available
            end
        where id = v_line.variant_id
          and track_stock
          and stock_quantity is not null
        returning stock_quantity into v_new_qty;

      if found then
        insert into public.stock_adjustments (food_item_id, variant_id, delta, resulting_quantity, source, order_id)
        values (v_line.food_item_id, v_line.variant_id, p_direction * v_line.quantity, v_new_qty, v_source, p_order_id);
      end if;
    else
      update public.food_items
        set stock_quantity = greatest(coalesce(stock_quantity, 0) + p_direction * v_line.quantity, 0),
            available = case
              when p_direction < 0 and coalesce(stock_quantity, 0) + p_direction * v_line.quantity <= 0 then false
              else available
            end
        where id = v_line.food_item_id
          and track_stock
          and stock_quantity is not null
        returning stock_quantity into v_new_qty;

      if found then
        insert into public.stock_adjustments (food_item_id, variant_id, delta, resulting_quantity, source, order_id)
        values (v_line.food_item_id, null, p_direction * v_line.quantity, v_new_qty, v_source, p_order_id);
      end if;
    end if;
  end loop;
end;
$$;

revoke execute on function public.adjust_stock_for_order(uuid, integer) from public, anon, authenticated;

-- =========================================================
-- RPC: adjust_item_stock -- manual restock/correction. Treated as an
-- operational task (like accepting/rejecting orders), not a
-- pricing/menu-structure change, so canteen staff sub-accounts may call
-- this too, not just the owner.
-- =========================================================

create or replace function public.adjust_item_stock(p_food_item_id uuid, p_variant_id uuid, p_delta integer, p_reason text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_canteen_id uuid;
  v_track boolean;
  v_qty integer;
  v_new_qty integer;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;
  if p_delta = 0 then
    raise exception 'Delta must be nonzero';
  end if;

  select canteen_id into v_canteen_id from public.food_items where id = p_food_item_id;
  if v_canteen_id is null then
    raise exception 'Item not found';
  end if;

  if not (public.has_permission(v_user, 'food.orders.update') and public.can_manage_canteen_orders(v_user, v_canteen_id)) then
    raise exception 'Not authorized to adjust stock for this canteen';
  end if;

  if p_variant_id is not null then
    select track_stock, stock_quantity into v_track, v_qty
      from public.food_item_variants where id = p_variant_id and food_item_id = p_food_item_id for update;
    if not found then
      raise exception 'Option not found for this item';
    end if;
    if not v_track or v_qty is null then
      raise exception 'Stock tracking is not enabled for this option';
    end if;

    v_new_qty := greatest(v_qty + p_delta, 0);
    update public.food_item_variants
      set stock_quantity = v_new_qty,
          available = case when v_new_qty <= 0 then false else available end
      where id = p_variant_id;
  else
    select track_stock, stock_quantity into v_track, v_qty
      from public.food_items where id = p_food_item_id for update;
    if not v_track or v_qty is null then
      raise exception 'Stock tracking is not enabled for this item';
    end if;

    v_new_qty := greatest(v_qty + p_delta, 0);
    update public.food_items
      set stock_quantity = v_new_qty,
          available = case when v_new_qty <= 0 then false else available end
      where id = p_food_item_id;
  end if;

  insert into public.stock_adjustments (food_item_id, variant_id, delta, resulting_quantity, source, reason, actor_id)
  values (p_food_item_id, p_variant_id, p_delta, v_new_qty,
          case when p_delta > 0 then 'manual_restock' else 'manual_correction' end, p_reason, v_user);

  return v_new_qty;
end;
$$;

grant execute on function public.adjust_item_stock(uuid, uuid, integer, text) to authenticated;

-- =========================================================
-- RPC: vendor_inventory_report -- current stock levels (items + variants)
-- for the caller's own canteen (owner or staff), flagging low stock, plus a
-- rolling consumed/restocked movement summary from stock_adjustments.
-- =========================================================

create or replace function public.vendor_inventory_report(p_days integer default 30)
returns table (
  food_item_id uuid,
  item_name text,
  variant_id uuid,
  variant_name text,
  track_stock boolean,
  stock_quantity integer,
  low_stock_threshold integer,
  low_stock boolean,
  available boolean,
  consumed_qty bigint,
  restocked_qty bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_canteen uuid;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;

  select id into v_canteen from public.canteens where owner_id = v_user limit 1;
  if v_canteen is null then
    select csa.canteen_id into v_canteen from public.canteen_staff_accounts csa where csa.user_id = v_user and csa.active limit 1;
  end if;
  if v_canteen is null and not public.current_user_is_admin() then
    raise exception 'No canteen assigned to this account';
  end if;

  return query
  select
    fi.id as food_item_id, fi.name as item_name, null::uuid as variant_id, null::text as variant_name,
    fi.track_stock as track_stock, fi.stock_quantity as stock_quantity, fi.low_stock_threshold as low_stock_threshold,
    (fi.track_stock and fi.stock_quantity is not null and fi.stock_quantity <= fi.low_stock_threshold) as low_stock,
    fi.available as available,
    coalesce((select sum(-sa.delta) from public.stock_adjustments sa
      where sa.food_item_id = fi.id and sa.variant_id is null and sa.delta < 0
        and sa.created_at >= now() - (greatest(p_days, 1) || ' days')::interval), 0)::bigint as consumed_qty,
    coalesce((select sum(sa.delta) from public.stock_adjustments sa
      where sa.food_item_id = fi.id and sa.variant_id is null and sa.delta > 0
        and sa.created_at >= now() - (greatest(p_days, 1) || ' days')::interval), 0)::bigint as restocked_qty
  from public.food_items fi
  where fi.canteen_id = v_canteen and fi.active and fi.track_stock
  union all
  select
    fi.id, fi.name, fv.id, fv.name,
    fv.track_stock, fv.stock_quantity, fv.low_stock_threshold,
    (fv.track_stock and fv.stock_quantity is not null and fv.stock_quantity <= fv.low_stock_threshold),
    fv.available,
    coalesce((select sum(-sa.delta) from public.stock_adjustments sa
      where sa.variant_id = fv.id and sa.delta < 0
        and sa.created_at >= now() - (greatest(p_days, 1) || ' days')::interval), 0)::bigint,
    coalesce((select sum(sa.delta) from public.stock_adjustments sa
      where sa.variant_id = fv.id and sa.delta > 0
        and sa.created_at >= now() - (greatest(p_days, 1) || ' days')::interval), 0)::bigint
  from public.food_item_variants fv
  join public.food_items fi on fi.id = fv.food_item_id
  where fi.canteen_id = v_canteen and fv.active and fv.track_stock
  order by low_stock desc, item_name;
end;
$$;

grant execute on function public.vendor_inventory_report(integer) to authenticated;
