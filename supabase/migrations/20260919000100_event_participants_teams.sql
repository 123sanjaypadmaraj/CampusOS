-- =============================================================================
-- EVENT MANAGER: participants, Google-Forms/CSV import, teams, attendance.
--
-- get_event_roster() (20260819002000) only ever covered students who
-- registered *inside CampusOS*, and only offered check-in by ticket token.
-- Clubs also collect registrations through Google Forms (workshops opened to
-- other colleges, hackathons, contests...) and need those responses in the
-- same place as the in-app ones, split into teams, with attendance marked
-- for everyone -- not just ticket holders. This adds:
--
--   event_participants  the organizer's unified per-event roster. In-app
--                       registrants are mirrored in by sync_event_participants();
--                       Google Forms / CSV rows are merged in by
--                       import_event_participants() (re-importing an updated
--                       sheet updates existing rows, so it works as a "sync").
--   event_teams         named teams per event; a participant is in <= 1 team.
--
-- Access model: RLS is ON with NO policies, so the tables are unreachable from
-- the API directly. Everything goes through SECURITY DEFINER RPCs that call
-- require_event_manager() first -- same audience as get_event_roster()
-- (event organizer, that club's leadership, 'events.checkin' staff, admins).
-- =============================================================================

-- =========================================================
-- 1. TABLES
-- =========================================================

create table if not exists public.event_teams (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  notes text check (notes is null or char_length(notes) <= 500),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  -- lets event_participants reference (team_id, event_id) so a participant
  -- can never be placed in another event's team, even by a buggy caller.
  unique (id, event_id)
);

create unique index if not exists event_teams_event_name_uniq
  on public.event_teams (event_id, lower(btrim(name)));

create table if not exists public.event_participants (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  registration_id uuid references public.event_registrations(id) on delete set null,
  user_id uuid references public.profiles(id) on delete set null,
  source text not null default 'manual' check (source in ('app','import','manual')),
  status text not null default 'registered' check (status in ('registered','cancelled')),
  name text not null default '' check (char_length(name) <= 200),
  usn text check (usn is null or char_length(usn) <= 60),
  email text check (email is null or char_length(email) <= 254),
  phone text check (phone is null or char_length(phone) <= 40),
  department text check (department is null or char_length(department) <= 120),
  year text check (year is null or char_length(year) <= 40),
  team_id uuid,
  -- every other column of the source form, keyed by its original header
  extra jsonb not null default '{}'::jsonb check (jsonb_typeof(extra) = 'object'),
  notes text check (notes is null or char_length(notes) <= 1000),
  attended boolean not null default false,
  attended_at timestamptz,
  attended_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (team_id, event_id) references public.event_teams (id, event_id) on delete set null (team_id)
);

-- One row per person per event, keyed on email and on USN independently.
create unique index if not exists event_participants_event_email_uniq
  on public.event_participants (event_id, lower(email)) where email is not null;
create unique index if not exists event_participants_event_usn_uniq
  on public.event_participants (event_id, upper(usn)) where usn is not null;
create unique index if not exists event_participants_registration_uniq
  on public.event_participants (registration_id) where registration_id is not null;
create index if not exists event_participants_event_idx on public.event_participants (event_id, created_at, id);
create index if not exists event_participants_team_idx on public.event_participants (team_id) where team_id is not null;

alter table public.event_teams enable row level security;
alter table public.event_participants enable row level security;
-- intentionally no policies: all access is via the RPCs below.
revoke all on public.event_teams, public.event_participants from anon, authenticated;

-- =========================================================
-- 2. AUTHORIZATION
-- =========================================================

-- Every operand is coalesce()d and the null-user case is rejected up front: a
-- bare `not (a or b or c)` over null operands evaluates to null, and
-- `if null` is false, so the "not authorized" branch would silently be
-- skipped (the same null-comparison bypass fixed in c349666 / 3e375f3).
create or replace function public.can_manage_event(p_event_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_event public.events;
begin
  if v_user is null or p_event_id is null then
    return false;
  end if;

  select * into v_event from public.events where id = p_event_id;
  if not found then
    return false;
  end if;

  return coalesce(v_event.organizer_id = v_user, false)
    or coalesce(public.is_club_leader(v_user, v_event.club_id), false)
    or coalesce(public.has_permission(v_user, 'events.checkin'), false)
    or coalesce(public.current_user_is_admin(), false);
end;
$$;

create or replace function public.require_event_manager(p_event_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_manage_event(p_event_id) then
    raise exception 'Not authorized to manage this event';
  end if;
end;
$$;

revoke all on function public.can_manage_event(uuid) from public, anon;
revoke all on function public.require_event_manager(uuid) from public, anon;
grant execute on function public.can_manage_event(uuid) to authenticated;
grant execute on function public.require_event_manager(uuid) to authenticated;

-- =========================================================
-- 3. READ
-- =========================================================

create or replace function public.get_event_participants(p_event_id uuid)
returns setof public.event_participants
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_event_manager(p_event_id);
  return query
    select * from public.event_participants
    where event_id = p_event_id
    order by created_at, id;
end;
$$;

create or replace function public.get_event_teams(p_event_id uuid)
returns setof public.event_teams
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_event_manager(p_event_id);
  return query
    select * from public.event_teams where event_id = p_event_id order by lower(name), id;
end;
$$;

-- =========================================================
-- 4. SYNC IN-APP REGISTRATIONS
-- =========================================================

-- Mirrors confirmed in-app registrations into event_participants (so they
-- can be teamed / marked present alongside imported rows), links a form
-- response to the in-app registration of the same person (matched on email
-- then USN) instead of duplicating them, and pulls ticket check-ins across.
-- Idempotent -- the workspace calls it every time it opens.
create or replace function public.sync_event_participants(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_pid uuid;
  v_added integer := 0;
  v_linked integer := 0;
begin
  perform public.require_event_manager(p_event_id);

  for r in
    select reg.id as reg_id, reg.user_id, reg.contact_name, reg.contact_usn, reg.contact_email,
           reg.contact_phone, reg.contact_department
    from public.event_registrations reg
    where reg.event_id = p_event_id and reg.status = 'confirmed'
      and not exists (select 1 from public.event_participants p where p.registration_id = reg.id)
  loop
    v_pid := null;

    if nullif(btrim(r.contact_email), '') is not null then
      select id into v_pid from public.event_participants
        where event_id = p_event_id and registration_id is null and lower(email) = lower(btrim(r.contact_email));
    end if;
    if v_pid is null and nullif(btrim(r.contact_usn), '') is not null then
      select id into v_pid from public.event_participants
        where event_id = p_event_id and registration_id is null and upper(usn) = upper(btrim(r.contact_usn));
    end if;

    if v_pid is not null then
      update public.event_participants
        set registration_id = r.reg_id, user_id = r.user_id,
            name = case when name = '' then left(coalesce(r.contact_name, ''), 200) else name end,
            phone = coalesce(phone, left(nullif(btrim(r.contact_phone), ''), 40)),
            department = coalesce(department, left(nullif(btrim(r.contact_department), ''), 120)),
            status = 'registered', updated_at = now()
        where id = v_pid;
      v_linked := v_linked + 1;
    else
      begin
        insert into public.event_participants
          (event_id, registration_id, user_id, source, name, usn, email, phone, department)
        values (p_event_id, r.reg_id, r.user_id, 'app', left(coalesce(r.contact_name, ''), 200),
                left(nullif(btrim(r.contact_usn), ''), 60), left(lower(nullif(btrim(r.contact_email), '')), 254),
                left(nullif(btrim(r.contact_phone), ''), 40), left(nullif(btrim(r.contact_department), ''), 120));
      exception when unique_violation then
        -- email and USN pointed at two different existing rows; keep the
        -- registrant rather than dropping them, just without the USN key.
        insert into public.event_participants
          (event_id, registration_id, user_id, source, name, email, phone, department)
        values (p_event_id, r.reg_id, r.user_id, 'app', left(coalesce(r.contact_name, ''), 200),
                left(lower(nullif(btrim(r.contact_email), '')), 254),
                left(nullif(btrim(r.contact_phone), ''), 40), left(nullif(btrim(r.contact_department), ''), 120));
      end;
      v_added := v_added + 1;
    end if;
  end loop;

  -- cancelled / re-confirmed registrations
  update public.event_participants p set status = 'cancelled', updated_at = now()
    from public.event_registrations reg
    where p.registration_id = reg.id and p.event_id = p_event_id
      and reg.status <> 'confirmed' and p.status <> 'cancelled';
  update public.event_participants p set status = 'registered', updated_at = now()
    from public.event_registrations reg
    where p.registration_id = reg.id and p.event_id = p_event_id
      and reg.status = 'confirmed' and p.status <> 'registered';

  -- door check-ins done via ticket scan
  update public.event_participants p
    set attended = true, attended_at = t.checked_in_at, attended_by = t.checked_in_by, updated_at = now()
    from public.event_tickets t
    where t.registration_id = p.registration_id and p.event_id = p_event_id
      and t.checked_in_at is not null and p.attended = false and p.status = 'registered';

  return jsonb_build_object('added', v_added, 'linked', v_linked);
end;
$$;

-- =========================================================
-- 5. IMPORT (Google Forms / CSV)
-- =========================================================

-- p_rows: [{ name, usn, email, phone, department, year, team, extra: {header: value} }].
-- The browser parses the file and maps columns; this validates and merges.
-- Merge rules (so re-importing an updated sheet is safe):
--   * a row matches an existing participant on email, else USN
--   * on match: non-empty imported values overwrite name/phone/department/
--     year, `extra` is merged key-by-key, and email/USN are only filled in
--     when blank -- and the team is only set when the person has none, so a
--     re-import never undoes teams the organizer arranged by hand.
--   * otherwise a new participant is inserted; a row with no name and no
--     email/USN/phone is skipped as blank.
create or replace function public.import_event_participants(p_event_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row jsonb;
  v_extra jsonb;
  v_kv record;
  v_name text;
  v_usn text;
  v_email text;
  v_phone text;
  v_dept text;
  v_year text;
  v_team text;
  v_team_id uuid;
  v_existing public.event_participants;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_teams_created integer := 0;
  v_key_count integer;
begin
  perform public.require_event_manager(p_event_id);

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'IMPORT_INVALID: rows must be a JSON array';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'IMPORT_TOO_LARGE: import at most 2000 rows at a time';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_name  := left(btrim(coalesce(v_row->>'name', '')), 200);
    v_usn   := left(nullif(btrim(coalesce(v_row->>'usn', '')), ''), 60);
    v_email := left(lower(nullif(btrim(coalesce(v_row->>'email', '')), '')), 254);
    v_phone := left(nullif(btrim(coalesce(v_row->>'phone', '')), ''), 40);
    v_dept  := left(nullif(btrim(coalesce(v_row->>'department', '')), ''), 120);
    v_year  := left(nullif(btrim(coalesce(v_row->>'year', '')), ''), 40);
    v_team  := left(nullif(btrim(coalesce(v_row->>'team', '')), ''), 80);

    if v_name = '' and v_usn is null and v_email is null and v_phone is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- extra: only string-ish values, capped so one hostile row can't bloat the table
    v_extra := '{}'::jsonb;
    v_key_count := 0;
    if jsonb_typeof(v_row->'extra') = 'object' then
      for v_kv in select key, value from jsonb_each(v_row->'extra') loop
        exit when v_key_count >= 60;
        if jsonb_typeof(v_kv.value) in ('string', 'number', 'boolean') and btrim(v_kv.key) <> '' then
          v_extra := v_extra || jsonb_build_object(left(btrim(v_kv.key), 120), left(v_kv.value #>> '{}', 2000));
          v_key_count := v_key_count + 1;
        end if;
      end loop;
    end if;

    v_team_id := null;
    if v_team is not null then
      select id into v_team_id from public.event_teams
        where event_id = p_event_id and lower(btrim(name)) = lower(v_team);
      if v_team_id is null then
        insert into public.event_teams (event_id, name, created_by) values (p_event_id, v_team, v_user)
          returning id into v_team_id;
        v_teams_created := v_teams_created + 1;
      end if;
    end if;

    v_existing := null;
    if v_email is not null then
      select * into v_existing from public.event_participants
        where event_id = p_event_id and lower(email) = v_email;
    end if;
    if v_existing.id is null and v_usn is not null then
      select * into v_existing from public.event_participants
        where event_id = p_event_id and upper(usn) = upper(v_usn);
    end if;

    if v_existing.id is not null then
      update public.event_participants set
        name = coalesce(nullif(v_name, ''), name),
        phone = coalesce(v_phone, phone),
        department = coalesce(v_dept, department),
        year = coalesce(v_year, year),
        email = coalesce(email, case
          when v_email is not null and not exists (
            select 1 from public.event_participants o where o.event_id = p_event_id and lower(o.email) = v_email
          ) then v_email end),
        usn = coalesce(usn, case
          when v_usn is not null and not exists (
            select 1 from public.event_participants o where o.event_id = p_event_id and upper(o.usn) = upper(v_usn)
          ) then v_usn end),
        team_id = coalesce(team_id, v_team_id),
        extra = extra || v_extra,
        updated_at = now()
      where id = v_existing.id;
      v_updated := v_updated + 1;
    else
      insert into public.event_participants
        (event_id, source, name, usn, email, phone, department, year, team_id, extra)
      values (p_event_id, 'import', v_name, v_usn, v_email, v_phone, v_dept, v_year, v_team_id, v_extra);
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, reason)
  values (v_user, 'event.participants.import', 'event', p_event_id::text,
          format('inserted=%s updated=%s skipped=%s', v_inserted, v_updated, v_skipped));

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated,
                            'skipped', v_skipped, 'teams_created', v_teams_created);
end;
$$;

-- =========================================================
-- 6. MANUAL ADD / EDIT / DELETE
-- =========================================================

-- p_fields keys: name, usn, email, phone, department, year, notes, team_id.
-- Only keys present are changed on edit. Pass p_participant_id null to add.
create or replace function public.upsert_event_participant(p_event_id uuid, p_participant_id uuid, p_fields jsonb)
returns public.event_participants
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.event_participants;
  v_email text;
  v_usn text;
begin
  perform public.require_event_manager(p_event_id);

  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'PARTICIPANT_INVALID: fields must be a JSON object';
  end if;

  v_email := left(lower(nullif(btrim(coalesce(p_fields->>'email', '')), '')), 254);
  v_usn   := left(nullif(btrim(coalesce(p_fields->>'usn', '')), ''), 60);

  begin
    if p_participant_id is null then
      if btrim(coalesce(p_fields->>'name', '')) = '' then
        raise exception 'PARTICIPANT_INVALID: a name is required';
      end if;
      insert into public.event_participants
        (event_id, source, name, usn, email, phone, department, year, notes, team_id)
      values (p_event_id, 'manual', left(btrim(p_fields->>'name'), 200), v_usn, v_email,
              left(nullif(btrim(coalesce(p_fields->>'phone', '')), ''), 40),
              left(nullif(btrim(coalesce(p_fields->>'department', '')), ''), 120),
              left(nullif(btrim(coalesce(p_fields->>'year', '')), ''), 40),
              left(nullif(btrim(coalesce(p_fields->>'notes', '')), ''), 1000),
              nullif(p_fields->>'team_id', '')::uuid)
      returning * into v_row;
    else
      update public.event_participants set
        name = case when p_fields ? 'name' then left(btrim(coalesce(p_fields->>'name', '')), 200) else name end,
        usn = case when p_fields ? 'usn' then v_usn else usn end,
        email = case when p_fields ? 'email' then v_email else email end,
        phone = case when p_fields ? 'phone' then left(nullif(btrim(coalesce(p_fields->>'phone', '')), ''), 40) else phone end,
        department = case when p_fields ? 'department' then left(nullif(btrim(coalesce(p_fields->>'department', '')), ''), 120) else department end,
        year = case when p_fields ? 'year' then left(nullif(btrim(coalesce(p_fields->>'year', '')), ''), 40) else year end,
        notes = case when p_fields ? 'notes' then left(nullif(btrim(coalesce(p_fields->>'notes', '')), ''), 1000) else notes end,
        team_id = case when p_fields ? 'team_id' then nullif(p_fields->>'team_id', '')::uuid else team_id end,
        updated_at = now()
      where id = p_participant_id and event_id = p_event_id
      returning * into v_row;
      if not found then
        raise exception 'Participant not found';
      end if;
    end if;
  exception
    when unique_violation then
      raise exception 'DUPLICATE_PARTICIPANT: someone with that email or USN is already on this event';
    when foreign_key_violation then
      raise exception 'TEAM_INVALID: that team does not belong to this event';
  end;

  return v_row;
end;
$$;

-- Rows mirrored from an in-app registration can't be deleted here (the
-- registration would just re-sync them) -- cancel the registration instead.
create or replace function public.delete_event_participants(p_event_id uuid, p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  perform public.require_event_manager(p_event_id);
  if coalesce(array_length(p_ids, 1), 0) > 5000 then
    raise exception 'Too many participants in one request';
  end if;

  with d as (
    delete from public.event_participants
    where event_id = p_event_id and id = any(p_ids) and registration_id is null
    returning 1
  )
  select count(*) into v_count from d;
  return v_count;
end;
$$;

-- =========================================================
-- 7. ATTENDANCE
-- =========================================================

-- Marks participants present/absent. For in-app registrants this also keeps
-- event_attendance (drives feedback + certificates) and the ticket's
-- check-in in step, both ways, so the QR door flow and this table never
-- disagree -- un-marking clears the ticket so the sync above doesn't just
-- flip it back.
create or replace function public.set_participants_attendance(p_event_id uuid, p_ids uuid[], p_attended boolean)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_count integer;
  v_user_ids uuid[];
  v_reg_ids uuid[];
begin
  perform public.require_event_manager(p_event_id);
  if p_attended is null then
    raise exception 'attended must be true or false';
  end if;
  if coalesce(array_length(p_ids, 1), 0) > 5000 then
    raise exception 'Too many participants in one request';
  end if;

  with upd as (
    update public.event_participants set
      attended = p_attended,
      attended_at = case when p_attended then coalesce(attended_at, now()) else null end,
      attended_by = case when p_attended then v_user else null end,
      updated_at = now()
    where event_id = p_event_id and id = any(p_ids) and status = 'registered'
      and attended is distinct from p_attended
    returning user_id, registration_id
  )
  select count(*),
         array_agg(user_id) filter (where user_id is not null),
         array_agg(registration_id) filter (where registration_id is not null)
    into v_count, v_user_ids, v_reg_ids
    from upd;

  if p_attended then
    insert into public.event_attendance (event_id, user_id)
      select p_event_id, u from unnest(coalesce(v_user_ids, '{}'::uuid[])) u
      on conflict (event_id, user_id) do nothing;
    update public.event_tickets
      set checked_in_at = coalesce(checked_in_at, now()), checked_in_by = coalesce(checked_in_by, v_user)
      where registration_id = any(coalesce(v_reg_ids, '{}'::uuid[]));
  else
    delete from public.event_attendance
      where event_id = p_event_id and user_id = any(coalesce(v_user_ids, '{}'::uuid[]));
    update public.event_tickets set checked_in_at = null, checked_in_by = null
      where registration_id = any(coalesce(v_reg_ids, '{}'::uuid[]));
  end if;

  return coalesce(v_count, 0);
end;
$$;

-- =========================================================
-- 8. TEAMS
-- =========================================================

create or replace function public.create_event_teams(p_event_id uuid, p_names text[])
returns setof public.event_teams
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_name text;
  v_wanted text[] := '{}';
begin
  perform public.require_event_manager(p_event_id);
  if coalesce(array_length(p_names, 1), 0) = 0 or array_length(p_names, 1) > 200 then
    raise exception 'TEAM_INVALID: provide between 1 and 200 team names';
  end if;

  foreach v_name in array p_names loop
    v_name := left(btrim(coalesce(v_name, '')), 80);
    if v_name = '' then
      raise exception 'TEAM_INVALID: team names cannot be blank';
    end if;
    v_wanted := v_wanted || lower(v_name);
    insert into public.event_teams (event_id, name, created_by) values (p_event_id, v_name, v_user)
      on conflict (event_id, lower(btrim(name))) do nothing;
  end loop;

  return query
    select * from public.event_teams
    where event_id = p_event_id and lower(btrim(name)) = any(v_wanted)
    order by lower(name), id;
end;
$$;

create or replace function public.update_event_team(p_team_id uuid, p_name text, p_notes text default null)
returns public.event_teams
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event uuid;
  v_row public.event_teams;
begin
  select event_id into v_event from public.event_teams where id = p_team_id;
  if v_event is null then
    raise exception 'Team not found';
  end if;
  perform public.require_event_manager(v_event);

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'TEAM_INVALID: team name cannot be blank';
  end if;

  begin
    update public.event_teams
      set name = left(btrim(p_name), 80), notes = left(nullif(btrim(coalesce(p_notes, '')), ''), 500)
      where id = p_team_id
      returning * into v_row;
  exception when unique_violation then
    raise exception 'TEAM_DUPLICATE: this event already has a team with that name';
  end;
  return v_row;
end;
$$;

-- Members are un-teamed, not deleted (FK is `on delete set null (team_id)`).
create or replace function public.delete_event_team(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event uuid;
begin
  select event_id into v_event from public.event_teams where id = p_team_id;
  if v_event is null then
    raise exception 'Team not found';
  end if;
  perform public.require_event_manager(v_event);
  delete from public.event_teams where id = p_team_id;
end;
$$;

-- p_assignments: [{ participant_id, team_id }] -- team_id null un-assigns.
create or replace function public.assign_participants_to_teams(p_event_id uuid, p_assignments jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  perform public.require_event_manager(p_event_id);

  if p_assignments is null or jsonb_typeof(p_assignments) <> 'array' then
    raise exception 'TEAM_INVALID: assignments must be a JSON array';
  end if;
  if jsonb_array_length(p_assignments) > 5000 then
    raise exception 'Too many assignments in one request';
  end if;

  begin
    with a as (
      select (x->>'participant_id')::uuid as participant_id, nullif(x->>'team_id', '')::uuid as team_id
      from jsonb_array_elements(p_assignments) x
    ), upd as (
      update public.event_participants p set team_id = a.team_id, updated_at = now()
      from a
      where p.id = a.participant_id and p.event_id = p_event_id
        and p.team_id is distinct from a.team_id
      returning 1
    )
    select count(*) into v_count from upd;
  exception when foreign_key_violation then
    raise exception 'TEAM_INVALID: a team in this request does not belong to this event';
  end;

  return coalesce(v_count, 0);
end;
$$;

-- =========================================================
-- 9. GRANTS
-- =========================================================

do $$
declare
  f text;
begin
  foreach f in array array[
    'get_event_participants(uuid)',
    'get_event_teams(uuid)',
    'sync_event_participants(uuid)',
    'import_event_participants(uuid, jsonb)',
    'upsert_event_participant(uuid, uuid, jsonb)',
    'delete_event_participants(uuid, uuid[])',
    'set_participants_attendance(uuid, uuid[], boolean)',
    'create_event_teams(uuid, text[])',
    'update_event_team(uuid, text, text)',
    'delete_event_team(uuid)',
    'assign_participants_to_teams(uuid, jsonb)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
