-- =============================================================================
-- 0038: CLUB/VENDOR REQUEST + APPROVAL WORKFLOW (doc §104)
-- =============================================================================
-- Before this, the only way to get a new club or vendor account into
-- CampusOS was for an admin to hand-provision it directly (AdminCMS's
-- Events & Clubs tab for clubs; scripts/setup-vendor-accounts.mjs for
-- vendors) -- no self-serve request, no approval trail. This adds a single
-- request/review flow for both. Note what it deliberately does NOT do:
-- auto-create a vendor's Supabase Auth account on approval. That requires
-- the Admin Auth API with the service_role key, which must never be
-- reachable from client code (see src/services/mvpService.js's own "Never
-- put the service_role key in the frontend" header) -- approving a vendor
-- request here marks it approved and is the trigger for an admin to run
-- the existing provisioning script; the UI says so rather than pretending
-- to fully automate a step it structurally cannot.

create table if not exists public.org_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  campus_id uuid references public.campuses(id) on delete cascade,
  request_type text not null check (request_type in ('club', 'vendor')),
  name text not null,
  description text not null,
  category text, -- club category, or vendor business type (canteen/print/etc.)
  contact_phone text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now()
);

create index if not exists org_requests_status_idx on public.org_requests(status, created_at);

alter table public.org_requests enable row level security;

create policy "org_requests_insert_own" on public.org_requests for insert to authenticated
  with check (requester_id = auth.uid());

create policy "org_requests_read" on public.org_requests for select to authenticated
  using (requester_id = auth.uid() or public.has_permission(auth.uid(), 'clubs.manage') or public.current_user_is_admin());

create policy "org_requests_update_mod" on public.org_requests for update to authenticated
  using (public.has_permission(auth.uid(), 'clubs.manage') or public.current_user_is_admin())
  with check (public.has_permission(auth.uid(), 'clubs.manage') or public.current_user_is_admin());

-- RPC: approve_club_request -- the one place a request turns into a real
-- club, so it's atomic with marking the request approved (same pattern as
-- moderate_content/admin_set_user_status: single audited entry point, not
-- a client-side "insert club then update request" two-step that could
-- leave a request stuck pending after the club already exists).
create or replace function public.approve_org_request(p_request_id uuid, p_reason text default null)
returns public.org_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.org_requests;
  v_club_id uuid;
begin
  if not (public.has_permission(auth.uid(), 'clubs.manage') or public.current_user_is_admin()) then
    raise exception 'Not authorized to approve requests';
  end if;

  select * into v_request from public.org_requests where id = p_request_id for update;
  if not found then
    raise exception 'Request not found';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Request already %', v_request.status;
  end if;

  if v_request.request_type = 'club' then
    insert into public.clubs (campus_id, name, category, description)
    values (v_request.campus_id, v_request.name, v_request.category, v_request.description)
    on conflict (campus_id, name) do nothing
    returning id into v_club_id;

    if v_club_id is not null then
      insert into public.club_members (club_id, user_id, role)
      values (v_club_id, v_request.requester_id, 'owner');
    end if;
  end if;
  -- request_type = 'vendor' has no automatic side effect -- see header
  -- comment. Approval here just records the decision; account
  -- provisioning is a manual follow-up (scripts/setup-vendor-accounts.mjs).

  update public.org_requests
    set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), rejection_reason = null
    where id = p_request_id
    returning * into v_request;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, reason)
  values (auth.uid(), 'org_request.approve', 'org_request', p_request_id::text, p_reason);

  return v_request;
end;
$$;

grant execute on function public.approve_org_request(uuid, text) to authenticated;

create or replace function public.reject_org_request(p_request_id uuid, p_reason text)
returns public.org_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.org_requests;
begin
  if not (public.has_permission(auth.uid(), 'clubs.manage') or public.current_user_is_admin()) then
    raise exception 'Not authorized to review requests';
  end if;

  update public.org_requests
    set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), rejection_reason = coalesce(p_reason, 'Not specified')
    where id = p_request_id and status = 'pending'
    returning * into v_request;

  if not found then
    raise exception 'Request not found or already reviewed';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, reason)
  values (auth.uid(), 'org_request.reject', 'org_request', p_request_id::text, p_reason);

  return v_request;
end;
$$;

grant execute on function public.reject_org_request(uuid, text) to authenticated;
