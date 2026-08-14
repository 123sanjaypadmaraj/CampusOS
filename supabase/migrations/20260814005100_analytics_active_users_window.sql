-- =============================================================================
-- 0051: rolling-window active-user counts (WAU/MAU) -- admin_dau_series
-- (0050) returns one distinct-user count per calendar day, which is NOT the
-- same thing as "distinct users active at any point across the last 7/30
-- days" (a user active on 3 different days would otherwise get triple-
-- counted if a client just summed the daily series). Small enough to be
-- its own function rather than overloading admin_dau_series's return shape.
-- =============================================================================

create or replace function public.admin_active_users_window(p_campus_id uuid default null, p_days integer default 7)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_count bigint;
begin
  if not (public.has_permission(auth.uid(), 'analytics.read') or public.current_user_is_admin()) then
    raise exception 'Not authorized';
  end if;

  select count(distinct user_id) into v_count
  from public.user_activity_daily
  where activity_date >= current_date - (greatest(p_days,1) - 1)
    and (p_campus_id is null or campus_id = p_campus_id);

  return v_count;
end;
$$;

grant execute on function public.admin_active_users_window(uuid, integer) to authenticated;
