-- =============================================================================
-- Feature flags (AdminCMS pass, part 5/5). Didn't exist in any form before
-- this (confirmed by grep across the whole tree) -- new capability end to
-- end: schema, admin CRUD, and a frontend read path other features can gate
-- behind. Nothing in this pass wires an existing feature to a flag yet;
-- this lands the infrastructure only.
--
-- Global default (campus_id null) + optional per-campus override, same
-- shape `ai_knowledge` (20260817002100) already uses for campus-specific-
-- vs-global rows. Real gotcha worth documenting: a plain `unique(key,
-- campus_id)` constraint does NOT dedupe multiple global rows for the same
-- key, because Postgres treats every NULL as distinct from every other NULL
-- for uniqueness purposes -- two `('maintenance_mode', null)` rows would
-- both insert cleanly under a naive constraint. Using two partial unique
-- indexes instead (one scoped to `campus_id is not null`, one to `campus_id
-- is null`) closes that gap properly.
-- =============================================================================

create table if not exists public.feature_flags (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  campus_id uuid references public.campuses(id) on delete cascade,
  description text,
  enabled boolean not null default false,
  rollout_percentage integer not null default 100 check (rollout_percentage between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

create unique index if not exists feature_flags_campus_key_uidx on public.feature_flags(key, campus_id) where campus_id is not null;
create unique index if not exists feature_flags_global_key_uidx on public.feature_flags(key) where campus_id is null;

alter table public.feature_flags enable row level security;

-- Flags are config, not secrets -- readable by anyone (incl. anon, so a
-- pre-login screen could gate behind one too), same posture as
-- announcements/campuses. Writes are RPC-only below, no write policy at
-- all (RLS defaults to deny for any command with no matching policy).
drop policy if exists "feature_flags_read" on public.feature_flags;
create policy "feature_flags_read" on public.feature_flags for select to anon, authenticated using (true);

-- =========================================================
-- RPC: admin_upsert_feature_flag -- manual find-then-branch upsert rather
-- than `on conflict`, since a single ON CONFLICT target can't cleanly cover
-- both partial unique indexes above in one statement. `is not distinct
-- from` is the null-safe equality this needs (`campus_id = p_campus_id`
-- would silently never match an existing global row). The two partial
-- indexes above still stand as a DB-level backstop against a genuine race
-- between two concurrent inserts of a brand-new key -- acceptable for a
-- rare, admin-only, low-concurrency action.
-- =========================================================

create or replace function public.admin_upsert_feature_flag(
  p_key text,
  p_campus_id uuid,
  p_description text,
  p_enabled boolean,
  p_rollout_percentage integer default 100
)
returns public.feature_flags
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.feature_flags;
  v_key text := lower(trim(coalesce(p_key, '')));
begin
  if not public.current_user_is_admin() then
    raise exception 'Not authorized to manage feature flags';
  end if;
  if v_key = '' then
    raise exception 'Flag key is required';
  end if;
  if p_rollout_percentage is null or p_rollout_percentage < 0 or p_rollout_percentage > 100 then
    raise exception 'Rollout percentage must be between 0 and 100';
  end if;

  select * into v_row from public.feature_flags
    where key = v_key and campus_id is not distinct from p_campus_id
    for update;

  if found then
    update public.feature_flags set
      description = p_description,
      enabled = p_enabled,
      rollout_percentage = p_rollout_percentage,
      updated_at = now(),
      updated_by = v_user
      where id = v_row.id
      returning * into v_row;
  else
    insert into public.feature_flags (key, campus_id, description, enabled, rollout_percentage, updated_by)
    values (v_key, p_campus_id, p_description, p_enabled, p_rollout_percentage, v_user)
    returning * into v_row;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value)
  values (v_user, 'feature_flag.upsert', 'feature_flag', v_row.id::text,
          jsonb_build_object('key', v_row.key, 'campus_id', v_row.campus_id, 'enabled', v_row.enabled,
                              'rollout_percentage', v_row.rollout_percentage));

  return v_row;
end;
$$;

grant execute on function public.admin_upsert_feature_flag(text, uuid, text, boolean, integer) to authenticated;

create or replace function public.admin_delete_feature_flag(p_key text, p_campus_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_key text := lower(trim(coalesce(p_key, '')));
begin
  if not public.current_user_is_admin() then
    raise exception 'Not authorized to manage feature flags';
  end if;

  delete from public.feature_flags where key = v_key and campus_id is not distinct from p_campus_id;
  if not found then
    raise exception 'Feature flag not found';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value)
  values (v_user, 'feature_flag.delete', 'feature_flag', v_key, jsonb_build_object('campus_id', p_campus_id));
end;
$$;

grant execute on function public.admin_delete_feature_flag(text, uuid) to authenticated;
