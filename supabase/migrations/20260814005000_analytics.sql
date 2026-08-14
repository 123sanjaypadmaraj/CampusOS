-- =============================================================================
-- 0044: ANALYTICS -- DAU / GMV / AOV / SLA for admin (platform-wide) and
-- vendor (own canteen or print shop) dashboards. `analytics.read` was
-- already seeded as a permission (0002, granted to super_admin/
-- college_admin/vendor) but nothing used it until now.
-- =============================================================================

-- =========================================================
-- DAU tracking. Nothing in this schema previously recorded "who was
-- active when" -- audit_logs only captures privileged actions, not
-- ordinary usage, so it can't stand in for real DAU. This is a minimal,
-- append-mostly-noop table: one row per user per campus per calendar day.
-- =========================================================

create table if not exists public.user_activity_daily (
  user_id uuid not null references public.profiles(id) on delete cascade,
  campus_id uuid references public.campuses(id) on delete cascade,
  activity_date date not null,
  first_seen_at timestamptz not null default now(),
  primary key (user_id, activity_date)
);

create index if not exists user_activity_daily_date_idx on public.user_activity_daily(activity_date);
create index if not exists user_activity_daily_campus_date_idx on public.user_activity_daily(campus_id, activity_date);

alter table public.user_activity_daily enable row level security;

create policy "user_activity_daily_read" on public.user_activity_daily for select to authenticated
  using (public.has_permission(auth.uid(), 'analytics.read') or public.current_user_is_admin());

-- No direct-insert policy: every write goes through touch_activity() below,
-- which is SECURITY DEFINER and bypasses RLS by design (same convention as
-- every other "the RPC is the only entry point" table in this schema).

create or replace function public.touch_activity()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_campus uuid;
begin
  if v_user is null then return; end if;

  select campus_id into v_campus from public.profiles where id = v_user;

  insert into public.user_activity_daily (user_id, campus_id, activity_date)
  values (v_user, v_campus, current_date)
  on conflict (user_id, activity_date) do nothing;
end;
$$;

grant execute on function public.touch_activity() to authenticated;

-- =========================================================
-- Ticket SLA target, set once at creation from priority so
-- service_requests.sla_due_at (existed since 0007, never populated) means
-- something. Doc has no stated per-priority targets, so these are a
-- reasonable operational default: urgent=4h, high=24h, normal=72h, low=7d.
-- =========================================================

create or replace function public.set_service_request_sla_due()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.sla_due_at is null then
    new.sla_due_at := new.created_at + case new.priority
      when 'urgent' then interval '4 hours'
      when 'high' then interval '24 hours'
      when 'low' then interval '7 days'
      else interval '72 hours'
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists service_requests_set_sla_due on public.service_requests;
create trigger service_requests_set_sla_due
before insert on public.service_requests
for each row execute function public.set_service_request_sla_due();

update public.service_requests set sla_due_at = created_at + case priority
    when 'urgent' then interval '4 hours'
    when 'high' then interval '24 hours'
    when 'low' then interval '7 days'
    else interval '72 hours'
  end
  where sla_due_at is null;

-- =========================================================
-- ADMIN ANALYTICS (platform-wide, optionally scoped to a campus)
-- =========================================================

create or replace function public.admin_dau_series(p_campus_id uuid default null, p_days integer default 30)
returns table (day date, dau bigint)
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
    select gs.d::date, count(distinct uad.user_id)
    from generate_series(current_date - (greatest(p_days,1) - 1), current_date, interval '1 day') gs(d)
    left join public.user_activity_daily uad
      on uad.activity_date = gs.d::date
      and (p_campus_id is null or uad.campus_id = p_campus_id)
    group by gs.d
    order by gs.d;
end;
$$;

grant execute on function public.admin_dau_series(uuid, integer) to authenticated;

