-- =============================================================================
-- 0020: FIX handle_new_user() NEVER SETTING campus_id
-- The original trigger (0001) inserted every new profile with campus_id
-- implicitly null -- getOrCreateProfile() on the client was supposed to
-- backfill it, but only did so on the "row doesn't exist yet" branch, which
-- the trigger always beats it to. Every account created through the Admin
-- API (USN signups, admin-provisioned accounts) ended up with no campus,
-- silently breaking anything that derives campus server-side from the
-- caller's profile (e.g. publish_announcement()). Fixed on both ends: the
-- client (src/services/mvpService.js getOrCreateProfile) now backfills an
-- existing null campus_id too, and the trigger itself defaults to the
-- single-campus fallback so new signups aren't null from the start.
-- =============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campus_id uuid;
begin
  v_campus_id := nullif(new.raw_user_meta_data->>'campus_id', '')::uuid;
  if v_campus_id is null then
    -- Single-campus deployment today (doc §9 leaves room for more later) --
    -- default new accounts onto the one campus that exists instead of null.
    select id into v_campus_id from public.campuses order by created_at limit 1;
  end if;

  insert into public.profiles (id, campus_id, name, email, usn, course, year)
  values (
    new.id,
    v_campus_id,
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

-- One-time backfill for every profile created before this fix.
update public.profiles
  set campus_id = (select id from public.campuses order by created_at limit 1)
  where campus_id is null;
