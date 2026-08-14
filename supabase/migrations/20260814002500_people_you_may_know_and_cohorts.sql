-- =============================================================================
-- 0024: "PEOPLE YOU MAY KNOW" + AUTO COHORT GROUPS
-- Two LinkedIn-style features on top of the existing Connect directory:
--   1. get_people_you_may_know() -- a ranked similarity list per student,
--      scored from branch/year, shared club membership, and shared
--      community-activity tags (doc-requested signals; skills deliberately
--      excluded from scoring this round).
--   2. Auto-formed cohort groups -- one group per (campus, course, year)
--      combination, membership derived automatically from profiles rather
--      than requiring anyone to create or join it manually.
-- Both are SECURITY DEFINER and project only the same safe fields
-- search_people()/get_profile_snippets() already expose -- never email/phone.
-- =============================================================================

create or replace function public.get_people_you_may_know(
  p_limit integer default 12
)
returns table (
  id uuid, name text, course text, department text, year text,
  avatar_url text, skills text[], shared_clubs integer, shared_tags integer, score integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_campus uuid;
  v_course text;
  v_year text;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;

  -- Qualified explicitly: RETURNS TABLE(course, year, ...) implicitly
  -- creates OUT-parameter variables with those exact names, so bare
  -- `course`/`year` here would be ambiguous against pr.course/pr.year.
  select pr.campus_id, pr.course, pr.year into v_campus, v_course, v_year
  from public.profiles pr where pr.id = v_user;

  return query
  with my_clubs as (
    select club_id from public.club_members where user_id = v_user
  ),
  my_tags as (
    select distinct unnest(tags) as tag from public.posts where author_id = v_user and status = 'visible'
    union
    select distinct unnest(p.tags) as tag from public.post_likes l join public.posts p on p.id = l.post_id where l.user_id = v_user and p.status = 'visible'
  ),
  candidates as (
    select
      pr.id, pr.name, pr.course, pr.department, pr.year, pr.avatar_url, pr.skills,
      coalesce((
        select count(*)::int from public.club_members cm
        where cm.user_id = pr.id and cm.club_id in (select club_id from my_clubs)
      ), 0) as shared_clubs,
      coalesce((
        select count(distinct t.tag)::int
        from (
          select unnest(tags) as tag from public.posts where author_id = pr.id and status = 'visible'
          union
          select unnest(p2.tags) as tag from public.post_likes l2 join public.posts p2 on p2.id = l2.post_id where l2.user_id = pr.id and p2.status = 'visible'
        ) t
        where t.tag in (select tag from my_tags)
      ), 0) as shared_tags
    from public.profiles pr
    where pr.campus_id = v_campus
      and pr.id <> v_user
      and pr.privacy_level in ('public','campus')
      and pr.status = 'active'
  )
  select
    c.id, c.name, c.course, c.department, c.year, c.avatar_url, c.skills,
    c.shared_clubs, c.shared_tags,
    (
      (case when c.course is not distinct from v_course and c.course is not null then 35 else 0 end) +
      (case when c.year is not distinct from v_year and c.year is not null then 15 else 0 end) +
      least(c.shared_clubs * 15, 30) +
      least(c.shared_tags * 5, 20)
    )::int as score
  from candidates c
  where (
    (c.course is not distinct from v_course and c.course is not null)
    or c.shared_clubs > 0
    or c.shared_tags > 0
  )
  order by score desc, c.shared_clubs desc, c.name
  limit least(coalesce(p_limit, 12), 50);
end;
$$;

grant execute on function public.get_people_you_may_know(integer) to authenticated;

-- =========================================================
-- AUTO COHORT GROUPS -- one per (campus, course, year), no manual
-- creation/joining. Membership is just "your profile matches."
-- =========================================================

create or replace function public.list_cohort_groups(p_campus_id uuid)
returns table (course text, year text, member_count integer)
language sql
stable
security definer
set search_path = public
as $$
  select p.course, p.year, count(*)::int as member_count
  from public.profiles p
  where p.campus_id = p_campus_id
    and p.status = 'active'
    and p.privacy_level in ('public','campus')
    and coalesce(p.course, '') <> ''
    and coalesce(p.year, '') <> ''
  group by p.course, p.year
  having count(*) >= 2
  order by member_count desc, p.course, p.year;
$$;

grant execute on function public.list_cohort_groups(uuid) to authenticated;

create or replace function public.get_cohort_group_members(
  p_campus_id uuid,
  p_course text,
  p_year text,
  p_limit integer default 30,
  p_cursor timestamptz default null
)
returns table (
  id uuid, name text, course text, department text, year text,
  avatar_url text, skills text[], open_to_projects boolean, created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.name, p.course, p.department, p.year, p.avatar_url, p.skills, p.open_to_projects, p.created_at
  from public.profiles p
  where p.campus_id = p_campus_id
    and p.course = p_course
    and p.year = p_year
    and p.status = 'active'
    and p.privacy_level in ('public','campus')
    and (p_cursor is null or p.created_at < p_cursor)
  order by p.created_at desc
  limit least(coalesce(p_limit, 30), 100);
$$;

grant execute on function public.get_cohort_group_members(uuid, text, text, integer, timestamptz) to authenticated;
