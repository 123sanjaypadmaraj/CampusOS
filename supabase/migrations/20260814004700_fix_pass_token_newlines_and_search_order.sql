-- =============================================================================
-- 0047: two real bugs found via live testing (not assumptions):
--
-- 1. mint_campus_pass()/verify_campus_pass() -- Postgres's encode(bytea,
--    'base64') line-wraps its output with an embedded newline every 76
--    characters (RFC 2045 MIME behaviour). The existing pickup_code/ticket
--    token pattern this schema already used (0003/0005) never hit that --
--    gen_random_bytes(24) encodes to ~32 chars, under the wrap threshold.
--    A campus pass payload (a JSON object with sub/iat/exp/jti) is much
--    longer and DOES wrap, so translate(encode(...,'base64'), '+/=', '-_')
--    left embedded '\n' characters sitting inside the "compact" token. That
--    on its own wouldn't break the HMAC comparison (both mint and verify
--    hash the same literal string, newlines and all) -- what it broke was
--    b64url_decode()'s padding math: length(p_text) counted the newline
--    characters too, so the '=' padding it added was wrong, decode()
--    produced garbage, and every real, untampered, unexpired pass came
--    back "Malformed pass". Found immediately by live-testing mint -> verify
--    with a real facilities account instead of assuming it worked.
--
-- 2. global_search() -- Postgres rejects an ORDER BY *expression* (as
--    opposed to a plain output-column reference) inside a SELECT that's
--    directly a branch of a UNION ALL ("Only result column names can be
--    used, not expressions or functions"). Every branch ordered by
--    similarity(...) desc, which is exactly that. Fixed by ordering by
--    column position instead (7 = rank, 6 = created_at in every branch's
--    fixed 7-column shape) -- valid in a set-operation branch.
-- =============================================================================

create or replace function public.b64url_encode(p_bytes bytea)
returns text
language sql
immutable
as $$
  -- FROM has 4 chars, TO has 2 -- translate() drops any FROM character
  -- past TO's length, so '=' padding and embedded '\n' wrap characters are
  -- both stripped in the same pass that maps '+'/'/' to '-'/'_'.
  select translate(encode(p_bytes, 'base64'), E'+/=\n', '-_');
$$;

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
  v_payload_b64 := public.b64url_encode(convert_to(v_payload, 'utf8'));
  v_sig := public.b64url_encode(extensions.hmac(convert_to(v_payload_b64, 'utf8'), convert_to(v_secret, 'utf8'), 'sha256'));

  return query select
    v_payload_b64 || '.' || v_sig,
    v_exp,
    v_profile.name, v_profile.usn, v_profile.avatar_url, v_profile.course;
end;
$$;

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
    v_expected_sig := public.b64url_encode(extensions.hmac(convert_to(v_parts[1], 'utf8'), convert_to(v_secret, 'utf8'), 'sha256'));

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

-- global_search(): positional ORDER BY inside each UNION ALL branch
-- (valid), instead of the same expression as an output column (rejected).
create or replace function public.global_search(p_query text, p_limit integer default 8)
returns table (
  entity_type text, entity_id uuid, title text, subtitle text, snippet text,
  created_at timestamptz, rank real
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_campus uuid;
  v_q text := btrim(coalesce(p_query, ''));
  v_limit integer := least(greatest(coalesce(p_limit, 8), 1), 20);
begin
  if length(v_q) < 2 then
    return;
  end if;

  select campus_id into v_campus from public.profiles where id = v_user;

  return query
  select * from (
  (
    select 'post'::text, p.id, p.title,
           'Campus feed · ' || coalesce(pr.name, 'Someone'), left(p.content, 140),
           p.created_at, similarity(p.title || ' ' || p.content, v_q)
    from public.posts p
    join public.profiles pr on pr.id = p.author_id
    where p.status = 'visible'
      and (v_campus is null or p.campus_id = v_campus)
      and (p.title ilike '%'||v_q||'%' or p.content ilike '%'||v_q||'%')
    order by 7 desc, 6 desc
    limit v_limit
  )
  union all
  (
    select 'event', e.id, e.title,
           'Event' || coalesce(' · ' || to_char(e.event_date, 'DD Mon'), ''), left(coalesce(e.description, ''), 140),
           e.created_at, similarity(e.title || ' ' || coalesce(e.description, ''), v_q)
    from public.events e
    where e.published = true
      and (v_campus is null or e.campus_id = v_campus)
      and (e.title ilike '%'||v_q||'%' or e.description ilike '%'||v_q||'%')
    order by 7 desc, 6 desc
    limit v_limit
  )
  union all
  (
    select 'club', c.id, c.name,
           'Club' || coalesce(' · ' || c.category, ''), left(coalesce(c.description, ''), 140),
           c.created_at, similarity(c.name || ' ' || coalesce(c.description, ''), v_q)
    from public.clubs c
    where c.active = true
      and (v_campus is null or c.campus_id = v_campus)
      and (c.name ilike '%'||v_q||'%' or c.description ilike '%'||v_q||'%')
    order by 7 desc, 6 desc
    limit v_limit
  )
  union all
  (
    select 'listing', m.id, m.title,
           'Marketplace · ₹' || trim(to_char(m.price, 'FM999999990')), left(m.description, 140),
           m.created_at, similarity(m.title || ' ' || m.description, v_q)
    from public.marketplace_listings m
    where m.status = 'active'
      and (v_campus is null or m.campus_id = v_campus)
      and (m.title ilike '%'||v_q||'%' or m.description ilike '%'||v_q||'%')
    order by 7 desc, 6 desc
    limit v_limit
  )
  union all
  (
    select 'food_item', f.id, f.name,
           'Food · ' || cn.name, left(coalesce(f.description, ''), 140),
           f.created_at, similarity(f.name || ' ' || coalesce(f.description, ''), v_q)
    from public.food_items f
    join public.canteens cn on cn.id = f.canteen_id
    where f.active = true and cn.active = true
      and (v_campus is null or cn.campus_id = v_campus)
      and (f.name ilike '%'||v_q||'%' or f.description ilike '%'||v_q||'%')
    order by 7 desc, 6 desc
    limit v_limit
  )
  union all
  (
    select 'service', s.id, s.name,
           'Service · ' || s.category, left(coalesce(s.description, ''), 140),
           now(), similarity(s.name || ' ' || coalesce(s.description, ''), v_q)
    from public.services s
    where s.active = true
      and (v_campus is null or s.campus_id = v_campus)
      and (s.name ilike '%'||v_q||'%' or s.description ilike '%'||v_q||'%')
    order by 7 desc, 6 desc
    limit v_limit
  )
  union all
  (
    select 'lost_found', l.id, l.title,
           initcap(l.item_type) || ' · ' || l.location, left(l.description, 140),
           l.created_at, similarity(l.title || ' ' || l.description, v_q)
    from public.lost_found_items l
    where l.status in ('open', 'claim_pending')
      and (v_campus is null or l.campus_id = v_campus)
      and (l.title ilike '%'||v_q||'%' or l.description ilike '%'||v_q||'%')
    order by 7 desc, 6 desc
    limit v_limit
  )
  union all
  (
    select 'announcement', a.id, a.title,
           'Announcement · ' || a.category, left(a.body, 140),
           a.created_at, similarity(a.title || ' ' || a.body, v_q)
    from public.announcements a
    where a.published_at is not null
      and (v_campus is null or a.campus_id = v_campus)
      and (a.title ilike '%'||v_q||'%' or a.body ilike '%'||v_q||'%')
    order by 7 desc, 6 desc
    limit v_limit
  )
  union all
  (
    select 'person', pr.id, pr.name,
           coalesce(pr.course, 'Classmate'), left(coalesce(pr.bio, ''), 140),
           pr.created_at, similarity(pr.name || ' ' || coalesce(pr.course, '') || ' ' || array_to_string(pr.skills, ' '), v_q)
    from public.profiles pr
    where pr.privacy_level in ('public', 'campus')
      and pr.status = 'active'
      and pr.id <> coalesce(v_user, '00000000-0000-0000-0000-000000000000'::uuid)
      and (v_campus is null or pr.campus_id = v_campus)
      and (pr.name ilike '%'||v_q||'%' or pr.course ilike '%'||v_q||'%' or v_q = any(pr.skills))
    order by 7 desc, 6 desc
    limit v_limit
  )
  ) unified(entity_type, entity_id, title, subtitle, snippet, created_at, rank)
  order by unified.rank desc, unified.created_at desc
  limit v_limit * 3;
end;
$$;

grant execute on function public.global_search(text, integer) to authenticated;
