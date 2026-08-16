-- =============================================================================
-- 0057: CAMPUS EMERGENCY DIRECTORY (doc §113, second half of the gap left
-- open by 0056/20260815000700_emergency_contacts.sql)
-- =============================================================================
-- 0056 built a verified *next-of-kin* directory (who to call on a student's
-- behalf). This migration builds the other half the doc actually asked for:
-- a verified directory of *campus office* contacts -- Security, Medical,
-- Admin, Facilities, Transport, Hostel, Emergency Response, Campus
-- Management -- so a student (or a responder) knows who to call, whether
-- they're open right now, and where they physically are, without leaving
-- the app. Read-visible to any signed-in user (this is safety information,
-- not something to gate behind a permission); writes are RPC-only, same
-- rationale as 0056's header comment (a raw UPDATE would make "verified"
-- trivially spoofable).

create table if not exists public.campus_emergency_directory (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid references public.campuses(id) on delete cascade, -- null = applies to every campus (e.g. a national helpline)
  category text not null check (category in (
    'security', 'medical', 'admin', 'facilities', 'transport',
    'hostel', 'emergency_response', 'campus_management'
  )),
  name text not null,
  designation text, -- e.g. "Chief Security Officer" / "Campus Security Desk"
  description text,
  phone text not null,
  alt_phone text,
  email text,
  location text, -- building/room/landmark, free text
  priority text not null default 'standard' check (priority in ('critical', 'high', 'standard')),
  is_24x7 boolean not null default false,
  -- {"mon": ["09:00","17:00"], "tue": [...], ...} -- a missing/null day means
  -- closed that day. Only consulted when is_24x7 is false. Kept as jsonb
  -- (not 7 separate columns) so the frontend can compute "open now" without
  -- a schema change if a future entry needs split shifts.
  weekly_hours jsonb,
  hours_note text, -- free-text fallback for irregular schedules ("by appointment")
  verified boolean not null default false,
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  verification_notes text,
  active boolean not null default true,
  display_order integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists campus_emergency_directory_campus_idx on public.campus_emergency_directory(campus_id, active);
create index if not exists campus_emergency_directory_category_idx on public.campus_emergency_directory(category, active);

drop trigger if exists campus_emergency_directory_set_updated_at on public.campus_emergency_directory;
create trigger campus_emergency_directory_set_updated_at
before update on public.campus_emergency_directory
for each row execute function public.set_updated_at();

alter table public.campus_emergency_directory enable row level security;

-- No direct write policy, by design -- see header comment. Read: active
-- entries are visible to any signed-in user (this is public safety info),
-- inactive/unverified-pending entries are only visible to whoever can
-- manage the directory, so a deactivated office doesn't linger for students.
create policy "campus_emergency_directory_read" on public.campus_emergency_directory for select to authenticated
  using (
    active
    or public.has_permission(auth.uid(), 'emergency_directory.manage')
    or public.current_user_is_admin()
  );

insert into public.permissions (key, description) values
  ('emergency_directory.manage', 'Add, edit, verify and deactivate campus emergency office directory entries')
on conflict (key) do nothing;

with rp as (
  select r.id as role_id, p.id as permission_id
  from public.roles r
  join public.permissions p on p.key = 'emergency_directory.manage'
  where r.key in ('facilities_staff', 'college_admin', 'super_admin')
)
insert into public.role_permissions (role_id, permission_id)
select role_id, permission_id from rp
on conflict do nothing;

-- =========================================================
-- RPC: list_emergency_directory -- the student-facing read. Plain RLS
-- already scopes visibility; this RPC's only job is resolving "my campus
-- or campus-agnostic" server-side (rather than every call site re-deriving
-- profiles.campus_id + an OR filter) and a sane display order.
-- =========================================================

