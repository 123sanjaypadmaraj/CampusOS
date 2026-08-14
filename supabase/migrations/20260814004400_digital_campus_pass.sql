-- =============================================================================
-- 0044: DIGITAL CAMPUS PASS -- signed, short-lived QR token system
-- Replaces the fully-fake `PassService` (a static <HiQrCode/> icon, a
-- hardcoded fallback name/USN, and a "Download Pass QR" button that only
-- fired a toast -- see src/App.jsx). Every event/food/print pickup token
-- already in this schema is a static value stored in the DB (order.token,
-- pickup_code) -- fine for a single-use code, wrong for a general "this is
-- me" identity pass someone could screenshot and reuse indefinitely. This
-- is a distinct, purpose-built token: HMAC-signed, ~90s lifetime, verified
-- entirely in Postgres (pgcrypto's hmac()) so no extra edge function or
-- secret-sync between two deploy targets is needed.
-- =============================================================================

-- The HMAC signing key lives in Supabase Vault, generated once here from
-- random bytes -- it is never present in this file or anywhere in git.
-- SECURITY DEFINER functions below (owned by postgres) can read it back via
-- vault.decrypted_secrets; nothing else can.
do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'campus_pass_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'campus_pass_secret',
      'HMAC-SHA256 signing key for short-lived digital campus pass QR tokens (mint_campus_pass / verify_campus_pass).'
    );
  end if;
end $$;

insert into public.permissions (key, description) values
  ('pass.verify', 'Scan and verify a student''s digital campus pass')
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where p.key = 'pass.verify' and r.key in ('facilities_staff', 'college_admin', 'super_admin')
on conflict do nothing;

-- Small helper: base64url (no padding) -> bytea. The inverse of the
-- `translate(encode(bytes,'base64'), '+/=', '-_')` idiom already used
-- elsewhere in this schema for order/ticket tokens (0003/0005).
create or replace function public.b64url_decode(p_text text)
returns bytea
language sql
immutable
as $$
  select decode(
    translate(p_text, '-_', '+/') || repeat('=', (4 - length(p_text) % 4) % 4),
    'base64'
  );
$$;

-- =========================================================
-- MINT -- called by the pass holder (any authenticated, non-suspended
-- student) roughly every 60-75s while the pass modal is open, so a
-- screenshot of the QR is worthless a minute later.
-- =========================================================

create or replace function public.mint_campus_pass()
returns table (token text, expires_at timestamptz, holder_name text, holder_usn text, holder_avatar text, holder_course text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_profile record;
  v_secret text;
  v_now timestamptz := now();
  v_exp timestamptz := now() + interval '90 seconds';
  v_payload text;
  v_payload_b64 text;
  v_sig text;
begin
  if v_user is null then raise exception 'Sign in required'; end if;

  select id, name, usn, avatar_url, course, status into v_profile from public.profiles where id = v_user;
  if v_profile.status = 'suspended' then
    raise exception 'ACCOUNT_SUSPENDED: your account has been suspended and cannot do this. Contact a campus admin.';
  end if;

  if not public.check_rate_limit(v_user, 'campus_pass_mint', 30, 60) then
    raise exception 'Too many pass refreshes -- please wait a moment';
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'campus_pass_secret';
  if v_secret is null then raise exception 'Campus pass signing key is not configured'; end if;

  v_payload := jsonb_build_object(
    'sub', v_user,
    'iat', extract(epoch from v_now)::bigint,
    'exp', extract(epoch from v_exp)::bigint,
    'jti', gen_random_uuid()
  )::text;
  v_payload_b64 := translate(encode(convert_to(v_payload, 'utf8'), 'base64'), '+/=', '-_');
  v_sig := translate(encode(extensions.hmac(convert_to(v_payload_b64, 'utf8'), convert_to(v_secret, 'utf8'), 'sha256'), 'base64'), '+/=', '-_');

  return query select
    v_payload_b64 || '.' || v_sig,
    v_exp,
    v_profile.name, v_profile.usn, v_profile.avatar_url, v_profile.course;
end;
$$;

-- =========================================================
-- VERIFY -- called by facilities staff / admins scanning a pass. Never
-- raises on an invalid/expired token (a scanner UI needs to *show* that
-- outcome, not catch an exception) -- `valid` carries the result instead.
-- Every attempt, valid or not, is written to audit_logs for accountability.
-- =========================================================

create or replace function public.verify_campus_pass(p_token text)
returns table (
  valid boolean, reason text,
  holder_id uuid, holder_name text, holder_usn text, holder_avatar text,
  holder_course text, holder_department text, holder_status text, verified_student boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scanner uuid := auth.uid();
  v_secret text;
  v_parts text[];
  v_expected_sig text;
  v_payload jsonb;
  v_sub uuid;
  v_exp bigint;
  v_holder record;
  v_valid boolean := false;
  v_reason text := 'Invalid pass';
begin
  if v_scanner is null then raise exception 'Sign in required'; end if;
  if not (public.has_permission(v_scanner, 'pass.verify') or public.current_user_is_admin()) then
    raise exception 'Not authorized to verify campus passes';
  end if;

  if not public.check_rate_limit(v_scanner, 'campus_pass_verify', 120, 60) then
    raise exception 'Too many scans -- please wait a moment';
  end if;

  v_parts := regexp_split_to_array(coalesce(p_token, ''), '\.');

  if array_length(v_parts, 1) = 2 then
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'campus_pass_secret';
    v_expected_sig := translate(encode(extensions.hmac(convert_to(v_parts[1], 'utf8'), convert_to(v_secret, 'utf8'), 'sha256'), 'base64'), '+/=', '-_');

    if v_secret is not null and v_expected_sig = v_parts[2] then
      begin
        v_payload := convert_from(public.b64url_decode(v_parts[1]), 'utf8')::jsonb;
        v_sub := (v_payload->>'sub')::uuid;
        v_exp := (v_payload->>'exp')::bigint;
      exception when others then
        v_payload := null;
      end;

      if v_payload is null or v_sub is null or v_exp is null then
        v_reason := 'Malformed pass';
      elsif v_exp < extract(epoch from now())::bigint then
        v_reason := 'Pass expired -- ask them to refresh it';
      else
        select id, name, usn, avatar_url, course, department, status into v_holder
        from public.profiles where id = v_sub;

        if v_holder.id is null then
          v_reason := 'Holder not found';
        elsif v_holder.status = 'suspended' then
          v_reason := 'Holder account is suspended';
        else
          v_valid := true;
          v_reason := 'Valid';
        end if;
      end if;
    else
      v_reason := 'Signature mismatch -- possibly tampered or forged';
    end if;
  else
    v_reason := 'Malformed pass';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value)
  values (
    v_scanner, 'pass.scan', 'campus_pass', coalesce(v_sub::text, null),
    jsonb_build_object('valid', v_valid, 'reason', v_reason)
  );

  if v_valid then
    return query select
      true, v_reason, v_holder.id, v_holder.name, v_holder.usn, v_holder.avatar_url,
      v_holder.course, v_holder.department, v_holder.status,
      exists(select 1 from public.student_verifications sv where sv.user_id = v_holder.id and sv.status = 'approved');
  else
    return query select false, v_reason, v_sub, null::text, null::text, null::text, null::text, null::text, null::text, false;
  end if;
end;
$$;

grant execute on function public.mint_campus_pass() to authenticated;
grant execute on function public.verify_campus_pass(text) to authenticated;
