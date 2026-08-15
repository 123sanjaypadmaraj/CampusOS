-- =============================================================================
-- ANALYTICS PLATFORM (doc §14) -- turns three isolated metric views (admin
-- DAU/GMV, vendor revenue/SLA, and nothing at all for students) into a real
-- analytics surface for all three audiences. Scope negotiated explicitly
-- with the user against the doc's full checklist:
--   Student:  spending & orders, events & clubs activity, marketplace &
--             opportunities activity (all three chosen).
--   Vendor:   top products & peak hours, repeat customers, cancellations &
--             refunds (inventory analytics explicitly NOT chosen).
--   Admin:    full cross-vendor-type performance leaderboard, events &
--             facilities analytics, marketplace & notifications analytics,
--             platform health.
-- "Platform health" here is real error-log data (error_logs already exists
-- and is real) -- NOT a new uptime-history table/GitHub-Actions change,
-- which would be a materially bigger, separate undertaking (a new public
-- write endpoint + workflow change) not attempted in this pass; uptime
-- alerting already exists via .github/workflows/uptime.yml's own failure
-- emails, unchanged.
-- =============================================================================

-- =========================================================
-- STUDENT ANALYTICS -- scoped to auth.uid(), no permission check beyond
-- being signed in (same trust level as e.g. getMyOrders()).
-- =========================================================