create or replace function public.list_emergency_directory()
returns setof public.campus_emergency_directory
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_campus uuid;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;
  select p.campus_id into v_campus from public.profiles p where p.id = v_user;

  return query
    select d.* from public.campus_emergency_directory d
    where d.active
      and (d.campus_id is null or d.campus_id = v_campus)
    order by
      case d.priority when 'critical' then 0 when 'high' then 1 else 2 end,
      case d.category
        when 'emergency_response' then 0 when 'security' then 1 when 'medical' then 2
        when 'facilities' then 3 when 'hostel' then 4 when 'transport' then 5
        when 'admin' then 6 else 7
      end,
      d.display_order, d.name;
end;
$$;

grant execute on function public.list_emergency_directory() to authenticated;

-- =========================================================
-- RPC: admin_list_emergency_directory -- the management view (every entry
-- for the caller's campus + campus-agnostic ones, active or not).
-- =========================================================

create or replace function public.admin_list_emergency_directory()
returns setof public.campus_emergency_directory
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if not (public.has_permission(v_user, 'emergency_directory.manage') or public.current_user_is_admin()) then
    raise exception 'Not authorized to manage the emergency directory';
  end if;

  return query
    select d.* from public.campus_emergency_directory d
    order by d.active desc, d.category, d.display_order, d.name;
end;
$$;

grant execute on function public.admin_list_emergency_directory() to authenticated;

-- =========================================================
-- RPC: upsert_emergency_directory_entry -- create/edit. Editing an
-- already-verified entry resets it back to unverified, same rationale as
-- upsert_emergency_contact(): verification means "we confirmed *this exact*
-- number/hours are correct", which a silent edit invalidates.
-- =========================================================

create or replace function public.upsert_emergency_directory_entry(
  p_id uuid default null,
  p_category text default null,
  p_name text default null,
  p_designation text default null,
  p_description text default null,
  p_phone text default null,
  p_alt_phone text default null,
  p_email text default null,
  p_location text default null,
  p_priority text default 'standard',
  p_is_24x7 boolean default false,
  p_weekly_hours jsonb default null,
  p_hours_note text default null,
  p_campus_id uuid default null,
  p_display_order integer default 0
)
returns public.campus_emergency_directory
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_existing public.campus_emergency_directory;
  v_row public.campus_emergency_directory;
begin
  if not (public.has_permission(v_user, 'emergency_directory.manage') or public.current_user_is_admin()) then
    raise exception 'Not authorized to manage the emergency directory';
  end if;
  if p_category not in ('security', 'medical', 'admin', 'facilities', 'transport', 'hostel', 'emergency_response', 'campus_management') then
    raise exception 'Invalid category';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Name is required';
  end if;
  if p_phone is null or p_phone !~ '^\+?[0-9]{3,15}$' then
    raise exception 'Enter a valid phone number';
  end if;
  if p_alt_phone is not null and length(trim(p_alt_phone)) > 0 and p_alt_phone !~ '^\+?[0-9]{3,15}$' then
    raise exception 'Enter a valid alternate phone number, or leave it blank';
  end if;
  if p_priority not in ('critical', 'high', 'standard') then
    raise exception 'Invalid priority';
  end if;

  if p_id is not null then
    select * into v_existing from public.campus_emergency_directory where id = p_id;
    if not found then
      raise exception 'Directory entry not found';
    end if;
  end if;

  if p_id is not null then
    update public.campus_emergency_directory set
      category = p_category,
      name = trim(p_name),
      designation = nullif(trim(coalesce(p_designation, '')), ''),
      description = nullif(trim(coalesce(p_description, '')), ''),
      phone = trim(p_phone),
      alt_phone = nullif(trim(coalesce(p_alt_phone, '')), ''),
      email = nullif(trim(coalesce(p_email, '')), ''),
      location = nullif(trim(coalesce(p_location, '')), ''),
      priority = p_priority,
      is_24x7 = p_is_24x7,
      weekly_hours = case when p_is_24x7 then null else p_weekly_hours end,
      hours_note = nullif(trim(coalesce(p_hours_note, '')), ''),
      campus_id = p_campus_id,
      display_order = p_display_order,
      -- editing resets verification -- see header comment.
      verified = false, verified_by = null, verified_at = null, verification_notes = null
    where id = p_id
    returning * into v_row;
  else
    insert into public.campus_emergency_directory (
      campus_id, category, name, designation, description, phone, alt_phone, email,
      location, priority, is_24x7, weekly_hours, hours_note, display_order, created_by
    ) values (
      p_campus_id, p_category, trim(p_name), nullif(trim(coalesce(p_designation, '')), ''),
      nullif(trim(coalesce(p_description, '')), ''), trim(p_phone),
      nullif(trim(coalesce(p_alt_phone, '')), ''), nullif(trim(coalesce(p_email, '')), ''),
      nullif(trim(coalesce(p_location, '')), ''), p_priority, p_is_24x7,
      case when p_is_24x7 then null else p_weekly_hours end,
      nullif(trim(coalesce(p_hours_note, '')), ''), p_display_order, v_user
    ) returning * into v_row;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id)
  values (v_user, case when p_id is null then 'emergency_directory.create' else 'emergency_directory.update' end, 'emergency_directory_entry', v_row.id::text);

  return v_row;
