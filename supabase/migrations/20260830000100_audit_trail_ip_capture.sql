-- =============================================================================
-- Active-pentest-driven hardening (2026-08-30, user-requested: "make sure
-- there is no chance of anonymity"). Found while reviewing every INSERT
-- into public.audit_logs across the whole migration history: the table has
-- had an `ip_address text` column since 20260814000200_rbac.sql, but of the
-- ~50 call sites that insert an audit_logs row (admin_set_user_role,
-- admin_set_user_status, admin_transfer_vendor_ownership, moderate_content,
-- escalate_support_ticket, admin_process_account_deletion, and every other
-- privileged/audited mutation in this repo), not one of them ever set it --
-- confirmed by grepping "insert into (public.)?audit_logs" across every
-- migration file. Every privileged action was traceable to an actor_id, but
-- carried zero network-level trail: a compromised or malicious admin
-- session (stolen JWT, leaked service-role-adjacent credential, a rogue
-- staff account) could perform any audited action with no IP evidence to
-- investigate afterward.
--
-- public.moderation_actions (moderate_content()'s own audit trail) had the
-- same gap one level worse -- it never had ip_address/user_agent columns
-- at all, only moderator_id.
--
-- Fixed via one BEFORE INSERT trigger per table rather than touching every
-- existing function body: each autofills ip_address/user_agent from
-- PostgREST's `request.headers` GUC, only when the inserting function
-- didn't already supply a value -- purely additive, never overrides an
-- explicit value a caller sets.
--
-- IMPORTANT, found live during this same pass: a naive "read
-- x-forwarded-for" implementation is trivially spoofable by any caller
-- with an API key (even the public anon key) -- a client can set that
-- header on their own request and it reaches Postgres unmodified. Verified
-- live: a call with `X-Forwarded-For: 203.0.113.66` got exactly that fake
-- IP written to ip_address. client_ip() below instead prefers
-- `cf-connecting-ip` (this project's API domain is Cloudflare-fronted;
-- that header is set by Cloudflare's own edge and a request that tries to
-- set it itself gets hard-rejected there with a 403 before ever reaching
-- Postgres -- also verified live) and, only as a fallback, the LAST entry
-- of x-forwarded-for rather than the first (Cloudflare appends the true
-- connecting IP as the final hop; the leading entries are whatever the
-- caller chose to send).
-- =============================================================================

alter table public.audit_logs add column if not exists user_agent text;
alter table public.moderation_actions add column if not exists ip_address text;
alter table public.moderation_actions add column if not exists user_agent text;

create or replace function public.client_ip()
returns text
language plpgsql
stable
as $$
declare
  v_headers json;
  v_cf_ip text;
  v_xff text;
  v_parts text[];
begin
  v_headers := nullif(current_setting('request.headers', true), '')::json;
  if v_headers is null then
    return null;
  end if;

  -- cf-connecting-ip is set by Cloudflare's edge (this project's API domain
  -- is Cloudflare-fronted) and is NOT client-controllable: verified live
  -- during the 2026-08-30 pentest -- a request that tries to set this
  -- header itself gets hard-rejected at Cloudflare's edge (403 "DNS points
  -- to prohibited IP") before it ever reaches Postgres, rather than being
  -- silently passed through. This is the only trustworthy source here and
  -- must stay the primary one.
  v_cf_ip := v_headers ->> 'cf-connecting-ip';
  if v_cf_ip is not null and length(trim(v_cf_ip)) > 0 then
    return trim(v_cf_ip);
  end if;

  -- Fallback for any request that somehow reaches Postgres without going
  -- through Cloudflare (shouldn't happen for this project, but don't leave
  -- ip_address unconditionally null if it does): x-forwarded-for is a
  -- comma-separated proxy chain, and the LEFTMOST entry is whatever the
  -- ORIGINAL CALLER chose to send -- fully attacker-controlled (also
  -- confirmed live: sending a fabricated leading entry is accepted and
  -- forwarded as-is). Cloudflare appends the true connecting IP as the
  -- LAST entry in the chain, so that's the only defensible one to trust
  -- here. Do not "fix" this back to the first entry.
  v_xff := v_headers ->> 'x-forwarded-for';
  if v_xff is not null and length(trim(v_xff)) > 0 then
    v_parts := string_to_array(v_xff, ',');
    return trim(v_parts[array_length(v_parts, 1)]);
  end if;

  return null;
exception when others then
  -- Header parsing must never break the audited action itself -- an audit
  -- row with a null IP is far better than a failed privileged mutation.
  return null;
end;
$$;

create or replace function public.client_user_agent()
returns text
language plpgsql
stable
as $$
declare
  v_headers json;
begin
  v_headers := nullif(current_setting('request.headers', true), '')::json;
  if v_headers is null then
    return null;
  end if;
  return v_headers ->> 'user-agent';
exception when others then
  return null;
end;
$$;

create or replace function public.audit_trail_autofill()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.ip_address is null then
    new.ip_address := public.client_ip();
  end if;
  if new.user_agent is null then
    new.user_agent := public.client_user_agent();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_audit_logs_autofill on public.audit_logs;
create trigger trg_audit_logs_autofill
  before insert on public.audit_logs
  for each row execute function public.audit_trail_autofill();

drop trigger if exists trg_moderation_actions_autofill on public.moderation_actions;
create trigger trg_moderation_actions_autofill
  before insert on public.moderation_actions
  for each row execute function public.audit_trail_autofill();

-- Read access to the new columns is already covered by the existing
-- audit_logs_read / moderation console RLS policies (admin/moderator/
-- has_permission('audit.read') gated) -- no policy changes needed, these
-- are just new columns on already-locked-down tables.
