-- =============================================================================
-- LOST & FOUND HARDENING (module 14) -- gap-checked against the full doc §44
-- checklist: images/category/location/date-time, search/matching, claim +
-- ownership proof, admin verification, handover record, claim rejection,
-- fraud prevention, item expiry/archive, staff-managed inventory. Most of
-- that was already real (20260814000900, 20260815000400, 20260819000500) --
-- this closes the remaining four gaps found by reading the code, not by
-- assuming the checklist was unmet:
--
--   1. Item expiry/archive -- items sat open forever with no lifecycle, the
--      only thing marketplace_listings got in 20260818000700. Same
--      opportunistic-expiry pattern (expires_at + expire_stale_*(), called
--      fire-and-forget from the feed load), shorter TTL (21 days, not 60 --
--      a lost phone report going stale matters faster than a stale listing).
--   2. Fraud prevention on claims -- claim_lost_found_item() had no rate
--      limit (a bad actor could claim-spam many open items to grief other
--      claimants and flood staff's queue) and no self-claim guard (nothing
--      stopped a reporter from "claiming" their own report).
--   3. Handover record -- verify_lost_found_handover() flipped status and
--      set handled_by but wrote no audit_logs entry, unlike every other
--      accountability-sensitive action in this codebase (moderate_content,
--      admin_add_prohibited_term, etc). No permanent record of who
--      approved/rejected which claim and why.
--   4. Reporting a bogus/fraudulent report -- content_reports and
--      get_report_context() already had full 'lost_found_item' support
--      (20260814003400/20260815001500) but moderate_content() never grew a
--      branch to act on one, so a reported lost&found item could never
--      actually be hidden/removed through the standard moderation flow --
--      only a full admin delete (destructive, no report resolution) worked.
-- =============================================================================

-- =========================================================
-- 1. ITEM EXPIRY / ARCHIVE
-- =========================================================

alter table public.lost_found_items
  add column if not exists expires_at timestamptz not null default (now() + interval '21 days');

do $$ begin
  alter table public.lost_found_items drop constraint if exists lost_found_items_status_check;
  alter table public.lost_found_items add constraint lost_found_items_status_check
    check (status in ('open', 'claim_pending', 'resolved', 'archived'));
exception when others then null; end $$;

create index if not exists lost_found_items_expires_idx on public.lost_found_items(status, expires_at);

-- Best-effort, not a hard SLA -- same posture as expire_stale_listings():
-- called fire-and-forget from the client every time the feed loads rather
-- than needing pg_cron. Only touches 'open' reports -- a claim_pending item
-- stays claim_pending until staff verify it either way, it never silently
-- expires out from under an in-flight claim.
create or replace function public.expire_stale_lost_found_items()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.lost_found_items
    set status = 'archived'
    where status = 'open' and expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.expire_stale_lost_found_items() to authenticated;

-- =========================================================
-- 2. FRAUD PREVENTION ON CLAIMS
-- Recreated with the same signature (p_item_id uuid, p_proof text) --
-- restructured to select-then-check-then-update so the self-claim guard and
-- rate limit can run before the write, instead of only the conditional
-- UPDATE...WHERE status='open' the original had.
-- =========================================================

create or replace function public.claim_lost_found_item(p_item_id uuid, p_proof text)
returns public.lost_found_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_item public.lost_found_items;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if coalesce(trim(p_proof), '') = '' then raise exception 'Proof of ownership is required to claim an item'; end if;

  select * into v_item from public.lost_found_items where id = p_item_id for update;
  if not found then raise exception 'Item is not available to claim'; end if;
  if v_item.status <> 'open' then raise exception 'Item is not available to claim'; end if;
  if v_item.user_id = v_user then raise exception 'You reported this item yourself -- you can''t claim it'; end if;

  -- Claim-spam guard: without this, one account could claim every open
  -- report to grief other claimants and flood staff's verification queue --
  -- each claim silently blocks the item for everyone else until a moderator
  -- rejects it. 8/hour is generous for a genuine user (nobody legitimately
  -- claims that many lost&found items in an hour) but caps the blast radius.
  if not public.check_rate_limit(v_user, 'lost_found_claim', 8, 3600) then
    raise exception 'You are claiming items too fast -- slow down and try again shortly';
  end if;

  update public.lost_found_items
    set status = 'claim_pending', claimed_by = v_user, claim_proof = p_proof
    where id = p_item_id and status = 'open'
    returning * into v_item;

  if not found then raise exception 'Item is not available to claim'; end if;
  return v_item;
