-- =============================================================================
-- ACADEMIC ANNOUNCEMENTS + INTEGRATION (doc §109-112, ROADMAP "academic
-- announcements integration" -- previously flagged there as genuinely not
-- built). User's checklist: department/faculty announcements, exam notices,
-- assignment notices, timetables, academic calendar, deadlines,
-- course-specific notifications, year/department targeting.
--
-- What already existed before this migration (found by reading the code
-- first, not re-built here): public.announcements with a real category enum
-- (incl. Academic/Exam) and target_scope (department/year/course/hostel/
-- club), publish_announcement() fanning out real notifications matching
-- department/year/course -- but publish/admin-only, no student-facing feed,
-- no faculty role, no timetable/calendar/assignment concept anywhere.
--
-- Deliberately reuses the existing free-text department/course/year columns
-- on profiles (this app has no normalized course/department catalog
-- anywhere else either) rather than introducing a new relational catalog --
-- consistent with how announcements' own target_scope already works.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. FACULTY ROLE
-- Additive to the existing role check constraint + admin_set_user_role's
-- allow-list (both must move together or an admin could never set anyone to
-- faculty) + RBAC seed tables (roles/permissions/role_permissions), mirroring
-- 20260814000200_rbac.sql's own pattern exactly.
-- ---------------------------------------------------------------------------

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('student', 'club_admin', 'vendor', 'facilities_staff', 'faculty', 'college_admin', 'super_admin'));

insert into public.roles (key, name, description) values
  ('faculty', 'Faculty', 'Publishes academic announcements, assignments/deadlines and class timetables for their own department/course')
on conflict (key) do nothing;

insert into public.permissions (key, description) values
  ('academics.publish', 'Publish academic announcements, assignment/deadline notices and class timetable entries')
on conflict (key) do nothing;

-- college_admin/super_admin already inherit every permission except
-- users.roles.manage via 0002's wildcard clause -- only faculty needs an
-- explicit grant here.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r, public.permissions p
where r.key = 'faculty' and p.key = 'academics.publish'
on conflict do nothing;

create or replace function public.admin_set_user_role(p_target_user uuid, p_new_role text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_role text;
begin
  if not public.has_permission(auth.uid(), 'users.roles.manage') and not public.current_user_is_admin() then
    raise exception 'Not authorized to change roles';
  end if;

  if p_new_role not in ('student','club_admin','vendor','facilities_staff','faculty','college_admin','super_admin') then
    raise exception 'Invalid role %', p_new_role;
  end if;

  select role into v_old_role from public.profiles where id = p_target_user for update;

  perform set_config('campusos.allow_role_change', 'true', true);
  update public.profiles set role = p_new_role where id = p_target_user;
  perform set_config('campusos.allow_role_change', 'false', true);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_value, new_value, reason)
  values (auth.uid(), 'role.change', 'profile', p_target_user::text,
          jsonb_build_object('role', v_old_role), jsonb_build_object('role', p_new_role), p_reason);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. ANNOUNCEMENTS: 'Assignment' category + faculty can publish (scoped to
-- their own department/year/course only, never 'everyone'/'hostel'/'club',
-- never Emergency -- admin keeps campus-wide reach, faculty doesn't) + a
-- real student-facing "what's relevant to me" read entry point.
-- ---------------------------------------------------------------------------

alter table public.announcements drop constraint if exists announcements_category_check;
alter table public.announcements add constraint announcements_category_check
  check (category in ('Academic','Exam','Assignment','Holiday','Emergency','Campus','Maintenance','Transport','General'));

create or replace function public.publish_announcement(
  p_category text, p_title text, p_body text, p_target_scope text default 'everyone', p_target_value text default null
)
returns public.announcements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_campus uuid;
  v_announcement public.announcements;
  v_recipient record;
  v_is_admin boolean := public.current_user_is_admin();
  v_is_faculty boolean := public.has_permission(v_user, 'academics.publish');
  v_profile public.profiles;
begin
  if p_category = 'Emergency' and not v_is_admin then
    raise exception 'Emergency alerts require college_admin/super_admin (doc §53)';
  end if;

  if not v_is_admin then
    if not v_is_faculty then
      raise exception 'Not authorized to publish announcements';
    end if;
    -- Faculty: Academic/Exam/Assignment only, always targeted (never a
    -- campus-wide blast), and only to their own department/year/course --
    -- never someone else's, even by guessing a target_value.
    if p_category not in ('Academic', 'Exam', 'Assignment') then
      raise exception 'Faculty can only publish Academic, Exam or Assignment announcements';
    end if;
    if p_target_scope not in ('department', 'year', 'course') then
      raise exception 'Faculty announcements must target a department, year or course';
    end if;
    select * into v_profile from public.profiles where id = v_user;
    if p_target_scope = 'department' and (p_target_value is null or p_target_value <> v_profile.department) then
      raise exception 'You can only target your own department';
    end if;
    if p_target_scope = 'year' and (p_target_value is null or p_target_value <> v_profile.year) then
      raise exception 'You can only target your own year';
    end if;
    if p_target_scope = 'course' and (p_target_value is null or p_target_value <> v_profile.course) then
      raise exception 'You can only target your own course';
    end if;
  end if;

  select campus_id into v_campus from public.profiles where id = v_user;

  insert into public.announcements (campus_id, author_id, category, title, body, target_scope, target_value, published_at)
  values (v_campus, v_user, p_category, p_title, p_body, p_target_scope, p_target_value, now())
  returning * into v_announcement;

  for v_recipient in
    select p.id from public.profiles p
    where p.campus_id = v_campus
      and (p_target_scope = 'everyone'
        or (p_target_scope = 'department' and p.department = p_target_value)
        or (p_target_scope = 'year' and p.year = p_target_value)
        or (p_target_scope = 'course' and p.course = p_target_value))
  loop
    perform public.create_notification(
      v_recipient.id, p_title, p_body,
      case when p_category = 'Emergency' then 'emergency' else 'official' end,
      'announcement', v_announcement.id::text
    );
  end loop;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value)
  values (v_user, 'announcement.publish', 'announcement', v_announcement.id::text,
          jsonb_build_object('category', p_category, 'title', p_title));

  return v_announcement;
