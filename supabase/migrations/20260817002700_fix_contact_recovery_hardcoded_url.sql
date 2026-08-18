-- =============================================================================
-- 0270: FIX request_contact_email_verification()'S HARDCODED PRODUCTION URL
-- Same class of bug 20260817002500 fixed for the push/email/sms dispatch
-- functions: this RPC (20260817002200) hardcoded
-- 'https://dzjzjlylsfpmymkcavrq.functions.supabase.co/send-email' directly,
-- so on staging it was calling production's send-email (wrong secret,
-- wrong everything) instead of its own. Moved to the same
-- public.app_config.functions_base_url lookup 002500 introduced, which is
-- already correctly seeded per-project on both staging and production.
-- =============================================================================

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
  if v_secret is null or v_base_url is null then
    return; -- not configured yet -- the token row exists, nothing to send it with.
  end if;

  v_link := 'https://campusos-amber.vercel.app/verify-email?token=' || v_raw_token;
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
