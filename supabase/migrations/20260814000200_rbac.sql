-- =============================================================================
-- 0002: RBAC -- roles / permissions / role_permissions / user_roles (doc §8)
-- profiles.role stays as the fast display column; these tables are the real
-- enforcement layer used by RLS policies and RPC functions everywhere else.
-- =============================================================================

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  name text not null,
  description text
);

create table if not exists public.permissions (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  description text
);

create table if not exists public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  campus_id uuid references public.campuses(id) on delete cascade,
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  unique (user_id, role_id, campus_id)
);

create index if not exists user_roles_user_idx on public.user_roles(user_id);

-- =========================================================
-- SEED ROLES (mirrors profiles.role check constraint)
-- =========================================================

insert into public.roles (key, name, description) values
  ('student', 'Student', 'Default campus member'),
  ('club_admin', 'Club Admin', 'Manages a club, its events and posts'),
  ('vendor', 'Vendor', 'Runs a canteen, store or print counter'),
  ('facilities_staff', 'Facilities Staff', 'Handles maintenance and service tickets'),
  ('college_admin', 'College Admin', 'Controls campus-wide operations'),
  ('super_admin', 'Super Admin', 'Platform-level management')
on conflict (key) do nothing;

-- =========================================================
-- SEED PERMISSIONS (scoped to modules covered in this hardening pass)
-- =========================================================

insert into public.permissions (key, description) values
  ('food.menu.read', 'View canteen menus'),
  ('food.menu.write', 'Create/edit/archive food items'),
  ('food.orders.read', 'View orders for a canteen'),
  ('food.orders.update', 'Advance an order through its state machine'),
  ('food.refunds.create', 'Issue a refund for a food order'),
  ('events.create', 'Create events'),
  ('events.update', 'Edit events'),
  ('events.delete', 'Cancel/delete events'),
  ('events.checkin', 'Check students in at an event'),
  ('clubs.manage', 'Manage club membership, posts and settings'),
  ('services.manage', 'Manage the service catalog'),
  ('tickets.read', 'View facilities/service tickets'),
  ('tickets.update', 'Triage, assign, resolve tickets'),
  ('bookings.approve', 'Approve resource bookings that require approval'),
  ('print.manage', 'Operate the print queue'),
  ('moderation.act', 'Hide/remove content, warn/suspend users'),
  ('users.read', 'Search/view user profiles beyond public fields'),
  ('users.suspend', 'Suspend/reactivate user accounts'),
  ('users.roles.manage', 'Grant/revoke roles'),
  ('analytics.read', 'View platform/vendor analytics'),
  ('finance.read', 'View payment/payout ledgers'),
  ('audit.read', 'Read the full audit log')
on conflict (key) do nothing;

-- =========================================================
-- SEED ROLE -> PERMISSION MAPPING
-- =========================================================

with rp as (
  select r.id as role_id, p.id as permission_id
  from public.roles r
  join public.permissions p on true
  where
    (r.key = 'super_admin') -- super_admin gets everything
    or (r.key = 'college_admin' and p.key <> 'users.roles.manage')
    or (r.key = 'club_admin' and p.key in ('events.create','events.update','events.delete','events.checkin','clubs.manage'))
    or (r.key = 'vendor' and p.key in ('food.menu.read','food.menu.write','food.orders.read','food.orders.update','food.refunds.create','print.manage','analytics.read'))
    or (r.key = 'facilities_staff' and p.key in ('tickets.read','tickets.update','bookings.approve'))
    or (r.key = 'student' and p.key in ('food.menu.read'))
)
insert into public.role_permissions (role_id, permission_id)
select role_id, permission_id from rp
on conflict do nothing;

-- =========================================================
-- AUDIT LOG (doc §59/§103) -- created here because admin_set_user_role
-- below needs it; every other privileged mutation in later migrations
-- writes into this same table.
-- =========================================================

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_role text,
  action text not null,
  entity_type text,
  entity_id text,
  old_value jsonb,
  new_value jsonb,
  reason text,
  ip_address text,
  created_at timestamptz not null default now()
);

-- This project's live audit_logs predates every schema file in this repo
-- (it has its own legacy shape: user_id/table_name/record_id/details) --
-- `create table if not exists` above was a no-op against it, so every
-- column this migration set relies on is added explicitly here instead of
-- being assumed from the CREATE TABLE.
alter table public.audit_logs add column if not exists actor_id uuid references public.profiles(id) on delete set null;
alter table public.audit_logs add column if not exists action text;
alter table public.audit_logs add column if not exists entity_type text;
alter table public.audit_logs add column if not exists entity_id text;
alter table public.audit_logs add column if not exists old_value jsonb;
alter table public.audit_logs add column if not exists new_value jsonb;
alter table public.audit_logs add column if not exists reason text;
alter table public.audit_logs add column if not exists ip_address text;
alter table public.audit_logs add column if not exists actor_role text;
alter table public.audit_logs add column if not exists created_at timestamptz not null default now();
update public.audit_logs set action = coalesce(action, 'legacy') where action is null;
alter table public.audit_logs alter column action set not null;

-- Backfill actor_id from the legacy user_id column, if one exists.
do $$ begin
  update public.audit_logs set actor_id = user_id where actor_id is null;
exception when undefined_column then null;
end $$;

create index if not exists audit_logs_actor_idx on public.audit_logs(actor_id);
create index if not exists audit_logs_entity_idx on public.audit_logs(entity_type, entity_id);
create index if not exists audit_logs_created_idx on public.audit_logs(created_at desc);

-- =========================================================
-- HELPER FUNCTIONS used throughout RLS policies and RPCs
-- =========================================================

create or replace function public.has_permission(p_user uuid, p_permission text, p_campus uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.permissions p on p.id = rp.permission_id
    where ur.user_id = p_user
      and p.key = p_permission
      and (p_campus is null or ur.campus_id is null or ur.campus_id = p_campus)
  );
$$;

create or replace function public.has_role(p_user uuid, p_role_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = p_user and r.key = p_role_key
  );
$$;

create or replace function public.current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role(auth.uid(), 'college_admin') or public.has_role(auth.uid(), 'super_admin');
$$;

-- Keep user_roles in sync whenever profiles.role changes, so the RBAC tables
-- never drift from the legacy display column.
create or replace function public.sync_user_roles_from_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_role_id uuid;
begin
  select id into target_role_id from public.roles where key = new.role;
  if target_role_id is null then
    return new;
  end if;

  -- Remove any campus-unscoped role rows that no longer match, then ensure
  -- the current role is present.
  delete from public.user_roles
  where user_id = new.id and campus_id is null and role_id <> target_role_id;

  insert into public.user_roles (user_id, role_id, campus_id)
  values (new.id, target_role_id, null)
  on conflict (user_id, role_id, campus_id) do nothing;

  return new;
end;
$$;

drop trigger if exists profiles_sync_user_roles on public.profiles;
create trigger profiles_sync_user_roles
after insert or update of role on public.profiles
for each row execute function public.sync_user_roles_from_profile();

-- The single, audited entry point for changing a user's role (doc §55/§103).
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

  if p_new_role not in ('student','club_admin','vendor','facilities_staff','college_admin','super_admin') then
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