end;
$$;

-- Real student-facing read entry point: "what's relevant to me", not "every
-- published announcement on campus regardless of who it's for" (the base
-- announcements_read RLS policy is intentionally left as-is -- it's already
-- relied on by the admin CMS/global search and only ever widens access, so
-- narrowing it here would be a separate, riskier change). Mirrors the exact
-- same scope-matching rule publish_announcement()'s own notification fan-out
-- above already uses, so "you got notified" and "it shows in your feed"
-- never disagree.
create or replace function public.get_relevant_announcements(p_limit integer default 50, p_category text default null)
returns setof public.announcements
language sql
stable
security definer
set search_path = public
as $$
  select a.*
  from public.announcements a
  join public.profiles p on p.id = auth.uid()
  where a.published_at is not null
    and a.campus_id = p.campus_id
    and (p_category is null or a.category = p_category)
    and (
      a.target_scope = 'everyone'
      or (a.target_scope = 'department' and a.target_value = p.department)
      or (a.target_scope = 'year' and a.target_value = p.year)
      or (a.target_scope = 'course' and a.target_value = p.course)
    )
  order by a.published_at desc
  limit p_limit;
$$;

grant execute on function public.get_relevant_announcements(integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. ASSIGNMENT / DEADLINE NOTICES
-- New, not a repurposed table -- real RLS does the relevance filtering
-- directly (no read RPC needed), same "plain RLS-scoped select" pattern
-- reminders (20260816000100) already uses. Writes only via
-- create_academic_deadline() so the same faculty self-scoping rule from
-- publish_announcement() above applies here too.
-- ---------------------------------------------------------------------------

create table if not exists public.academic_deadlines (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid references public.campuses(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  category text not null default 'assignment' check (category in ('assignment', 'exam', 'deadline', 'other')),
  title text not null check (length(btrim(title)) > 0 and length(title) <= 200),
  description text,
  target_scope text not null default 'everyone' check (target_scope in ('everyone', 'department', 'year', 'course')),
  target_value text,
  due_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists academic_deadlines_campus_idx on public.academic_deadlines(campus_id, due_at);

alter table public.academic_deadlines enable row level security;

drop policy if exists "academic_deadlines_read" on public.academic_deadlines;
create policy "academic_deadlines_read" on public.academic_deadlines for select to authenticated
  using (
    author_id = auth.uid()
    or public.current_user_is_admin()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.campus_id = academic_deadlines.campus_id
        and (
          academic_deadlines.target_scope = 'everyone'
          or (academic_deadlines.target_scope = 'department' and academic_deadlines.target_value = p.department)
          or (academic_deadlines.target_scope = 'year' and academic_deadlines.target_value = p.year)
          or (academic_deadlines.target_scope = 'course' and academic_deadlines.target_value = p.course)
        )
    )
  );

drop policy if exists "academic_deadlines_delete_own" on public.academic_deadlines;
create policy "academic_deadlines_delete_own" on public.academic_deadlines for delete to authenticated
  using (author_id = auth.uid() or public.current_user_is_admin());
-- No insert policy -- creation always goes through create_academic_deadline().

create or replace function public.create_academic_deadline(
  p_category text, p_title text, p_due_at timestamptz, p_description text default null,
  p_target_scope text default 'everyone', p_target_value text default null
)
returns public.academic_deadlines
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_campus uuid;
  v_is_admin boolean := public.current_user_is_admin();
  v_profile public.profiles;
  v_row public.academic_deadlines;
  v_title text := btrim(coalesce(p_title, ''));
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if not v_is_admin and not public.has_permission(v_user, 'academics.publish') then
    raise exception 'Not authorized to publish assignment/deadline notices';
  end if;
  if p_category not in ('assignment', 'exam', 'deadline', 'other') then
    raise exception 'Invalid category %', p_category;
  end if;
  if v_title = '' then raise exception 'Give the notice a title'; end if;
  if p_due_at is null then raise exception 'Pick a due date/time'; end if;

  select * into v_profile from public.profiles where id = v_user;
  v_campus := v_profile.campus_id;

  if not v_is_admin then
    if p_target_scope not in ('department', 'year', 'course') then
      raise exception 'Assignment/deadline notices must target a department, year or course';
    end if;
    if p_target_scope = 'department' and (p_target_value is null or p_target_value <> v_profile.department) then
      raise exception 'You can only target your own department';
    end if;
    if p_target_scope = 'year' and (p_target_value is null or p_target_value <> v_profile.year) then
      raise exception 'You can only target your own year';
    end if;
    if p_target_scope = 'course' and (p_target_value is null or p_target_value <> v_profile.course) then
      raise exception 'You can only target your own course';
    end if;
  end if;

  insert into public.academic_deadlines (campus_id, author_id, category, title, description, target_scope, target_value, due_at)
  values (v_campus, v_user, p_category, v_title, nullif(btrim(coalesce(p_description, '')), ''), p_target_scope, p_target_value, p_due_at)
  returning * into v_row;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value)
  values (v_user, 'academic_deadline.create', 'academic_deadline', v_row.id::text,
          jsonb_build_object('category', p_category, 'title', v_title, 'due_at', p_due_at));

  return v_row;
end;
$$;

grant execute on function public.create_academic_deadline(text, text, timestamptz, text, text, text) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'academic_deadlines'
  ) then
    execute 'alter publication supabase_realtime add table public.academic_deadlines';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. CLASS TIMETABLE
