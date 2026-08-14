-- =============================================================================
-- 0032: LINKEDIN VERIFICATION (OAuth-verified badge, not a profile-URL source)
-- =============================================================================
-- LinkedIn's only easily-obtainable OAuth product ("Sign In with LinkedIn
-- using OpenID Connect") returns name/email/picture via the OIDC userinfo
-- endpoint -- it does NOT return the vanity profile URL (that needs
-- LinkedIn's older, partner-approval-gated Profile API). So unlike GitHub,
-- connecting LinkedIn can't auto-fill profiles.linkedin_url -- it can only
-- prove "this is a real, OAuth-authenticated LinkedIn account holder".
-- profiles.linkedin_url stays a manual field; this just adds a verified
-- badge alongside it.
--
-- linkedin_verified_at is intentionally NOT settable via a plain client
-- UPDATE (profiles_update_self would let anyone self-report "verified"
-- without ever completing OAuth, which defeats the point of a trust badge)
-- -- it's only set by mark_linkedin_verified(), which checks auth.identities
-- server-side for a real linked linkedin_oidc identity first.

alter table public.profiles add column if not exists linkedin_verified_at timestamptz;

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

  update public.profiles set linkedin_verified_at = now(), updated_at = now()
    where id = v_user
    returning * into v_profile;

  return v_profile;
end;
$$;

grant execute on function public.mark_linkedin_verified() to authenticated;
