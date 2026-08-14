-- =============================================================================
-- 0001: EXTENSIONS, CAMPUSES, PROFILES, STUDENT VERIFICATION
-- Canonical, idempotent. Safe to run against the existing populated database.
-- Supersedes: src/supabase/archive/*.sql (kept for historical reference only).
-- =============================================================================

create extension if not exists pgcrypto;
create extension if not exists btree_gist; -- needed for booking overlap exclusion constraints
create extension if not exists pg_trgm;    -- needed for fuzzy/full-text search

-- Generic updated_at trigger helper, reused by every table below.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================================================
-- CAMPUSES
-- =========================================================

create table if not exists public.campuses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  domain text,                      -- e.g. 'nhce.edu.in' for email-domain verification
  timezone text not null default 'Asia/Kolkata',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.campuses add column if not exists domain text;
alter table public.campuses add column if not exists timezone text not null default 'Asia/Kolkata';
alter table public.campuses add column if not exists active boolean not null default true;

insert into public.campuses (name, slug, domain)
values ('New Horizon College of Engineering', 'nhce', 'nhce.edu.in')
on conflict (slug) do update set name = excluded.name;

-- =========================================================
-- PROFILES
-- profiles.role remains the fast/legacy single-role column for backward
-- compatibility with existing frontend code; the real enforcement layer is
-- the RBAC tables in 0002_rbac.sql, kept in sync via trigger.
-- =========================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  campus_id uuid references public.campuses(id) on delete set null,
  name text not null default 'Campus Student',
  email text,
  usn text,
  course text,
  department text,
  year text,
  avatar_url text,
  bio text,
  skills text[] not null default '{}',
  role text not null default 'student'
    check (role in ('student', 'club_admin', 'vendor', 'facilities_staff', 'college_admin', 'super_admin')),
  open_to_projects boolean not null default false,
  privacy_level text not null default 'campus'
    check (privacy_level in ('public', 'campus', 'limited', 'private')),
  status text not null default 'active'
    check (status in ('active', 'suspended', 'deleted')),
  suspended_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Backfill columns for pre-existing installs (older schema versions used a
-- free-standing uuid PK unrelated to auth.users -- profiles.id must reference
-- auth.users for RLS auth.uid() checks to mean anything, so this is enforced
-- going forward for all new rows; existing demo rows are left as-is and will
-- simply have no matching auth user, which the RLS policies in 0011 handle
-- safely by never granting write access to rows the caller doesn't own).
alter table public.profiles add column if not exists department text;
alter table public.profiles add column if not exists privacy_level text not null default 'campus';
alter table public.profiles add column if not exists status text not null default 'active';
alter table public.profiles add column if not exists suspended_reason text;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- Auto-create a profile row whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, email, usn, course, year)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(coalesce(new.email,''),'@',1), 'Campus Student'),
    new.email,
    coalesce(new.raw_user_meta_data->>'usn', ''),
    coalesce(new.raw_user_meta_data->>'course', ''),
    coalesce(new.raw_user_meta_data->>'year', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Role changes must NEVER be self-service. The previous version of this
-- trigger only blocked the change when auth.uid() IS NOT NULL, which meant
-- an anonymous (unauthenticated) request could freely escalate a profile to
-- super_admin. Role changes are now only permitted through
-- public.admin_set_user_role() (see 0002_rbac.sql), which runs as
-- security definer and is itself gated by has_permission().
create or replace function public.protect_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role
     and coalesce(current_setting('campusos.allow_role_change', true), 'false') <> 'true' then
    raise exception 'Role changes must go through admin_set_user_role()';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role
before update on public.profiles
for each row execute function public.protect_profile_role();

-- =========================================================
-- STUDENT IDENTITY VERIFICATION (doc §7)
-- =========================================================

create table if not exists public.student_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  campus_id uuid not null references public.campuses(id) on delete cascade,
  student_id text,
  usn text,
  verification_method text not null default 'college_email'
    check (verification_method in ('college_email', 'document_upload', 'manual', 'sso')),
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'rejected')),
  verified_at timestamptz,
  verified_by uuid references public.profiles(id) on delete set null,
  rejection_reason text,
  created_at timestamptz not null default now(),
  unique (user_id, campus_id)
);

create index if not exists student_verifications_status_idx on public.student_verifications(status);
create index if not exists student_verifications_campus_idx on public.student_verifications(campus_id);
