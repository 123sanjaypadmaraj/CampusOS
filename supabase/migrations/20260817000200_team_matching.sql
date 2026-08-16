-- =============================================================================
-- PROJECT / TEAM MATCHING (doc §22 / user's "22. Project / Team Matching"
-- checklist: student skills, project interests, team creation, find
-- teammates, skill matching, project posts, invitations, applications,
-- team management).
--
-- Was entirely fake before this migration: README's own "Hackathon & Team
-- Formation" mockup ("Looking for: Flutter Developer... [JOIN TEAM]") never
-- had real data behind it, Home's "3 teams are looking for developers"
-- pulse card is hardcoded copy that just navigates to the Campus feed, the
-- People page's "Need a teammate" button just opened the generic community
-- post composer, and its "SKILL MATCHING / Find my team" button literally
-- did nothing but `notify("Skill matching questionnaire opened")`. Only
-- real pre-existing pieces: `profiles.skills text[]` and
-- `profiles.open_to_projects boolean` (self-reported, already editable from
-- Profile) -- both reused here rather than duplicated.
--
-- Scope decision: "project posts" and "team creation" are modeled as ONE
-- entity, `project_teams` -- a team IS its own recruitment post (title,
-- description, skills needed/have, deadline). Splitting them into two
-- tables would just mean keeping a post and a team in sync for no real
-- benefit; every real hackathon/team-formation platform (Devpost etc.)
-- treats "post a team" and "form a team" as the same action.
--
-- "Skill matching" ("I need a React developer and an embedded systems
-- person" -> CampusOS finds matching students) is real, RPC-level ranking
-- (get_team_candidates / list_project_teams), not a chat parser -- wiring a
-- natural-language query into this is the campus-assistant's job (doc
-- §16's AI Action System), left as a follow-up; the RPCs here are already
-- shaped so that tool could call them (skills text[] in, ranked students
-- out) without any schema change.
-- =============================================================================

create table if not exists public.project_teams (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid references public.campuses(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text not null default '',
  category text not null default 'Project'
    check (category in ('Project','Hackathon','Academic Project','Startup','Research','Open Source','Competition','Other')),
  context text, -- e.g. "Smart India Hackathon 2026" -- free text, optional
  skills_have text[] not null default '{}',
  skills_needed text[] not null default '{}',
  max_members integer not null default 4 check (max_members between 1 and 20),
  status text not null default 'recruiting'
    check (status in ('recruiting','full','closed','completed')),
  deadline date,
  external_link text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists project_teams_set_updated_at on public.project_teams;
create trigger project_teams_set_updated_at
before update on public.project_teams
for each row execute function public.set_updated_at();

create table if not exists public.project_team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.project_teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  joined_at timestamptz not null default now(),
  unique (team_id, user_id)
);

create table if not exists public.project_team_applications (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.project_teams(id) on delete cascade,
  applicant_id uuid not null references public.profiles(id) on delete cascade,
  message text,
  status text not null default 'pending' check (status in ('pending','accepted','rejected','withdrawn')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.project_team_invitations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.project_teams(id) on delete cascade,
  inviter_id uuid not null references public.profiles(id) on delete cascade,
  invitee_id uuid not null references public.profiles(id) on delete cascade,
  message text,
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

create index if not exists project_teams_campus_status_idx on public.project_teams(campus_id, status, created_at desc);
create index if not exists project_teams_owner_idx on public.project_teams(owner_id);
create index if not exists project_team_members_team_idx on public.project_team_members(team_id);
create index if not exists project_team_members_user_idx on public.project_team_members(user_id);
create index if not exists project_team_applications_team_status_idx on public.project_team_applications(team_id, status, created_at desc);
create index if not exists project_team_applications_applicant_idx on public.project_team_applications(applicant_id);
create index if not exists project_team_invitations_team_idx on public.project_team_invitations(team_id);
create index if not exists project_team_invitations_invitee_status_idx on public.project_team_invitations(invitee_id, status, created_at desc);

-- =========================================================
-- RLS
-- =========================================================

alter table public.project_teams enable row level security;
alter table public.project_team_members enable row level security;
alter table public.project_team_applications enable row level security;
alter table public.project_team_invitations enable row level security;

-- Teams themselves: same visibility level as clubs/opportunities -- any
-- signed-in student can browse. Direct field edits (title/description/
-- skills/etc) go through the owner via RLS, same as updateClubProfile();
-- membership/application/invitation changes always go through the RPCs
-- below since those need atomic capacity checks.
drop policy if exists "project_teams_read" on public.project_teams;
create policy "project_teams_read" on public.project_teams for select to authenticated using (true);

drop policy if exists "project_teams_update_own" on public.project_teams;
create policy "project_teams_update_own" on public.project_teams for update to authenticated
  using (owner_id = auth.uid() or public.current_user_is_admin())
  with check (owner_id = auth.uid() or public.current_user_is_admin());

drop policy if exists "project_teams_delete_own" on public.project_teams;
create policy "project_teams_delete_own" on public.project_teams for delete to authenticated
  using (owner_id = auth.uid() or public.current_user_is_admin());

-- No insert policy -- creation always goes through create_project_team()
-- so the owner membership row is created atomically in the same
-- transaction as the team itself.

-- Roster is readable by anyone (same trust level as club_members); every
-- write is RPC-only (join-via-accept, remove, leave) for atomic capacity
-- enforcement.
drop policy if exists "project_team_members_read" on public.project_team_members;
create policy "project_team_members_read" on public.project_team_members for select to authenticated using (true);

-- Applications: the applicant's own rows, or the team owner/admin.
drop policy if exists "project_team_applications_read" on public.project_team_applications;
create policy "project_team_applications_read" on public.project_team_applications for select to authenticated
  using (
    applicant_id = auth.uid()
    or exists (select 1 from public.project_teams t where t.id = team_id and t.owner_id = auth.uid())
    or public.current_user_is_admin()
  );

-- Invitations: the inviter, the invitee, or the team owner/admin.
drop policy if exists "project_team_invitations_read" on public.project_team_invitations;
create policy "project_team_invitations_read" on public.project_team_invitations for select to authenticated
  using (
    inviter_id = auth.uid() or invitee_id = auth.uid()
    or exists (select 1 from public.project_teams t where t.id = team_id and t.owner_id = auth.uid())
    or public.current_user_is_admin()
  );

-- =========================================================
-- RPCs
-- =========================================================

create or replace function public.create_project_team(
  p_title text,
  p_description text default '',
  p_category text default 'Project',
  p_context text default null,
  p_skills_have text[] default '{}',
  p_skills_needed text[] default '{}',
  p_max_members integer default 4,
  p_deadline date default null,
  p_external_link text default null
)
returns public.project_teams
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_campus uuid;
  v_team public.project_teams;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'Team title is required'; end if;
  if not public.check_rate_limit(v_user, 'project_teams', 10, 3600) then
    raise exception 'RATE_LIMITED: too many teams created recently, try again later';
  end if;

  select campus_id into v_campus from public.profiles where id = v_user;

  insert into public.project_teams (
    campus_id, owner_id, title, description, category, context,
    skills_have, skills_needed, max_members, deadline, external_link
  ) values (
    v_campus, v_user, trim(p_title), coalesce(p_description, ''), coalesce(p_category, 'Project'), p_context,
    coalesce(p_skills_have, '{}'), coalesce(p_skills_needed, '{}'),
    greatest(1, least(coalesce(p_max_members, 4), 20)), p_deadline, p_external_link
  ) returning * into v_team;

  insert into public.project_team_members (team_id, user_id, role) values (v_team.id, v_user, 'owner');

  return v_team;
end;
$$;

create or replace function public.delete_project_team(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_team public.project_teams;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  select * into v_team from public.project_teams where id = p_team_id;
  if not found then raise exception 'Team not found'; end if;
  if not (v_team.owner_id = v_user or public.current_user_is_admin()) then
    raise exception 'Not authorized to delete this team';
  end if;

  delete from public.project_teams where id = p_team_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_value)
  values (v_user, 'project_team.delete', 'project_team', p_team_id::text, to_jsonb(v_team));
end;
$$;

-- Apply to join a recruiting team.
create or replace function public.apply_to_team(p_team_id uuid, p_message text default null)
returns public.project_team_applications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_team public.project_teams;
  v_app public.project_team_applications;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if not public.check_rate_limit(v_user, 'team_applications', 20, 3600) then
    raise exception 'RATE_LIMITED: too many applications recently, try again later';
  end if;

  select * into v_team from public.project_teams where id = p_team_id for update;
  if not found then raise exception 'Team not found'; end if;
  if v_team.owner_id = v_user then raise exception 'You already own this team'; end if;
  if v_team.status <> 'recruiting' then raise exception 'TEAM_NOT_RECRUITING: this team is not accepting applications'; end if;

  if exists (select 1 from public.project_team_members where team_id = p_team_id and user_id = v_user) then
    raise exception 'You are already a member of this team';
  end if;
  if exists (select 1 from public.project_team_applications where team_id = p_team_id and applicant_id = v_user and status = 'pending') then
    raise exception 'You already have a pending application to this team';
  end if;

  insert into public.project_team_applications (team_id, applicant_id, message)
  values (p_team_id, v_user, p_message)
  returning * into v_app;

  perform public.create_notification(
    v_team.owner_id, 'New team application',
    (select name from public.profiles where id = v_user) || ' applied to join "' || v_team.title || '"',
    'team', 'team_application', p_team_id::text
  );

  return v_app;
end;
$$;

create or replace function public.withdraw_team_application(p_application_id uuid)
returns public.project_team_applications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_app public.project_team_applications;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  select * into v_app from public.project_team_applications where id = p_application_id for update;
  if not found then raise exception 'Application not found'; end if;
  if v_app.applicant_id <> v_user then raise exception 'Not your application'; end if;
  if v_app.status <> 'pending' then raise exception 'Only a pending application can be withdrawn'; end if;

  update public.project_team_applications set status = 'withdrawn' where id = p_application_id returning * into v_app;
  return v_app;
end;
$$;

create or replace function public.review_team_application(p_application_id uuid, p_decision text)
returns public.project_team_applications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_app public.project_team_applications;
  v_team public.project_teams;
  v_member_count integer;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if p_decision not in ('accepted','rejected') then raise exception 'Invalid decision %', p_decision; end if;

  select * into v_app from public.project_team_applications where id = p_application_id for update;
  if not found then raise exception 'Application not found'; end if;
  select * into v_team from public.project_teams where id = v_app.team_id for update;
  if not found then raise exception 'Team not found'; end if;
  if not (v_team.owner_id = v_user or public.current_user_is_admin()) then
    raise exception 'Not authorized to review applications for this team';
  end if;
  if v_app.status <> 'pending' then raise exception 'Application already reviewed'; end if;

  if p_decision = 'accepted' then
    select count(*) into v_member_count from public.project_team_members where team_id = v_team.id;
    if v_member_count >= v_team.max_members then
      raise exception 'TEAM_FULL: this team has already reached its member limit';
    end if;
    if not exists (select 1 from public.project_team_members where team_id = v_team.id and user_id = v_app.applicant_id) then
      insert into public.project_team_members (team_id, user_id, role) values (v_team.id, v_app.applicant_id, 'member');
    end if;
    if v_member_count + 1 >= v_team.max_members then
      update public.project_teams set status = 'full' where id = v_team.id;
    end if;
  end if;

  update public.project_team_applications
    set status = p_decision, reviewed_by = v_user, reviewed_at = now()
    where id = p_application_id
    returning * into v_app;

  perform public.create_notification(
    v_app.applicant_id,
    case when p_decision = 'accepted' then 'Team application accepted' else 'Team application update' end,
    'Your application to "' || v_team.title || '" was ' || p_decision,
    'team', 'team_application', v_team.id::text
  );

  return v_app;
end;
$$;

create or replace function public.invite_to_team(p_team_id uuid, p_invitee_id uuid, p_message text default null)
returns public.project_team_invitations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_team public.project_teams;
  v_inv public.project_team_invitations;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if not public.check_rate_limit(v_user, 'team_invitations', 30, 3600) then
    raise exception 'RATE_LIMITED: too many invitations sent recently, try again later';
  end if;

  select * into v_team from public.project_teams where id = p_team_id for update;
  if not found then raise exception 'Team not found'; end if;
  if not (v_team.owner_id = v_user or public.current_user_is_admin()) then
    raise exception 'Not authorized to invite for this team';
  end if;
  if p_invitee_id = v_team.owner_id then raise exception 'That student already owns this team'; end if;
  if v_team.status not in ('recruiting') then raise exception 'TEAM_NOT_RECRUITING: this team is not accepting new members'; end if;

  if exists (select 1 from public.project_team_members where team_id = p_team_id and user_id = p_invitee_id) then
    raise exception 'That student is already a member of this team';
  end if;
  if exists (select 1 from public.project_team_invitations where team_id = p_team_id and invitee_id = p_invitee_id and status = 'pending') then
    raise exception 'That student already has a pending invitation to this team';
  end if;

  insert into public.project_team_invitations (team_id, inviter_id, invitee_id, message)
  values (p_team_id, v_user, p_invitee_id, p_message)
  returning * into v_inv;

  perform public.create_notification(
    p_invitee_id, 'Team invitation',
    (select name from public.profiles where id = v_user) || ' invited you to join "' || v_team.title || '"',
    'team', 'team_invitation', p_team_id::text
  );

  return v_inv;
end;
$$;

create or replace function public.cancel_team_invitation(p_invitation_id uuid)
returns public.project_team_invitations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_inv public.project_team_invitations;
  v_team public.project_teams;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  select * into v_inv from public.project_team_invitations where id = p_invitation_id for update;
  if not found then raise exception 'Invitation not found'; end if;
  select * into v_team from public.project_teams where id = v_inv.team_id;
  if not (v_inv.inviter_id = v_user or v_team.owner_id = v_user or public.current_user_is_admin()) then
    raise exception 'Not authorized to cancel this invitation';
  end if;
  if v_inv.status <> 'pending' then raise exception 'Only a pending invitation can be cancelled'; end if;

  update public.project_team_invitations set status = 'cancelled' where id = p_invitation_id returning * into v_inv;
  return v_inv;
end;
$$;

create or replace function public.respond_to_team_invitation(p_invitation_id uuid, p_decision text)
returns public.project_team_invitations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_inv public.project_team_invitations;
  v_team public.project_teams;
  v_member_count integer;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if p_decision not in ('accepted','declined') then raise exception 'Invalid decision %', p_decision; end if;

  select * into v_inv from public.project_team_invitations where id = p_invitation_id for update;
  if not found then raise exception 'Invitation not found'; end if;
  if v_inv.invitee_id <> v_user then raise exception 'Not your invitation'; end if;
  if v_inv.status <> 'pending' then raise exception 'Invitation already resolved'; end if;

  select * into v_team from public.project_teams where id = v_inv.team_id for update;
  if not found then raise exception 'Team not found'; end if;

  if p_decision = 'accepted' then
    if v_team.status <> 'recruiting' then raise exception 'TEAM_NOT_RECRUITING: this team is no longer accepting members'; end if;
    select count(*) into v_member_count from public.project_team_members where team_id = v_team.id;
    if v_member_count >= v_team.max_members then raise exception 'TEAM_FULL: this team has already reached its member limit'; end if;
    if not exists (select 1 from public.project_team_members where team_id = v_team.id and user_id = v_user) then
      insert into public.project_team_members (team_id, user_id, role) values (v_team.id, v_user, 'member');
    end if;
    if v_member_count + 1 >= v_team.max_members then
      update public.project_teams set status = 'full' where id = v_team.id;
    end if;
  end if;

  update public.project_team_invitations
    set status = p_decision, responded_at = now()
    where id = p_invitation_id
    returning * into v_inv;

  perform public.create_notification(
    v_inv.inviter_id, 'Team invitation response',
    (select name from public.profiles where id = v_user) || ' ' || p_decision || ' your invitation to "' || v_team.title || '"',
    'team', 'team_invitation', v_team.id::text
  );

  return v_inv;
end;
$$;

create or replace function public.remove_team_member(p_team_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_team public.project_teams;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  select * into v_team from public.project_teams where id = p_team_id for update;
  if not found then raise exception 'Team not found'; end if;
  if not (v_team.owner_id = v_user or public.current_user_is_admin()) then
    raise exception 'Not authorized to manage this team''s roster';
  end if;
  if p_user_id = v_team.owner_id then raise exception 'The owner cannot be removed -- delete the team instead'; end if;

  delete from public.project_team_members where team_id = p_team_id and user_id = p_user_id;
  if v_team.status = 'full' then
    update public.project_teams set status = 'recruiting' where id = p_team_id;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value)
  values (v_user, 'project_team.member.remove', 'project_team', p_team_id::text, jsonb_build_object('user_id', p_user_id));
end;
$$;

create or replace function public.leave_team(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_team public.project_teams;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  select * into v_team from public.project_teams where id = p_team_id for update;
  if not found then raise exception 'Team not found'; end if;
  if v_team.owner_id = v_user then
    raise exception 'OWNER_CANNOT_LEAVE: transfer ownership is not supported yet -- delete the team instead';
  end if;
  if not exists (select 1 from public.project_team_members where team_id = p_team_id and user_id = v_user) then
    raise exception 'You are not a member of this team';
  end if;

  delete from public.project_team_members where team_id = p_team_id and user_id = v_user;
  if v_team.status = 'full' then
    update public.project_teams set status = 'recruiting' where id = p_team_id;
  end if;
end;
$$;

-- One-call team detail: profile + roster (with names) + pending
-- applications/invitations if the caller is the owner/admin. Same
-- "one RPC for the whole dashboard" shape as get_club_dashboard().
create or replace function public.get_project_team(p_team_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_team public.project_teams;
  v_is_owner boolean;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  select * into v_team from public.project_teams where id = p_team_id;
  if not found then raise exception 'Team not found'; end if;
  v_is_owner := (v_team.owner_id = v_user or public.current_user_is_admin());

  return jsonb_build_object(
    'team', to_jsonb(v_team),
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id, 'user_id', p.id, 'name', p.name, 'avatar_url', p.avatar_url,
        'course', p.course, 'year', p.year, 'skills', p.skills, 'role', m.role, 'joined_at', m.joined_at
      ) order by m.role desc, m.joined_at), '[]'::jsonb)
      from public.project_team_members m join public.profiles p on p.id = m.user_id
      where m.team_id = p_team_id
    ),
    'applications', case when v_is_owner then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'applicant_id', p.id, 'name', p.name, 'avatar_url', p.avatar_url,
        'course', p.course, 'year', p.year, 'skills', p.skills, 'message', a.message,
        'status', a.status, 'created_at', a.created_at
      ) order by a.created_at desc), '[]'::jsonb)
      from public.project_team_applications a join public.profiles p on p.id = a.applicant_id
      where a.team_id = p_team_id and a.status = 'pending'
    ) else '[]'::jsonb end,
    'invitations', case when v_is_owner then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id, 'invitee_id', p.id, 'name', p.name, 'avatar_url', p.avatar_url,
        'status', i.status, 'created_at', i.created_at
      ) order by i.created_at desc), '[]'::jsonb)
      from public.project_team_invitations i join public.profiles p on p.id = i.invitee_id
      where i.team_id = p_team_id and i.status = 'pending'
    ) else '[]'::jsonb end,
    'my_application_status', (
      select a.status from public.project_team_applications a
      where a.team_id = p_team_id and a.applicant_id = v_user
      order by a.created_at desc limit 1
    ),
    'my_invitation_id', (
      select i.id from public.project_team_invitations i
      where i.team_id = p_team_id and i.invitee_id = v_user and i.status = 'pending'
      limit 1
    )
  );
