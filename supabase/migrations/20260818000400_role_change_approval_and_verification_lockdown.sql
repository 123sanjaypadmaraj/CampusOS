-- =============================================================================
-- Auth & identity hardening pass, part 1/2: two real security bugs found by
-- the "Authentication & identity" doc-checklist audit, plus the maker-checker
-- role-assignment-approval feature that closes the more serious of the two
-- properly (not just patches it).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- BUG 1: privilege escalation via admin_set_user_role().
--
-- The RBAC seed (20260814000200_rbac.sql) deliberately withholds
-- 'users.roles.manage' from college_admin ("college_admin and p.key <>
-- 'users.roles.manage'") -- only super_admin gets it, via the wildcard
-- clause. But admin_set_user_role()'s own gate was
-- `has_permission(...,'users.roles.manage') OR current_user_is_admin()`, and
-- current_user_is_admin() returns true for college_admin too -- so the OR
-- fully defeated the seed's own exclusion. Any single college_admin could
-- call this RPC to promote anyone, including themselves, straight to
-- super_admin, with nothing but an audit_logs row after the fact (and, until
-- this same migration, no UI even showed that row -- see AdminCMS.jsx).
--
-- Fix: drop the `OR current_user_is_admin()` bypass, so only an actor who
-- actually holds 'users.roles.manage' (super_admin, via the wildcard) can
-- call this directly. college_admin now goes through propose_role_change()/
-- decide_role_change() below instead of a straight RPC call.
--
-- Recreated from the LATEST version on disk (20260818000100_fix_stock_
-- decrement_and_faculty_regression.sql), not the original in rbac.sql, per
-- this repo's own "recreate from latest, not original" convention -- that's
-- the version with vendor_staff/faculty already in the allow-list.
-- -----------------------------------------------------------------------------

create or replace function public.admin_set_user_role(p_target_user uuid, p_new_role text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_role text;
begin
  if not public.has_permission(auth.uid(), 'users.roles.manage') then
    raise exception 'Not authorized to change roles';
  end if;

  if p_new_role not in ('student','club_admin','vendor','vendor_staff','facilities_staff','faculty','college_admin','super_admin') then
    raise exception 'Invalid role %', p_new_role;
  end if;

  select role into v_old_role from public.profiles where id = p_target_user for update;

  perform set_config('campusos.allow_role_change', 'true', true);
  update public.profiles set role = p_new_role where id = p_target_user;
  perform set_config('campusos.allow_role_change', 'false', true);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_value, new_value, reason)
  values (auth.uid(), 'role.change', 'profile', p_target_user::text,
          jsonb_build_object('role', v_old_role), jsonb_build_object('role', p_new_role), p_reason);
end;
$$;

-- -----------------------------------------------------------------------------
-- Role-assignment approval (doc "Admin" checklist item, and the real fix for
-- bug 1 above -- college_admin can still get roles changed, just not
-- unilaterally). A two-person maker-checker: any admin (college_admin or
-- super_admin) may PROPOSE a role change, but it only takes effect once a
-- DIFFERENT admin approves it. Promoting someone to super_admin specifically
-- requires the approver to already hold super_admin -- the most sensitive
-- escalation gets the strictest check.
--
-- Deliberately NOT required for super_admin's own direct calls to
-- admin_set_user_role() above (unchanged, instant) -- this app's bootstrap
-- path (scripts/setup-admin-account.mjs) creates exactly one super_admin, so
-- forcing every role change through two-person approval with no second
-- super_admin to ever approve anything would deadlock a fresh deployment.
-- The maker-checker requirement sits specifically on the tier that the RBAC
-- seed already distrusts more (college_admin), matching its existing intent.
-- -----------------------------------------------------------------------------

create table if not exists public.role_change_requests (
  id uuid primary key default gen_random_uuid(),
  target_user uuid not null references public.profiles(id) on delete cascade,
  requested_role text not null,
  reason text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  -- Nullable, not `not null`, despite every real proposal always having one
  -- -- it has to tolerate `on delete set null` if the proposer's own account
  -- is later deleted (e.g. via the account-deletion-request workflow this
  -- same hardening pass adds), or deleting that account would fail outright
  -- with a foreign-key violation instead of just orphaning the historical
  -- record. requested_role/target_user/status still say what happened even
  -- with requested_by null.
  requested_by uuid references public.profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_reason text
);

create index if not exists role_change_requests_status_idx on public.role_change_requests(status, requested_at);
create index if not exists role_change_requests_target_idx on public.role_change_requests(target_user);

alter table public.role_change_requests enable row level security;

-- Admin-only read (proposer included, since current_user_is_admin() covers
-- both college_admin and super_admin) -- no client insert/update policy at
-- all, same "RPC-only writes" pattern as canteen_staff_accounts/
-- academic_deadlines/reminders elsewhere in this codebase.
create policy "role_change_requests_read" on public.role_change_requests for select to authenticated
  using (public.current_user_is_admin());

create or replace function public.propose_role_change(p_target_user uuid, p_new_role text, p_reason text default null)
returns public.role_change_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.role_change_requests;
begin
  if not public.current_user_is_admin() then
    raise exception 'Not authorized to propose role changes';
  end if;

  if p_new_role not in ('student','club_admin','vendor','vendor_staff','facilities_staff','faculty','college_admin','super_admin') then
    raise exception 'Invalid role %', p_new_role;
  end if;

  if not exists (select 1 from public.profiles where id = p_target_user) then
    raise exception 'User not found';
  end if;

  -- One live proposal per target at a time, same "no ever-growing history of
  -- attempts" reasoning submitStudentVerification()'s upsert already uses.
  update public.role_change_requests
    set status = 'cancelled', decided_by = auth.uid(), decided_at = now(), decision_reason = 'Superseded by a new proposal'
    where target_user = p_target_user and status = 'pending';

  insert into public.role_change_requests (target_user, requested_role, reason, requested_by)
  values (p_target_user, p_new_role, p_reason, auth.uid())
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.decide_role_change(p_request_id uuid, p_approve boolean, p_reason text default null)
returns public.role_change_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.role_change_requests;
  v_old_role text;
begin
  if not public.current_user_is_admin() then
    raise exception 'Not authorized to decide role changes';
  end if;

  select * into v_req from public.role_change_requests where id = p_request_id for update;
  if not found then
    raise exception 'Role change request not found';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'This request has already been decided';
  end if;

  -- The maker-checker itself: whoever proposed it cannot also approve it.
  if v_req.requested_by = auth.uid() then
    raise exception 'A different admin must approve this request';
  end if;

  -- Extra scrutiny on the most sensitive promotions: only an existing
  -- super_admin can approve a proposal that grants an admin tier. Originally
  -- gated on requested_role = 'super_admin' alone -- but two colluding (or
  -- compromised) college_admin accounts could still mint a brand-new
  -- college_admin between themselves with zero super_admin oversight (A
  -- proposes, B, a different college_admin, approves), defeating this exact
  -- migration's own stated intent that college_admin is the tier the RBAC
  -- seed already distrusts more. Both admin-tier targets now require an
  -- existing super_admin to approve.
  if v_req.requested_role in ('college_admin', 'super_admin') and not public.has_role(auth.uid(), 'super_admin') then
    raise exception 'Only a super_admin can approve a promotion to %', v_req.requested_role;
  end if;

  if p_approve then
    select role into v_old_role from public.profiles where id = v_req.target_user for update;

    perform set_config('campusos.allow_role_change', 'true', true);
    update public.profiles set role = v_req.requested_role where id = v_req.target_user;
    perform set_config('campusos.allow_role_change', 'false', true);

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_value, new_value, reason)
    values (auth.uid(), 'role.change', 'profile', v_req.target_user::text,
            jsonb_build_object('role', v_old_role), jsonb_build_object('role', v_req.requested_role),
            coalesce(p_reason, v_req.reason));

    update public.role_change_requests
      set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_reason = p_reason
      where id = p_request_id
      returning * into v_req;
  else
    update public.role_change_requests
      set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_reason = p_reason
      where id = p_request_id
      returning * into v_req;
  end if;

  return v_req;