end;
$$;

grant execute on function public.upsert_emergency_directory_entry(
  uuid, text, text, text, text, text, text, text, text, text, boolean, jsonb, text, uuid, integer
) to authenticated;

-- =========================================================
-- RPC: verify_emergency_directory_entry -- the review side, same shape as
-- verify_emergency_contact().
-- =========================================================

create or replace function public.verify_emergency_directory_entry(
  p_id uuid,
  p_verified boolean,
  p_notes text default null
)
returns public.campus_emergency_directory
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.campus_emergency_directory;
begin
  if not (public.has_permission(v_user, 'emergency_directory.manage') or public.current_user_is_admin()) then
    raise exception 'Not authorized to verify emergency directory entries';
  end if;

  update public.campus_emergency_directory set
    verified = p_verified,
    verified_by = case when p_verified then v_user else null end,
    verified_at = case when p_verified then now() else null end,
    verification_notes = p_notes
  where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'Directory entry not found';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, reason)
  values (v_user, case when p_verified then 'emergency_directory.verify' else 'emergency_directory.unverify' end, 'emergency_directory_entry', p_id::text, p_notes);

  return v_row;
end;
$$;

grant execute on function public.verify_emergency_directory_entry(uuid, boolean, text) to authenticated;

-- =========================================================
-- RPC: set_emergency_directory_active -- deactivate/reactivate. A soft
-- delete rather than a hard one -- these are public-safety records, so a
-- retired office desk keeps an audit trail instead of vanishing outright.
-- =========================================================

create or replace function public.set_emergency_directory_active(p_id uuid, p_active boolean)
returns public.campus_emergency_directory
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.campus_emergency_directory;
begin
  if not (public.has_permission(v_user, 'emergency_directory.manage') or public.current_user_is_admin()) then
    raise exception 'Not authorized to manage the emergency directory';
  end if;

  update public.campus_emergency_directory set active = p_active
  where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'Directory entry not found';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id)
  values (v_user, case when p_active then 'emergency_directory.activate' else 'emergency_directory.deactivate' end, 'emergency_directory_entry', p_id::text);

  return v_row;
end;
$$;

grant execute on function public.set_emergency_directory_active(uuid, boolean) to authenticated;

-- Defense in depth against the "newly-created function grants EXECUTE to
-- PUBLIC/anon by default" gotcha documented in 20260816000200_smart_search.sql.
revoke execute on function public.list_emergency_directory() from public, anon;
revoke execute on function public.admin_list_emergency_directory() from public, anon;
revoke execute on function public.upsert_emergency_directory_entry(
  uuid, text, text, text, text, text, text, text, text, text, boolean, jsonb, text, uuid, integer
) from public, anon;
revoke execute on function public.verify_emergency_directory_entry(uuid, boolean, text) from public, anon;
revoke execute on function public.set_emergency_directory_active(uuid, boolean) from public, anon;
