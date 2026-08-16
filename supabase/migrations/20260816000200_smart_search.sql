-- =============================================================================
-- SMART SEARCH (doc §72, "17. Smart Search") -- extends the unified search
-- built in 20260814004300_global_search.sql (posts/events/clubs/
-- marketplace/food/services/lost&found/announcements/people) with:
--   - four more entity types: vendors (canteens + stores), locations,
--     opportunities, campus store items
--   - real typo tolerance (pg_trgm similarity as a match FALLBACK, not
--     just a ranking signal -- today a genuine typo matches nothing at
--     all, since the WHERE clause requires an exact ILIKE substring)
--   - entity-type filters (p_types)
--   - personalized ranking (small boosts from the caller's skills/course/
--     department/year/club categories/past canteen orders -- the same
--     signal family recommend_*() already uses, not a new engine)
--   - recent searches + trending search suggestions
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Locations: `public.locations` already exists for real (resource booking,
-- 20260814000700_services_bookings.sql -- id/campus_id/name/type/building/
-- floor/room/latitude/longitude, `locations_read`/`locations_write` RLS
-- already in place, real rows already in it). This almost became a second,
-- competing "locations" table with fake seed data before a staging push
-- caught it (`create table if not exists` was silently a no-op against the
-- real one, then the new RLS policy below failed on a column that only
-- existed in the never-created duplicate) -- just add the one column
-- search needs, nothing else.
-- ---------------------------------------------------------------------------

alter table public.locations add column if not exists active boolean not null default true;

drop policy if exists "locations_read" on public.locations;
create policy "locations_read" on public.locations for select to anon, authenticated using (active);

-- ---------------------------------------------------------------------------
-- Trigram indexes for the new entity types (global_search's WHERE clauses
-- below use ILIKE/similarity() on these columns).
-- ---------------------------------------------------------------------------

