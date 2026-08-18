-- =============================================================================
-- 0220: CONTACT EMAIL VERIFICATION + PASSWORD RECOVERY
-- Closes the two real gaps 20260817001700/002000's notification-delivery
-- infra left open: there was nowhere real to send an email TO (no
-- contact_email column, no verification), and USN+password accounts have no
-- password-recovery path at all -- their auth.users.email is a synthetic,
-- never-shown address (usnToEmail() in src/services/mvpService.js), so
-- Supabase's own native "reset password by email" can't reach a real inbox
-- for them. Magic-link/Google/vendor accounts already have a real email on
-- auth.users and don't need any of this -- see the fallback logic in
-- send-email (supabase/functions/send-email).
-- =============================================================================

alter table public.profiles add column if not exists contact_email text;
alter table public.profiles add column if not exists contact_email_verified_at timestamptz;

create table if not exists public.email_verification_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  email text not null, -- snapshot of what's being verified, so a later
                        -- contact_email change can't retroactively "verify"
                        -- via a stale link for a different address
  token_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists email_verification_tokens_lookup_idx on public.email_verification_tokens(token_hash) where used_at is null;

create table if not exists public.password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists password_reset_tokens_lookup_idx on public.password_reset_tokens(token_hash) where used_at is null;

-- Both token tables are only ever touched via RPC/service-role Edge
-- Functions (security definer / service key), never a direct client
-- insert/select -- RLS enabled with zero policies, same "no self-serve
-- access at all" posture as notification_deliveries (20260817001700).
alter table public.email_verification_tokens enable row level security;
alter table public.password_reset_tokens enable row level security;
revoke all on public.email_verification_tokens from public, anon, authenticated;
revoke all on public.password_reset_tokens from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Protect contact_email_verified_at the same way 20260814003300 protects
-- linkedin_verified_at: a before-update trigger blocks any direct write
-- outside the one trusted RPC, which sets a session-local flag around its
-- own update. Also: changing contact_email itself always resets
-- verification (no guard needed for that direction -- it can only ever make
-- the account *less* verified, never forge a verified badge).
-- ---------------------------------------------------------------------------
create or replace function public.protect_contact_email_verification()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.contact_email is distinct from old.contact_email then
    new.contact_email_verified_at := null;
  end if;
  if new.contact_email_verified_at is distinct from old.contact_email_verified_at
     and new.contact_email_verified_at is not null
     and coalesce(current_setting('campusos.allow_contact_email_verify', true), 'false') <> 'true' then
    raise exception 'contact_email_verified_at changes must go through confirm_contact_email_verification()';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_contact_email_verification on public.profiles;
create trigger profiles_protect_contact_email_verification
before update on public.profiles
for each row execute function public.protect_contact_email_verification();

-- ---------------------------------------------------------------------------
-- request_contact_email_verification -- sets profiles.contact_email (via
-- the plain profiles_update_self policy, this RPC just also mints the
-- token) and emails a verification link. Returns nothing sensitive; the raw
-- token only ever exists in the outgoing email, never in a query result.
-- ---------------------------------------------------------------------------
create or replace function public.request_contact_email_verification(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_secret text;
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
  if v_secret is null then
    return; -- not configured yet -- the token row exists, nothing to send it with.
  end if;

  v_link := 'https://campusos-amber.vercel.app/verify-email?token=' || v_raw_token;
  -- Only the dispatch call is best-effort -- nested so a pg_net hiccup here
  -- can never mask the validation/rate-limit raises above (a bare
  -- `exception when others` on the whole function body would swallow those
  -- too, silently turning a rejected request into an apparent success).
  begin
    perform net.http_post(
      url := 'https://dzjzjlylsfpmymkcavrq.functions.supabase.co/send-email',
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

revoke all on function public.request_contact_email_verification(text) from public, anon;
grant execute on function public.request_contact_email_verification(text) to authenticated;

-- ---------------------------------------------------------------------------
-- confirm_contact_email_verification -- public (called from a signed-out-or-
-- irrelevant browser context landing on /verify-email?token=...), so it
-- looks the token up directly rather than trusting auth.uid().
-- ---------------------------------------------------------------------------
create or replace function public.confirm_contact_email_verification(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.email_verification_tokens;
  v_hash text;
begin
  v_hash := encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  select * into v_row from public.email_verification_tokens
    where token_hash = v_hash and used_at is null and expires_at > now();
  if v_row is null then
    raise exception 'INVALID_TOKEN: this verification link is invalid or has expired.';
  end if;

  -- The address may have changed again since this link was minted -- only
  -- mark verified if it still matches what's currently on the profile.
  if not exists (select 1 from public.profiles where id = v_row.user_id and contact_email = v_row.email) then
    raise exception 'STALE_TOKEN: your contact email has changed since this link was sent.';
  end if;

  update public.email_verification_tokens set used_at = now() where id = v_row.id;

  perform set_config('campusos.allow_contact_email_verify', 'true', true);
  update public.profiles set contact_email_verified_at = now(), updated_at = now() where id = v_row.user_id;
  perform set_config('campusos.allow_contact_email_verify', 'false', true);
end;
$$;

revoke all on function public.confirm_contact_email_verification(text) from public;
grant execute on function public.confirm_contact_email_verification(text) to anon, authenticated;

comment on function public.request_contact_email_verification(text) is
  'Self-scoped (auth.uid()), rate-limited 3/hour. Sets profiles.contact_email and emails a verification link.';
comment on function public.confirm_contact_email_verification(text) is
  'Public -- called from /verify-email?token=... with no session assumed. Token-scoped, not user-scoped.';
