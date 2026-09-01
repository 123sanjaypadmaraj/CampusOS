-- =============================================================================
-- 0200: DOMAIN-CUTOVER PREP -- PARAMETERIZE THE FRONTEND URL IN EMAIL LINKS
-- request_contact_email_verification() (20260817002700) hardcoded
-- 'https://campusos-amber.vercel.app/verify-email?token=...' directly in its
-- SQL body -- the same class of bug 20260817002500 fixed for the Edge
-- Function *dispatch* URL (app_config.functions_base_url), just left behind
-- in this one function's *link* text. Moving it to the same app_config
-- lookup pattern means a future domain cutover is a one-row UPDATE on each
-- project instead of a migration + redeploy.
--
-- Seeded with the current production value so behavior is byte-for-byte
-- unchanged until someone updates the row:
--   update public.app_config set value = 'https://your-new-domain.example'
--     where key = 'frontend_base_url';
-- (staging should get its own https://campusos-staging.vercel.app row set
-- the same way app_config.functions_base_url already is per docs/ENVIRONMENTS.md.)
-- =============================================================================

insert into public.app_config (key, value)
values ('frontend_base_url', 'https://campusos-amber.vercel.app')
on conflict (key) do nothing;

create or replace function public.request_contact_email_verification(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_secret text;
  v_base_url text;
  v_frontend_url text;
  v_raw_token text;
  v_link text;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;
  if p_email is null or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address.';
  end if;
  if not public.check_rate_limit(v_user, 'email_verify', 3, 3600) then
    raise exception 'Too many verification emails requested. Try again later.';
  end if;

  update public.profiles set contact_email = lower(trim(p_email)), updated_at = now() where id = v_user;

  v_raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.email_verification_tokens (user_id, email, token_hash, expires_at)
  values (v_user, lower(trim(p_email)), encode(extensions.digest(v_raw_token, 'sha256'), 'hex'), now() + interval '24 hours');

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'email_dispatch_secret';
  select value into v_base_url from public.app_config where key = 'functions_base_url';
  select value into v_frontend_url from public.app_config where key = 'frontend_base_url';
  if v_secret is null or v_base_url is null then
    return; -- not configured yet -- the token row exists, nothing to send it with.
  end if;
  -- Fall back to the current production frontend rather than erroring or
  -- emailing a broken 'null/verify-email' link if the row is ever missing.
  v_frontend_url := coalesce(v_frontend_url, 'https://campusos-amber.vercel.app');

  v_link := v_frontend_url || '/verify-email?token=' || v_raw_token;
  begin
    perform net.http_post(
      url := v_base_url || '/send-email',
      headers := jsonb_build_object('Content-Type', 'application/json', 'X-Email-Secret', v_secret),
      body := jsonb_build_object(
        'to', lower(trim(p_email)),
        'subject', 'Verify your CampusOS email',
        'html', '<p>Confirm this is your email address:</p><p><a href="' || v_link || '">Verify email</a></p><p>This link expires in 24 hours. If you didn''t request this, ignore it.</p>'
      ),
      timeout_milliseconds := 8000
    );
  exception when others then
    null;
  end;
end;
$$;
