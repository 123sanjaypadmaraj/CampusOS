-- =============================================================================
-- 0111: COMPLETE CLUB CMS (doc §39) -- everything the self-service club
-- dashboard (20260814004800_club_self_service.sql) didn't yet cover: real
-- Treasurer/Event Manager roles, an application-based join/recruitment
-- flow (today joinClub() is an instant insert with no approval step at
-- all), documents, a photo gallery, club-only announcements, meeting
-- attendance, and a membership history log (today leaving/being removed
-- from club_members just deletes the row -- no record survives).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Roles: add treasurer/event_manager alongside the existing leadership
-- roles. Additive only -- owner/president/vice_president/coordinator stay
-- valid (real clubs already have members in those roles; narrowing the
-- constraint would risk orphaning live data), so ClubManage's role select
-- keeps offering all of them, this just adds two more real-world titles.
-- ---------------------------------------------------------------------------

alter table public.club_members drop constraint if exists club_members_role_check;
alter table public.club_members add constraint club_members_role_check
  check (role in ('owner','president','vice_president','secretary','coordinator','treasurer','event_manager','member'));

create or replace function public.is_club_leader(p_user uuid, p_club uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.club_members
    where club_id = p_club and user_id = p_user
      and role in ('owner','president','vice_president','secretary','coordinator','treasurer','event_manager')
  );
$$;

-- Recreate with the expanded role list (same signature/return type as
-- 20260814004800 -- CREATE OR REPLACE is safe here).
create or replace function public.set_club_member_role(p_member_id uuid, p_role text)
returns public.club_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_member public.club_members;
  v_owner_count integer;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if p_role not in ('owner','president','vice_president','secretary','coordinator','treasurer','event_manager','member') then
    raise exception 'Invalid club role %', p_role;
  end if;

  select * into v_member from public.club_members where id = p_member_id for update;
  if not found then raise exception 'Member not found'; end if;

  if not (public.is_club_admin_role(v_user, v_member.club_id)
          or public.has_permission(v_user, 'clubs.manage') or public.current_user_is_admin()) then
    raise exception 'Not authorized to manage this club''s roster';
  end if;

  if v_member.role = 'owner' and p_role <> 'owner' then
    select count(*) into v_owner_count from public.club_members where club_id = v_member.club_id and role = 'owner';
    if v_owner_count <= 1 then
      raise exception 'CLUB_LAST_OWNER: a club must always have at least one owner -- promote someone else first';
    end if;
  end if;

  update public.club_members set role = p_role where id = p_member_id returning * into v_member;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value)
  values (v_user, 'club_member.role.change', 'club_member', p_member_id::text, jsonb_build_object('role', p_role));

  return v_member;
end;
$$;