create or replace function public.admin_gmv_series(p_campus_id uuid default null, p_days integer default 30)
returns table (day date, gmv numeric, orders_count bigint, aov numeric)
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
    select gs.d::date,
      coalesce(sum(o.total), 0)::numeric as gmv,
      count(o.id) as orders_count,
      case when count(o.id) > 0 then round(sum(o.total) / count(o.id), 2) else 0 end as aov
    from generate_series(current_date - (greatest(p_days,1) - 1), current_date, interval '1 day') gs(d)
    left join public.orders o
      on o.created_at::date = gs.d::date
      and o.payment_status = 'paid'
      and (p_campus_id is null or exists (
        select 1 from public.canteens c where c.id = o.canteen_id and c.campus_id = p_campus_id
      ))
    group by gs.d
    order by gs.d;
end;
$$;

grant execute on function public.admin_gmv_series(uuid, integer) to authenticated;

create or replace function public.admin_top_canteens_gmv(p_campus_id uuid default null, p_days integer default 30)
returns table (canteen_id uuid, canteen_name text, gmv numeric, orders_count bigint, aov numeric)
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
    select c.id, c.name,
      coalesce(sum(o.total), 0)::numeric,
      count(o.id),
      case when count(o.id) > 0 then round(sum(o.total) / count(o.id), 2) else 0 end
    from public.canteens c
    left join public.orders o
      on o.canteen_id = c.id
      and o.payment_status = 'paid'
      and o.created_at >= now() - (greatest(p_days,1) || ' days')::interval
    where (p_campus_id is null or c.campus_id = p_campus_id)
    group by c.id, c.name
    order by coalesce(sum(o.total), 0) desc;
end;
$$;

grant execute on function public.admin_top_canteens_gmv(uuid, integer) to authenticated;

-- SLA summary across the two domains that have a real due-by concept:
-- food-order fulfillment (fixed 30-minute operational target -- no
-- per-canteen target column exists) and facilities tickets
-- (priority-based sla_due_at, set above).
create or replace function public.admin_sla_summary(p_campus_id uuid default null, p_days integer default 30)
returns table (domain text, total bigint, within_sla bigint, breached bigint, avg_minutes numeric, sla_met_pct numeric)
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
    select 'food_order'::text,
      count(*),
      count(*) filter (where o.updated_at - o.created_at <= interval '30 minutes'),
      count(*) filter (where o.updated_at - o.created_at > interval '30 minutes'),
      round(avg(extract(epoch from (o.updated_at - o.created_at)) / 60)::numeric, 1),
      case when count(*) > 0 then round(100.0 * count(*) filter (where o.updated_at - o.created_at <= interval '30 minutes') / count(*), 1) else null end
    from public.orders o
    join public.canteens c on c.id = o.canteen_id
    where o.status in ('COMPLETED', 'DELIVERED')
      and o.created_at >= now() - (greatest(p_days,1) || ' days')::interval
      and (p_campus_id is null or c.campus_id = p_campus_id)
  union all
    select 'ticket'::text,
      count(*),
      count(*) filter (where (status in ('RESOLVED','CLOSED') and updated_at <= sla_due_at) or (status not in ('RESOLVED','CLOSED') and now() <= sla_due_at)),
      count(*) filter (where not ((status in ('RESOLVED','CLOSED') and updated_at <= sla_due_at) or (status not in ('RESOLVED','CLOSED') and now() <= sla_due_at))),
      round((avg(extract(epoch from (updated_at - created_at)) / 60) filter (where status in ('RESOLVED','CLOSED')))::numeric, 1),
      case when count(*) > 0 then round(100.0 * count(*) filter (where (status in ('RESOLVED','CLOSED') and updated_at <= sla_due_at) or (status not in ('RESOLVED','CLOSED') and now() <= sla_due_at)) / count(*), 1) else null end
    from public.service_requests
    where created_at >= now() - (greatest(p_days,1) || ' days')::interval
      and (p_campus_id is null or campus_id = p_campus_id);
end;
$$;

grant execute on function public.admin_sla_summary(uuid, integer) to authenticated;

-- =========================================================
-- VENDOR ANALYTICS -- scoped to whatever the caller owns (their own
-- canteen, or the print shop), mirroring how VendorDashboard.jsx already
-- branches between the two.
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

  raise exception 'No vendor profile (canteen or print shop) assigned to this account';
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

  raise exception 'No vendor profile (canteen or print shop) assigned to this account';
end;
$$;

grant execute on function public.vendor_sla_summary(integer) to authenticated;