end;
$$;

-- =========================================================
-- 3. HANDOVER RECORD -- write an audit_logs entry on every verification
-- decision (approve or reject), same table every other accountability-
-- sensitive admin action in this codebase already writes to. Signature
-- unchanged so no frontend/RPC-call-site changes are needed.
-- =========================================================

create or replace function public.verify_lost_found_handover(p_item_id uuid, p_approve boolean)
returns public.lost_found_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_before public.lost_found_items;
  v_item public.lost_found_items;
begin
  if not (public.has_permission(v_user, 'moderation.act') or public.current_user_is_admin()) then
    raise exception 'Not authorized to verify handovers';
  end if;

  select * into v_before from public.lost_found_items where id = p_item_id for update;
  if not found or v_before.status <> 'claim_pending' then
    raise exception 'Item is not awaiting handover verification';
  end if;

  update public.lost_found_items
    set status = case when p_approve then 'resolved' else 'open' end,
        claimed_by = case when p_approve then claimed_by else null end,
        claim_proof = case when p_approve then claim_proof else null end,
        handled_by = v_user
    where id = p_item_id and status = 'claim_pending'
    returning * into v_item;

  if not found then raise exception 'Item is not awaiting handover verification'; end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, reason, old_value, new_value)
  values (
    v_user,
    case when p_approve then 'lost_found.handover_approved' else 'lost_found.claim_rejected' end,
    'lost_found_item', p_item_id::text,
    'Claimant ' || coalesce(v_before.claimed_by::text, 'unknown') || ': "' || coalesce(v_before.claim_proof, '') || '"',
    jsonb_build_object('status', v_before.status, 'claimed_by', v_before.claimed_by),
    jsonb_build_object('status', v_item.status, 'claimed_by', v_item.claimed_by)
  );

  return v_item;
end;
$$;

-- =========================================================
-- 4. moderate_content(): add the 'lost_found_item' branch. Recreated from
-- marketplace_hardening's latest version (20260818000700) with the same
-- signature, just widening the body -- post/comment/marketplace_listing
-- branches are copied unchanged.
-- =========================================================

create or replace function public.moderate_content(
  p_target_type text,
  p_target_id uuid,
  p_action text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_new_status text;
begin
  if not (public.has_permission(v_user, 'moderation.act') or public.current_user_is_admin()) then
    raise exception 'Not authorized to moderate content';
  end if;

  v_new_status := case p_action when 'approve' then 'visible' when 'hide' then 'hidden' when 'remove' then 'removed' else null end;

  if v_new_status is not null then
    if p_target_type = 'post' then
      update public.posts set status = v_new_status where id = p_target_id;
    elsif p_target_type = 'comment' then
      update public.comments set status = v_new_status where id = p_target_id;
    elsif p_target_type = 'marketplace_listing' then
      if p_action in ('hide', 'remove') then
        update public.marketplace_listings set status = 'removed' where id = p_target_id;
      elsif p_action = 'approve' then
        update public.marketplace_listings set status = 'active' where id = p_target_id and status = 'removed';
      end if;
    elsif p_target_type = 'lost_found_item' then
      -- lost_found_items has no 'hidden'/'removed' state of its own --
      -- 'hide'/'remove' both take a bogus report off the public feed the
      -- same way expiry does (status='archived', already excluded by
      -- getLostFoundItems' own .eq('status','open') filter); 'approve'
      -- restores a wrongly-archived report back to 'open'. Only acts on
      -- 'open' reports -- a claim_pending/resolved item is left alone so
      -- moderating a stale report can't clobber an in-flight or completed
      -- handover.
      if p_action in ('hide', 'remove') then
        update public.lost_found_items set status = 'archived' where id = p_target_id and status = 'open';
      elsif p_action = 'approve' then
        -- Reset expires_at too -- otherwise a report restored from
        -- 'archived' is already past its old expiry and gets re-archived by
        -- the very next expire_stale_lost_found_items() housekeeping call.
        update public.lost_found_items set status = 'open', expires_at = now() + interval '21 days'
          where id = p_target_id and status = 'archived';
      end if;
    end if;
  end if;

  insert into public.moderation_actions (moderator_id, target_type, target_id, action, reason)
  values (v_user, p_target_type, p_target_id, p_action, p_reason);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, reason)
  values (v_user, 'moderation.' || p_action, p_target_type, p_target_id::text, p_reason);
end;
$$;
