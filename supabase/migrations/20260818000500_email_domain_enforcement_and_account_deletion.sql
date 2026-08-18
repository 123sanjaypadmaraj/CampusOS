-- =============================================================================
-- Auth & identity hardening pass, part 2/2: server-side email-domain
-- enforcement (doc "Student" checklist: "Confirm official NHCE email domain"
-- / "Verify email-domain restrictions") + a real account-deletion-request
-- workflow (doc "Student" checklist: "Account deletion request").
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Server-side email-domain enforcement.
--
-- sendMagicLink() (mvpService.js) already checks the domain client-side
-- before calling supabase.auth.signInWithOtp() -- but that's trivially
-- bypassed by calling signInWithOtp()/signUp() directly against the Supabase
-- Auth API, which this trigger can't be skipped by since it fires on the
-- actual auth.users insert regardless of which client path created it.
--
-- Allow-list mirrors the client-side check exactly (nhce.edu.in /
-- newhorizonindia.edu / gmail.com) so this doesn't change who can already
-- sign up, only closes the bypass -- plus the two carve-outs every existing
-- legitimate account-creation path in this codebase actually uses:
--   - @usn.campusos.internal: synthetic emails, only ever minted server-side
--     by the signup-with-usn Edge Function (service_role key required to
--     call auth.admin.createUser at all) or scripts/setup-admin-account.mjs's
--     bootstrap, never something a client can type into a sign-in form.
--   - every vendor/facilities-staff account this repo's own setup scripts
--     create (scripts/setup-vendor-accounts.mjs, setup-facilities-account.mjs)
--     already uses a real @nhce.edu.in address, so no separate service-role
--     carve-out is needed for them.
--
-- Whether @gmail.com should still be allowed for an "official NHCE email
-- domain" checklist item is a real product-policy question, not something
-- decided here -- this migration only moves the EXISTING policy server-side
-- unchanged, flagged for the user to revisit separately.
-- -----------------------------------------------------------------------------

create or replace function public.enforce_signup_email_domain()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(coalesce(new.email, ''));
begin
  if v_email = '' then
    return new; -- Supabase Auth's own constraints handle a missing email
  end if;

  if v_email like '%@usn.campusos.internal' then
    return new;
  end if;

  if v_email like '%@nhce.edu.in'
     or v_email like '%@newhorizonindia.edu'
     or v_email like '%@gmail.com' then
    return new;
  end if;

  raise exception 'Please use an allowed college email domain (@nhce.edu.in)';
end;
$$;

drop trigger if exists auth_users_enforce_email_domain on auth.users;
create trigger auth_users_enforce_email_domain
before insert on auth.users
for each row execute function public.enforce_signup_email_domain();

-- The INSERT trigger alone only covers signup. A signed-in student can also
-- call the ordinary client SDK's supabase.auth.updateUser({ email }) to
-- change their own email post-signup -- with no UPDATE trigger, that path
-- skipped domain enforcement entirely, defeating this migration's own stated
-- purpose (closing exactly this class of API-level bypass). Reuses the same
-- function unchanged (it only ever reads NEW.email, which both INSERT and
-- UPDATE triggers populate identically); WHEN limits it to rows where the
-- email is actually changing, so unrelated profile/session updates on
-- auth.users aren't re-checked for no reason.
drop trigger if exists auth_users_enforce_email_domain_update on auth.users;
create trigger auth_users_enforce_email_domain_update
before update on auth.users
for each row when (new.email is distinct from old.email)
execute function public.enforce_signup_email_domain();

-- -----------------------------------------------------------------------------
-- Account deletion request (doc "Student" checklist item). profiles.status's
-- CHECK constraint has included 'deleted' since 20260814000100 but nothing
-- ever set it -- an unreachable placeholder value, not a real flow. This adds
-- one: a student requests deletion (self-service, always safe -- it's just a
-- pending row), an admin reviews and either completes it (soft-deletes: sets
-- status='deleted', which reject_if_suspended() below now also blocks
-- exactly like 'suspended') or rejects the request (account untouched).
--
-- Deliberately NOT a hard DELETE of the auth.users/profiles row -- almost
-- every table in this schema references profiles.id, most with
-- `on delete cascade` (orders, posts, payments, audit trail...), so a real
-- delete would silently destroy financial/moderation records that need to
-- outlive the account. Soft-delete (same posture as suspension, permanent
-- instead of reversible-by-admin) is the safe default; a true GDPR-style
-- erasure/anonymization pass is a bigger, separate decision.
-- -----------------------------------------------------------------------------

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  reason text,
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'rejected', 'cancelled')),
  requested_at timestamptz not null default now(),
  processed_by uuid references public.profiles(id) on delete set null,
  processed_at timestamptz,
  admin_note text
);