-- ---------------------------------------------------------------------------
-- Recruitment settings on clubs: open (instant join, today's behaviour),
-- application (must apply, a leader approves/rejects), closed (not
-- accepting anyone new). Edited the same way name/category/description
-- already are -- via the existing clubs_write RLS policy, no new RPC.
-- ---------------------------------------------------------------------------

alter table public.clubs add column if not exists recruitment_mode text not null default 'open';
do $$ begin
  alter table public.clubs add constraint clubs_recruitment_mode_check
    check (recruitment_mode in ('open','application','closed'));
exception when duplicate_object then null;
end $$;
alter table public.clubs add column if not exists recruitment_message text;

-- ---------------------------------------------------------------------------
-- Applications
-- ---------------------------------------------------------------------------

create table if not exists public.club_applications (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  message text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','withdrawn')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);

create index if not exists club_applications_club_status_idx on public.club_applications(club_id, status, created_at desc);
create index if not exists club_applications_user_idx on public.club_applications(user_id);

alter table public.club_applications enable row level security;

-- Read only: the applicant (their own row) or the club's leaders/admins.
-- No insert/update/delete policy at all -- every write goes through the
-- RPCs below (security definer), same "RPC is the only writer" pattern
-- set_club_member_role/remove_club_member already use for club_members.
drop policy if exists "club_applications_read" on public.club_applications;
create policy "club_applications_read" on public.club_applications for select to authenticated
  using (user_id = auth.uid() or public.is_club_leader(auth.uid(), club_id)
    or public.has_permission(auth.uid(),'clubs.manage') or public.current_user_is_admin());

create or replace function public.apply_to_club(p_club_id uuid, p_message text default null)
returns public.club_applications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_club public.clubs;
  v_app public.club_applications;
  v_leader record;
  v_name text;
begin
  if v_user is null then raise exception 'Sign in required'; end if;

  select * into v_club from public.clubs where id = p_club_id;
  if not found then raise exception 'Club not found'; end if;

  if v_club.recruitment_mode = 'closed' then
    raise exception 'CLUB_RECRUITMENT_CLOSED: this club is not accepting new members right now';
  end if;

  if exists (select 1 from public.club_members where club_id = p_club_id and user_id = v_user) then
    raise exception 'You are already a member of this club';
  end if;

  if exists (select 1 from public.club_applications where club_id = p_club_id and user_id = v_user and status = 'pending') then
    raise exception 'You already have a pending application for this club';
  end if;

  if not public.check_rate_limit(v_user, 'club_applications', 10, 3600) then
    raise exception 'RATE_LIMITED: too many club applications, slow down';
  end if;

  insert into public.club_applications (club_id, user_id, message)
  values (p_club_id, v_user, nullif(trim(p_message), ''))
  returning * into v_app;

  select name into v_name from public.profiles where id = v_user;

  for v_leader in
    select user_id from public.club_members
    where club_id = p_club_id and role in ('owner','president','vice_president','secretary','coordinator','treasurer','event_manager')
  loop
    perform public.create_notification(
      v_leader.user_id, 'New club application',
      coalesce(v_name, 'A student') || ' applied to join ' || v_club.name || '.',
      'club', 'club', p_club_id::text
    );
  end loop;

  return v_app;
end;
$$;

grant execute on function public.apply_to_club(uuid, text) to authenticated;

create or replace function public.cancel_club_application(p_application_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_app public.club_applications;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  select * into v_app from public.club_applications where id = p_application_id for update;
  if not found then raise exception 'Application not found'; end if;
  if v_app.user_id <> v_user then raise exception 'Not your application'; end if;
  if v_app.status <> 'pending' then raise exception 'Only a pending application can be withdrawn'; end if;
  update public.club_applications set status = 'withdrawn' where id = p_application_id;
end;
$$;

grant execute on function public.cancel_club_application(uuid) to authenticated;

create or replace function public.review_club_application(p_application_id uuid, p_decision text, p_note text default null)
returns public.club_applications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_app public.club_applications;
  v_club public.clubs;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'Invalid decision'; end if;

  select * into v_app from public.club_applications where id = p_application_id for update;
  if not found then raise exception 'Application not found'; end if;
  if v_app.status <> 'pending' then raise exception 'This application has already been reviewed'; end if;

  if not (public.is_club_leader(v_user, v_app.club_id)
          or public.has_permission(v_user,'clubs.manage') or public.current_user_is_admin()) then
    raise exception 'Not authorized to review applications for this club';
  end if;

  select * into v_club from public.clubs where id = v_app.club_id;

  update public.club_applications
    set status = p_decision, reviewed_by = v_user, reviewed_at = now(), review_note = nullif(trim(coalesce(p_note,'')),'')
    where id = p_application_id
    returning * into v_app;

  if p_decision = 'approved' then
    insert into public.club_members (club_id, user_id, role) values (v_app.club_id, v_app.user_id, 'member')
      on conflict (club_id, user_id) do nothing;
  end if;

  perform public.create_notification(
    v_app.user_id,
    case when p_decision = 'approved' then 'Application approved!' else 'Application update' end,
    case when p_decision = 'approved' then 'You''re now a member of ' || v_club.name || '.'
         else 'Your application to join ' || v_club.name || ' was not approved this time.' end,
    'club', 'club', v_app.club_id::text
  );

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value)
  values (v_user, 'club_application.review', 'club_application', p_application_id::text, jsonb_build_object('decision', p_decision));

  return v_app;
end;
$$;

grant execute on function public.review_club_application(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Documents (private storage, any signed-in campus member can read, only
-- leaders/admins can write -- mirrors the "authenticated read, leader
-- write" shape used below for gallery/announcements/meetings).
-- ---------------------------------------------------------------------------

create table if not exists public.club_documents (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  title text not null,
  description text,
  file_path text not null,
  category text,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists club_documents_club_idx on public.club_documents(club_id, created_at desc);
alter table public.club_documents enable row level security;

drop policy if exists "club_documents_read" on public.club_documents;
create policy "club_documents_read" on public.club_documents for select to authenticated using (true);

drop policy if exists "club_documents_write" on public.club_documents;
create policy "club_documents_write" on public.club_documents for all to authenticated
  using (public.is_club_leader(auth.uid(), club_id) or public.has_permission(auth.uid(),'clubs.manage') or public.current_user_is_admin())
  with check (public.is_club_leader(auth.uid(), club_id) or public.has_permission(auth.uid(),'clubs.manage') or public.current_user_is_admin());

-- ---------------------------------------------------------------------------
-- Gallery (public storage -- club photos are meant to be shown, including
-- to prospective members who haven't joined yet).
-- ---------------------------------------------------------------------------

create table if not exists public.club_gallery (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  image_url text not null,
  caption text,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists club_gallery_club_idx on public.club_gallery(club_id, created_at desc);
alter table public.club_gallery enable row level security;

drop policy if exists "club_gallery_read" on public.club_gallery;
create policy "club_gallery_read" on public.club_gallery for select to anon, authenticated using (true);

drop policy if exists "club_gallery_write" on public.club_gallery;
create policy "club_gallery_write" on public.club_gallery for all to authenticated
  using (public.is_club_leader(auth.uid(), club_id) or public.has_permission(auth.uid(),'clubs.manage') or public.current_user_is_admin())
  with check (public.is_club_leader(auth.uid(), club_id) or public.has_permission(auth.uid(),'clubs.manage') or public.current_user_is_admin());

-- ---------------------------------------------------------------------------
-- Announcements (club-scoped, distinct from admin's campus-wide
-- announcements table). Insert only via publish_club_announcement() so
-- posting always fans out a real notification to every member; edit/pin/
-- delete stay plain RLS since those don't need a fresh notification.
-- ---------------------------------------------------------------------------

create table if not exists public.club_announcements (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  title text not null,
  body text,
  pinned boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists club_announcements_club_idx on public.club_announcements(club_id, pinned desc, created_at desc);
alter table public.club_announcements enable row level security;

drop policy if exists "club_announcements_read" on public.club_announcements;
create policy "club_announcements_read" on public.club_announcements for select to authenticated using (true);

drop policy if exists "club_announcements_update" on public.club_announcements;
create policy "club_announcements_update" on public.club_announcements for update to authenticated
  using (public.is_club_leader(auth.uid(), club_id) or public.has_permission(auth.uid(),'clubs.manage') or public.current_user_is_admin())
  with check (public.is_club_leader(auth.uid(), club_id) or public.has_permission(auth.uid(),'clubs.manage') or public.current_user_is_admin());

drop policy if exists "club_announcements_delete" on public.club_announcements;
create policy "club_announcements_delete" on public.club_announcements for delete to authenticated
  using (public.is_club_leader(auth.uid(), club_id) or public.has_permission(auth.uid(),'clubs.manage') or public.current_user_is_admin());

create or replace function public.publish_club_announcement(p_club_id uuid, p_title text, p_body text default null, p_pinned boolean default false)
returns public.club_announcements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_club public.clubs;
  v_ann public.club_announcements;
  v_member record;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if not (public.is_club_leader(v_user, p_club_id) or public.has_permission(v_user,'clubs.manage') or public.current_user_is_admin()) then
    raise exception 'Not authorized to post announcements for this club';
  end if;
  if coalesce(trim(p_title),'') = '' then raise exception 'Title is required'; end if;

  select * into v_club from public.clubs where id = p_club_id;
  if not found then raise exception 'Club not found'; end if;

  insert into public.club_announcements (club_id, title, body, pinned, created_by)
  values (p_club_id, trim(p_title), p_body, coalesce(p_pinned, false), v_user)
  returning * into v_ann;

  for v_member in select user_id from public.club_members where club_id = p_club_id
  loop
    perform public.create_notification(v_member.user_id, v_club.name || ': ' || v_ann.title, p_body, 'club', 'club', p_club_id::text);
  end loop;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value)
  values (v_user, 'club_announcement.publish', 'club_announcement', v_ann.id::text, jsonb_build_object('title', p_title));

  return v_ann;
end;
$$;

grant execute on function public.publish_club_announcement(uuid, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Meetings & attendance -- distinct from event check-in (event_attendance):
-- these are internal club meetings, not published campus events. Meetings
-- are leader-internal (no general member read -- nothing worth showing
-- non-leaders). Attendance rows go through mark_meeting_attendance() only
-- (bulk upsert + validates the member still belongs to the club); members
-- may read their own record.
-- ---------------------------------------------------------------------------

create table if not exists public.club_meetings (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  title text not null,
  meeting_date timestamptz not null,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists club_meetings_club_idx on public.club_meetings(club_id, meeting_date desc);
alter table public.club_meetings enable row level security;

drop policy if exists "club_meetings_all" on public.club_meetings;
create policy "club_meetings_all" on public.club_meetings for all to authenticated
  using (public.is_club_leader(auth.uid(), club_id) or public.has_permission(auth.uid(),'clubs.manage') or public.current_user_is_admin())
  with check (public.is_club_leader(auth.uid(), club_id) or public.has_permission(auth.uid(),'clubs.manage') or public.current_user_is_admin());

create table if not exists public.club_meeting_attendance (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.club_meetings(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'present' check (status in ('present','absent','excused')),
  marked_by uuid references public.profiles(id) on delete set null,
  marked_at timestamptz not null default now(),
  unique(meeting_id, user_id)
);

create index if not exists club_meeting_attendance_meeting_idx on public.club_meeting_attendance(meeting_id);
alter table public.club_meeting_attendance enable row level security;

drop policy if exists "club_meeting_attendance_read" on public.club_meeting_attendance;
create policy "club_meeting_attendance_read" on public.club_meeting_attendance for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.club_meetings m where m.id = meeting_id and public.is_club_leader(auth.uid(), m.club_id))
    or public.has_permission(auth.uid(),'clubs.manage') or public.current_user_is_admin()
  );

create or replace function public.mark_meeting_attendance(p_meeting_id uuid, p_entries jsonb)
returns setof public.club_meeting_attendance
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_meeting public.club_meetings;
  v_entry jsonb;
  v_status text;
  v_target uuid;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  select * into v_meeting from public.club_meetings where id = p_meeting_id;
  if not found then raise exception 'Meeting not found'; end if;

  if not (public.is_club_leader(v_user, v_meeting.club_id) or public.has_permission(v_user,'clubs.manage') or public.current_user_is_admin()) then
    raise exception 'Not authorized to record attendance for this club';
  end if;

  for v_entry in select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb))
  loop
    v_target := (v_entry->>'user_id')::uuid;
    v_status := coalesce(v_entry->>'status', 'present');
    if v_status not in ('present','absent','excused') then
      raise exception 'Invalid attendance status %', v_status;
    end if;
    if not exists (select 1 from public.club_members where club_id = v_meeting.club_id and user_id = v_target) then
      continue; -- skip anyone who is no longer a member
    end if;
    insert into public.club_meeting_attendance (meeting_id, user_id, status, marked_by)
    values (p_meeting_id, v_target, v_status, v_user)
    on conflict (meeting_id, user_id) do update set status = excluded.status, marked_by = v_user, marked_at = now();
  end loop;

  return query select * from public.club_meeting_attendance where meeting_id = p_meeting_id;
end;
$$;

grant execute on function public.mark_meeting_attendance(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Membership history -- club_members only ever holds *current* membership;
-- leaving or being removed just deletes the row today, losing the record.
-- This trigger writes an append-only log on every join/role-change/leave/
-- removal so leaders can see who's ever been in the club. Written by a
-- SECURITY DEFINER trigger function only -- no RLS write policy exists, so
-- it can't be tampered with directly.
-- ---------------------------------------------------------------------------

create table if not exists public.club_membership_history (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in ('joined','left','removed','role_changed')),
  role text,
  previous_role text,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists club_membership_history_club_idx on public.club_membership_history(club_id, created_at desc);
alter table public.club_membership_history enable row level security;

drop policy if exists "club_membership_history_read" on public.club_membership_history;
create policy "club_membership_history_read" on public.club_membership_history for select to authenticated
  using (public.is_club_leader(auth.uid(), club_id) or public.has_permission(auth.uid(),'clubs.manage') or public.current_user_is_admin());

create or replace function public.log_club_membership_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.club_membership_history (club_id, user_id, event_type, role, actor_id)
    values (new.club_id, new.user_id, 'joined', new.role, auth.uid());
    return new;
  elsif tg_op = 'UPDATE' then
    if new.role is distinct from old.role then
      insert into public.club_membership_history (club_id, user_id, event_type, role, previous_role, actor_id)
      values (new.club_id, new.user_id, 'role_changed', new.role, old.role, auth.uid());
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.club_membership_history (club_id, user_id, event_type, role, actor_id)
    values (old.club_id, old.user_id, case when old.user_id = auth.uid() then 'left' else 'removed' end, old.role, auth.uid());
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists club_members_history_trigger on public.club_members;
create trigger club_members_history_trigger
  after insert or update or delete on public.club_members
  for each row execute function public.log_club_membership_event();

-- ---------------------------------------------------------------------------
-- Storage: club-files (private documents) + club-gallery (public photos).
-- Path convention: `${club_id}/${filename}` -- write access checked via a
-- club_members leadership lookup on the folder segment rather than the
-- `foldername[1] = auth.uid()` pattern the other buckets use, since these
-- files belong to a club, not to whoever uploaded them.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('club-gallery', 'club-gallery', true, 10485760, array['image/png','image/jpeg','image/webp']),
  ('club-files', 'club-files', false, 26214400, array['application/pdf','image/png','image/jpeg',
    'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "club_gallery_storage_read" on storage.objects;
create policy "club_gallery_storage_read" on storage.objects for select to anon, authenticated
  using (bucket_id = 'club-gallery');

drop policy if exists "club_gallery_storage_write" on storage.objects;
create policy "club_gallery_storage_write" on storage.objects for all to authenticated
  using (bucket_id = 'club-gallery' and (
    exists (select 1 from public.club_members m where m.user_id = auth.uid() and m.club_id::text = (storage.foldername(name))[1]
      and m.role in ('owner','president','vice_president','secretary','coordinator','treasurer','event_manager'))
    or public.has_permission(auth.uid(),'clubs.manage') or public.current_user_is_admin()
  ))
  with check (bucket_id = 'club-gallery' and (
    exists (select 1 from public.club_members m where m.user_id = auth.uid() and m.club_id::text = (storage.foldername(name))[1]
      and m.role in ('owner','president','vice_president','secretary','coordinator','treasurer','event_manager'))
    or public.has_permission(auth.uid(),'clubs.manage') or public.current_user_is_admin()
  ));

drop policy if exists "club_files_storage_read" on storage.objects;
create policy "club_files_storage_read" on storage.objects for select to authenticated
  using (bucket_id = 'club-files');

drop policy if exists "club_files_storage_write" on storage.objects;
create policy "club_files_storage_write" on storage.objects for all to authenticated
  using (bucket_id = 'club-files' and (
    exists (select 1 from public.club_members m where m.user_id = auth.uid() and m.club_id::text = (storage.foldername(name))[1]
      and m.role in ('owner','president','vice_president','secretary','coordinator','treasurer','event_manager'))
    or public.has_permission(auth.uid(),'clubs.manage') or public.current_user_is_admin()
  ))
  with check (bucket_id = 'club-files' and (
    exists (select 1 from public.club_members m where m.user_id = auth.uid() and m.club_id::text = (storage.foldername(name))[1]
      and m.role in ('owner','president','vice_president','secretary','coordinator','treasurer','event_manager'))
    or public.has_permission(auth.uid(),'clubs.manage') or public.current_user_is_admin()
  ));

-- ---------------------------------------------------------------------------
-- get_club_dashboard: extend the one-call dashboard payload with
-- applications/documents/gallery/announcements/meetings/membership_history.
-- Same signature as 20260814004800's version -- CREATE OR REPLACE is safe.
-- ---------------------------------------------------------------------------

create or replace function public.get_club_dashboard(p_club_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_my_role text;
  v_result jsonb;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;

  select role into v_my_role from public.club_members where club_id = p_club_id and user_id = v_user;

  if coalesce(v_my_role, 'member') = 'member'
     and not (public.has_permission(v_user, 'clubs.manage') or public.current_user_is_admin()) then
    raise exception 'Not authorized to manage this club';
  end if;

  select jsonb_build_object(
    'club', (select to_jsonb(c) from public.clubs_with_counts c where c.id = p_club_id),
    'my_role', coalesce(v_my_role, 'admin'),
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id, 'user_id', m.user_id, 'role', m.role, 'joined_at', m.joined_at,
        'name', p.name, 'usn', p.usn, 'course', p.course, 'avatar_url', p.avatar_url
      ) order by m.joined_at), '[]'::jsonb)
      from public.club_members m join public.profiles p on p.id = m.user_id
      where m.club_id = p_club_id
    ),
    'events', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'title', e.title, 'category', e.category, 'event_date', e.event_date,
        'place', e.place, 'capacity', e.capacity, 'attendees', e.attendees,
        'registration_status', e.registration_status, 'published', e.published
      ) order by e.event_date desc), '[]'::jsonb)
      from public.events_with_counts e where e.club_id = p_club_id
    ),
    'member_growth', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d, 'new_members', cnt) order by d), '[]'::jsonb)
      from (
        select date_trunc('day', joined_at)::date as d, count(*) as cnt
        from public.club_members
        where club_id = p_club_id and joined_at >= now() - interval '30 days'
        group by 1
      ) t
    ),
    'applications', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'user_id', a.user_id, 'message', a.message, 'status', a.status,
        'created_at', a.created_at, 'name', p.name, 'usn', p.usn, 'course', p.course, 'year', p.year
      ) order by a.created_at desc), '[]'::jsonb)
      from public.club_applications a join public.profiles p on p.id = a.user_id
      where a.club_id = p_club_id and a.status = 'pending'
    ),
    'documents', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', d.id, 'title', d.title, 'description', d.description, 'file_path', d.file_path,
        'category', d.category, 'created_at', d.created_at, 'uploaded_by_name', p.name
      ) order by d.created_at desc), '[]'::jsonb)
      from public.club_documents d left join public.profiles p on p.id = d.uploaded_by
      where d.club_id = p_club_id
    ),
    'gallery', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', g.id, 'image_url', g.image_url, 'caption', g.caption, 'created_at', g.created_at
      ) order by g.created_at desc), '[]'::jsonb)
      from public.club_gallery g where g.club_id = p_club_id
    ),
    'announcements', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'title', a.title, 'body', a.body, 'pinned', a.pinned, 'created_at', a.created_at,
        'author_name', p.name
      ) order by a.pinned desc, a.created_at desc), '[]'::jsonb)
      from public.club_announcements a left join public.profiles p on p.id = a.created_by
      where a.club_id = p_club_id
    ),
    'meetings', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', mt.id, 'title', mt.title, 'meeting_date', mt.meeting_date, 'notes', mt.notes,
        'present', (select count(*) from public.club_meeting_attendance ca where ca.meeting_id = mt.id and ca.status = 'present'),
        'absent', (select count(*) from public.club_meeting_attendance ca where ca.meeting_id = mt.id and ca.status = 'absent'),
        'excused', (select count(*) from public.club_meeting_attendance ca where ca.meeting_id = mt.id and ca.status = 'excused'),
        'marked', (select count(*) from public.club_meeting_attendance ca where ca.meeting_id = mt.id)
      ) order by mt.meeting_date desc), '[]'::jsonb)
      from public.club_meetings mt where mt.club_id = p_club_id
    ),
    'membership_history', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', h.id, 'user_id', h.user_id, 'event_type', h.event_type, 'role', h.role,
        'previous_role', h.previous_role, 'created_at', h.created_at, 'name', p.name
      ) order by h.created_at desc), '[]'::jsonb)
      from (select * from public.club_membership_history where club_id = p_club_id order by created_at desc limit 50) h
      left join public.profiles p on p.id = h.user_id
    )
  ) into v_result;

  if v_result is null or (v_result->'club') = 'null'::jsonb then
    raise exception 'Club not found';
  end if;

  return v_result;
end;
$$;

grant execute on function public.get_club_dashboard(uuid) to authenticated;
