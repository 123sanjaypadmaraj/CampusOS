-- =============================================================================
-- 0043: GLOBAL UNIFIED SEARCH
-- Every module has always had its own local filter box (Home/Campus feed/
-- Connect/Food/Marketplace/Map). This adds one cross-module RPC the whole
-- app can query from a single search bar, returning a ranked, mixed set of
-- posts/events/clubs/marketplace listings/food items/services/lost&found/
-- announcements/people -- respecting exactly the same visibility rules each
-- module's own query already enforces (active/published/visible only,
-- campus-scoped, no email/phone on people).
-- =============================================================================

-- Trigram indexes so ILIKE '%term%' across all of these stays fast as the
-- tables grow (pg_trgm's gin_trgm_ops accelerates ILIKE, not just
-- similarity()). Most tables here didn't have one yet.
create index if not exists posts_title_trgm_idx on public.posts using gin (title gin_trgm_ops);
create index if not exists posts_content_trgm_idx on public.posts using gin (content gin_trgm_ops);
create index if not exists events_title_trgm_idx on public.events using gin (title gin_trgm_ops);
create index if not exists events_description_trgm_idx on public.events using gin (description gin_trgm_ops);
create index if not exists clubs_name_trgm_idx on public.clubs using gin (name gin_trgm_ops);
create index if not exists clubs_description_trgm_idx on public.clubs using gin (description gin_trgm_ops);
create index if not exists marketplace_title_trgm_idx on public.marketplace_listings using gin (title gin_trgm_ops);
create index if not exists marketplace_description_trgm_idx on public.marketplace_listings using gin (description gin_trgm_ops);
create index if not exists food_items_name_trgm_idx on public.food_items using gin (name gin_trgm_ops);
create index if not exists services_name_trgm_idx on public.services using gin (name gin_trgm_ops);
create index if not exists lost_found_title_trgm_idx on public.lost_found_items using gin (title gin_trgm_ops);
create index if not exists lost_found_description_trgm_idx on public.lost_found_items using gin (description gin_trgm_ops);
create index if not exists announcements_title_trgm_idx on public.announcements using gin (title gin_trgm_ops);
create index if not exists announcements_body_trgm_idx on public.announcements using gin (body gin_trgm_ops);

