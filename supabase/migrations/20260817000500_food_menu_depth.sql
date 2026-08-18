-- =============================================================================
-- FOOD ORDERING hardening, part 2/4: menu variants, add-ons/modifiers,
-- availability schedules (item-level time windows + real canteen opening
-- hours/holiday/temporary-closure, replacing the current manual-only
-- Open/Busy/Closed status toggle), and richer dietary metadata.
--
-- Variants/add-ons mirror the shape already shipped for Campus Store
-- (20260815000900_campus_store_variants_stock_analytics.sql) as closely as
-- the domain allows -- same opt-in, same order-item snapshot convention, so
-- order history survives a hard-deleted variant/add-on.
-- =============================================================================

-- =========================================================
-- DIETARY METADATA -- is_vegetarian stays (used everywhere already); these
-- are additive, opt-in (default empty/null = "not specified", never hides
-- an item that hasn't been tagged yet).
-- =========================================================

alter table public.food_items add column if not exists dietary_tags text[] not null default '{}';
alter table public.food_items add column if not exists allergens text[] not null default '{}';
alter table public.food_items add column if not exists spice_level text;
alter table public.food_items add column if not exists calories integer check (calories is null or calories >= 0);

do $$ begin
  alter table public.food_items add constraint food_items_spice_level_check
    check (spice_level is null or spice_level in ('mild','medium','hot','extra_hot'));
exception when duplicate_object then null;
end $$;

-- =========================================================
-- ITEM-LEVEL AVAILABILITY WINDOWS -- e.g. "breakfast items, 7-11am only".
-- Opt-in: both null (the default) means "always available whenever the
-- canteen itself is open", identical to today's behaviour.
-- =========================================================

alter table public.food_items add column if not exists available_days smallint[];
alter table public.food_items add column if not exists available_from time;
alter table public.food_items add column if not exists available_to time;

do $$ begin
  alter table public.food_items add constraint food_items_available_days_check check (
    available_days is null or (
      available_days <@ array[0,1,2,3,4,5,6]::smallint[]
    )
  );
exception when duplicate_object then null;
end $$;

-- Campus-local wall-clock time; this app is single-timezone (Asia/Kolkata,
-- same convention as notification_delivery_infra.sql) -- the DB session/
-- `now()`/`localtime` run in UTC (Supabase default), so day-of-week and
-- time-of-day must be computed off `now() at time zone 'Asia/Kolkata'`
-- rather than the session clock, or every check is off by 5.5 hours.
create or replace function public.is_food_item_available_now(p_available_days smallint[], p_available_from time, p_available_to time)
returns boolean
language sql
stable
as $$
  select
    (p_available_days is null or extract(dow from (now() at time zone 'Asia/Kolkata'))::smallint = any(p_available_days))
    and (
      p_available_from is null or p_available_to is null
      or case
        when p_available_to > p_available_from then (now() at time zone 'Asia/Kolkata')::time between p_available_from and p_available_to
        else (now() at time zone 'Asia/Kolkata')::time >= p_available_from or (now() at time zone 'Asia/Kolkata')::time <= p_available_to -- window crosses midnight
      end
    );
$$;

-- =========================================================
-- CANTEEN OPENING HOURS / HOLIDAY / TEMPORARY CLOSURE -- replaces the
-- vendor's manual-only status toggle with a real schedule. Opt-in per
-- canteen (no canteen_hours rows at all = fall back to the status field
-- only, so every existing canteen keeps working unchanged until its owner
-- configures hours).
-- =========================================================

create table if not exists public.canteen_hours (
  id uuid primary key default gen_random_uuid(),
  canteen_id uuid not null references public.canteens(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6), -- 0 = Sunday
  opens_at time not null,
  closes_at time not null,
  closed boolean not null default false,
  unique (canteen_id, day_of_week)
);

alter table public.canteen_hours enable row level security;

drop policy if exists "canteen_hours_read" on public.canteen_hours;
create policy "canteen_hours_read" on public.canteen_hours for select to anon, authenticated
  using (exists (select 1 from public.canteens c where c.id = canteen_hours.canteen_id and c.active));

drop policy if exists "canteen_hours_write" on public.canteen_hours;
create policy "canteen_hours_write" on public.canteen_hours for all to authenticated
  using (public.is_canteen_owner(auth.uid(), canteen_hours.canteen_id))
  with check (public.is_canteen_owner(auth.uid(), canteen_hours.canteen_id));

create table if not exists public.canteen_closures (
  id uuid primary key default gen_random_uuid(),
  canteen_id uuid not null references public.canteens(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists canteen_closures_canteen_idx on public.canteen_closures(canteen_id, starts_at, ends_at);

alter table public.canteen_closures enable row level security;

drop policy if exists "canteen_closures_read" on public.canteen_closures;
create policy "canteen_closures_read" on public.canteen_closures for select to anon, authenticated
  using (exists (select 1 from public.canteens c where c.id = canteen_closures.canteen_id and c.active));

drop policy if exists "canteen_closures_write" on public.canteen_closures;
create policy "canteen_closures_write" on public.canteen_closures for all to authenticated
  using (public.is_canteen_owner(auth.uid(), canteen_closures.canteen_id))
  with check (public.is_canteen_owner(auth.uid(), canteen_closures.canteen_id));

create or replace function public.is_canteen_open(p_canteen_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_status text;
  v_has_hours boolean;
  v_today record;
begin
  select status into v_status from public.canteens where id = p_canteen_id and active;
  if v_status is null or v_status = 'Closed' then
    return false;
  end if;

  if exists (
    select 1 from public.canteen_closures
    where canteen_id = p_canteen_id and now() between starts_at and ends_at
  ) then
    return false;
  end if;

  -- `select ... into` leaves v_has_hours NULL (not false) when zero rows
  -- match, and `if not null` is itself NULL/falsy in plpgsql -- so a plain
  -- `select true into v_has_hours ... if not v_has_hours` would silently
  -- skip this fallback and fall through to "no row for today -> closed"
  -- even when hours were never configured at all. exists(...) is always a
  -- real boolean, never NULL, so it can't have that bug.
  v_has_hours := exists (select 1 from public.canteen_hours where canteen_id = p_canteen_id);
  if not v_has_hours then
    return true; -- hours not configured yet: fall back to the status field alone
  end if;

  select * into v_today from public.canteen_hours
    where canteen_id = p_canteen_id and day_of_week = extract(dow from (now() at time zone 'Asia/Kolkata'))::smallint;

  if not found or v_today.closed then
    return false;
  end if;

  -- Campus-local wall-clock time (see is_food_item_available_now's comment
  -- below): the session runs in UTC, so `localtime` alone is 5.5h off IST.
  if v_today.closes_at > v_today.opens_at then
    return (now() at time zone 'Asia/Kolkata')::time between v_today.opens_at and v_today.closes_at;
  else
    return (now() at time zone 'Asia/Kolkata')::time >= v_today.opens_at or (now() at time zone 'Asia/Kolkata')::time <= v_today.closes_at; -- overnight window
  end if;
end;
$$;

-- =========================================================
-- VARIANTS -- single-attribute options (e.g. "Half"/"Full", "Regular"/
-- "Large"), each with its own price and, optionally, its own stock. Same
-- shape as store_item_variants.
-- =========================================================

create table if not exists public.food_item_variants (
  id uuid primary key default gen_random_uuid(),
  food_item_id uuid not null references public.food_items(id) on delete cascade,
  name text not null,
  price numeric(10,2) not null default 0 check (price >= 0),
  sku text,
  available boolean not null default true,
  active boolean not null default true,
  track_stock boolean not null default false,
  stock_quantity integer,
  low_stock_threshold integer not null default 5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (food_item_id, name)
);

do $$ begin
  alter table public.food_item_variants add constraint food_item_variants_stock_quantity_check check (stock_quantity is null or stock_quantity >= 0);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.food_item_variants add constraint food_item_variants_low_stock_threshold_check check (low_stock_threshold >= 0);
exception when duplicate_object then null;
end $$;

drop trigger if exists food_item_variants_set_updated_at on public.food_item_variants;
create trigger food_item_variants_set_updated_at
before update on public.food_item_variants
for each row execute function public.set_updated_at();

create index if not exists food_item_variants_item_idx on public.food_item_variants(food_item_id);

alter table public.food_item_variants enable row level security;

drop policy if exists "food_item_variants_read" on public.food_item_variants;
create policy "food_item_variants_read" on public.food_item_variants for select to anon, authenticated
  using (active and exists (select 1 from public.food_items fi where fi.id = food_item_variants.food_item_id and fi.active));

drop policy if exists "food_item_variants_write" on public.food_item_variants;
create policy "food_item_variants_write" on public.food_item_variants for all to authenticated
  using (exists (select 1 from public.food_items fi where fi.id = food_item_variants.food_item_id and public.is_canteen_owner(auth.uid(), fi.canteen_id)))
  with check (exists (select 1 from public.food_items fi where fi.id = food_item_variants.food_item_id and public.is_canteen_owner(auth.uid(), fi.canteen_id)));

-- =========================================================
-- ADD-ONS / MODIFIERS -- grouped, multi-select (e.g. "Toppings": pick 0-3;
-- "Spice level": pick exactly 1). min_select > 0 makes a group required.
-- =========================================================

create table if not exists public.food_item_addon_groups (
  id uuid primary key default gen_random_uuid(),
  food_item_id uuid not null references public.food_items(id) on delete cascade,
  name text not null,
  min_select integer not null default 0 check (min_select >= 0),
  max_select integer not null default 1 check (max_select >= 1),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (food_item_id, name),
  check (max_select >= min_select)
);

create index if not exists food_item_addon_groups_item_idx on public.food_item_addon_groups(food_item_id);

create table if not exists public.food_item_addon_options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.food_item_addon_groups(id) on delete cascade,
  name text not null,
  price_delta numeric(10,2) not null default 0 check (price_delta >= 0),
  available boolean not null default true,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (group_id, name)
);

create index if not exists food_item_addon_options_group_idx on public.food_item_addon_options(group_id);

alter table public.food_item_addon_groups enable row level security;
alter table public.food_item_addon_options enable row level security;

drop policy if exists "food_item_addon_groups_read" on public.food_item_addon_groups;
create policy "food_item_addon_groups_read" on public.food_item_addon_groups for select to anon, authenticated
  using (active and exists (select 1 from public.food_items fi where fi.id = food_item_addon_groups.food_item_id and fi.active));

drop policy if exists "food_item_addon_groups_write" on public.food_item_addon_groups;
create policy "food_item_addon_groups_write" on public.food_item_addon_groups for all to authenticated
  using (exists (select 1 from public.food_items fi where fi.id = food_item_addon_groups.food_item_id and public.is_canteen_owner(auth.uid(), fi.canteen_id)))
  with check (exists (select 1 from public.food_items fi where fi.id = food_item_addon_groups.food_item_id and public.is_canteen_owner(auth.uid(), fi.canteen_id)));

drop policy if exists "food_item_addon_options_read" on public.food_item_addon_options;
create policy "food_item_addon_options_read" on public.food_item_addon_options for select to anon, authenticated
  using (active and exists (
    select 1 from public.food_item_addon_groups g join public.food_items fi on fi.id = g.food_item_id
    where g.id = food_item_addon_options.group_id and g.active and fi.active
  ));

drop policy if exists "food_item_addon_options_write" on public.food_item_addon_options;
create policy "food_item_addon_options_write" on public.food_item_addon_options for all to authenticated
  using (exists (
    select 1 from public.food_item_addon_groups g join public.food_items fi on fi.id = g.food_item_id
    where g.id = food_item_addon_options.group_id and public.is_canteen_owner(auth.uid(), fi.canteen_id)
  ))
  with check (exists (
    select 1 from public.food_item_addon_groups g join public.food_items fi on fi.id = g.food_item_id
    where g.id = food_item_addon_options.group_id and public.is_canteen_owner(auth.uid(), fi.canteen_id)
  ));

-- =========================================================
-- Order-item snapshot columns -- variant_id is ON DELETE SET NULL (a
-- variant can always be hard-deleted; item_name/variant_name/addon_selection
-- text/jsonb snapshots keep order history readable regardless), matching
-- store_order_items' convention.
-- =========================================================

alter table public.order_items add column if not exists variant_id uuid references public.food_item_variants(id) on delete set null;
alter table public.order_items add column if not exists variant_name text;
alter table public.order_items add column if not exists addon_selection jsonb not null default '[]';

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'food_item_variants'
  ) then
    execute 'alter publication supabase_realtime add table public.food_item_variants';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'canteen_hours'
  ) then
    execute 'alter publication supabase_realtime add table public.canteen_hours';
  end if;
end $$;

-- =========================================================
-- create_food_order -- rebuilt to support variants, add-ons, and both
-- canteen-level and item-level availability windows. Recreated with the
-- identical signature (uuid, jsonb, text, text, text) so this doesn't create
-- a second overload. p_items entries may now optionally carry "variant_id"
-- and "addon_option_ids" (array of uuid). Based on the latest prior version
-- (20260814000300_food_ordering.sql -- confirmed via grep to be the only
-- definition), not a stale copy.
-- =========================================================

create or replace function public.create_food_order(
  p_canteen_id uuid,
  p_items jsonb,              -- [{ "food_item_id": uuid, "quantity": int, "special_instructions": text, "variant_id": uuid|null, "addon_option_ids": uuid[]|null }]
  p_notes text default '',
  p_fulfillment_type text default 'pickup',
  p_idempotency_key text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_order public.orders;
  v_existing public.orders;
  v_item jsonb;
  v_food record;
  v_variant record;
  v_group_counts record;
  v_qty integer;
  v_variant_id uuid;
  v_addon_ids uuid[];
  v_addon_total numeric(10,2);
  v_addon_snapshot jsonb;
  v_unit_price numeric(10,2);
  v_item_name text;
  v_variant_name text;
  v_subtotal numeric(10,2) := 0;
  v_tax numeric(10,2) := 0;
  v_platform_fee numeric(10,2) := 10;
  v_total numeric(10,2) := 0;
  v_pickup_code text;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;

  if not public.check_rate_limit(v_user, 'orders', 20, 3600) then
    raise exception 'RATE_LIMITED: too many orders placed, slow down';
  end if;

  if p_idempotency_key is not null then
    select * into v_existing from public.orders
      where user_id = v_user and idempotency_key = p_idempotency_key;
    if found then
      return v_existing;
    end if;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Cart is empty';
  end if;

  if not public.is_canteen_open(p_canteen_id) then
    raise exception 'CANTEEN_CLOSED: this canteen is not accepting orders right now';
  end if;

  v_pickup_code := lpad((floor(random()*1000000))::text, 6, '0');

  insert into public.orders (
    user_id, canteen_id, status, fulfillment_type, notes, pickup_code, idempotency_key
  ) values (
    v_user, p_canteen_id, 'CREATED', p_fulfillment_type, coalesce(p_notes,''), v_pickup_code, p_idempotency_key
  ) returning * into v_order;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := coalesce((v_item->>'quantity')::integer, 0);
    if v_qty <= 0 then
      raise exception 'Invalid quantity for item %', v_item->>'food_item_id';
    end if;

    -- Lock the row so concurrent orders can't both read a stale "available".
    select id, name, price, canteen_id, available, active, tax_rate, available_days, available_from, available_to,
      track_stock, stock_quantity
      into v_food
      from public.food_items
      where id = (v_item->>'food_item_id')::uuid
      for update;

    if not found or not v_food.active then
      raise exception 'ORDER_ITEM_UNAVAILABLE: % is no longer on the menu', coalesce(v_food.name, 'Item');
    end if;

    if not v_food.available then
      raise exception 'ORDER_ITEM_UNAVAILABLE: % is currently unavailable', v_food.name;
    end if;

    if v_food.canteen_id <> p_canteen_id then
      raise exception 'ORDER_SINGLE_CANTEEN: all items must come from the same canteen';
    end if;

    if not public.is_food_item_available_now(v_food.available_days, v_food.available_from, v_food.available_to) then
      raise exception 'ORDER_ITEM_UNAVAILABLE: % is not being served at this time', v_food.name;
    end if;

    v_variant_id := nullif(v_item->>'variant_id', '')::uuid;
    v_unit_price := v_food.price;
    v_item_name := v_food.name;
    v_variant_name := null;

    -- Base-item stock is only meaningful when the order line has no variant --
    -- a variant carries its own independent stock, checked separately below.
    if v_variant_id is null and v_food.track_stock and coalesce(v_food.stock_quantity, 0) < v_qty then
      raise exception 'ORDER_ITEM_UNAVAILABLE: not enough stock of % left', v_food.name;
    end if;

    if v_variant_id is not null then
      select id, food_item_id, name, price, available, active, track_stock, stock_quantity
        into v_variant
        from public.food_item_variants
        where id = v_variant_id
        for update;

      if not found or not v_variant.active or v_variant.food_item_id <> v_food.id then
        raise exception 'ORDER_ITEM_UNAVAILABLE: that option is no longer available for %', v_food.name;
      end if;

      if not v_variant.available then
        raise exception 'ORDER_ITEM_UNAVAILABLE: % (%) is currently unavailable', v_food.name, v_variant.name;
      end if;

      if v_variant.track_stock and coalesce(v_variant.stock_quantity, 0) < v_qty then
        raise exception 'ORDER_ITEM_UNAVAILABLE: not enough stock of % (%) left', v_food.name, v_variant.name;
      end if;

      v_unit_price := v_variant.price;
      v_variant_name := v_variant.name;
      v_item_name := v_food.name || ' (' || v_variant.name || ')';
    end if;

    -- Add-ons: validate every submitted option actually belongs to an
    -- active group on THIS food item and is itself active+available.
    -- v_item->'addon_option_ids' can be SQL NULL (key absent) or JSON null
    -- (key present, value null -- the frontend always sends the key). coalesce()
    -- alone only catches the former: jsonb_array_elements_text('null'::jsonb)
    -- raises "cannot extract elements from a scalar", so gate on jsonb_typeof.
    select array(
      select (elem)::uuid
      from jsonb_array_elements_text(
        case when jsonb_typeof(v_item->'addon_option_ids') = 'array'
          then v_item->'addon_option_ids'
          else '[]'::jsonb
        end
      ) as elem
    ) into v_addon_ids;

    if v_addon_ids is not null and array_length(v_addon_ids, 1) > 0 then
      if (
        select count(*) from public.food_item_addon_options o
        join public.food_item_addon_groups g on g.id = o.group_id
        where o.id = any(v_addon_ids) and g.food_item_id = v_food.id and g.active and o.active and o.available
      ) <> array_length(v_addon_ids, 1) then
        raise exception 'ORDER_ITEM_UNAVAILABLE: an add-on selection for % is invalid or unavailable', v_food.name;
      end if;

      select coalesce(sum(o.price_delta), 0), coalesce(jsonb_agg(jsonb_build_object('group_name', g.name, 'option_name', o.name, 'price_delta', o.price_delta)), '[]'::jsonb)
        into v_addon_total, v_addon_snapshot
        from public.food_item_addon_options o
        join public.food_item_addon_groups g on g.id = o.group_id
        where o.id = any(v_addon_ids);
    else
      v_addon_ids := array[]::uuid[];
      v_addon_total := 0;
      v_addon_snapshot := '[]'::jsonb;
    end if;

    for v_group_counts in
      select g.id, g.name, g.min_select, g.max_select,
        (select count(*) from public.food_item_addon_options o where o.group_id = g.id and o.id = any(v_addon_ids)) as selected
      from public.food_item_addon_groups g
      where g.food_item_id = v_food.id and g.active
    loop
      if v_group_counts.selected < v_group_counts.min_select or v_group_counts.selected > v_group_counts.max_select then
        raise exception 'ORDER_ADDON_INVALID: choose between % and % option(s) for "%" (%)',
          v_group_counts.min_select, v_group_counts.max_select, v_group_counts.name, v_food.name;
      end if;
    end loop;

    v_unit_price := v_unit_price + v_addon_total;

    insert into public.order_items (
      order_id, food_item_id, item_name, quantity, unit_price, total_price, special_instructions,
      variant_id, variant_name, addon_selection
    )
    values (
      v_order.id, v_food.id, v_item_name, v_qty, v_unit_price, v_unit_price * v_qty, v_item->>'special_instructions',
      v_variant_id, v_variant_name, v_addon_snapshot
    );

    v_subtotal := v_subtotal + (v_unit_price * v_qty);
    v_tax := v_tax + (v_unit_price * v_qty * v_food.tax_rate);
  end loop;

  v_total := round(v_subtotal + v_tax + v_platform_fee, 2);

  update public.orders
    set subtotal = round(v_subtotal,2),
        tax_amount = round(v_tax,2),
        platform_fee = v_platform_fee,
        total = v_total,
        status = 'PAYMENT_PENDING'
    where id = v_order.id
    returning * into v_order;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by)
  values (v_order.id, 'CREATED', 'PAYMENT_PENDING', v_user);

  return v_order;
end;
$$;

grant execute on function public.create_food_order(uuid, jsonb, text, text, text) to authenticated;
grant execute on function public.is_food_item_available_now(smallint[], time, time) to anon, authenticated;
grant execute on function public.is_canteen_open(uuid) to anon, authenticated;
