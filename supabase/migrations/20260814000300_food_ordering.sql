-- =============================================================================
-- 0003: FOOD ORDERING -- canteens, food, orders, state machine, idempotency,
-- pickup tokens. All order creation / status transitions move server-side
-- into SECURITY DEFINER RPCs -- the frontend must never insert into orders
-- or order_items directly again (doc §5, §12, §13, §15, §63).
-- =============================================================================

-- =========================================================
-- CANTEENS / MENU
-- =========================================================

create table if not exists public.canteens (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid references public.campuses(id) on delete cascade,
  owner_id uuid references public.profiles(id) on delete set null,
  name text not null,
  subtitle text,
  status text not null default 'Open',
  eta_min integer not null default 5,
  eta_max integer not null default 15,
  queue_level text not null default 'quiet',
  load integer not null default 25,
  color text not null default 'green',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(campus_id, name)
);

alter table public.canteens add column if not exists owner_id uuid references public.profiles(id) on delete set null;

create table if not exists public.food_categories (
  id uuid primary key default gen_random_uuid(),
  name text unique not null
);

create table if not exists public.food_items (
  id uuid primary key default gen_random_uuid(),
  canteen_id uuid not null references public.canteens(id) on delete cascade,
  category_id uuid references public.food_categories(id) on delete set null,
  name text not null,
  description text,
  price numeric(10,2) not null default 0 check (price >= 0),
  image_url text,
  is_vegetarian boolean not null default true,
  available boolean not null default true,
  active boolean not null default true, -- never hard-delete items with order history (doc §17)
  preparation_time_min integer not null default 10,
  featured boolean not null default false,
  sku text,
  tax_rate numeric(5,4) not null default 0.05,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(canteen_id, name)
);

alter table public.food_items add column if not exists active boolean not null default true;
alter table public.food_items add column if not exists preparation_time_min integer not null default 10;
alter table public.food_items add column if not exists featured boolean not null default false;
alter table public.food_items add column if not exists sku text;
alter table public.food_items add column if not exists tax_rate numeric(5,4) not null default 0.05;
alter table public.food_items add column if not exists updated_at timestamptz not null default now();

drop trigger if exists food_items_set_updated_at on public.food_items;
create trigger food_items_set_updated_at
before update on public.food_items
for each row execute function public.set_updated_at();

-- =========================================================
-- ORDER STATE MACHINE (doc §13)
-- =========================================================

create table if not exists public.order_status_transitions (
  from_status text not null,
  to_status text not null,
  primary key (from_status, to_status)
);

insert into public.order_status_transitions (from_status, to_status) values
  ('CREATED','PAYMENT_PENDING'), ('CREATED','CANCELLED'),
  ('PAYMENT_PENDING','PAID'), ('PAYMENT_PENDING','EXPIRED'), ('PAYMENT_PENDING','CANCELLED'),
  ('PAID','RECEIVED'), ('PAID','REFUND_PENDING'), ('PAID','CANCEL_REQUESTED'),
  ('RECEIVED','ACCEPTED'), ('RECEIVED','REJECTED'),
  ('ACCEPTED','PREPARING'), ('ACCEPTED','CANCEL_REQUESTED'),
  ('PREPARING','READY'), ('PREPARING','CANCEL_REQUESTED'),
  ('READY','OUT_FOR_DELIVERY'), ('READY','COMPLETED'),
  ('OUT_FOR_DELIVERY','DELIVERED'),
  ('DELIVERED','COMPLETED'),
  ('CANCEL_REQUESTED','CANCELLED'), ('CANCEL_REQUESTED','PREPARING'), ('CANCEL_REQUESTED','READY'),
  ('REJECTED','REFUND_PENDING'),
  ('CANCELLED','REFUND_PENDING'),
  ('REFUND_PENDING','REFUNDED')
on conflict do nothing;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  canteen_id uuid not null references public.canteens(id),
  status text not null default 'CREATED'
    check (status in (
      'CREATED','PAYMENT_PENDING','PAID','RECEIVED','ACCEPTED','PREPARING','READY',
      'OUT_FOR_DELIVERY','DELIVERED','COMPLETED','CANCEL_REQUESTED','CANCELLED',
      'REFUND_PENDING','REFUNDED','REJECTED','EXPIRED'
    )),
  fulfillment_type text not null default 'pickup' check (fulfillment_type in ('pickup','delivery')),
  subtotal numeric(10,2) not null default 0,
  tax_amount numeric(10,2) not null default 0,
  platform_fee numeric(10,2) not null default 0,
  delivery_fee numeric(10,2) not null default 0,
  discount_amount numeric(10,2) not null default 0,
  coupon_code text,
  total numeric(10,2) not null default 0,
  payment_status text not null default 'pending'
    check (payment_status in ('pending','paid','failed','refund_pending','refunded')),
  pickup_code text,
  notes text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.orders add column if not exists fulfillment_type text not null default 'pickup';
