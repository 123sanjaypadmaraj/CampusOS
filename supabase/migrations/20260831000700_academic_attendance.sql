-- =============================================================================
-- ATTENDANCE TRACKING (academic module depth -- doc §109-112's academic
-- module shipped announcements/deadlines/timetable/calendar but never
-- attendance, the single most-used daily faculty workflow at a real college
-- and a direct prerequisite for exam eligibility in most Indian institutions.
-- Flagged as "faculty workflow depth" in the readiness audit's high-priority
-- list; picked up now as the next concrete engineering-doable item.
--
-- Follows the exact conventions 20260817000300_academic_module.sql set: a
-- security-definer RPC per write path re-validating the same
-- faculty-can-only-touch-their-own-course rule upsert_timetable_entry()
-- already enforces, RLS doing relevance filtering on reads where the data
-- isn't sensitive, and a dedicated read RPC where a table-level policy would
-- either leak too much (every student's attendance to every other student)
-- or need one anyway (a student's own summary, computed server-side).
--
-- Roster note: profiles has no `section` column (only class_timetable does
-- -- section is a scheduling subdivision, never enrolled-on-the-profile), so
-- get_class_roster() below can only filter by course/year, not section. A
-- session still *records* a section label for the faculty's own bookkeeping;
-- it just can't be used to auto-filter who's in it.
-- =============================================================================

create table if not exists public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid references public.campuses(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  timetable_entry_id uuid references public.class_timetable(id) on delete set null,
  course text not null,
  year text not null default '',
  section text not null default '',
  subject text not null check (length(btrim(subject)) > 0),
  class_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campus_id, course, year, section, subject, class_date)
);

create index if not exists attendance_sessions_lookup_idx on public.attendance_sessions(campus_id, course, class_date);
create index if not exists attendance_sessions_author_idx on public.attendance_sessions(author_id);

alter table public.attendance_sessions enable row level security;

drop policy if exists "attendance_sessions_read" on public.attendance_sessions;
create policy "attendance_sessions_read" on public.attendance_sessions for select to authenticated
  using (author_id = auth.uid() or public.current_user_is_admin());

drop policy if exists "attendance_sessions_delete_own" on public.attendance_sessions;
create policy "attendance_sessions_delete_own" on public.attendance_sessions for delete to authenticated
  using (author_id = auth.uid() or public.current_user_is_admin());
-- No insert/update policy -- always through mark_attendance().

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'present' check (status in ('present', 'absent', 'late', 'excused')),
  marked_at timestamptz not null default now(),
  unique (session_id, student_id)
);

create index if not exists attendance_records_session_idx on public.attendance_records(session_id);
create index if not exists attendance_records_student_idx on public.attendance_records(student_id);

alter table public.attendance_records enable row level security;

drop policy if exists "attendance_records_read" on public.attendance_records;
create policy "attendance_records_read" on public.attendance_records for select to authenticated
  using (
    student_id = auth.uid()
    or public.current_user_is_admin()
    or exists (
      select 1 from public.attendance_sessions s
      where s.id = attendance_records.session_id and s.author_id = auth.uid()
    )
  );
-- No insert/update/delete policy -- always through mark_attendance(); rows
-- cascade-delete with their session.

-- ---------------------------------------------------------------------------
-- get_class_roster: who a faculty member can take attendance for. Same
-- own-course-only rule as every other write RPC in this module, applied here
-- on read too since it's the input to mark_attendance() below -- no point
-- letting a faculty account browse another course's student list even
-- read-only.
-- ---------------------------------------------------------------------------

create or replace function public.get_class_roster(p_course text, p_year text default null)
returns table(student_id uuid, name text, usn text, year text, department text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_is_admin boolean := public.current_user_is_admin();
  v_profile public.profiles;
  v_course text := btrim(coalesce(p_course, ''));
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if not v_is_admin and not public.has_permission(v_user, 'academics.publish') then
    raise exception 'Not authorized to view class rosters';
  end if;
  if v_course = '' then raise exception 'Course is required'; end if;

  select * into v_profile from public.profiles where id = v_user;

  if not v_is_admin and v_course <> coalesce(v_profile.course, '') then
    raise exception 'You can only view the roster for your own course';
  end if;

  return query
    select p.id, p.name, p.usn, p.year, p.department
    from public.profiles p
    where p.campus_id = v_profile.campus_id
      and p.role = 'student'
      and p.status = 'active'
      and p.course = v_course
      and (p_year is null or p.year = p_year)
    order by p.name;
end;
$$;

grant execute on function public.get_class_roster(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- mark_attendance: find-or-create today's (or any past) session for a
-- course/year/section/subject/date, then upsert every student's status in
-- one call so the frontend can submit a whole class roster at once instead
-- of one RPC round-trip per student. p_records is a jsonb array of
-- {"student_id": "...", "status": "present"} objects; every student_id is
-- re-validated server-side against the same course/campus roster
-- get_class_roster() above returns -- a faculty account can't be handed an
-- arbitrary student id from the client and mark attendance for someone
-- outside their own course.
-- ---------------------------------------------------------------------------

create or replace function public.mark_attendance(
  p_course text, p_subject text, p_class_date date, p_records jsonb,
  p_year text default null, p_section text default null, p_timetable_entry_id uuid default null
)
returns public.attendance_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_is_admin boolean := public.current_user_is_admin();
  v_profile public.profiles;
  v_course text := btrim(coalesce(p_course, ''));
  v_subject text := btrim(coalesce(p_subject, ''));
  v_year text := coalesce(p_year, '');
  v_section text := coalesce(p_section, '');
  v_session public.attendance_sessions;
  v_rec jsonb;
  v_student_id uuid;
  v_status text;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if not v_is_admin and not public.has_permission(v_user, 'academics.publish') then
    raise exception 'Not authorized to mark attendance';
  end if;
  if v_course = '' then raise exception 'Course is required'; end if;
  if v_subject = '' then raise exception 'Subject is required'; end if;
  if p_class_date is null then raise exception 'Class date is required'; end if;
  if p_class_date > current_date then raise exception 'Cannot mark attendance for a future date'; end if;
  if jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records) = 0 then
    raise exception 'At least one student record is required';
  end if;

  select * into v_profile from public.profiles where id = v_user;

  if not v_is_admin and v_course <> coalesce(v_profile.course, '') then
    raise exception 'You can only mark attendance for your own course';
  end if;

  insert into public.attendance_sessions (campus_id, author_id, timetable_entry_id, course, year, section, subject, class_date)
  values (v_profile.campus_id, v_user, p_timetable_entry_id, v_course, v_year, v_section, v_subject, p_class_date)
  on conflict (campus_id, course, year, section, subject, class_date)
  do update set updated_at = now()
  returning * into v_session;

  for v_rec in select * from jsonb_array_elements(p_records)
  loop
    v_student_id := nullif(v_rec->>'student_id', '')::uuid;
    v_status := v_rec->>'status';
    if v_student_id is null then
      raise exception 'Every record needs a student_id';
    end if;
    if v_status not in ('present', 'absent', 'late', 'excused') then
      raise exception 'Invalid status % for student %', v_status, v_student_id;
    end if;
    -- Re-validate every student against the roster this session's own
    -- course/campus resolves to, rather than trusting the client's list --
    -- mirrors get_class_roster()'s own filter exactly.
    if not exists (
      select 1 from public.profiles p
      where p.id = v_student_id
        and p.campus_id = v_profile.campus_id
        and p.role = 'student'
        and p.course = v_course
    ) then
      raise exception 'Student % is not on this course''s roster', v_student_id;
    end if;

    insert into public.attendance_records (session_id, student_id, status, marked_at)
    values (v_session.id, v_student_id, v_status, now())
    on conflict (session_id, student_id) do update set status = excluded.status, marked_at = now();
  end loop;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value)
  values (v_user, 'attendance.mark', 'attendance_session', v_session.id::text,
          jsonb_build_object('course', v_course, 'subject', v_subject, 'class_date', p_class_date, 'record_count', jsonb_array_length(p_records)));

  return v_session;
end;
$$;

grant execute on function public.mark_attendance(text, text, date, jsonb, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- list_attendance_sessions / get_attendance_session: faculty/admin-facing
-- history + a single session's per-student detail (for re-opening and
-- correcting a prior day's marks).
-- ---------------------------------------------------------------------------

create or replace function public.list_attendance_sessions(p_course text default null, p_limit integer default 50)
returns table(
  id uuid, course text, year text, section text, subject text, class_date date,
  present_count bigint, absent_count bigint, late_count bigint, excused_count bigint, total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id, s.course, s.year, s.section, s.subject, s.class_date,
    count(*) filter (where r.status = 'present') as present_count,
    count(*) filter (where r.status = 'absent') as absent_count,
    count(*) filter (where r.status = 'late') as late_count,
    count(*) filter (where r.status = 'excused') as excused_count,
    count(r.id) as total_count
  from public.attendance_sessions s
  left join public.attendance_records r on r.session_id = s.id
  where (s.author_id = auth.uid() or public.current_user_is_admin())
    and (p_course is null or s.course = p_course)
  group by s.id
  order by s.class_date desc, s.created_at desc
  limit p_limit;
$$;

grant execute on function public.list_attendance_sessions(text, integer) to authenticated;

create or replace function public.get_attendance_session(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_session public.attendance_sessions;
  v_result jsonb;
begin
  select * into v_session from public.attendance_sessions
  where id = p_session_id and (author_id = auth.uid() or public.current_user_is_admin());
  if v_session.id is null then raise exception 'Session not found'; end if;

  select jsonb_build_object(
    'id', v_session.id, 'course', v_session.course, 'year', v_session.year,
    'section', v_session.section, 'subject', v_session.subject, 'class_date', v_session.class_date,
    'records', coalesce(jsonb_agg(jsonb_build_object(
      'student_id', p.id, 'name', p.name, 'usn', p.usn, 'status', r.status
    ) order by p.name) filter (where p.id is not null), '[]'::jsonb)
  )
  into v_result
  from public.attendance_records r
  join public.profiles p on p.id = r.student_id
  where r.session_id = v_session.id;

  return v_result;
end;
$$;

grant execute on function public.get_attendance_session(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Student-facing reads: a per-subject summary (the number every student
-- actually wants -- "am I above the eligibility cutoff") plus the full
-- record list behind it. Security-definer + an explicit student_id = auth.uid()
-- filter, same shape as get_relevant_announcements() -- lets the query join
-- across sessions/records without needing a broader, leakier RLS policy.
-- ---------------------------------------------------------------------------

create or replace function public.get_my_attendance_summary()
returns table(course text, subject text, total_sessions bigint, present_count bigint, percentage numeric)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.course, s.subject,
    count(*) as total_sessions,
    count(*) filter (where r.status in ('present', 'late')) as present_count,
    round(100.0 * count(*) filter (where r.status in ('present', 'late')) / count(*), 1) as percentage
  from public.attendance_records r
  join public.attendance_sessions s on s.id = r.session_id
  where r.student_id = auth.uid()
  group by s.course, s.subject
  order by s.subject;
$$;

grant execute on function public.get_my_attendance_summary() to authenticated;

create or replace function public.get_my_attendance_records(p_subject text default null)
returns table(class_date date, course text, subject text, section text, status text)
language sql
stable
security definer
set search_path = public
as $$
  select s.class_date, s.course, s.subject, s.section, r.status
  from public.attendance_records r
  join public.attendance_sessions s on s.id = r.session_id
  where r.student_id = auth.uid()
    and (p_subject is null or s.subject = p_subject)
  order by s.class_date desc;
$$;

grant execute on function public.get_my_attendance_records(text) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'attendance_sessions'
  ) then
    execute 'alter publication supabase_realtime add table public.attendance_sessions';
  end if;
end $$;
