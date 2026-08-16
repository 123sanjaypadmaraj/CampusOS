-- =============================================================================
-- Fix a real bug in 20260816000200_smart_search.sql's global_search():
-- none of the branches gave their output columns explicit aliases, so the
-- combined UNION ALL's result columns were unnamed everywhere a branch's
-- last column was an expression (similarity(...), or similarity(...) +
-- a CASE boost) rather than a bare column reference. The function's own
-- trailing `order by rank desc, created_at desc` then failed outright --
-- Postgres requires a UNION's ORDER BY to reference actual output column
-- names, not expressions -- with "invalid UNION/INTERSECT/EXCEPT ORDER BY
-- clause". Found live: the very first authenticated search call in
-- scripts/live-check-smart-search.mjs crashed with exactly this error.
-- Same signature as before (CREATE OR REPLACE in place, no new overload) --
-- every branch now explicitly aliases its 7 columns to match the function's
-- RETURNS TABLE column names, and every ORDER BY (inner and outer) uses
-- the `rank` name instead of a positional ordinal.
-- =============================================================================

create or replace function public.global_search(p_query text, p_limit integer default 8, p_types text[] default null)
returns table (
  entity_type text, entity_id uuid, title text, subtitle text, snippet text,
  created_at timestamptz, rank real
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_campus uuid;
  v_q text := btrim(coalesce(p_query, ''));
  v_limit integer := least(greatest(coalesce(p_limit, 8), 1), 20);
  v_types text[] := p_types;
  v_typo_threshold constant real := 0.15;
  v_skills text[];
  v_course text;
  v_department text;
  v_year text;
  v_my_club_categories text[];
  v_my_canteen_ids uuid[];
begin
  -- The original 0043 comment says "authenticated only", but nothing ever
  -- actually enforced that -- Supabase's default privileges grant EXECUTE
  -- to `anon` on every new function in this schema automatically, and
  -- without this check an anonymous caller just got v_campus = null,
  -- silently searching across every campus instead of being rejected.
  -- Found live via scripts/live-check-smart-search.mjs.
  if v_user is null then
    raise exception 'Sign in required';
  end if;

  if length(v_q) < 2 then
    return;
  end if;

  select campus_id, skills, course, department, year
    into v_campus, v_skills, v_course, v_department, v_year
  from public.profiles where id = v_user;

  select coalesce(array_agg(distinct c.category), '{}') into v_my_club_categories
  from public.club_members m join public.clubs c on c.id = m.club_id
  where m.user_id = v_user and c.category is not null;

  select coalesce(array_agg(distinct o.canteen_id), '{}') into v_my_canteen_ids
  from public.orders o where o.user_id = v_user;

  return query
  (
    select 'post'::text as entity_type, p.id as entity_id, p.title as title,
           'Campus feed · ' || coalesce(pr.name, 'Someone') as subtitle, left(p.content, 140) as snippet,
           p.created_at as created_at, similarity(p.title || ' ' || p.content, v_q) as rank
    from public.posts p
    join public.profiles pr on pr.id = p.author_id
    where (v_types is null or 'post' = any(v_types))
      and p.status = 'visible'
      and (v_campus is null or p.campus_id = v_campus)
      and (p.title ilike '%'||v_q||'%' or p.content ilike '%'||v_q||'%'
           or similarity(p.title || ' ' || p.content, v_q) > v_typo_threshold)
    order by rank desc, created_at desc
    limit v_limit
  )
  union all
  (
    select 'event', e.id, e.title,
           'Event' || coalesce(' · ' || to_char(e.event_date, 'DD Mon'), ''), left(coalesce(e.description, ''), 140),
           e.created_at,
           similarity(e.title || ' ' || coalesce(e.description, ''), v_q)
             + (case when e.category = any(v_my_club_categories) then 0.05::real else 0::real end) as rank
    from public.events e
    where (v_types is null or 'event' = any(v_types))
      and e.published = true
      and (v_campus is null or e.campus_id = v_campus)
      and (e.title ilike '%'||v_q||'%' or e.description ilike '%'||v_q||'%'
           or similarity(e.title || ' ' || coalesce(e.description, ''), v_q) > v_typo_threshold)
    order by rank desc, e.event_date desc
    limit v_limit
  )
  union all
  (
    select 'club', c.id, c.name,
           'Club' || coalesce(' · ' || c.category, ''), left(coalesce(c.description, ''), 140),
           c.created_at,
           similarity(c.name || ' ' || coalesce(c.description, ''), v_q)
             + (case when c.category = any(v_my_club_categories) then 0.15::real else 0::real end) as rank
    from public.clubs c
    where (v_types is null or 'club' = any(v_types))
      and c.active = true
      and (v_campus is null or c.campus_id = v_campus)
      and (c.name ilike '%'||v_q||'%' or c.description ilike '%'||v_q||'%'
           or similarity(c.name || ' ' || coalesce(c.description, ''), v_q) > v_typo_threshold)
    order by rank desc
    limit v_limit
  )
  union all
  (
    select 'listing', m.id, m.title,
           'Marketplace · ₹' || trim(to_char(m.price, 'FM999999990')), left(m.description, 140),
           m.created_at, similarity(m.title || ' ' || m.description, v_q) as rank
    from public.marketplace_listings m
    where (v_types is null or 'listing' = any(v_types))
      and m.status = 'active'
      and (v_campus is null or m.campus_id = v_campus)
      and (m.title ilike '%'||v_q||'%' or m.description ilike '%'||v_q||'%'
           or similarity(m.title || ' ' || m.description, v_q) > v_typo_threshold)
    order by rank desc
    limit v_limit
  )
  union all
  (
    select 'food_item', f.id, f.name,
           'Food · ' || cn.name, left(coalesce(f.description, ''), 140),
           f.created_at,
           similarity(f.name || ' ' || coalesce(f.description, ''), v_q)
             + (case when f.canteen_id = any(v_my_canteen_ids) then 0.1::real else 0::real end) as rank
    from public.food_items f
    join public.canteens cn on cn.id = f.canteen_id
    where (v_types is null or 'food_item' = any(v_types))
      and f.active = true and cn.active = true
      and (v_campus is null or cn.campus_id = v_campus)
      and (f.name ilike '%'||v_q||'%' or f.description ilike '%'||v_q||'%'
           or similarity(f.name || ' ' || coalesce(f.description, ''), v_q) > v_typo_threshold)
    order by rank desc
    limit v_limit
  )
  union all
  (
    select 'service', s.id, s.name,
           'Service · ' || s.category, left(coalesce(s.description, ''), 140),
           now(), similarity(s.name || ' ' || coalesce(s.description, ''), v_q) as rank
    from public.services s
    where (v_types is null or 'service' = any(v_types))
      and s.active = true
      and (v_campus is null or s.campus_id = v_campus)
      and (s.name ilike '%'||v_q||'%' or s.description ilike '%'||v_q||'%'
           or similarity(s.name || ' ' || coalesce(s.description, ''), v_q) > v_typo_threshold)
    order by rank desc
    limit v_limit
  )
  union all
  (
    select 'lost_found', l.id, l.title,
           initcap(l.item_type) || ' · ' || l.location, left(l.description, 140),
           l.created_at, similarity(l.title || ' ' || l.description, v_q) as rank
    from public.lost_found_items l
    where (v_types is null or 'lost_found' = any(v_types))
      and l.status in ('open', 'claim_pending')
      and (v_campus is null or l.campus_id = v_campus)
      and (l.title ilike '%'||v_q||'%' or l.description ilike '%'||v_q||'%'
           or similarity(l.title || ' ' || l.description, v_q) > v_typo_threshold)
    order by rank desc
    limit v_limit
  )
  union all
  (
    select 'announcement', a.id, a.title,
           'Announcement · ' || a.category, left(a.body, 140),
           a.created_at, similarity(a.title || ' ' || a.body, v_q) as rank
    from public.announcements a
    where (v_types is null or 'announcement' = any(v_types))
      and a.published_at is not null
      and (v_campus is null or a.campus_id = v_campus)
      and (a.title ilike '%'||v_q||'%' or a.body ilike '%'||v_q||'%'
           or similarity(a.title || ' ' || a.body, v_q) > v_typo_threshold)
    order by rank desc
    limit v_limit
  )
  union all
  (
    select 'person', pr.id, pr.name,
           coalesce(pr.course, 'Classmate'), left(coalesce(pr.bio, ''), 140),
           pr.created_at,
           similarity(pr.name || ' ' || coalesce(pr.course, '') || ' ' || array_to_string(pr.skills, ' '), v_q)
             + (case when pr.course is not null and pr.course = v_course then 0.15::real else 0::real end)
             + (case when pr.department is not null and pr.department = v_department then 0.1::real else 0::real end)
             + (case when pr.year is not null and pr.year = v_year then 0.05::real else 0::real end)
             + (case when pr.skills && v_skills then 0.1::real else 0::real end) as rank
    from public.profiles pr
    where (v_types is null or 'person' = any(v_types))
      and pr.privacy_level in ('public', 'campus')
      and pr.status = 'active'
      and pr.id <> coalesce(v_user, '00000000-0000-0000-0000-000000000000'::uuid)
      and (v_campus is null or pr.campus_id = v_campus)
      and (pr.name ilike '%'||v_q||'%' or pr.course ilike '%'||v_q||'%' or v_q = any(pr.skills)
           or similarity(pr.name || ' ' || coalesce(pr.course, ''), v_q) > v_typo_threshold)
    order by rank desc
    limit v_limit
  )
  union all
  (
    select 'canteen', cn.id, cn.name,
           'Vendor · Canteen' || coalesce(' · ' || cn.status, ''), coalesce(cn.subtitle, ''),
           now(), similarity(cn.name || ' ' || coalesce(cn.subtitle, ''), v_q)
             + (case when cn.id = any(v_my_canteen_ids) then 0.1::real else 0::real end) as rank
    from public.canteens cn
    where (v_types is null or 'canteen' = any(v_types))
      and cn.active = true
      and (v_campus is null or cn.campus_id = v_campus)
      and (cn.name ilike '%'||v_q||'%' or cn.subtitle ilike '%'||v_q||'%'
           or similarity(cn.name || ' ' || coalesce(cn.subtitle, ''), v_q) > v_typo_threshold)
    order by rank desc
    limit v_limit
  )
  union all
  (
    select 'store_vendor', st.id, st.name,
           'Vendor · Store · ' || st.category, coalesce(st.subtitle, ''),
           st.created_at, similarity(st.name || ' ' || coalesce(st.subtitle, ''), v_q) as rank
    from public.stores st
    where (v_types is null or 'store_vendor' = any(v_types))
      and st.active = true
      and (v_campus is null or st.campus_id = v_campus)
      and (st.name ilike '%'||v_q||'%' or st.subtitle ilike '%'||v_q||'%'
           or similarity(st.name || ' ' || coalesce(st.subtitle, ''), v_q) > v_typo_threshold)
    order by rank desc
    limit v_limit
  )
  union all
  (
    select 'store_item', si.id, si.name,
           'Store · ' || st.name, left(coalesce(si.description, ''), 140),
           si.created_at, similarity(si.name || ' ' || coalesce(si.description, ''), v_q) as rank
    from public.store_items si
    join public.stores st on st.id = si.store_id
    where (v_types is null or 'store_item' = any(v_types))
      and si.active = true and st.active = true
      and (v_campus is null or st.campus_id = v_campus)
      and (si.name ilike '%'||v_q||'%' or si.description ilike '%'||v_q||'%'
           or similarity(si.name || ' ' || coalesce(si.description, ''), v_q) > v_typo_threshold)
    order by rank desc
    limit v_limit
  )
  union all
  (
    select 'opportunity', o.id, o.role,
           'Opportunity · ' || o.company || ' · ' || o.type, left(o.description, 140),
           o.created_at,
           similarity(o.company || ' ' || o.role || ' ' || o.description, v_q)
             + (case when o.tags && v_skills then 0.15::real else 0::real end) as rank
    from public.opportunities o
    where (v_types is null or 'opportunity' = any(v_types))
      and o.active = true
      and (v_campus is null or o.campus_id = v_campus)
      and (o.company ilike '%'||v_q||'%' or o.role ilike '%'||v_q||'%' or o.description ilike '%'||v_q||'%'
           or v_q = any(o.tags)
           or similarity(o.company || ' ' || o.role || ' ' || o.description, v_q) > v_typo_threshold)
    order by rank desc
    limit v_limit
  )
  union all
  (
    select 'location', loc.id, loc.name,
           'Location · ' || coalesce(loc.type, 'Campus'),
           trim(both ' · ' from coalesce(loc.building, '') || coalesce(' · ' || loc.floor, '') || coalesce(' · Room ' || loc.room, '')),
           now(), similarity(loc.name || ' ' || coalesce(loc.building, ''), v_q) as rank
    from public.locations loc
    where (v_types is null or 'location' = any(v_types))
      and loc.active = true
      and (v_campus is null or loc.campus_id = v_campus)
      and (loc.name ilike '%'||v_q||'%' or loc.building ilike '%'||v_q||'%'
           or similarity(loc.name || ' ' || coalesce(loc.building, ''), v_q) > v_typo_threshold)
    order by rank desc
    limit v_limit
  )
  order by rank desc, created_at desc
  limit v_limit * 3;
end;
$$;

-- The overload churn in 20260816000200 (a genuinely new function object,
-- not a true in-place replace -- see 20260816000300) left this granted to
-- PUBLIC, which is Postgres's default for a newly-created function unless
-- explicitly revoked -- silently letting anon/unauthenticated callers
-- through despite the `to authenticated`-only grant below (grants are
-- additive; CREATE OR REPLACE never revokes an existing one). Found live:
-- scripts/live-check-smart-search.mjs's very first assertion.
revoke execute on function public.global_search(text, integer, text[]) from public;
revoke execute on function public.global_search(text, integer, text[]) from anon;
grant execute on function public.global_search(text, integer, text[]) to authenticated;

-- Same "PUBLIC/anon got a default-privilege grant on every new function in
-- this schema" issue applies to every other function 20260816000200 added.
-- log_search()/get_recent_searches()/clear_recent_searches() are already
-- harmless for an anonymous caller (auth.uid() is null, so they touch zero
-- rows) but revoking here too keeps the grant list honest about intent,
-- same as global_search above.
revoke execute on function public.log_search(text) from public, anon;
revoke execute on function public.get_recent_searches(integer) from public, anon;
revoke execute on function public.clear_recent_searches() from public, anon;
revoke execute on function public.get_search_suggestions(integer) from public, anon;
