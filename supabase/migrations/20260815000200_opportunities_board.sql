-- =============================================================================
-- OPPORTUNITIES BOARD AS REAL DATA (doc §109)
-- Was entirely fake: `opportunities`/`mentors` in src/App.jsx are hardcoded
-- arrays, "View" on an opportunity just fires a notify() toast, and
-- "Mentor request" does the same -- no request ever went anywhere. This
-- gives both their own tables plus a real request/application flow.
--
-- Scope decision: opportunities/mentors are admin-curated (same trust
-- level as announcements -- current_user_is_admin() gates writes, no new
-- permission key needed), not open to student self-posting. Mentors are a
-- curated directory, not necessarily platform accounts (a listed mentor
-- may be a faculty member with no login) -- mentor_requests always
-- notifies admins as the human-in-the-loop fallback, and additionally
-- notifies the mentor's own account if one is linked (profile_id).
-- =============================================================================

create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid references public.campuses(id) on delete cascade,
  posted_by uuid references public.profiles(id) on delete set null,
  company text not null,
  role text not null,
  type text not null default 'Internship'
    check (type in ('Internship', 'Research', 'Job', 'Volunteer', 'Competition')),
  description text not null default '',
  tags text[] not null default '{}',
  deadline date,
  apply_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists opportunities_set_updated_at on public.opportunities;
create trigger opportunities_set_updated_at
before update on public.opportunities
for each row execute function public.set_updated_at();