end;
$$;

-- Browse/find-teammates board. Ranked by overlap between the caller's own
-- skills and each team's skills_needed -- "find me a team that needs my
-- skills" for free, no separate query needed.
create or replace function public.list_project_teams(
  p_campus_id uuid,
  p_status text default 'recruiting',
  p_category text default null,
  p_search text default null,
  p_limit integer default 30,
  p_cursor timestamptz default null
)
returns table (
  id uuid, owner_id uuid, owner_name text, title text, description text, category text, context text,
  skills_have text[], skills_needed text[], max_members integer, member_count integer,
  status text, deadline date, external_link text, created_at timestamptz, match_score integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_my_skills text[] := '{}';
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  -- `where profiles.id = ...`, not bare `id` -- this function's RETURNS
  -- TABLE(id uuid, ...) creates a same-named plpgsql OUT variable in scope
  -- for the whole body, and a bare `id` here is ambiguous against it
  -- (caught live: "column reference \"id\" is ambiguous").
  select skills into v_my_skills from public.profiles where profiles.id = v_user;
  v_my_skills := coalesce(v_my_skills, '{}');

  return query
  select
    t.id, t.owner_id, pr.name, t.title, t.description, t.category, t.context,
    t.skills_have, t.skills_needed, t.max_members,
    (select count(*)::int from public.project_team_members m where m.team_id = t.id),
    t.status, t.deadline, t.external_link, t.created_at,
    (
      select count(*)::int from unnest(t.skills_needed) s
      where exists (select 1 from unnest(v_my_skills) ms where lower(ms) = lower(s))
    ) as match_score
  from public.project_teams t
  join public.profiles pr on pr.id = t.owner_id
  where t.campus_id = p_campus_id
    and (p_status is null or t.status = p_status)
    and (p_category is null or t.category = p_category)
    and (p_search is null or p_search = '' or (
      t.title ilike '%' || p_search || '%'
      or t.description ilike '%' || p_search || '%'
      or exists (select 1 from unnest(t.skills_needed) s where s ilike '%' || p_search || '%')
    ))
    and (p_cursor is null or t.created_at < p_cursor)
  order by match_score desc, t.created_at desc
  limit least(coalesce(p_limit, 30), 100);
end;
$$;

-- Skill-matching for a team owner: "I need a React developer and an
-- embedded systems person" -- rank students by overlap with skills_needed.
create or replace function public.get_team_candidates(p_team_id uuid, p_limit integer default 20)
returns table (
  id uuid, name text, course text, department text, year text, avatar_url text,
  skills text[], match_score integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_team public.project_teams;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  -- Same "RETURNS TABLE(id uuid, ...) shadows bare id" pitfall as
  -- list_project_teams above -- qualify explicitly.
  select * into v_team from public.project_teams where project_teams.id = p_team_id;
  if not found then raise exception 'Team not found'; end if;
  if not (v_team.owner_id = v_user or public.current_user_is_admin()) then
    raise exception 'Not authorized to view candidates for this team';
  end if;

  return query
  select
    p.id, p.name, p.course, p.department, p.year, p.avatar_url, p.skills,
    (
      select count(*)::int from unnest(v_team.skills_needed) s
      where exists (select 1 from unnest(p.skills) ps where lower(ps) = lower(s))
    ) as match_score
  from public.profiles p
  where p.campus_id = v_team.campus_id
    and p.id <> v_team.owner_id
    and p.status = 'active'
    and p.privacy_level in ('public','campus')
    and p.open_to_projects = true
    and not exists (select 1 from public.project_team_members m where m.team_id = p_team_id and m.user_id = p.id)
    and not exists (select 1 from public.project_team_invitations i where i.team_id = p_team_id and i.invitee_id = p.id and i.status = 'pending')
  order by match_score desc, p.name
  limit least(coalesce(p_limit, 20), 50);
end;
$$;

-- Teams I own or belong to, plus how many pending applications/invitations
-- need my attention as owner -- powers a "My Teams" tab + badge count.
create or replace function public.get_my_teams()
returns table (
  id uuid, title text, category text, status text, role text,
  member_count integer, max_members integer, pending_applications integer, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Sign in required'; end if;

  return query
  select
    t.id, t.title, t.category, t.status, m.role,
    (select count(*)::int from public.project_team_members m2 where m2.team_id = t.id),
    t.max_members,
    case when m.role = 'owner' then
      (select count(*)::int from public.project_team_applications a where a.team_id = t.id and a.status = 'pending')
    else 0 end,
    t.created_at
  from public.project_team_members m
  join public.project_teams t on t.id = m.team_id
  where m.user_id = v_user
  order by t.created_at desc;
end;
$$;

-- Pending invitations addressed to me, with team context.
create or replace function public.get_my_team_invitations()
returns table (
  id uuid, team_id uuid, team_title text, inviter_id uuid, inviter_name text,
  message text, created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.team_id, t.title, i.inviter_id, p.name, i.message, i.created_at
  from public.project_team_invitations i
  join public.project_teams t on t.id = i.team_id
  join public.profiles p on p.id = i.inviter_id
  where i.invitee_id = auth.uid() and i.status = 'pending'
  order by i.created_at desc;
$$;

-- =========================================================
-- Grants -- explicit revoke from public/anon on every function here, per
-- the lesson from 20260816000200_smart_search.sql: newly-created
-- functions in this project pick up an EXECUTE grant to PUBLIC (and
-- therefore anon) by default, so a plain `grant ... to authenticated`
-- alone is not sufficient defense in depth.
-- =========================================================

grant execute on function public.create_project_team(text, text, text, text, text[], text[], integer, date, text) to authenticated;
grant execute on function public.delete_project_team(uuid) to authenticated;
grant execute on function public.apply_to_team(uuid, text) to authenticated;
grant execute on function public.withdraw_team_application(uuid) to authenticated;
grant execute on function public.review_team_application(uuid, text) to authenticated;
grant execute on function public.invite_to_team(uuid, uuid, text) to authenticated;
grant execute on function public.cancel_team_invitation(uuid) to authenticated;
grant execute on function public.respond_to_team_invitation(uuid, text) to authenticated;
grant execute on function public.remove_team_member(uuid, uuid) to authenticated;
grant execute on function public.leave_team(uuid) to authenticated;
grant execute on function public.get_project_team(uuid) to authenticated;
grant execute on function public.list_project_teams(uuid, text, text, text, integer, timestamptz) to authenticated;
grant execute on function public.get_team_candidates(uuid, integer) to authenticated;
grant execute on function public.get_my_teams() to authenticated;
grant execute on function public.get_my_team_invitations() to authenticated;

revoke all on function public.create_project_team(text, text, text, text, text[], text[], integer, date, text) from public, anon;
revoke all on function public.delete_project_team(uuid) from public, anon;
revoke all on function public.apply_to_team(uuid, text) from public, anon;
revoke all on function public.withdraw_team_application(uuid) from public, anon;
revoke all on function public.review_team_application(uuid, text) from public, anon;
revoke all on function public.invite_to_team(uuid, uuid, text) from public, anon;
revoke all on function public.cancel_team_invitation(uuid) from public, anon;
revoke all on function public.respond_to_team_invitation(uuid, text) from public, anon;
revoke all on function public.remove_team_member(uuid, uuid) from public, anon;
revoke all on function public.leave_team(uuid) from public, anon;
revoke all on function public.get_project_team(uuid) from public, anon;
revoke all on function public.list_project_teams(uuid, text, text, text, integer, timestamptz) from public, anon;
revoke all on function public.get_team_candidates(uuid, integer) from public, anon;
revoke all on function public.get_my_teams() from public, anon;
revoke all on function public.get_my_team_invitations() from public, anon;