create index if not exists locations_name_trgm_idx on public.locations using gin (name gin_trgm_ops);
create index if not exists locations_building_trgm_idx on public.locations using gin (building gin_trgm_ops);
create index if not exists canteens_name_trgm_idx on public.canteens using gin (name gin_trgm_ops);
create index if not exists stores_name_trgm_idx on public.stores using gin (name gin_trgm_ops);
create index if not exists store_items_name_trgm_idx on public.store_items using gin (name gin_trgm_ops);
create index if not exists store_items_description_trgm_idx on public.store_items using gin (description gin_trgm_ops);
create index if not exists opportunities_company_role_trgm_idx on public.opportunities using gin ((company || ' ' || role) gin_trgm_ops);
create index if not exists opportunities_description_trgm_idx on public.opportunities using gin (description gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- global_search: same signature's first two params, one new trailing
-- p_types param with a default (CREATE OR REPLACE can append a defaulted
-- parameter without dropping the function). Typo tolerance: every branch's
-- match predicate now falls back to `similarity(...) > v_typo_threshold`
-- when the ILIKE substring doesn't hit, so "pyhton" still finds "Python
-- Club". Personalization: a handful of small additive boosts on top of the
-- existing similarity-based rank, from signals already on the caller's own
-- profile/history -- not a new scoring engine, no extra round trip.
-- ---------------------------------------------------------------------------

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
    select 'post'::text, p.id, p.title,
           'Campus feed · ' || coalesce(pr.name, 'Someone'), left(p.content, 140),
           p.created_at, similarity(p.title || ' ' || p.content, v_q)
    from public.posts p
    join public.profiles pr on pr.id = p.author_id
    where (v_types is null or 'post' = any(v_types))
      and p.status = 'visible'
      and (v_campus is null or p.campus_id = v_campus)
      and (p.title ilike '%'||v_q||'%' or p.content ilike '%'||v_q||'%'
           or similarity(p.title || ' ' || p.content, v_q) > v_typo_threshold)
    order by similarity(p.title || ' ' || p.content, v_q) desc, p.created_at desc
    limit v_limit
  )
  union all
  (
    select 'event', e.id, e.title,
           'Event' || coalesce(' · ' || to_char(e.event_date, 'DD Mon'), ''), left(coalesce(e.description, ''), 140),
           e.created_at,
           similarity(e.title || ' ' || coalesce(e.description, ''), v_q)
             + (case when e.category = any(v_my_club_categories) then 0.05 else 0 end)
    from public.events e
    where (v_types is null or 'event' = any(v_types))
      and e.published = true
      and (v_campus is null or e.campus_id = v_campus)
      and (e.title ilike '%'||v_q||'%' or e.description ilike '%'||v_q||'%'
           or similarity(e.title || ' ' || coalesce(e.description, ''), v_q) > v_typo_threshold)
    order by 7 desc, e.event_date desc
    limit v_limit
  )
  union all
  (
    select 'club', c.id, c.name,
           'Club' || coalesce(' · ' || c.category, ''), left(coalesce(c.description, ''), 140),
           c.created_at,
           similarity(c.name || ' ' || coalesce(c.description, ''), v_q)
             + (case when c.category = any(v_my_club_categories) then 0.15 else 0 end)
    from public.clubs c
    where (v_types is null or 'club' = any(v_types))
      and c.active = true
      and (v_campus is null or c.campus_id = v_campus)
      and (c.name ilike '%'||v_q||'%' or c.description ilike '%'||v_q||'%'
           or similarity(c.name || ' ' || coalesce(c.description, ''), v_q) > v_typo_threshold)
    order by 7 desc
    limit v_limit
  )
  union all
  (
    select 'listing', m.id, m.title,
           'Marketplace · ₹' || trim(to_char(m.price, 'FM999999990')), left(m.description, 140),
           m.created_at, similarity(m.title || ' ' || m.description, v_q)
    from public.marketplace_listings m
    where (v_types is null or 'listing' = any(v_types))
      and m.status = 'active'
      and (v_campus is null or m.campus_id = v_campus)
      and (m.title ilike '%'||v_q||'%' or m.description ilike '%'||v_q||'%'
           or similarity(m.title || ' ' || m.description, v_q) > v_typo_threshold)
    order by similarity(m.title || ' ' || m.description, v_q) desc
    limit v_limit
  )
  union all
  (
    select 'food_item', f.id, f.name,
           'Food · ' || cn.name, left(coalesce(f.description, ''), 140),
           f.created_at,
           similarity(f.name || ' ' || coalesce(f.description, ''), v_q)
             + (case when f.canteen_id = any(v_my_canteen_ids) then 0.1 else 0 end)
    from public.food_items f
    join public.canteens cn on cn.id = f.canteen_id
    where (v_types is null or 'food_item' = any(v_types))
      and f.active = true and cn.active = true
      and (v_campus is null or cn.campus_id = v_campus)
      and (f.name ilike '%'||v_q||'%' or f.description ilike '%'||v_q||'%'
           or similarity(f.name || ' ' || coalesce(f.description, ''), v_q) > v_typo_threshold)
    order by 7 desc
    limit v_limit
  )
  union all
  (
    select 'service', s.id, s.name,
           'Service · ' || s.category, left(coalesce(s.description, ''), 140),
           now(), similarity(s.name || ' ' || coalesce(s.description, ''), v_q)
    from public.services s
    where (v_types is null or 'service' = any(v_types))
      and s.active = true
      and (v_campus is null or s.campus_id = v_campus)
      and (s.name ilike '%'||v_q||'%' or s.description ilike '%'||v_q||'%'
           or similarity(s.name || ' ' || coalesce(s.description, ''), v_q) > v_typo_threshold)
    order by similarity(s.name || ' ' || coalesce(s.description, ''), v_q) desc
    limit v_limit
  )
  union all
  (
    select 'lost_found', l.id, l.title,
           initcap(l.item_type) || ' · ' || l.location, left(l.description, 140),
           l.created_at, similarity(l.title || ' ' || l.description, v_q)
    from public.lost_found_items l
    where (v_types is null or 'lost_found' = any(v_types))
      and l.status in ('open', 'claim_pending')
      and (v_campus is null or l.campus_id = v_campus)
      and (l.title ilike '%'||v_q||'%' or l.description ilike '%'||v_q||'%'
           or similarity(l.title || ' ' || l.description, v_q) > v_typo_threshold)
    order by similarity(l.title || ' ' || l.description, v_q) desc
    limit v_limit
  )
  union all
  (
    select 'announcement', a.id, a.title,
           'Announcement · ' || a.category, left(a.body, 140),
           a.created_at, similarity(a.title || ' ' || a.body, v_q)
    from public.announcements a
    where (v_types is null or 'announcement' = any(v_types))
      and a.published_at is not null
      and (v_campus is null or a.campus_id = v_campus)
      and (a.title ilike '%'||v_q||'%' or a.body ilike '%'||v_q||'%'
           or similarity(a.title || ' ' || a.body, v_q) > v_typo_threshold)
    order by similarity(a.title || ' ' || a.body, v_q) desc
    limit v_limit
  )
  union all
  (
    select 'person', pr.id, pr.name,
           coalesce(pr.course, 'Classmate'), left(coalesce(pr.bio, ''), 140),
           pr.created_at,
           similarity(pr.name || ' ' || coalesce(pr.course, '') || ' ' || array_to_string(pr.skills, ' '), v_q)
             + (case when pr.course is not null and pr.course = v_course then 0.15 else 0 end)
             + (case when pr.department is not null and pr.department = v_department then 0.1 else 0 end)
             + (case when pr.year is not null and pr.year = v_year then 0.05 else 0 end)
             + (case when pr.skills && v_skills then 0.1 else 0 end)
    from public.profiles pr
    where (v_types is null or 'person' = any(v_types))
      and pr.privacy_level in ('public', 'campus')
      and pr.status = 'active'
      and pr.id <> coalesce(v_user, '00000000-0000-0000-0000-000000000000'::uuid)
      and (v_campus is null or pr.campus_id = v_campus)
      and (pr.name ilike '%'||v_q||'%' or pr.course ilike '%'||v_q||'%' or v_q = any(pr.skills)
           or similarity(pr.name || ' ' || coalesce(pr.course, ''), v_q) > v_typo_threshold)
    order by 7 desc
    limit v_limit
  )
  union all
  (
    select 'canteen', cn.id, cn.name,
           'Vendor · Canteen' || coalesce(' · ' || cn.status, ''), coalesce(cn.subtitle, ''),
           now(), similarity(cn.name || ' ' || coalesce(cn.subtitle, ''), v_q)
             + (case when cn.id = any(v_my_canteen_ids) then 0.1 else 0 end)
    from public.canteens cn
    where (v_types is null or 'canteen' = any(v_types))
      and cn.active = true
      and (v_campus is null or cn.campus_id = v_campus)
      and (cn.name ilike '%'||v_q||'%' or cn.subtitle ilike '%'||v_q||'%'
           or similarity(cn.name || ' ' || coalesce(cn.subtitle, ''), v_q) > v_typo_threshold)
    order by 7 desc
    limit v_limit
  )
  union all
  (
    select 'store_vendor', st.id, st.name,
           'Vendor · Store · ' || st.category, coalesce(st.subtitle, ''),
           st.created_at, similarity(st.name || ' ' || coalesce(st.subtitle, ''), v_q)
    from public.stores st
    where (v_types is null or 'store_vendor' = any(v_types))
      and st.active = true
      and (v_campus is null or st.campus_id = v_campus)
      and (st.name ilike '%'||v_q||'%' or st.subtitle ilike '%'||v_q||'%'
           or similarity(st.name || ' ' || coalesce(st.subtitle, ''), v_q) > v_typo_threshold)
    order by similarity(st.name || ' ' || coalesce(st.subtitle, ''), v_q) desc
    limit v_limit
  )
  union all
  (
    select 'store_item', si.id, si.name,
           'Store · ' || st.name, left(coalesce(si.description, ''), 140),
           si.created_at, similarity(si.name || ' ' || coalesce(si.description, ''), v_q)
    from public.store_items si
    join public.stores st on st.id = si.store_id
    where (v_types is null or 'store_item' = any(v_types))
      and si.active = true and st.active = true
      and (v_campus is null or st.campus_id = v_campus)
      and (si.name ilike '%'||v_q||'%' or si.description ilike '%'||v_q||'%'
           or similarity(si.name || ' ' || coalesce(si.description, ''), v_q) > v_typo_threshold)
    order by similarity(si.name || ' ' || coalesce(si.description, ''), v_q) desc
    limit v_limit
  )
  union all
  (
    select 'opportunity', o.id, o.role,
           'Opportunity · ' || o.company || ' · ' || o.type, left(o.description, 140),
           o.created_at,
           similarity(o.company || ' ' || o.role || ' ' || o.description, v_q)
             + (case when o.tags && v_skills then 0.15 else 0 end)
    from public.opportunities o
    where (v_types is null or 'opportunity' = any(v_types))
      and o.active = true
      and (v_campus is null or o.campus_id = v_campus)
      and (o.company ilike '%'||v_q||'%' or o.role ilike '%'||v_q||'%' or o.description ilike '%'||v_q||'%'
           or v_q = any(o.tags)
           or similarity(o.company || ' ' || o.role || ' ' || o.description, v_q) > v_typo_threshold)
    order by 7 desc
    limit v_limit
  )
  union all
  (
    select 'location', loc.id, loc.name,
           'Location · ' || coalesce(loc.type, 'Campus'),
           trim(both ' · ' from coalesce(loc.building, '') || coalesce(' · ' || loc.floor, '') || coalesce(' · Room ' || loc.room, '')),
           now(), similarity(loc.name || ' ' || coalesce(loc.building, ''), v_q)
    from public.locations loc
    where (v_types is null or 'location' = any(v_types))
      and loc.active = true
      and (v_campus is null or loc.campus_id = v_campus)
      and (loc.name ilike '%'||v_q||'%' or loc.building ilike '%'||v_q||'%'
           or similarity(loc.name || ' ' || coalesce(loc.building, ''), v_q) > v_typo_threshold)
    order by similarity(loc.name || ' ' || coalesce(loc.building, ''), v_q) desc
    limit v_limit
  )
  order by rank desc, created_at desc
  limit v_limit * 3;
