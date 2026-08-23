-- =============================================================================
-- Phase 7 (Reliability at scale) audit finding: food-item stock overselling.
--
-- create_food_order (20260817000500_food_menu_depth.sql) locks the
-- food_items/food_item_variants row (`for update`) and CHECKS stock_quantity
-- against the requested quantity, but never decrements it -- the actual
-- decrement only happens later, in record_payment_event, after the student
-- completes the separate Razorpay checkout round-trip. The row lock is
-- released the moment create_food_order's transaction commits (order ->
-- PAYMENT_PENDING), long before payment. Two students ordering the last unit
-- within that window both pass the check (nothing decremented it yet), both
-- pay, both get accepted -- a real oversell, not just a display glitch:
-- confirmed by tracing every read/write of stock_quantity across the food
-- order lifecycle.
--
-- store_orders never had this gap: create_store_order decrements
-- stock_quantity in the SAME locked transaction as the check, because store
-- orders have no payment-gateway leg (PLACED is pay-at-pickup, per that
-- migration's own header comment). This migration brings food orders to the
-- same "reserve at checkout, not at payment" model:
--
--   1. create_food_order now calls adjust_stock_for_order(-1) itself, inside
--      the same transaction/lock as the check -- the reservation is atomic
--      the same way store's already was.
--   2. record_payment_event no longer decrements again on PAID (it already
--      happened at reservation time) -- removing this is what keeps stock
--      from double-decrementing.
--   3. transition_order_status's restore-on-cancel branch previously
--      excluded PAYMENT_PENDING (correct under the old model, where nothing
--      had been decremented yet at that point) -- now that reservation
--      happens at creation, cancelling/rejecting a PAYMENT_PENDING order must
--      also restore stock, so that exclusion is dropped.
--   4. Reserved-but-abandoned checkouts (a student who never completes
--      payment) would otherwise hold stock forever -- 'EXPIRED' has been a
--      valid order_status_transitions target since the table's creation but
--      nothing ever triggered it. expire_stale_food_orders() now sweeps
--      PAYMENT_PENDING orders older than 30 minutes to EXPIRED and restores
--      their stock, on the same pg_cron schedule as the existing reminder
--      jobs (20260817001900_notification_reminders_cron.sql).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. create_food_order -- reserve stock atomically at checkout, not at
-- payment. Identical to the 20260817000500 body except for the added
-- `perform public.adjust_stock_for_order(v_order.id, -1);` after all
-- order_items are inserted (and before the order_items loop's row locks are
-- released at commit).
-- ---------------------------------------------------------------------------

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

  -- Reserve stock now, in the same transaction as (and therefore still
  -- covered by the row locks taken during) the availability checks above --
  -- this is the actual fix. adjust_stock_for_order reads the order_items
  -- just inserted, decrements track_stock items, and logs a stock_adjustments
  -- row exactly as it already does for the (now-removed) payment-time call.
  perform public.adjust_stock_for_order(v_order.id, -1);

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

-- ---------------------------------------------------------------------------
-- 2. record_payment_event -- identical to the 20260818000100 body except the
-- `perform public.adjust_stock_for_order(v_order.id, -1);` call on the
-- PAYMENT_PENDING -> PAID transition is removed: stock was already reserved
-- by create_food_order at checkout, so decrementing again here would
-- double-consume it.
-- ---------------------------------------------------------------------------

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
  v_job public.print_jobs;
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

    if v_payment.order_id is not null then
      select * into v_order from public.orders where id = v_payment.order_id for update;

      if v_order.status = 'PAYMENT_PENDING' then
        update public.orders set status = 'PAID', payment_status = 'paid' where id = v_order.id;
        insert into public.order_status_history (order_id, from_status, to_status, reason)
        values (v_order.id, 'PAYMENT_PENDING', 'PAID', 'gateway webhook verified');

        update public.orders set status = 'RECEIVED' where id = v_order.id;
        insert into public.order_status_history (order_id, from_status, to_status, reason)
        values (v_order.id, 'PAID', 'RECEIVED', 'auto-forwarded to vendor queue');
      end if;

    elsif v_payment.print_job_id is not null then
      select * into v_job from public.print_jobs where id = v_payment.print_job_id for update;

      if v_job.status = 'AWAITING_PAYMENT' then
        update public.print_jobs
          set status = 'UPLOADED', payment_id = v_payment.id, expires_at = now() + interval '14 days'
          where id = v_job.id;
      end if;
    end if;

  elsif p_status = 'failed' then
    if v_payment.order_id is not null then
      update public.orders set payment_status = 'failed' where id = v_payment.order_id;
    end if;
    -- A failed print-job payment needs no state change -- the job just stays
    -- AWAITING_PAYMENT so the student can retry, and expires on its own.
    -- A failed food-order payment also needs no stock action here: stock was
    -- reserved at checkout and stays reserved so the student can retry
    -- payment on the same order; it's released by transition_order_status
    -- (if staff/the student cancels) or expire_stale_food_orders (if the
    -- checkout is simply abandoned).
  end if;

  return v_payment;
end;
$$;

revoke execute on function public.record_payment_event(text, text, text, boolean, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. transition_order_status -- identical to the 20260817000400 body except
-- the restore-stock condition no longer excludes PAYMENT_PENDING. Under the
-- old (payment-time-decrement) model, a PAYMENT_PENDING order had never had
-- its stock touched, so excluding it from restore was correct; now that
-- create_food_order reserves stock at checkout, cancelling/rejecting an
-- order from PAYMENT_PENDING must restore it too, or that stock leaks
-- forever. CREATED is left out of the restore condition's inputs entirely
-- (as before) since it's a transient intra-transaction state inside
-- create_food_order that transition_order_status can never actually observe
-- an order in.
-- ---------------------------------------------------------------------------

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
  v_can_manage := public.has_permission(v_user, 'food.orders.update') and public.can_manage_canteen_orders(v_user, v_order.canteen_id);

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

  if p_to_status in ('REJECTED', 'CANCELLED') then
    perform public.adjust_stock_for_order(p_order_id, 1);
  end if;

  return v_order;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. expire_stale_food_orders -- sweeps orders abandoned mid-checkout (stock
-- reserved, payment never completed) to EXPIRED and restores their stock.
-- 'EXPIRED' has been a valid order_status_transitions target since
-- 20260814000300_food_ordering.sql but nothing has ever triggered it -- this
-- was a pre-existing gap that only became consequential once reservation
-- moved to checkout time (before this migration, an abandoned PAYMENT_PENDING
-- order held no stock, so there was nothing to leak). 30 minutes matches the
-- Razorpay checkout session's own practical abandon window; runs every 15
-- minutes on the same pg_cron schedule as the existing reminder jobs.
-- ---------------------------------------------------------------------------

create or replace function public.expire_stale_food_orders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_count integer := 0;
begin
  for v_order in
    select id from public.orders
    where status = 'PAYMENT_PENDING' and created_at < now() - interval '30 minutes'
    for update skip locked
  loop
    update public.orders set status = 'EXPIRED', payment_status = 'failed' where id = v_order.id;

    insert into public.order_status_history (order_id, from_status, to_status, reason)
    values (v_order.id, 'PAYMENT_PENDING', 'EXPIRED', 'checkout abandoned -- auto-expired after 30 minutes');

    perform public.adjust_stock_for_order(v_order.id, 1);

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.expire_stale_food_orders() from public, anon, authenticated;

-- cron.schedule() upserts by job name in modern pg_cron, but
-- unschedule-then-schedule is used defensively, matching this repo's existing
-- convention (20260817001900_notification_reminders_cron.sql).
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'expire-stale-food-orders';
exception when others then null;
end $$;

select cron.schedule('expire-stale-food-orders', '*/15 * * * *', $$select public.expire_stale_food_orders();$$);