create index if not exists account_deletion_requests_status_idx on public.account_deletion_requests(status, requested_at);

alter table public.account_deletion_requests enable row level security;

create policy "account_deletion_requests_read" on public.account_deletion_requests for select to authenticated
  using (auth.uid() = user_id or public.current_user_is_admin());
-- RPC-only writes below, same "no client insert/update policy" pattern used
-- throughout this codebase (canteen_staff_accounts, role_change_requests...).

create or replace function public.request_account_deletion(p_reason text default null)
returns public.account_deletion_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.account_deletion_requests;
begin
  if auth.uid() is null then
    raise exception 'Please sign in first.';
  end if;

  -- One live request at a time, same pattern as
  -- submitStudentVerification()/propose_role_change() above.
  update public.account_deletion_requests
    set status = 'cancelled', processed_at = now()
    where user_id = auth.uid() and status = 'pending';

  insert into public.account_deletion_requests (user_id, reason)
  values (auth.uid(), p_reason)
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.cancel_account_deletion_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.account_deletion_requests
    set status = 'cancelled', processed_at = now()
    where id = p_request_id and user_id = auth.uid() and status = 'pending';

  if not found then
    raise exception 'No pending deletion request found to cancel';
  end if;
end;
$$;

create or replace function public.admin_process_account_deletion(p_request_id uuid, p_action text, p_note text default null)
returns public.account_deletion_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.account_deletion_requests;
  v_target_role text;
begin
  if not public.current_user_is_admin() then
    raise exception 'Not authorized to process account deletion requests';
  end if;

  if p_action not in ('complete', 'reject') then
    raise exception 'Invalid action %  -- only complete/reject are settable here', p_action;
  end if;

  select * into v_req from public.account_deletion_requests where id = p_request_id for update;
  if not found then
    raise exception 'Deletion request not found';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'This request has already been processed';
  end if;

  if p_action = 'complete' then
    select role into v_target_role from public.profiles where id = v_req.user_id;
    if v_target_role in ('college_admin', 'super_admin') then
      raise exception 'Admin accounts cannot be deleted through this action';
    end if;

    perform set_config('campusos.allow_status_change', 'true', true);
    update public.profiles set status = 'deleted', suspended_reason = null where id = v_req.user_id;
    perform set_config('campusos.allow_status_change', 'false', true);

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_value, new_value, reason)
    values (auth.uid(), 'account.delete', 'profile', v_req.user_id::text,
            jsonb_build_object('status', 'active'), jsonb_build_object('status', 'deleted'), p_note);
  end if;

  update public.account_deletion_requests
    set status = case when p_action = 'complete' then 'completed' else 'rejected' end,
        processed_by = auth.uid(), processed_at = now(), admin_note = p_note
    where id = p_request_id
    returning * into v_req;

  return v_req;
end;
$$;

revoke execute on function public.request_account_deletion(text) from public, anon;
revoke execute on function public.cancel_account_deletion_request(uuid) from public, anon;
revoke execute on function public.admin_process_account_deletion(uuid, text, text) from public, anon;

-- reject_if_suspended() (latest version: 20260814003100) now also blocks a
-- 'deleted' account the same way it already blocks 'suspended' -- the
-- account being gone should stop new writes exactly like being suspended
-- does, not leave a silent gap the checklist item would otherwise still flag.
create or replace function public.reject_if_suspended()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_status text;
begin
  if TG_TABLE_NAME = 'posts' or TG_TABLE_NAME = 'comments' then
    v_user := new.author_id;
  elsif TG_TABLE_NAME = 'marketplace_listings' then
    v_user := new.seller_id;
  else
    v_user := new.user_id;
  end if;

  if v_user is null then
    return new;
  end if;

  select status into v_status from public.profiles where id = v_user;

  if v_status = 'suspended' then
    raise exception 'ACCOUNT_SUSPENDED: your account has been suspended and cannot do this. Contact a campus admin.';
  end if;

  if v_status = 'deleted' then
    raise exception 'ACCOUNT_DELETED: this account has been deleted and cannot do this.';
  end if;

  return new;
end;
$$;