create table if not exists public.opportunity_applications (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  message text,
  status text not null default 'submitted'
    check (status in ('submitted', 'reviewed', 'shortlisted', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (opportunity_id, user_id)
);

drop trigger if exists opportunity_applications_set_updated_at on public.opportunity_applications;
create trigger opportunity_applications_set_updated_at
before update on public.opportunity_applications
for each row execute function public.set_updated_at();

create table if not exists public.mentors (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid references public.campuses(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null, -- set only if the mentor is a real platform account
  added_by uuid references public.profiles(id) on delete set null,
  name text not null,
  role text not null,
  skills text[] not null default '{}',
  bio text,
  contact_email text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.mentor_requests (
  id uuid primary key default gen_random_uuid(),
  mentor_id uuid not null references public.mentors(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  message text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now()
);

create index if not exists opportunities_campus_idx on public.opportunities(campus_id);
create index if not exists opportunity_applications_opportunity_idx on public.opportunity_applications(opportunity_id);
create index if not exists opportunity_applications_user_idx on public.opportunity_applications(user_id);
create index if not exists mentors_campus_idx on public.mentors(campus_id);
create index if not exists mentor_requests_mentor_idx on public.mentor_requests(mentor_id);
create index if not exists mentor_requests_user_idx on public.mentor_requests(user_id);

-- =========================================================
-- RLS
-- =========================================================

alter table public.opportunities enable row level security;
alter table public.opportunity_applications enable row level security;
alter table public.mentors enable row level security;
alter table public.mentor_requests enable row level security;

create policy "opportunities_read" on public.opportunities for select to anon, authenticated using (active);
create policy "opportunities_write" on public.opportunities for all to authenticated
  using (public.current_user_is_admin()) with check (public.current_user_is_admin());

-- Reads only -- writes are RPC-only (apply_to_opportunity), same
-- "no insert policy for authenticated" pattern used everywhere else.
create policy "opportunity_applications_read" on public.opportunity_applications for select to authenticated
  using (
    user_id = auth.uid()
    or public.current_user_is_admin()
    or exists (select 1 from public.opportunities o where o.id = opportunity_applications.opportunity_id and o.posted_by = auth.uid())
  );
create policy "opportunity_applications_admin_update" on public.opportunity_applications for update to authenticated
  using (
    public.current_user_is_admin()
    or exists (select 1 from public.opportunities o where o.id = opportunity_applications.opportunity_id and o.posted_by = auth.uid())
  )
  with check (
    public.current_user_is_admin()
    or exists (select 1 from public.opportunities o where o.id = opportunity_applications.opportunity_id and o.posted_by = auth.uid())
  );

create policy "mentors_read" on public.mentors for select to anon, authenticated using (active);
create policy "mentors_write" on public.mentors for all to authenticated
  using (public.current_user_is_admin()) with check (public.current_user_is_admin());

create policy "mentor_requests_read" on public.mentor_requests for select to authenticated
  using (
    user_id = auth.uid()
    or public.current_user_is_admin()
    or exists (select 1 from public.mentors m where m.id = mentor_requests.mentor_id and m.profile_id = auth.uid())
  );

-- =========================================================
-- RPC: apply_to_opportunity -- re-applying edits the existing application
-- (message) instead of erroring, same "on conflict do update" shape as
-- register_for_event()'s re-registration handling.
-- =========================================================

create or replace function public.apply_to_opportunity(p_opportunity_id uuid, p_message text default null)
returns public.opportunity_applications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_app public.opportunity_applications;
  v_opportunity record;
  v_applicant_name text;
begin
  if v_user is null then raise exception 'Sign in required'; end if;

  if not public.check_rate_limit(v_user, 'opportunity_applications', 20, 3600) then
    raise exception 'RATE_LIMITED: too many applications submitted, slow down';
  end if;

  select id, role, posted_by, active into v_opportunity from public.opportunities where id = p_opportunity_id;
  if not found or not v_opportunity.active then
    raise exception 'This opportunity is no longer accepting applications';
  end if;

  insert into public.opportunity_applications (opportunity_id, user_id, message)
  values (p_opportunity_id, v_user, p_message)
  on conflict (opportunity_id, user_id) do update set message = excluded.message
  returning * into v_app;

  if v_opportunity.posted_by is not null then
    select name into v_applicant_name from public.profiles where id = v_user;
    perform public.create_notification(
      v_opportunity.posted_by, 'New application: ' || v_opportunity.role,
      coalesce(v_applicant_name, 'A student') || ' applied to ' || v_opportunity.role,
      'official', 'opportunity_application', v_app.id::text
    );
  end if;

  return v_app;
end;
$$;

-- =========================================================
-- RPC: request_mentor -- always notifies admins (mentors are a curated
-- directory, not guaranteed to have a login), and additionally the
-- mentor's own account if one is linked. Returns the mentor's profile_id
-- so the frontend can offer to open a real conversation when there is one.
-- =========================================================

create or replace function public.request_mentor(p_mentor_id uuid, p_message text default null)
returns table (request_id uuid, mentor_profile_id uuid, mentor_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_mentor record;
  v_request_id uuid;
  v_requester_name text;
  v_admin record;
begin
  if v_user is null then raise exception 'Sign in required'; end if;

  if not public.check_rate_limit(v_user, 'mentor_requests', 20, 3600) then
    raise exception 'RATE_LIMITED: too many requests submitted, slow down';
  end if;

  select id, name, profile_id, active into v_mentor from public.mentors where id = p_mentor_id;
  if not found or not v_mentor.active then
    raise exception 'This mentor is not currently available';
  end if;

  insert into public.mentor_requests (mentor_id, user_id, message)
  values (p_mentor_id, v_user, p_message)
  returning id into v_request_id;

  select name into v_requester_name from public.profiles where id = v_user;

  for v_admin in
    select ur.user_id from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where r.key in ('college_admin', 'super_admin')
  loop
    perform public.create_notification(
      v_admin.user_id, 'New mentorship request',
      coalesce(v_requester_name, 'A student') || ' wants to connect with ' || v_mentor.name,
      'official', 'mentor_request', v_request_id::text
    );
  end loop;

  if v_mentor.profile_id is not null then
    perform public.create_notification(
      v_mentor.profile_id, 'New mentorship request',
      coalesce(v_requester_name, 'A student') || ' wants your mentorship',
      'official', 'mentor_request', v_request_id::text
    );
  end if;

  return query select v_request_id, v_mentor.profile_id, v_mentor.name;
end;
$$;

grant execute on function public.apply_to_opportunity(uuid, text) to authenticated;
grant execute on function public.request_mentor(uuid, text) to authenticated;

-- =========================================================
-- Suspension enforcement + realtime, same idioms already used everywhere
-- else in this schema. Both new request/application tables' owning column
-- is `user_id`, which is reject_if_suspended()'s default branch already --
-- no function change needed.
-- =========================================================

drop trigger if exists opportunity_applications_reject_if_suspended on public.opportunity_applications;
create trigger opportunity_applications_reject_if_suspended
before insert on public.opportunity_applications
for each row execute function public.reject_if_suspended();

drop trigger if exists mentor_requests_reject_if_suspended on public.mentor_requests;
create trigger mentor_requests_reject_if_suspended
before insert on public.mentor_requests
for each row execute function public.reject_if_suspended();

do $$
declare
  t text;
  tables text[] := array['opportunities', 'opportunity_applications', 'mentors', 'mentor_requests'];
begin
  foreach t in array tables loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
