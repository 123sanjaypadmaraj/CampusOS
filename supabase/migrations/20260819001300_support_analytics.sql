-- =============================================================================
-- SUPPORT ANALYTICS. admin_tickets_by_category/admin_facilities_summary
-- (20260815001300_analytics_platform.sql) predate support_tickets entirely
-- (it didn't exist until 20260819000600) and read from service_requests
-- (facilities maintenance) -- there has never been any analytics coverage
-- for the general support-ticket queue. Same access gate
-- (analytics.read or admin) and p_campus_id/p_days shape as every other
-- admin_* analytics RPC so Analytics.jsx's existing Promise.all/rpc() helper
-- needs no changes.
-- =============================================================================

create or replace function public.admin_support_summary(p_campus_id uuid default null, p_days integer default 30)
returns table (
  ticket_count bigint,
  resolved_pct numeric,
  urgent_count bigint,
  escalated_open_count bigint,
  avg_resolution_hours numeric
)
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
    select
      count(*),
      case when count(*) > 0
        then round(100.0 * count(*) filter (where st.status in ('resolved', 'closed')) / count(*), 1)
        else null end,
      count(*) filter (where st.priority = 'urgent'),
      count(*) filter (where st.priority = 'urgent' and st.status not in ('resolved', 'closed')),
      round(avg(extract(epoch from (st.updated_at - st.created_at)) / 3600.0)
        filter (where st.status in ('resolved', 'closed')), 1)
    from public.support_tickets st
    where st.created_at >= now() - (greatest(p_days, 1) || ' days')::interval
      and (p_campus_id is null or st.campus_id = p_campus_id);
end;
$$;

grant execute on function public.admin_support_summary(uuid, integer) to authenticated;

-- RETURNS TABLE(category text, ...) shadows a bare `category` reference the
-- same way admin_tickets_by_category's own header warns about -- every
-- reference below is qualified with the table alias `st`.
create or replace function public.admin_support_tickets_by_category(p_campus_id uuid default null, p_days integer default 30)
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
    select st.category, count(*)
    from public.support_tickets st
    where st.created_at >= now() - (greatest(p_days, 1) || ' days')::interval
      and (p_campus_id is null or st.campus_id = p_campus_id)
    group by st.category
    order by count(*) desc;
end;
$$;

grant execute on function public.admin_support_tickets_by_category(uuid, integer) to authenticated;

create or replace function public.admin_support_tickets_by_priority(p_campus_id uuid default null, p_days integer default 30)
returns table (priority text, ticket_count bigint)
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
    select st.priority, count(*)
    from public.support_tickets st
    where st.created_at >= now() - (greatest(p_days, 1) || ' days')::interval
      and (p_campus_id is null or st.campus_id = p_campus_id)
    group by st.priority
    order by array_position(array['urgent','high','normal','low'], st.priority);
end;
$$;

grant execute on function public.admin_support_tickets_by_priority(uuid, integer) to authenticated;

-- Daily volume trend, same generate_series-left-join-zero-fill shape as
-- admin_dau_series/admin_gmv_series so TrendChart never has to special-case
-- a day with zero tickets.
create or replace function public.admin_support_tickets_series(p_campus_id uuid default null, p_days integer default 30)
returns table (day date, ticket_count bigint)
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
    select gs.d::date, count(st.id)
    from generate_series(current_date - (greatest(p_days, 1) - 1), current_date, interval '1 day') gs(d)
    left join public.support_tickets st
      on st.created_at::date = gs.d::date
      and (p_campus_id is null or st.campus_id = p_campus_id)
    group by gs.d
    order by gs.d;
end;
$$;

grant execute on function public.admin_support_tickets_series(uuid, integer) to authenticated;