end;
$$;

grant execute on function public.global_search(text, integer, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Recent searches + trending suggestions.
-- ---------------------------------------------------------------------------

create table if not exists public.search_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  query text not null,
  created_at timestamptz not null default now()
);

create index if not exists search_history_user_idx on public.search_history(user_id, created_at desc);
create index if not exists search_history_recent_idx on public.search_history(created_at desc);

alter table public.search_history enable row level security;
drop policy if exists "search_history_read_own" on public.search_history;
create policy "search_history_read_own" on public.search_history for select to authenticated
  using (user_id = auth.uid());
-- No insert/update/delete policy -- log_search()/clear_recent_searches()
-- (SECURITY DEFINER) are the only writers, same "RPC-only writes" pattern
-- used for club_applications/club_membership_history.

create or replace function public.log_search(p_query text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_q text := btrim(coalesce(p_query, ''));
  v_last_id uuid;
  v_last_query text;
begin
  if v_user is null or length(v_q) < 2 then
    return;
  end if;

  select id, query into v_last_id, v_last_query
  from public.search_history where user_id = v_user order by created_at desc limit 1;

  -- A repeat of the immediately-previous search just bumps its timestamp
  -- instead of piling up duplicate rows (e.g. re-opening the same result).
  if v_last_query = v_q then
    update public.search_history set created_at = now() where id = v_last_id;
    return;
  end if;

  insert into public.search_history (user_id, query) values (v_user, v_q);

  delete from public.search_history
  where user_id = v_user and id not in (
    select id from public.search_history where user_id = v_user order by created_at desc limit 20
  );
end;
$$;

grant execute on function public.log_search(text) to authenticated;

create or replace function public.get_recent_searches(p_limit integer default 8)
returns table(query text, searched_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select query, max(created_at) as searched_at
  from public.search_history
  where user_id = auth.uid()
  group by query
  order by searched_at desc
  limit least(greatest(coalesce(p_limit, 8), 1), 20);
$$;

grant execute on function public.get_recent_searches(integer) to authenticated;

create or replace function public.clear_recent_searches()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.search_history where user_id = auth.uid();
$$;

grant execute on function public.clear_recent_searches() to authenticated;

-- Trending searches: what other students on the same campus have searched
-- in the last 14 days, most frequent first. Reveals only aggregate
-- (query, count) pairs -- never who searched what.
create or replace function public.get_search_suggestions(p_limit integer default 6)
returns table(query text, hits integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_campus uuid;
begin
  select campus_id into v_campus from public.profiles where id = v_user;

  return query
  select h.query, count(*)::integer as hits
  from public.search_history h
  join public.profiles p on p.id = h.user_id
  where h.created_at > now() - interval '14 days'
    and (v_campus is null or p.campus_id = v_campus)
    and (v_user is null or h.user_id <> v_user)
  group by h.query
  order by hits desc, max(h.created_at) desc
  limit least(greatest(coalesce(p_limit, 6), 1), 20);
end;
$$;

grant execute on function public.get_search_suggestions(integer) to authenticated;
