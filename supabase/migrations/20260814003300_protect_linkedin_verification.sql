-- =============================================================================
-- 0033: ACTUALLY PROTECT linkedin_verified_at
-- =============================================================================
-- 0032 added mark_linkedin_verified() as the intended-only way to set this
-- column, but never guarded the column itself -- profiles_update_self (0011)
-- grants full self-UPDATE on every column with no per-column restriction, so
-- a plain REST PATCH to /profiles could set linkedin_verified_at directly,
-- completely bypassing the auth.identities check and forging the badge.
-- Verified live: a raw PATCH as a test user with no linked LinkedIn account
-- succeeded and set the timestamp. Same trigger pattern as
-- protect_profile_role() (0001) -- block the column outside the one trusted
-- path, which sets a session-local flag before its own UPDATE.

create or replace function public.protect_linkedin_verification()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.linkedin_verified_at is distinct from old.linkedin_verified_at
     and coalesce(current_setting('campusos.allow_linkedin_verify', true), 'false') <> 'true' then
    raise exception 'linkedin_verified_at changes must go through mark_linkedin_verified()';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_linkedin_verification on public.profiles;
create trigger profiles_protect_linkedin_verification
before update on public.profiles
for each row execute function public.protect_linkedin_verification();

create or replace function public.mark_linkedin_verified()
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_has_linkedin boolean;
  v_profile public.profiles;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;

  select exists (
    select 1 from auth.identities where user_id = v_user and provider = 'linkedin_oidc'
  ) into v_has_linkedin;

  if not v_has_linkedin then
    raise exception 'LINKEDIN_NOT_LINKED: link a LinkedIn account first';
  end if;

  perform set_config('campusos.allow_linkedin_verify', 'true', true);
  update public.profiles set linkedin_verified_at = now(), updated_at = now()
    where id = v_user
    returning * into v_profile;
  perform set_config('campusos.allow_linkedin_verify', 'false', true);

  return v_profile;
end;
$$;