-- Single-row summary: spending, orders, events, clubs, marketplace,
-- opportunities. clubs_joined_count is real here -- Profile.jsx's `stats`
-- prop has hardcoded clubs:0 since that page was first built; this RPC is
-- what the frontend change in this same pass wires it up to.
create or replace function public.student_activity_summary()
returns table (
  total_spent numeric,
  food_orders_count bigint,
  store_orders_count bigint,
  events_registered_count bigint,
  events_attended_count bigint,
  clubs_joined_count bigint,
  marketplace_listings_count bigint,
  marketplace_sold_count bigint,
  opportunities_applied_count bigint,
  mentor_requests_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Sign in required'; end if;

  return query
    select
      coalesce((select sum(o.total) from public.orders o where o.user_id = v_user and o.payment_status = 'paid'), 0)
        + coalesce((select sum(so.total) from public.store_orders so where so.user_id = v_user and so.status = 'COMPLETED'), 0),
      (select count(*) from public.orders o where o.user_id = v_user and o.payment_status = 'paid'),
      (select count(*) from public.store_orders so where so.user_id = v_user and so.status = 'COMPLETED'),
      (select count(*) from public.event_registrations er where er.user_id = v_user and er.status = 'confirmed'),
      -- e.event_date is `date` on staging but `timestamptz` on production
      -- (documented drift, see docs/ENVIRONMENTS.md) -- cast explicitly so
      -- this works on both, same fix as recommend_events() needed.
      (select count(*) from public.event_registrations er
        join public.events e on e.id = er.event_id
        where er.user_id = v_user and er.status = 'confirmed' and e.event_date::timestamptz < now()),
      (select count(*) from public.club_members cm where cm.user_id = v_user),
      (select count(*) from public.marketplace_listings ml where ml.seller_id = v_user and ml.status <> 'removed'),
      (select count(*) from public.marketplace_listings ml where ml.seller_id = v_user and ml.status = 'sold'),
      (select count(*) from public.opportunity_applications oa where oa.user_id = v_user),
      (select count(*) from public.mentor_requests mr where mr.user_id = v_user);
end;
$$;

grant execute on function public.student_activity_summary() to authenticated;

-- Daily spending trend, food + store combined and broken out, for a chart.
create or replace function public.student_spending_series(p_days integer default 30)
returns table (day date, food_spent numeric, store_spent numeric, total_spent numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Sign in required'; end if;

  return query
    select gs.d::date,
      coalesce(sum(o.total), 0)::numeric,
      coalesce(sum(so.total), 0)::numeric,
      coalesce(sum(o.total), 0)::numeric + coalesce(sum(so.total), 0)::numeric
    from generate_series(current_date - (greatest(p_days,1) - 1), current_date, interval '1 day') gs(d)
    left join public.orders o on o.user_id = v_user and o.payment_status = 'paid' and o.created_at::date = gs.d::date
    left join public.store_orders so on so.user_id = v_user and so.status = 'COMPLETED' and so.created_at::date = gs.d::date
    group by gs.d
    order by gs.d;
end;
$$;

grant execute on function public.student_spending_series(integer) to authenticated;

-- =========================================================
-- VENDOR ANALYTICS -- extends the existing vendor_gmv_series()/
-- vendor_sla_summary() family (20260814005000_analytics.sql,
-- 20260815000900_..._analytics.sql), same three-way owner-lookup branch
-- (canteen -> print shop -> store), scoped to the calling vendor's own
-- domain only via auth.uid().
-- =========================================================

-- Top products by revenue. Print has no per-SKU catalog (pricing is
-- pages*copies*rate, not a product list) so it returns an empty set rather
-- than raising -- "not applicable" is a real, valid answer here, same as
-- vendor_sla_summary never having a print-specific branch beyond turnaround.
create or replace function public.vendor_top_products(p_days integer default 30)
returns table (item_name text, quantity_sold bigint, revenue numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_canteen uuid;
  v_store uuid;
begin
  if v_user is null then raise exception 'Sign in required'; end if;

  select id into v_canteen from public.canteens where owner_id = v_user limit 1;
  if v_canteen is not null then
    return query
      select oi.item_name, sum(oi.quantity)::bigint, sum(oi.total_price)::numeric
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where o.canteen_id = v_canteen and o.payment_status = 'paid'
        and o.created_at >= now() - (greatest(p_days,1) || ' days')::interval
      group by oi.item_name
      order by sum(oi.total_price) desc
      limit 8;
    return;
  end if;

  if exists (select 1 from public.print_rate_card where owner_id = v_user) then
    return; -- no per-product catalog for print jobs
  end if;

  select id into v_store from public.stores where owner_id = v_user limit 1;
  if v_store is not null then
    return query
      select soi.item_name, sum(soi.quantity)::bigint, sum(soi.total_price)::numeric
      from public.store_order_items soi
      join public.store_orders so on so.id = soi.order_id
      where so.store_id = v_store and so.status = 'COMPLETED'
        and so.created_at >= now() - (greatest(p_days,1) || ' days')::interval
      group by soi.item_name
      order by sum(soi.total_price) desc
      limit 8;
    return;
  end if;

  raise exception 'No vendor profile (canteen, print shop, or store) assigned to this account';
end;
$$;

grant execute on function public.vendor_top_products(integer) to authenticated;

-- Order volume by hour-of-day (0-23, caller's local session timezone not
-- tracked server-side -- uses the DB's UTC, documented via the chart label
-- on the frontend rather than attempting per-user timezone conversion).
create or replace function public.vendor_peak_hours(p_days integer default 30)
returns table (hour_of_day integer, order_count bigint)
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
      select h.hour, count(o.id)
      from generate_series(0,23) h(hour)
      left join public.orders o on o.canteen_id = v_canteen and o.payment_status = 'paid'
        and extract(hour from o.created_at)::integer = h.hour
        and o.created_at >= now() - (greatest(p_days,1) || ' days')::interval
      group by h.hour order by h.hour;
    return;
  end if;

  select campus_id into v_print_campus from public.print_rate_card where owner_id = v_user limit 1;
  if v_print_campus is not null then
    return query
      select h.hour, count(pj.id)
      from generate_series(0,23) h(hour)
      left join public.print_jobs pj on pj.campus_id = v_print_campus
        and extract(hour from pj.created_at)::integer = h.hour
        and pj.created_at >= now() - (greatest(p_days,1) || ' days')::interval
      group by h.hour order by h.hour;
    return;
  end if;

  select id into v_store from public.stores where owner_id = v_user limit 1;
  if v_store is not null then
    return query
      select h.hour, count(so.id)
      from generate_series(0,23) h(hour)
      left join public.store_orders so on so.store_id = v_store and so.status = 'COMPLETED'
        and extract(hour from so.created_at)::integer = h.hour
        and so.created_at >= now() - (greatest(p_days,1) || ' days')::interval
      group by h.hour order by h.hour;
    return;
  end if;

  raise exception 'No vendor profile (canteen, print shop, or store) assigned to this account';
end;
$$;

grant execute on function public.vendor_peak_hours(integer) to authenticated;

-- New vs. returning buyers, by distinct customer within the range.
create or replace function public.vendor_repeat_customers(p_days integer default 30)
returns table (total_customers bigint, repeat_customers bigint, repeat_rate_pct numeric)
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
  v_total bigint;
  v_repeat bigint;
begin
  if v_user is null then raise exception 'Sign in required'; end if;

  select id into v_canteen from public.canteens where owner_id = v_user limit 1;
  if v_canteen is not null then
    select count(*), count(*) filter (where orders_placed > 1) into v_total, v_repeat
    from (
      select o.user_id, count(*) as orders_placed
      from public.orders o
      where o.canteen_id = v_canteen and o.payment_status = 'paid'
        and o.created_at >= now() - (greatest(p_days,1) || ' days')::interval
      group by o.user_id
    ) x;
    return query select v_total, v_repeat, case when v_total > 0 then round(100.0 * v_repeat / v_total, 1) else null end;
    return;
  end if;

  select campus_id into v_print_campus from public.print_rate_card where owner_id = v_user limit 1;
  if v_print_campus is not null then
    select count(*), count(*) filter (where jobs_placed > 1) into v_total, v_repeat
    from (
      select pj.user_id, count(*) as jobs_placed
      from public.print_jobs pj
      where pj.campus_id = v_print_campus and pj.status not in ('CANCELLED','FAILED')
        and pj.created_at >= now() - (greatest(p_days,1) || ' days')::interval
      group by pj.user_id
    ) x;
    return query select v_total, v_repeat, case when v_total > 0 then round(100.0 * v_repeat / v_total, 1) else null end;
    return;
  end if;

  select id into v_store from public.stores where owner_id = v_user limit 1;
  if v_store is not null then
    select count(*), count(*) filter (where orders_placed > 1) into v_total, v_repeat
    from (
      select so.user_id, count(*) as orders_placed
      from public.store_orders so
      where so.store_id = v_store and so.status = 'COMPLETED'
        and so.created_at >= now() - (greatest(p_days,1) || ' days')::interval
      group by so.user_id
    ) x;
    return query select v_total, v_repeat, case when v_total > 0 then round(100.0 * v_repeat / v_total, 1) else null end;
    return;
  end if;

  raise exception 'No vendor profile (canteen, print shop, or store) assigned to this account';
end;
$$;

grant execute on function public.vendor_repeat_customers(integer) to authenticated;

-- Cancellation rate + refund volume. Store/print have no refund concept
-- (pay-at-pickup/pay-at-counter) so refunded_amount/refund_count are
-- always 0 there -- a real, valid answer, not a missing feature.
create or replace function public.vendor_cancellations_refunds(p_days integer default 30)
returns table (total_orders bigint, cancelled_count bigint, cancelled_pct numeric, refunded_amount numeric, refund_count bigint)
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
  v_total bigint;
  v_cancelled bigint;
begin
  if v_user is null then raise exception 'Sign in required'; end if;

  select id into v_canteen from public.canteens where owner_id = v_user limit 1;
  if v_canteen is not null then
    select count(*), count(*) filter (where o.status in ('CANCELLED','REJECTED'))
      into v_total, v_cancelled
      from public.orders o
      where o.canteen_id = v_canteen and o.created_at >= now() - (greatest(p_days,1) || ' days')::interval;
    return query
      select v_total, v_cancelled, case when v_total > 0 then round(100.0 * v_cancelled / v_total, 1) else null end,
        coalesce((select sum(r.amount) from public.refunds r join public.orders o2 on o2.id = r.order_id
          where o2.canteen_id = v_canteen and r.status = 'completed'
            and r.created_at >= now() - (greatest(p_days,1) || ' days')::interval), 0),
        (select count(*) from public.refunds r join public.orders o2 on o2.id = r.order_id
          where o2.canteen_id = v_canteen and r.created_at >= now() - (greatest(p_days,1) || ' days')::interval);
    return;
  end if;

  select campus_id into v_print_campus from public.print_rate_card where owner_id = v_user limit 1;
  if v_print_campus is not null then
    select count(*), count(*) filter (where pj.status in ('CANCELLED','FAILED'))
      into v_total, v_cancelled
      from public.print_jobs pj
      where pj.campus_id = v_print_campus and pj.created_at >= now() - (greatest(p_days,1) || ' days')::interval;
    return query select v_total, v_cancelled, case when v_total > 0 then round(100.0 * v_cancelled / v_total, 1) else null end, 0::numeric, 0::bigint;
    return;
  end if;

  select id into v_store from public.stores where owner_id = v_user limit 1;
  if v_store is not null then
    select count(*), count(*) filter (where so.status = 'CANCELLED')
      into v_total, v_cancelled
      from public.store_orders so
      where so.store_id = v_store and so.created_at >= now() - (greatest(p_days,1) || ' days')::interval;
    return query select v_total, v_cancelled, case when v_total > 0 then round(100.0 * v_cancelled / v_total, 1) else null end, 0::numeric, 0::bigint;
    return;
  end if;

  raise exception 'No vendor profile (canteen, print shop, or store) assigned to this account';
end;
$$;

grant execute on function public.vendor_cancellations_refunds(integer) to authenticated;

-- =========================================================
-- ADMIN ANALYTICS -- same `analytics.read` / current_user_is_admin() gate
-- as every existing admin_* function in 20260814005000_analytics.sql.
-- =========================================================

-- Cross-vendor-type leaderboard (canteens + print shop + campus stores).
-- admin_top_canteens_gmv() (existing) stays food-only and untouched --
-- this is additive, not a replacement, since other call sites may still
-- want the food-only view.
create or replace function public.admin_vendor_performance(p_campus_id uuid default null, p_days integer default 30)
returns table (vendor_name text, vendor_type text, gmv numeric, orders_count bigint, aov numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.has_permission(auth.uid(), 'analytics.read') or public.current_user_is_admin()) then
    raise exception 'Not authorized';
  end if;
  -- Column aliases on this first branch only -- a UNION ALL's output column
  -- names come from its first SELECT, and the `order by gmv` below needs a
  -- real name to resolve against (the bare aggregate expressions have none
  -- by default).
  return query
    select c.name as vendor_name, 'canteen'::text as vendor_type,
      coalesce(sum(o.total), 0)::numeric as gmv, count(o.id) as orders_count,
      case when count(o.id) > 0 then round(sum(o.total) / count(o.id), 2) else 0 end as aov
    from public.canteens c
    left join public.orders o on o.canteen_id = c.id and o.payment_status = 'paid'
      and o.created_at >= now() - (greatest(p_days,1) || ' days')::interval
    where (p_campus_id is null or c.campus_id = p_campus_id)
    group by c.id, c.name
  union all
    select coalesce(p.name, 'Print Shop'), 'print_shop'::text,
      coalesce(sum(pj.price), 0)::numeric, count(pj.id),
      case when count(pj.id) > 0 then round(sum(pj.price) / count(pj.id), 2) else 0 end
    from (select distinct campus_id, owner_id from public.print_rate_card where owner_id is not null) prc
    left join public.profiles p on p.id = prc.owner_id
    left join public.print_jobs pj on pj.campus_id = prc.campus_id and pj.status not in ('CANCELLED','FAILED')
      and pj.created_at >= now() - (greatest(p_days,1) || ' days')::interval
    where (p_campus_id is null or prc.campus_id = p_campus_id)
    group by prc.owner_id, p.name
  union all
    select s.name, 'store'::text,
      coalesce(sum(so.total), 0)::numeric, count(so.id),
      case when count(so.id) > 0 then round(sum(so.total) / count(so.id), 2) else 0 end
    from public.stores s
    left join public.store_orders so on so.store_id = s.id and so.status = 'COMPLETED'
      and so.created_at >= now() - (greatest(p_days,1) || ' days')::interval
    where (p_campus_id is null or s.campus_id = p_campus_id)
    group by s.id, s.name
  order by gmv desc;
end;
$$;

grant execute on function public.admin_vendor_performance(uuid, integer) to authenticated;

-- Events: overview + a top-5 list.
create or replace function public.admin_events_summary(p_campus_id uuid default null, p_days integer default 30)
returns table (events_count bigint, total_registrations bigint, avg_registrations numeric, cancellation_rate numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_events bigint;
  v_regs bigint;
  v_cancelled bigint;
begin
  if not (public.has_permission(auth.uid(), 'analytics.read') or public.current_user_is_admin()) then
    raise exception 'Not authorized';
  end if;

  select count(*) into v_events from public.events e
    where e.created_at >= now() - (greatest(p_days,1) || ' days')::interval
      and (p_campus_id is null or e.campus_id = p_campus_id);

  select count(*) filter (where er.status = 'confirmed'), count(*) filter (where er.status = 'cancelled')
    into v_regs, v_cancelled
    from public.event_registrations er
    join public.events e on e.id = er.event_id
    where er.registered_at >= now() - (greatest(p_days,1) || ' days')::interval
      and (p_campus_id is null or e.campus_id = p_campus_id);

  return query select v_events, v_regs,
    case when v_events > 0 then round(v_regs::numeric / v_events, 1) else 0 end,
    case when (v_regs + v_cancelled) > 0 then round(100.0 * v_cancelled / (v_regs + v_cancelled), 1) else null end;
end;
$$;

grant execute on function public.admin_events_summary(uuid, integer) to authenticated;

create or replace function public.admin_top_events(p_campus_id uuid default null, p_days integer default 30)
returns table (event_name text, registrations bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.has_permission(auth.uid(), 'analytics.read') or public.current_user_is_admin()) then
    raise exception 'Not authorized';
  end if;
  return query
    select e.title, count(er.id)
    from public.events e
    join public.event_registrations er on er.event_id = e.id and er.status = 'confirmed'
      and er.registered_at >= now() - (greatest(p_days,1) || ' days')::interval
    where (p_campus_id is null or e.campus_id = p_campus_id)
    group by e.id, e.title
    order by count(er.id) desc
    limit 5;
end;
$$;

grant execute on function public.admin_top_events(uuid, integer) to authenticated;

-- Facilities: tickets + bookings overview, and a ticket-by-category bar.
create or replace function public.admin_facilities_summary(p_campus_id uuid default null, p_days integer default 30)
returns table (tickets_count bigint, tickets_resolved_pct numeric, bookings_count bigint, bookings_approved_pct numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tickets bigint;
  v_resolved bigint;
  v_bookings bigint;
  v_decided bigint;
  v_approved bigint;
begin
  if not (public.has_permission(auth.uid(), 'analytics.read') or public.current_user_is_admin()) then
    raise exception 'Not authorized';
  end if;

  select count(*), count(*) filter (where status in ('RESOLVED','CLOSED'))
    into v_tickets, v_resolved
    from public.service_requests
    where created_at >= now() - (greatest(p_days,1) || ' days')::interval
      and (p_campus_id is null or campus_id = p_campus_id);

  select count(*), count(*) filter (where status <> 'PENDING'), count(*) filter (where status in ('APPROVED','COMPLETED'))
    into v_bookings, v_decided, v_approved
    from public.bookings b
    join public.resources r on r.id = b.resource_id
    where b.created_at >= now() - (greatest(p_days,1) || ' days')::interval
      and (p_campus_id is null or r.campus_id = p_campus_id);

  return query select v_tickets,
    case when v_tickets > 0 then round(100.0 * v_resolved / v_tickets, 1) else null end,
    v_bookings,
    case when v_decided > 0 then round(100.0 * v_approved / v_decided, 1) else null end;
end;
$$;

grant execute on function public.admin_facilities_summary(uuid, integer) to authenticated;

-- RETURNS TABLE(category text, ...) implicitly declares an OUT parameter
-- named `category` -- any bare (unqualified) reference to service_requests'
-- own `category` column anywhere in the body is ambiguous against it, same
-- documented pitfall as get_people_you_may_know()/recommend_events(); every
-- reference below is qualified with the table alias `sr` to avoid it.
create or replace function public.admin_tickets_by_category(p_campus_id uuid default null, p_days integer default 30)
returns table (category text, ticket_count bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.has_permission(auth.uid(), 'analytics.read') or public.current_user_is_admin()) then
    raise exception 'Not authorized';
  end if;
  return query
    select coalesce(sr.category, 'Other'), count(*)
    from public.service_requests sr
    where sr.created_at >= now() - (greatest(p_days,1) || ' days')::interval
      and (p_campus_id is null or sr.campus_id = p_campus_id)
    group by sr.category
    order by count(*) desc;
end;
$$;

grant execute on function public.admin_tickets_by_category(uuid, integer) to authenticated;

-- Marketplace overview.
create or replace function public.admin_marketplace_summary(p_campus_id uuid default null, p_days integer default 30)
returns table (listings_count bigint, active_count bigint, sold_count bigint, sold_pct numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_listings bigint;
  v_active bigint;
  v_sold bigint;
begin
  if not (public.has_permission(auth.uid(), 'analytics.read') or public.current_user_is_admin()) then
    raise exception 'Not authorized';
  end if;

  select count(*) into v_listings from public.marketplace_listings ml
    where ml.created_at >= now() - (greatest(p_days,1) || ' days')::interval
      and (p_campus_id is null or ml.campus_id = p_campus_id);

  select count(*) into v_active from public.marketplace_listings ml
    where ml.status = 'active' and (p_campus_id is null or ml.campus_id = p_campus_id);

  select count(*) into v_sold from public.marketplace_listings ml
    where ml.status = 'sold' and ml.updated_at >= now() - (greatest(p_days,1) || ' days')::interval
      and (p_campus_id is null or ml.campus_id = p_campus_id);

  return query select v_listings, v_active, v_sold,
    case when v_listings > 0 then round(100.0 * v_sold / v_listings, 1) else null end;
end;
$$;

grant execute on function public.admin_marketplace_summary(uuid, integer) to authenticated;

-- Notifications: sent + read rate. notifications has no campus_id column,
-- so campus scoping joins through profiles.
create or replace function public.admin_notifications_summary(p_campus_id uuid default null, p_days integer default 30)
returns table (sent_count bigint, read_count bigint, read_pct numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sent bigint;
  v_read bigint;
begin
  if not (public.has_permission(auth.uid(), 'analytics.read') or public.current_user_is_admin()) then
    raise exception 'Not authorized';
  end if;

  select count(*), count(*) filter (where n.read) into v_sent, v_read
  from public.notifications n
  join public.profiles p on p.id = n.user_id
  where n.created_at >= now() - (greatest(p_days,1) || ' days')::interval
    and (p_campus_id is null or p.campus_id = p_campus_id);

  return query select v_sent, v_read, case when v_sent > 0 then round(100.0 * v_read / v_sent, 1) else null end;
end;
$$;

grant execute on function public.admin_notifications_summary(uuid, integer) to authenticated;

-- Platform health: real error_logs data (see file header for why this
-- doesn't include a new uptime-history table).
create or replace function public.admin_platform_health(p_campus_id uuid default null, p_days integer default 30)
returns table (error_count bigint, resolved_count bigint, resolved_pct numeric, fatal_count bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_errors bigint;
  v_resolved bigint;
  v_fatal bigint;
begin
  if not (public.has_permission(auth.uid(), 'analytics.read') or public.current_user_is_admin()) then
    raise exception 'Not authorized';
  end if;

  select count(*), count(*) filter (where resolved), count(*) filter (where severity = 'fatal')
    into v_errors, v_resolved, v_fatal
    from public.error_logs
    where created_at >= now() - (greatest(p_days,1) || ' days')::interval
      and (p_campus_id is null or campus_id = p_campus_id);

  return query select v_errors, v_resolved,
    case when v_errors > 0 then round(100.0 * v_resolved / v_errors, 1) else null end,
    v_fatal;
end;
$$;

grant execute on function public.admin_platform_health(uuid, integer) to authenticated;

create or replace function public.admin_error_trend(p_campus_id uuid default null, p_days integer default 30)
returns table (day date, error_count bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.has_permission(auth.uid(), 'analytics.read') or public.current_user_is_admin()) then
    raise exception 'Not authorized';
  end if;
  return query
    select gs.d::date, count(el.id)
    from generate_series(current_date - (greatest(p_days,1) - 1), current_date, interval '1 day') gs(d)
    left join public.error_logs el on el.created_at::date = gs.d::date
      and (p_campus_id is null or el.campus_id = p_campus_id)
    group by gs.d
    order by gs.d;
end;
$$;

grant execute on function public.admin_error_trend(uuid, integer) to authenticated;