end;
$$;

revoke execute on function public.propose_role_change(uuid, text, text) from public, anon;
revoke execute on function public.decide_role_change(uuid, boolean, text) from public, anon;

-- -----------------------------------------------------------------------------
-- BUG 2: student_verifications' insert policy didn't restrict the status
-- column -- a raw REST insert could set status:'verified' directly, skipping
-- admin review entirely. Same bug class already fixed elsewhere in this repo
-- (linkedin_verified_at, contact_email_verified_at) but missed here.
--
-- Also adds the self-scoped UPDATE policy submitStudentVerification()'s own
-- comment ("re-submitting after a rejection reuses the same row... resets it
-- back to pending") already assumed existed -- an upsert's ON CONFLICT DO
-- UPDATE branch needs a real UPDATE policy to succeed, and the only one that
-- existed was admin-only, so re-submission after a rejection was actually
-- unreachable for a real (non-admin) student before this.
-- -----------------------------------------------------------------------------

drop policy if exists "student_verifications_insert_own" on public.student_verifications;
create policy "student_verifications_insert_own" on public.student_verifications for insert to authenticated
  with check (
    auth.uid() = user_id
    and status = 'pending'
    and verified_at is null
    and verified_by is null
    and rejection_reason is null
  );

create policy "student_verifications_resubmit_own" on public.student_verifications for update to authenticated
  using (auth.uid() = user_id and status <> 'verified')
  with check (
    auth.uid() = user_id
    and status = 'pending'
    and verified_at is null
    and verified_by is null
    and rejection_reason is null
  );

-- -----------------------------------------------------------------------------
-- BUG 3 (found while building the deletion-request feature that needs this
-- column to actually stay admin-controlled, not part of the original audit):
-- profiles_update_self ("using (auth.uid() = id) with check (auth.uid() =
-- id)") has no column restriction at all -- only the `role` column is
-- protected by a trigger (protect_profile_role). `status` had no equivalent,
-- so any signed-in user could self-update their own profiles.status directly
-- via the client SDK, e.g. reversing their own suspension, or (once 'deleted'
-- becomes reachable in the next migration) marking themselves undeletable by
-- flipping straight back to 'active'. Mirrors protect_profile_role exactly.
-- -----------------------------------------------------------------------------

create or replace function public.protect_profile_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status
     and coalesce(current_setting('campusos.allow_status_change', true), 'false') <> 'true' then
    raise exception 'Account status changes must go through admin_set_user_status() or admin_process_account_deletion()';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_status on public.profiles;
create trigger profiles_protect_status
before update on public.profiles
for each row execute function public.protect_profile_status();

-- Recreate admin_set_user_status() (only defined once, in
-- 20260814002900_admin_user_management.sql) to set the new bypass flag around
-- its own status write -- otherwise the trigger above would now block it too.
create or replace function public.admin_set_user_status(
  p_target_user uuid,
  p_status text,
  p_reason text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
  v_old_status text;
begin
  if not (public.has_permission(auth.uid(), 'users.suspend') or public.current_user_is_admin()) then
    raise exception 'Not authorized to change account status';
  end if;

  if p_status not in ('active', 'suspended') then
    raise exception 'Invalid status %  -- only active/suspended are settable here', p_status;
  end if;

  select * into v_profile from public.profiles where id = p_target_user for update;
  if not found then
    raise exception 'User not found';
  end if;

  if v_profile.role in ('college_admin', 'super_admin') and p_target_user <> auth.uid() then
    raise exception 'Cannot suspend another admin account through this action';
  end if;

  v_old_status := v_profile.status;

  perform set_config('campusos.allow_status_change', 'true', true);
  update public.profiles
    set status = p_status, suspended_reason = case when p_status = 'suspended' then p_reason else null end
    where id = p_target_user
    returning * into v_profile;
  perform set_config('campusos.allow_status_change', 'false', true);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_value, new_value, reason)
  values (auth.uid(), 'status.change', 'profile', p_target_user::text,
          jsonb_build_object('status', v_old_status),
          jsonb_build_object('status', p_status), p_reason);

  return v_profile;
end;
$$;

grant execute on function public.admin_set_user_status(uuid, text, text) to authenticated;