create or replace function public.global_search(p_query text, p_limit integer default 8)
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
begin
  if length(v_q) < 2 then
    return;
  end if;

  select campus_id into v_campus from public.profiles where id = v_user;

  return query
  (
    select 'post'::text, p.id, p.title,
           'Campus feed · ' || coalesce(pr.name, 'Someone'), left(p.content, 140),
           p.created_at, similarity(p.title || ' ' || p.content, v_q)
    from public.posts p
    join public.profiles pr on pr.id = p.author_id
    where p.status = 'visible'
      and (v_campus is null or p.campus_id = v_campus)
      and (p.title ilike '%'||v_q||'%' or p.content ilike '%'||v_q||'%')
    order by similarity(p.title || ' ' || p.content, v_q) desc, p.created_at desc
    limit v_limit
  )
  union all
  (
    select 'event', e.id, e.title,
           'Event' || coalesce(' · ' || to_char(e.event_date, 'DD Mon'), ''), left(coalesce(e.description, ''), 140),
           e.created_at, similarity(e.title || ' ' || coalesce(e.description, ''), v_q)
    from public.events e
    where e.published = true
      and (v_campus is null or e.campus_id = v_campus)
      and (e.title ilike '%'||v_q||'%' or e.description ilike '%'||v_q||'%')
    order by similarity(e.title || ' ' || coalesce(e.description, ''), v_q) desc, e.event_date desc
    limit v_limit
  )
  union all
  (
    select 'club', c.id, c.name,
           'Club' || coalesce(' · ' || c.category, ''), left(coalesce(c.description, ''), 140),
           c.created_at, similarity(c.name || ' ' || coalesce(c.description, ''), v_q)
    from public.clubs c
    where c.active = true
      and (v_campus is null or c.campus_id = v_campus)
      and (c.name ilike '%'||v_q||'%' or c.description ilike '%'||v_q||'%')
    order by similarity(c.name || ' ' || coalesce(c.description, ''), v_q) desc
    limit v_limit
  )
  union all
  (
    select 'listing', m.id, m.title,
           'Marketplace · ₹' || trim(to_char(m.price, 'FM999999990')), left(m.description, 140),
           m.created_at, similarity(m.title || ' ' || m.description, v_q)
    from public.marketplace_listings m
    where m.status = 'active'
      and (v_campus is null or m.campus_id = v_campus)
      and (m.title ilike '%'||v_q||'%' or m.description ilike '%'||v_q||'%')
    order by similarity(m.title || ' ' || m.description, v_q) desc
    limit v_limit
  )
  union all
  (
    select 'food_item', f.id, f.name,
           'Food · ' || cn.name, left(coalesce(f.description, ''), 140),
           f.created_at, similarity(f.name || ' ' || coalesce(f.description, ''), v_q)
    from public.food_items f
    join public.canteens cn on cn.id = f.canteen_id
    where f.active = true and cn.active = true
      and (v_campus is null or cn.campus_id = v_campus)
      and (f.name ilike '%'||v_q||'%' or f.description ilike '%'||v_q||'%')
    order by similarity(f.name || ' ' || coalesce(f.description, ''), v_q) desc
    limit v_limit
  )
  union all
  (
    select 'service', s.id, s.name,
           'Service · ' || s.category, left(coalesce(s.description, ''), 140),
           now(), similarity(s.name || ' ' || coalesce(s.description, ''), v_q)
    from public.services s
    where s.active = true
      and (v_campus is null or s.campus_id = v_campus)
      and (s.name ilike '%'||v_q||'%' or s.description ilike '%'||v_q||'%')
    order by similarity(s.name || ' ' || coalesce(s.description, ''), v_q) desc
    limit v_limit
  )
  union all
  (
    select 'lost_found', l.id, l.title,
           initcap(l.item_type) || ' · ' || l.location, left(l.description, 140),
           l.created_at, similarity(l.title || ' ' || l.description, v_q)
    from public.lost_found_items l
    where l.status in ('open', 'claim_pending')
      and (v_campus is null or l.campus_id = v_campus)
      and (l.title ilike '%'||v_q||'%' or l.description ilike '%'||v_q||'%')
    order by similarity(l.title || ' ' || l.description, v_q) desc
    limit v_limit
  )
  union all
  (
    select 'announcement', a.id, a.title,
           'Announcement · ' || a.category, left(a.body, 140),
           a.created_at, similarity(a.title || ' ' || a.body, v_q)
    from public.announcements a
    where a.published_at is not null
      and (v_campus is null or a.campus_id = v_campus)
      and (a.title ilike '%'||v_q||'%' or a.body ilike '%'||v_q||'%')
    order by similarity(a.title || ' ' || a.body, v_q) desc
    limit v_limit
  )
  union all
  (
    select 'person', pr.id, pr.name,
           coalesce(pr.course, 'Classmate'), left(coalesce(pr.bio, ''), 140),
           pr.created_at, similarity(pr.name || ' ' || coalesce(pr.course, '') || ' ' || array_to_string(pr.skills, ' '), v_q)
    from public.profiles pr
    where pr.privacy_level in ('public', 'campus')
      and pr.status = 'active'
      and pr.id <> coalesce(v_user, '00000000-0000-0000-0000-000000000000'::uuid)
      and (v_campus is null or pr.campus_id = v_campus)
      and (pr.name ilike '%'||v_q||'%' or pr.course ilike '%'||v_q||'%' or v_q = any(pr.skills))
    order by similarity(pr.name || ' ' || coalesce(pr.course, ''), v_q) desc
    limit v_limit
  )
  order by rank desc, created_at desc
  limit v_limit * 3;
end;
$$;

-- Authenticated only (mirrors search_people) -- results are campus-scoped
-- off the caller's own profile, which an anonymous caller doesn't have.
grant execute on function public.global_search(text, integer) to authenticated;
