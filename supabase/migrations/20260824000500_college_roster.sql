-- =============================================================================
-- COLLEGE ROSTER (readiness-audit phase 10, part 1/2: data migration tooling
-- / USN mapping) -- gives admins a real, bulk-importable official roster to
-- validate signups against.
--
-- Today signup-with-usn's ONLY check is that a USN matches the NHCE shape
-- regex (src/features/auth/usn.ts's USN_PATTERN) -- any string of that shape
-- is accepted, there is no real roster behind it. That gap is called out in
-- this repo's own 20260814002800_student_id_verification.sql header comment
-- ("the only identity check is that the USN is ... which anyone can type").
-- This migration adds the roster table an admin can import into, plus the
-- import RPC; the signup-with-usn Edge Function is updated separately to
-- enforce membership once (and only once) a roster has actually been
-- imported, so staging/dev/test environments that have never imported one
-- keep working exactly as before.
-- =============================================================================

create table if not exists public.roster_import_batches (
  id uuid primary key default gen_random_uuid(),
  imported_by uuid references public.profiles(id) on delete set null,
  source_label text,
  row_count integer not null default 0,
  created_count integer not null default 0,
  updated_count integer not null default 0,
  invalid_count integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.official_roster (
  id uuid primary key default gen_random_uuid(),
  usn text not null,
  name text not null,
  department text,
  course text,
  year text,
  person_type text not null default 'student' check (person_type in ('student', 'staff')),
  email text,
  import_batch_id uuid references public.roster_import_batches(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Case-insensitive uniqueness on USN, same convention profiles.usn already
-- uses (see 20260814001700_usn_password_auth.sql's own unique index).
create unique index if not exists official_roster_usn_upper_idx on public.official_roster(upper(usn));
create index if not exists official_roster_batch_idx on public.official_roster(import_batch_id);

alter table public.official_roster enable row level security;
alter table public.roster_import_batches enable row level security;

-- New dedicated permission rather than reusing users.roles.manage (which is
-- deliberately super_admin-only, 20260818000400) -- importing a roster is
-- data management, not role escalation, so college_admin should hold it too.
insert into public.permissions (key, description) values
  ('users.roster.manage', 'Import/manage the official student & staff roster')
on conflict (key) do nothing;

-- The original RBAC seed's `join permissions on true` (20260814000200) only
-- ran once at that migration's apply time -- it is not a live view, so a
-- permission added afterwards needs its own explicit grant insert here.
-- Same idiom 20260819000300_vendor_manager_accounts.sql used for
-- food.staff.manage/vendor_staff.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.key in ('college_admin', 'super_admin') and p.key = 'users.roster.manage'
on conflict do nothing;

drop policy if exists "official_roster_admin_all" on public.official_roster;
create policy "official_roster_admin_all" on public.official_roster for all to authenticated
  using (public.has_permission(auth.uid(), 'users.roster.manage') or public.current_user_is_admin())
  with check (public.has_permission(auth.uid(), 'users.roster.manage') or public.current_user_is_admin());

drop policy if exists "roster_import_batches_admin_all" on public.roster_import_batches;
create policy "roster_import_batches_admin_all" on public.roster_import_batches for all to authenticated
  using (public.has_permission(auth.uid(), 'users.roster.manage') or public.current_user_is_admin())
  with check (public.has_permission(auth.uid(), 'users.roster.manage') or public.current_user_is_admin());

-- =========================================================
-- RPC: import_roster_rows -- bulk upsert, permission-gated, records a
-- batch row for audit/history. Backfills blank profiles.department/course
-- for any existing profile whose USN matches a row here -- never overwrites
-- a value that's already set, this is a fill-the-gaps reconciliation only.
-- =========================================================

create or replace function public.import_roster_rows(p_rows jsonb, p_source_label text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row jsonb;
  v_usn text;
  v_name text;
  v_batch_id uuid;
  v_created integer := 0;
  v_updated integer := 0;
  v_invalid integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_existing_id uuid;
begin
  if not (public.has_permission(v_user, 'users.roster.manage') or public.current_user_is_admin()) then
    raise exception 'Not authorized to manage the roster';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  insert into public.roster_import_batches (imported_by, source_label, row_count)
  values (v_user, p_source_label, jsonb_array_length(p_rows))
  returning id into v_batch_id;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_usn := nullif(trim(both from (v_row->>'usn')), '');
    v_name := nullif(trim(both from (v_row->>'name')), '');

    if v_usn is null or v_name is null or v_usn !~* '^\dNH\d{2}[A-Za-z]{2}\d{3}$' then
      v_invalid := v_invalid + 1;
      v_errors := v_errors || jsonb_build_object('usn', coalesce(v_usn, ''), 'reason', 'invalid usn or missing name');
      continue;
    end if;

    select id into v_existing_id from public.official_roster where upper(usn) = upper(v_usn);

    if v_existing_id is not null then
      update public.official_roster set
        name = v_name,
        department = coalesce(nullif(trim(both from (v_row->>'department')), ''), department),
        course = coalesce(nullif(trim(both from (v_row->>'course')), ''), course),
        year = coalesce(nullif(trim(both from (v_row->>'year')), ''), year),
        person_type = coalesce(nullif(trim(both from (v_row->>'person_type')), ''), person_type),
        email = coalesce(nullif(trim(both from (v_row->>'email')), ''), email),
        import_batch_id = v_batch_id,
        updated_at = now()
      where id = v_existing_id;
      v_updated := v_updated + 1;
    else
      insert into public.official_roster (usn, name, department, course, year, person_type, email, import_batch_id)
      values (
        upper(v_usn),
        v_name,
        nullif(trim(both from (v_row->>'department')), ''),
        nullif(trim(both from (v_row->>'course')), ''),
        nullif(trim(both from (v_row->>'year')), ''),
        coalesce(nullif(trim(both from (v_row->>'person_type')), ''), 'student'),
        nullif(trim(both from (v_row->>'email')), ''),
        v_batch_id
      );
      v_created := v_created + 1;
    end if;

    -- Backfill blanks only -- never clobber a value the profile already has.
    update public.profiles set
      department = coalesce(nullif(department, ''), nullif(trim(both from (v_row->>'department')), '')),
      course = coalesce(nullif(course, ''), nullif(trim(both from (v_row->>'course')), ''))
    where upper(usn) = upper(v_usn);
  end loop;

  update public.roster_import_batches set
    created_count = v_created,
    updated_count = v_updated,
    invalid_count = v_invalid,
    errors = v_errors
  where id = v_batch_id;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'created', v_created,
    'updated', v_updated,
    'invalid', v_invalid,
    'errors', v_errors
  );
end;
$$;

revoke all on function public.import_roster_rows(jsonb, text) from public, anon;
grant execute on function public.import_roster_rows(jsonb, text) to authenticated;
