-- =============================================================================
-- 0020: PROFILE SOCIAL LINKS + ACHIEVEMENTS (classmate directory / "Connect")
-- =============================================================================
-- Backs two frontend changes: (1) LinkedIn/GitHub links on a student's own
-- profile, (2) the "Socialize" tab repurposed from spoofed nearby-college
-- posts into a real in-campus classmate directory that surfaces self-reported
-- achievements. See src/App.jsx `Profile` / `Socialize` components.

alter table public.profiles add column if not exists linkedin_url text;
alter table public.profiles add column if not exists github_url text;
alter table public.profiles add column if not exists achievements text[] not null default '{}';

-- Loose format guards, not full URL validation -- keeps garbage out without
-- being a strict RFC 3986 parser. NULL/empty is always allowed; the app
-- layer normalizes '' to null before writing (see updateProfile in
-- src/services/mvpService.js) so these never fire on an empty field.
alter table public.profiles drop constraint if exists profiles_linkedin_url_check;
alter table public.profiles add constraint profiles_linkedin_url_check
  check (linkedin_url is null or linkedin_url ~* '^https://([a-z]{2,3}\.)?linkedin\.com/.+');

alter table public.profiles drop constraint if exists profiles_github_url_check;
alter table public.profiles add constraint profiles_github_url_check
  check (github_url is null or github_url ~* '^https://github\.com/.+');

-- search_people() is the SECURITY DEFINER, column-whitelisting RPC the
-- classmate directory reads through (see 0012) -- extend its projection with
-- the new fields. bio/achievements/linkedin_url/github_url are all
-- self-authored, intentionally-public professional info (same trust level as
-- name/course/skills already exposed here); email/phone remain excluded.
--
-- Postgres won't let CREATE OR REPLACE change a function's OUT-parameter row
-- type (only the body), so the old signature has to be dropped first -- the
-- parameter list itself is unchanged, only the RETURNS TABLE columns grow.
drop function if exists public.search_people(uuid, text, text, text, text, boolean, integer, timestamptz);

create function public.search_people(
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
  skills text[], avatar_url text, open_to_projects boolean, created_at timestamptz,
  bio text, achievements text[], linkedin_url text, github_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.name, p.course, p.department, p.year, p.skills, p.avatar_url, p.open_to_projects, p.created_at,
         p.bio, p.achievements, p.linkedin_url, p.github_url
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