alter table public.orders add column if not exists tax_amount numeric(10,2) not null default 0;
alter table public.orders add column if not exists delivery_fee numeric(10,2) not null default 0;
alter table public.orders add column if not exists discount_amount numeric(10,2) not null default 0;
alter table public.orders add column if not exists coupon_code text;
alter table public.orders add column if not exists idempotency_key text;
alter table public.orders add column if not exists updated_at timestamptz not null default now();

-- Migrate any legacy lowercase statuses left over from the MVP schema before
-- the new CHECK constraint below would reject them.
update public.orders set status = 'COMPLETED' where status = 'completed';
update public.orders set status = 'CANCELLED' where status = 'cancelled';
update public.orders set status = 'CREATED' where status = 'pending' and coalesce(payment_status,'pending') = 'pending';
update public.orders set status = 'PAID' where status = 'pending' and payment_status = 'paid';

do $$ begin
  alter table public.orders drop constraint if exists orders_status_check;
  alter table public.orders add constraint orders_status_check check (status in (
      'CREATED','PAYMENT_PENDING','PAID','RECEIVED','ACCEPTED','PREPARING','READY',
      'OUT_FOR_DELIVERY','DELIVERED','COMPLETED','CANCEL_REQUESTED','CANCELLED',
      'REFUND_PENDING','REFUNDED','REJECTED','EXPIRED'
  ));
exception when others then null;
end $$;

create unique index if not exists orders_user_idempotency_idx
  on public.orders(user_id, idempotency_key) where idempotency_key is not null;

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

create table if not exists public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by uuid references public.profiles(id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  food_item_id uuid not null references public.food_items(id),
  item_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(10,2) not null,
  total_price numeric(10,2) not null,
  special_instructions text
);

alter table public.order_items add column if not exists item_name text;
update public.order_items oi set item_name = fi.name from public.food_items fi where oi.food_item_id = fi.id and oi.item_name is null;
alter table public.order_items alter column item_name set not null;
alter table public.order_items add column if not exists special_instructions text;

-- =========================================================
-- PICKUP TOKENS (doc §15, §50, §51)
-- Opaque, single-use, short-lived. Generated once an order becomes READY.
-- Redeemed only through public.redeem_pickup_token(), never by a raw UPDATE.
-- =========================================================

create table if not exists public.order_pickup_tokens (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  -- 'base64url' as an encode() target only exists from Postgres 18 -- build
  -- it manually so this works on PG < 18 too (this project runs PG 17).
  token text not null unique default translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_'),
  short_code text not null default lpad((floor(random()*1000000))::text, 6, '0'),
  expires_at timestamptz not null default (now() + interval '2 hours'),
  used_at timestamptz,
  used_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists order_pickup_tokens_order_idx on public.order_pickup_tokens(order_id);

create or replace function public.issue_pickup_token()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'READY' and (old.status is distinct from new.status) then
    insert into public.order_pickup_tokens (order_id) values (new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists orders_issue_pickup_token on public.orders;
create trigger orders_issue_pickup_token
after update of status on public.orders
for each row execute function public.issue_pickup_token();

-- =========================================================
-- RPC: create_food_order -- the ONLY supported way to place a food order.
-- Runs entirely server-side: re-reads prices, locks rows, computes totals,
-- is idempotent, and writes order+items atomically (doc §5, §62, §63).
-- =========================================================

create or replace function public.create_food_order(
  p_canteen_id uuid,
  p_items jsonb,              -- [{ "food_item_id": uuid, "quantity": int, "special_instructions": text }]
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
  v_qty integer;
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
    select id, name, price, canteen_id, available, active, tax_rate
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

    insert into public.order_items (order_id, food_item_id, item_name, quantity, unit_price, total_price, special_instructions)
    values (v_order.id, v_food.id, v_food.name, v_qty, v_food.price, v_food.price * v_qty, v_item->>'special_instructions');

    v_subtotal := v_subtotal + (v_food.price * v_qty);
    v_tax := v_tax + (v_food.price * v_qty * v_food.tax_rate);
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

-- =========================================================
-- RPC: transition_order_status -- server-enforced state machine (doc §13).
-- Students may only request CANCEL_REQUESTED on their own order. Vendor
-- staff/admins (food.orders.update) can drive the rest of the pipeline.
-- Payment-related transitions (PAID) are only ever set by the payments
-- edge function via record_payment_event(), never through this RPC.
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
  v_can_manage := public.has_permission(v_user, 'food.orders.update') or public.current_user_is_admin();

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

-- =========================================================
-- RPC: redeem_pickup_token -- vendor-side QR/code scan (doc §15).
-- =========================================================

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
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;

  if not (public.has_permission(v_user, 'food.orders.update') or public.current_user_is_admin()) then
    raise exception 'Not authorized to redeem pickup tokens';
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

create index if not exists orders_user_created_idx on public.orders(user_id, created_at desc);
create index if not exists orders_canteen_status_idx on public.orders(canteen_id, status);
create index if not exists order_items_order_idx on public.order_items(order_id);
