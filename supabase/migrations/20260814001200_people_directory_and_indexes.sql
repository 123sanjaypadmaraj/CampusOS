-- =============================================================================
-- 0012: SAFE PEOPLE DIRECTORY + REMAINING INDEXES (doc §42, §61, §90)
-- =============================================================================

-- search_people() is the ONLY way the frontend should list other students.
-- It runs as SECURITY DEFINER specifically so it can bypass the restrictive
-- profiles RLS policy (own-row-only) while still only ever projecting the
-- safe columns below -- email, phone and any future sensitive fields are
-- never included, regardless of what the caller asks for (doc §42).
create or replace function public.search_people(
  p_campus_id uuid,
  p_query text default null,
  p_department text default null,
  p_year text default null,
  p_skill text default null,
  p_open_to_projects boolean default null,
  p_limit integer default 20,
  p_cursor timestamptz default null
)
returns table (
  id uuid, name text, course text, department text, year text,
  skills text[], avatar_url text, open_to_projects boolean, created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.name, p.course, p.department, p.year, p.skills, p.avatar_url, p.open_to_projects, p.created_at
  from public.profiles p
  where p.campus_id = p_campus_id
    and p.privacy_level in ('public','campus')
    and p.status = 'active'
    and (p_query is null or p.name ilike '%'||p_query||'%' or p.course ilike '%'||p_query||'%')
    and (p_department is null or p.department = p_department)
    and (p_year is null or p.year = p_year)
    and (p_skill is null or p_skill = any(p.skills))
    and (p_open_to_projects is null or p.open_to_projects = p_open_to_projects)
    and (p_cursor is null or p.created_at < p_cursor)
  order by p.created_at desc
  limit least(coalesce(p_limit, 20), 100);
$$;

grant execute on function public.search_people(uuid, text, text, text, text, boolean, integer, timestamptz) to authenticated;

-- get_profile_snippets() is the safe way for ANY feature (marketplace
-- seller, lost & found reporter, post author, club member list, ...) to
-- show "who posted this" without ever exposing email/phone. It deliberately
-- takes a list of ids rather than joining -- callers already fetched the
-- rows they need names for.
create or replace function public.get_profile_snippets(p_ids uuid[])
returns table (id uuid, name text, course text, avatar_url text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.name, p.course, p.avatar_url
  from public.profiles p
  where p.id = any(p_ids)
    and p.privacy_level in ('public','campus')
    and p.status = 'active';
$$;

grant execute on function public.get_profile_snippets(uuid[]) to authenticated, anon;

-- =========================================================
-- Remaining indexes for the fields doc §61 calls out that weren't already
-- created inline in earlier migrations.
-- =========================================================

create index if not exists profiles_campus_idx on public.profiles(campus_id);
create index if not exists profiles_role_idx on public.profiles(role);
create index if not exists profiles_skills_idx on public.profiles using gin(skills);
create index if not exists profiles_search_idx on public.profiles using gin (name gin_trgm_ops);

create index if not exists notifications_user_read_idx on public.notifications(user_id, read, created_at desc);
create index if not exists payments_status_idx on public.payments(status);
create index if not exists refunds_status_idx on public.refunds(status);
create index if not exists marketplace_seller_idx on public.marketplace_listings(seller_id);
create index if not exists lost_found_user_idx on public.lost_found_items(user_id);
create index if not exists club_members_user_idx on public.club_members(user_id);
create index if not exists announcements_target_idx on public.announcements(target_scope, target_value);
