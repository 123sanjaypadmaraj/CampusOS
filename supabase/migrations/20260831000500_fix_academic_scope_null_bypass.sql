-- =============================================================================
-- Fix a real null-comparison bypass in faculty's "own department/year/course
-- only" restriction, found while verifying the new admin-Onboarding "Make
-- faculty" promotion path (see AdminCMS.jsx EmailLookupSection.makeFaculty).
--
-- publish_announcement() and create_academic_deadline() (both from
-- 20260817000300_academic_module.sql) gate faculty targeting with:
--   if p_target_scope = 'department' and (p_target_value is null or p_target_value <> v_profile.department) then raise ...
-- In plpgsql, `if <null> then` never fires -- it's only ever true or false.
-- When v_profile.department is itself NULL (a faculty account promoted
-- straight from a bare magic-link signup, with no roster-backfilled
-- department/year/course), the second half of that OR evaluates to
-- `'anything' <> NULL` = NULL, so the whole condition can end up NULL and
-- silently NOT raise for a NON-NULL p_target_value that doesn't match the
-- faculty's (null) department at all -- i.e. a faculty account with a blank
-- department could target an arbitrary department/year/course, not just
-- "their own", contradicting the comment directly above this check
-- ("never someone else's, even by guessing a target_value"). Blast radius
-- was already bounded (same campus only, Academic/Exam/Assignment only,
-- never Emergency), but the invariant itself was genuinely bypassable.
--
-- upsert_timetable_entry() (same migration) already gets this right --
-- `v_course <> coalesce(v_profile.course, '')` -- this migration just
-- brings the other two functions in line with that same null-safe pattern,
-- using `is distinct from` (Postgres' null-safe <>) instead of coalescing
-- to '', so a NULL p_target_value is still explicitly rejected as before
-- (department/year/course scope always requires a real value) while a
-- NULL v_profile.<column> now correctly blocks every non-null p_target_value
-- rather than silently letting it through.
-- =============================================================================

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
    if p_target_scope = 'department' and (p_target_value is null or p_target_value is distinct from v_profile.department) then
      raise exception 'You can only target your own department';
    end if;
    if p_target_scope = 'year' and (p_target_value is null or p_target_value is distinct from v_profile.year) then
      raise exception 'You can only target your own year';
    end if;
    if p_target_scope = 'course' and (p_target_value is null or p_target_value is distinct from v_profile.course) then
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
    if p_target_scope = 'department' and (p_target_value is null or p_target_value is distinct from v_profile.department) then
      raise exception 'You can only target your own department';
    end if;
    if p_target_scope = 'year' and (p_target_value is null or p_target_value is distinct from v_profile.year) then
      raise exception 'You can only target your own year';
    end if;
    if p_target_scope = 'course' and (p_target_value is null or p_target_value is distinct from v_profile.course) then
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
