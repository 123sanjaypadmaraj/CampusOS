-- =============================================================================
-- 20260830000400: REAL COMMUNITY STATS FOR THE CAMPUS FEED SIDEBAR
-- =============================================================================
-- The Campus Feed "YOUR CAMPUS" mini-stats were hardcoded marketing copy
-- ("6,000+ students" / "20 active clubs") -- not real counts. Club count can
-- already be read for real client-side (getClubs() already fetches every
-- active club for the campus, so the frontend just uses that array's
-- length), but profiles are locked down by profiles_read_self_or_privileged
-- (own-row-only) per doc §42, so student/faculty counts need a SECURITY
-- DEFINER RPC that returns only an aggregate -- never row data -- same
-- pattern as search_people()/get_profile_snippets() in
-- 20260814001200_people_directory_and_indexes.sql.

create or replace function public.get_community_stats(p_campus_id uuid)
returns table (student_count bigint, faculty_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*) filter (where role = 'student') as student_count,
    count(*) filter (where role = 'faculty') as faculty_count
  from public.profiles
  where status = 'active'
    and (p_campus_id is null or campus_id = p_campus_id);
$$;

grant execute on function public.get_community_stats(uuid) to anon, authenticated;