-- Campus-wide read (a timetable isn't sensitive information, and browsing
-- another course's schedule is normal, e.g. for room/shared-space awareness)
-- -- write is RPC-gated the same way as announcements/deadlines.
-- ---------------------------------------------------------------------------

create table if not exists public.class_timetable (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid references public.campuses(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  course text not null,
  year text,
  section text,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  subject text not null check (length(btrim(subject)) > 0),
  faculty_name text,
  room text,
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);

create index if not exists class_timetable_lookup_idx on public.class_timetable(campus_id, course, day_of_week);

alter table public.class_timetable enable row level security;

drop policy if exists "class_timetable_read" on public.class_timetable;
create policy "class_timetable_read" on public.class_timetable for select to authenticated
  using (campus_id in (select campus_id from public.profiles where id = auth.uid()));

drop policy if exists "class_timetable_delete_own" on public.class_timetable;
create policy "class_timetable_delete_own" on public.class_timetable for delete to authenticated
  using (author_id = auth.uid() or public.current_user_is_admin());
-- No insert/update policy -- always through upsert_timetable_entry().

create or replace function public.upsert_timetable_entry(
  p_id uuid, p_course text, p_day_of_week integer, p_start_time time, p_end_time time, p_subject text,
  p_year text default null, p_section text default null, p_faculty_name text default null, p_room text default null
)
returns public.class_timetable
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_campus uuid;
  v_is_admin boolean := public.current_user_is_admin();
  v_profile public.profiles;
  v_row public.class_timetable;
  v_subject text := btrim(coalesce(p_subject, ''));
  v_course text := btrim(coalesce(p_course, ''));
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if not v_is_admin and not public.has_permission(v_user, 'academics.publish') then
    raise exception 'Not authorized to edit the timetable';
  end if;
  if v_course = '' then raise exception 'Give the entry a course'; end if;
  if v_subject = '' then raise exception 'Give the entry a subject'; end if;
  if p_day_of_week not between 0 and 6 then raise exception 'day_of_week must be 0-6'; end if;
  if p_end_time <= p_start_time then raise exception 'End time must be after start time'; end if;

  select * into v_profile from public.profiles where id = v_user;
  v_campus := v_profile.campus_id;

  if not v_is_admin and v_course <> coalesce(v_profile.course, '') then
    raise exception 'You can only edit the timetable for your own course';
  end if;

  if p_id is not null then
    update public.class_timetable set
      course = v_course, year = p_year, section = p_section, day_of_week = p_day_of_week,
      start_time = p_start_time, end_time = p_end_time, subject = v_subject,
      faculty_name = p_faculty_name, room = p_room
    where id = p_id and (author_id = v_user or v_is_admin)
    returning * into v_row;
    if v_row.id is null then raise exception 'Entry not found or not editable by you'; end if;
  else
    insert into public.class_timetable (campus_id, author_id, course, year, section, day_of_week, start_time, end_time, subject, faculty_name, room)
    values (v_campus, v_user, v_course, p_year, p_section, p_day_of_week, p_start_time, p_end_time, v_subject, p_faculty_name, p_room)
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

grant execute on function public.upsert_timetable_entry(uuid, text, integer, time, time, text, text, text, text, text) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'class_timetable'
  ) then
    execute 'alter publication supabase_realtime add table public.class_timetable';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. ACADEMIC CALENDAR
-- Campus-wide (exam windows/holidays/semester dates aren't per-department),
-- admin-only write -- registrar-level authority, same admin-gated/audited
-- pattern as Emergency announcements (doc §52-53), deliberately NOT opened
-- to faculty to avoid conflicting/duplicate campus-wide calendar entries.
-- ---------------------------------------------------------------------------

create table if not exists public.academic_calendar_events (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid references public.campuses(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  title text not null check (length(btrim(title)) > 0),
  description text,
  event_type text not null default 'other'
    check (event_type in ('exam_window', 'holiday', 'deadline', 'semester_start', 'semester_end', 'other')),
  start_date date not null,
  end_date date,
  created_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);

create index if not exists academic_calendar_events_campus_idx on public.academic_calendar_events(campus_id, start_date);

alter table public.academic_calendar_events enable row level security;

drop policy if exists "academic_calendar_events_read" on public.academic_calendar_events;
create policy "academic_calendar_events_read" on public.academic_calendar_events for select to authenticated
  using (campus_id in (select campus_id from public.profiles where id = auth.uid()));

drop policy if exists "academic_calendar_events_delete_admin" on public.academic_calendar_events;
create policy "academic_calendar_events_delete_admin" on public.academic_calendar_events for delete to authenticated
  using (public.current_user_is_admin());
-- No insert/update policy -- always through publish_calendar_event().

create or replace function public.publish_calendar_event(
  p_title text, p_event_type text, p_start_date date, p_end_date date default null, p_description text default null
)
returns public.academic_calendar_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_campus uuid;
  v_row public.academic_calendar_events;
  v_title text := btrim(coalesce(p_title, ''));
begin
  if not public.current_user_is_admin() then
    raise exception 'Academic calendar entries require college_admin/super_admin';
  end if;
  if v_title = '' then raise exception 'Give the entry a title'; end if;
  if p_event_type not in ('exam_window', 'holiday', 'deadline', 'semester_start', 'semester_end', 'other') then
    raise exception 'Invalid event_type %', p_event_type;
  end if;
  if p_start_date is null then raise exception 'Pick a start date'; end if;

  select campus_id into v_campus from public.profiles where id = v_user;

  insert into public.academic_calendar_events (campus_id, author_id, title, description, event_type, start_date, end_date)
  values (v_campus, v_user, v_title, nullif(btrim(coalesce(p_description, '')), ''), p_event_type, p_start_date, p_end_date)
  returning * into v_row;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value)
  values (v_user, 'academic_calendar.publish', 'academic_calendar_event', v_row.id::text,
          jsonb_build_object('title', v_title, 'event_type', p_event_type));

  return v_row;
end;
$$;

grant execute on function public.publish_calendar_event(text, text, date, date, text) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'academic_calendar_events'
  ) then
    execute 'alter publication supabase_realtime add table public.academic_calendar_events';
  end if;
end $$;
