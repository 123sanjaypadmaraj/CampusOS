-- =============================================================================
-- PROFILE PERSONALIZATION / RECOMMENDATION ENGINE (doc §107-108)
--
-- §107 (production profile fields) was already done in prior passes --
-- name/photo/USN/course/department/year/skills/bio/clubs/projects/
-- achievements/privacy/notifications/security all exist on `profiles`.
-- This migration is §108: "Student dashboard personalization" --
-- Recommended food / events / clubs / people / opportunities, based on
-- usage, preferences, clubs, skills, year, department.
--
-- "Recommended people" already exists (get_people_you_may_know(), 0024) --
-- reused as-is here, not rebuilt.
--
-- Doc explicitly says: "Avoid creepy behavior and provide controls." Two
-- controls, deliberately simple:
--   1. profiles.personalization_enabled (default true, plain self-editable
--      column -- profiles_update_self (0011) already grants this, no new
--      RPC/trigger needed since it grants no privilege, unlike e.g.
--      linkedin_verified_at). When off, every recommend_*() function below
--      falls back to campus-wide popular/recent ordering with a generic
--      reason string instead of using any personal signal.
--   2. recommendation_dismissals -- "not interested" hides that exact item
--      from that category going forward, self-service, no admin involved.
--
-- Signals used are all things the student already told the app (skills,
-- course/department/year, club memberships) or did on the app themselves
-- (past orders, event registrations, opportunity applications) -- no
-- browsing/dwell-time tracking, nothing inferred off-platform.
-- =============================================================================

alter table public.profiles add column if not exists personalization_enabled boolean not null default true;

create table if not exists public.recommendation_dismissals (
  user_id uuid not null references public.profiles(id) on delete cascade,
  entity_type text not null check (entity_type in ('food_item','event','club','opportunity','person')),
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, entity_type, entity_id)
);

alter table public.recommendation_dismissals enable row level security;

drop policy if exists "recommendation_dismissals_own" on public.recommendation_dismissals;
create policy "recommendation_dismissals_own" on public.recommendation_dismissals for select to authenticated
  using (auth.uid() = user_id);
-- No direct insert/update/delete policy -- writes go through
-- dismiss_recommendation() below so entity_type stays constrained to what
-- the frontend actually recommends and the row is always self-attributed.

create or replace function public.dismiss_recommendation(p_entity_type text, p_entity_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;
  if p_entity_type not in ('food_item','event','club','opportunity','person') then
    raise exception 'Unknown recommendation type: %', p_entity_type;
  end if;

  insert into public.recommendation_dismissals (user_id, entity_type, entity_id)
  values (v_user, p_entity_type, p_entity_id)
  on conflict (user_id, entity_type, entity_id) do nothing;
end;
$$;

grant execute on function public.dismiss_recommendation(text, uuid) to authenticated;

-- =========================================================
-- RECOMMENDED FOOD
-- Signal: categories/canteens you've actually ordered from before,
-- weighted by how often. Falls back to featured items campus-wide for a
-- new student with no order history, or with personalization off.
-- =========================================================

create or replace function public.recommend_food(p_limit integer default 6)
returns table (
  id uuid, name text, description text, price numeric, image_url text,
  canteen_id uuid, canteen_name text, category_name text,
  is_vegetarian boolean, reason text, score integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_campus uuid;
  v_personalize boolean;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;

  select p.campus_id, p.personalization_enabled into v_campus, v_personalize
  from public.profiles p where p.id = v_user;

  return query
  with my_categories as (
    select fi.category_id, count(*)::int as freq
    from public.orders o
    join public.order_items oi on oi.order_id = o.id
    join public.food_items fi on fi.id = oi.food_item_id
    where o.user_id = v_user and o.status not in ('CREATED','CANCELLED')
    group by fi.category_id
  ),
  my_canteens as (
    select o.canteen_id, count(*)::int as freq
    from public.orders o
    where o.user_id = v_user and o.status not in ('CREATED','CANCELLED')
    group by o.canteen_id
  ),
  candidates as (
    select
      fi.id, fi.name, fi.description, fi.price, fi.image_url, fi.featured, fi.is_vegetarian,
      c.id as canteen_id, c.name as canteen_name,
      fc.name as category_name,
      mc.freq as category_freq, mt.freq as canteen_freq
    from public.food_items fi
    join public.canteens c on c.id = fi.canteen_id
    left join public.food_categories fc on fc.id = fi.category_id
    left join my_categories mc on mc.category_id = fi.category_id
    left join my_canteens mt on mt.canteen_id = c.id
    where c.campus_id = v_campus and c.active and fi.active and fi.available
      and not exists (
        select 1 from public.recommendation_dismissals d
        where d.user_id = v_user and d.entity_type = 'food_item' and d.entity_id = fi.id
      )
  )
  select
    cd.id, cd.name, cd.description, cd.price, cd.image_url,
    cd.canteen_id, cd.canteen_name, cd.category_name, cd.is_vegetarian,
    case
      when not v_personalize then 'Popular pick'
      when coalesce(cd.category_freq, 0) > 0 then 'Because you often order ' || coalesce(cd.category_name, 'this') || ' at ' || cd.canteen_name
      when coalesce(cd.canteen_freq, 0) > 0 then 'From ' || cd.canteen_name || ', a canteen you order from'
      when cd.featured then 'Featured on campus'
      else 'Try something new'
    end as reason,
    (case when v_personalize then
      coalesce(cd.category_freq, 0) * 20 + coalesce(cd.canteen_freq, 0) * 10 + (case when cd.featured then 5 else 0 end)
    else
      (case when cd.featured then 50 else 0 end)
    end)::int as score
  from candidates cd
  order by score desc, cd.featured desc, cd.name
  limit least(coalesce(p_limit, 6), 25);
end;
$$;

grant execute on function public.recommend_food(integer) to authenticated;

-- =========================================================
-- RECOMMENDED EVENTS
-- Signal: clubs you're a member of, categories of events you've actually
-- registered for before. Falls back to soonest upcoming events.
-- =========================================================

create or replace function public.recommend_events(p_limit integer default 6)
returns table (
  id uuid, title text, category text, description text, event_date timestamptz,
  place text, cover_image_url text, club_id uuid, club_name text,
  reason text, score integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_campus uuid;
  v_personalize boolean;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;

  select p.campus_id, p.personalization_enabled into v_campus, v_personalize
  from public.profiles p where p.id = v_user;

  -- Note: RETURNS TABLE(...) above implicitly declares club_id/category as
  -- OUT-parameter variables, so any *unqualified* reference to those names
  -- inside this function body is ambiguous against them (same pitfall
  -- already documented in get_people_you_may_know(), 0024) -- CTE columns
  -- below are deliberately named my_club_id / evt_category to avoid it.
  return query
  with my_clubs as (
    select cm.club_id as my_club_id from public.club_members cm where cm.user_id = v_user
  ),
  my_categories as (
    select e.category as evt_category, count(*)::int as freq
    from public.event_registrations r
    join public.events e on e.id = r.event_id
    where r.user_id = v_user and r.status = 'confirmed' and e.category is not null
    group by e.category
  ),
  candidates as (
    select
      -- events.event_date is timestamptz in production but `date` on staging
      -- (documented pre-existing drift, see docs/ENVIRONMENTS.md -- not
      -- something this migration should "fix" by altering an existing
      -- column). Cast explicitly so this function's return type is stable
      -- across both.
      e.id, e.title, e.category, e.description, e.event_date::timestamptz as event_date, e.place, e.cover_image_url,
      e.club_id, cl.name as club_name,
      (e.club_id in (select my_club_id from my_clubs)) as club_match,
      coalesce(mc.freq, 0) as category_freq
    from public.events e
    left join public.clubs cl on cl.id = e.club_id
    left join my_categories mc on mc.evt_category = e.category
    where e.campus_id = v_campus and e.published
      and e.registration_status in ('OPEN','WAITLIST')
      and e.event_date >= now()
      and not exists (
        select 1 from public.event_registrations r
        where r.event_id = e.id and r.user_id = v_user and r.status = 'confirmed'
      )
      and not exists (
        select 1 from public.recommendation_dismissals d
        where d.user_id = v_user and d.entity_type = 'event' and d.entity_id = e.id
      )
  )
  select
    cd.id, cd.title, cd.category, cd.description, cd.event_date, cd.place, cd.cover_image_url,
    cd.club_id, cd.club_name,
    case
      when not v_personalize then 'Happening soon'
      when cd.club_match then 'Because you''re in ' || cd.club_name
      when cd.category_freq > 0 then 'You often go to ' || coalesce(cd.category, 'these') || ' events'
      else 'Happening soon'
    end as reason,
    (case when v_personalize then
      (case when cd.club_match then 40 else 0 end) + least(cd.category_freq * 10, 20)
    else 0 end)::int as score
  from candidates cd
  order by score desc, cd.event_date asc
  limit least(coalesce(p_limit, 6), 25);
end;
$$;

grant execute on function public.recommend_events(integer) to authenticated;

-- =========================================================
-- RECOMMENDED CLUBS
-- Signal: category overlap with clubs you're already in, plus how many
-- classmates in your own course+year batch are already members (a "people
-- like you joined this" collaborative signal, not individually identifying
-- -- only a count is exposed). Falls back to campus-wide member count.
-- =========================================================

create or replace function public.recommend_clubs(p_limit integer default 6)
returns table (
  id uuid, name text, category text, description text, logo_url text,
  member_count integer, batchmate_count integer, reason text, score integer
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
  v_personalize boolean;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;

  select p.campus_id, p.course, p.year, p.personalization_enabled
    into v_campus, v_course, v_year, v_personalize
  from public.profiles p where p.id = v_user;

  -- Note: RETURNS TABLE(...) above implicitly declares "category" as an
  -- OUT-parameter variable, so an unqualified reference to it inside this
  -- function body is ambiguous (same pitfall as recommend_events() above) --
  -- the CTE column is deliberately named my_category to avoid it.
  return query
  with my_club_categories as (
    select distinct c.category as my_category
    from public.club_members m
    join public.clubs c on c.id = m.club_id
    where m.user_id = v_user and c.category is not null
  ),
  candidates as (
    select
      c.id, c.name, c.category, c.description, c.logo_url,
      (select count(*)::int from public.club_members m2 where m2.club_id = c.id) as member_count,
      (select count(*)::int from public.club_members m3
        join public.profiles p3 on p3.id = m3.user_id
        where m3.club_id = c.id
          and p3.course is not distinct from v_course and v_course is not null
          and p3.year is not distinct from v_year and v_year is not null
      ) as batchmate_count,
      (c.category in (select my_category from my_club_categories)) as category_match
    from public.clubs c
    where c.campus_id = v_campus and c.active
      and not exists (select 1 from public.club_members m4 where m4.club_id = c.id and m4.user_id = v_user)
      and not exists (
        select 1 from public.recommendation_dismissals d
        where d.user_id = v_user and d.entity_type = 'club' and d.entity_id = c.id
      )
  )
  select
    cd.id, cd.name, cd.category, cd.description, cd.logo_url,
    cd.member_count, cd.batchmate_count,
    case
      when not v_personalize then 'Popular on campus'
      when cd.category_match then 'Matches clubs you''re already in'
      when cd.batchmate_count > 0 then cd.batchmate_count || ' students in your batch are members'
      else 'Popular on campus'
    end as reason,
    (case when v_personalize then
      (case when cd.category_match then 25 else 0 end) + least(cd.batchmate_count * 8, 24)
    else 0 end)::int as score
  from candidates cd
  order by score desc, cd.member_count desc, cd.name
  limit least(coalesce(p_limit, 6), 25);
end;
$$;

grant execute on function public.recommend_clubs(integer) to authenticated;

-- =========================================================
-- RECOMMENDED OPPORTUNITIES
-- Signal: tag overlap with your profile skills, plus the type
-- (Internship/Research/Job/Volunteer/Competition) you've applied to
-- before. Falls back to soonest-deadline / newest.
-- =========================================================

create or replace function public.recommend_opportunities(p_limit integer default 6)
returns table (
  id uuid, company text, role text, type text, description text, tags text[],
  deadline date, apply_url text, reason text, score integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_campus uuid;
  v_skills text[];
  v_personalize boolean;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;

  select p.campus_id, p.skills, p.personalization_enabled into v_campus, v_skills, v_personalize
  from public.profiles p where p.id = v_user;

  return query
  with my_types as (
    select o.type, count(*)::int as freq
    from public.opportunity_applications a
    join public.opportunities o on o.id = a.opportunity_id
    where a.user_id = v_user
    group by o.type
  ),
  candidates as (
    select
      o.id, o.company, o.role, o.type, o.description, o.tags, o.deadline, o.apply_url,
      (
        select count(*)::int from unnest(o.tags) t
        where lower(t) in (select lower(s) from unnest(coalesce(v_skills, '{}')) s)
      ) as skill_matches,
      coalesce(mt.freq, 0) as type_freq
    from public.opportunities o
    left join my_types mt on mt.type = o.type
    where o.active
      and (o.campus_id is null or o.campus_id = v_campus)
      and (o.deadline is null or o.deadline >= current_date)
      and not exists (
        select 1 from public.opportunity_applications a2
        where a2.opportunity_id = o.id and a2.user_id = v_user
      )
      and not exists (
        select 1 from public.recommendation_dismissals d
        where d.user_id = v_user and d.entity_type = 'opportunity' and d.entity_id = o.id
      )
  )
  select
    cd.id, cd.company, cd.role, cd.type, cd.description, cd.tags, cd.deadline, cd.apply_url,
    case
      when not v_personalize then coalesce('Closes ' || to_char(cd.deadline, 'Mon DD'), 'New')
      when cd.skill_matches > 0 then 'Matches your skills'
      when cd.type_freq > 0 then 'You often apply to ' || lower(cd.type) || ' roles'
      else coalesce('Closes ' || to_char(cd.deadline, 'Mon DD'), 'New')
    end as reason,
    (case when v_personalize then
      least(cd.skill_matches * 25, 50) + least(cd.type_freq * 10, 20)
    else 0 end)::int as score
  from candidates cd
  order by score desc, cd.deadline asc nulls last, cd.company
  limit least(coalesce(p_limit, 6), 25);
end;
$$;

grant execute on function public.recommend_opportunities(integer) to authenticated;
