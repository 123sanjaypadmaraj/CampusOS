-- =============================================================================
-- 0056: VERIFIED EMERGENCY CONTACTS DIRECTORY (doc §113, gap identified
-- against the SOS work in 0055)
-- =============================================================================
-- SOS dispatch itself is real (0055: a persisted alert, realtime responder
-- visibility, audited acknowledge/resolve) but a responder who actually
-- picks up a real emergency has no way to reach anyone on the student's
-- behalf -- there was no next-of-kin/emergency-contact data anywhere in the
-- schema. This migration adds a small, purpose-built directory: each
-- student can self-report up to 5 contacts, a facilities/admin reviewer
-- marks a contact "verified" (confirmed the number is real, e.g. by
-- calling it) so responders aren't trusting unverified self-reported data
-- in a real crisis, and a dedicated RPC lets a responder pull a student's
-- contacts only in the context of a genuine active/acknowledged SOS alert
-- -- not a standing "browse every student's family phone numbers" grant.

create table if not exists public.emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  contact_name text not null,
  relationship text not null
    check (relationship in ('parent', 'guardian', 'sibling', 'spouse', 'relative', 'friend', 'other')),
  phone text not null,
  alt_phone text,
  email text,
  is_primary boolean not null default false,
  verified boolean not null default false,
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  verification_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists emergency_contacts_user_idx on public.emergency_contacts(user_id);
create index if not exists emergency_contacts_verified_idx on public.emergency_contacts(verified, created_at);
-- At most one primary contact per student -- a partial unique index rather
-- than a trigger; upsert_emergency_contact() unsets any existing primary
-- before setting a new one, inside the same transaction, so this never
-- actually rejects a legitimate caller.
create unique index if not exists emergency_contacts_one_primary_idx
  on public.emergency_contacts(user_id) where is_primary;

drop trigger if exists emergency_contacts_set_updated_at on public.emergency_contacts;
create trigger emergency_contacts_set_updated_at
before update on public.emergency_contacts
for each row execute function public.set_updated_at();

-- Suspended accounts shouldn't be able to write here either -- same
-- BEFORE INSERT trigger every other user-writable table uses (0030/0031).
-- reject_if_suspended()'s CASE falls through to `new.user_id` for any
-- table it doesn't special-case, which is exactly this table's shape.
drop trigger if exists emergency_contacts_reject_if_suspended on public.emergency_contacts;
create trigger emergency_contacts_reject_if_suspended
before insert on public.emergency_contacts
for each row execute function public.reject_if_suspended();

alter table public.emergency_contacts enable row level security;

-- No direct insert/update/delete policy at all, by design -- every write
-- goes through the RPCs below. This is deliberate, not an oversight: the
-- LinkedIn-verification incident (20260814003300) showed that a permissive
-- self-UPDATE policy makes a "verified" flag trivially spoofable by a raw
-- PATCH even when an RPC also exists to set it properly. RPC-only writes
-- (same pattern as sos_alerts/orders) means there is no column to guard --
-- there's simply no path that isn't the RPC.
create policy "emergency_contacts_read" on public.emergency_contacts for select to authenticated
  using (
    user_id = auth.uid()
    or public.has_permission(auth.uid(), 'emergency_contacts.verify')
    or public.current_user_is_admin()
  );

insert into public.permissions (key, description) values
  ('emergency_contacts.verify', 'Review and verify students'' emergency/next-of-kin contacts')
on conflict (key) do nothing;

with rp as (
  select r.id as role_id, p.id as permission_id
  from public.roles r
  join public.permissions p on p.key = 'emergency_contacts.verify'
  where r.key in ('facilities_staff', 'college_admin', 'super_admin')
)
insert into public.role_permissions (role_id, permission_id)
select role_id, permission_id from rp
on conflict do nothing;

-- =========================================================
-- RPC: upsert_emergency_contact -- the only way a student adds/edits their
-- own contact. Editing an existing (already-verified) contact resets it
-- back to unverified: the whole point of verification is confirming *this
-- exact* name/number is real, so a silent edit after approval can't keep
-- the checkmark.
-- =========================================================

create or replace function public.upsert_emergency_contact(
  p_id uuid default null,
  p_contact_name text default null,
  p_relationship text default null,
  p_phone text default null,
  p_alt_phone text default null,
  p_email text default null,
  p_is_primary boolean default false
)
returns public.emergency_contacts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_existing public.emergency_contacts;
  v_count integer;
  v_row public.emergency_contacts;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;
  if p_contact_name is null or length(trim(p_contact_name)) = 0 then
    raise exception 'Contact name is required';
  end if;
  if p_relationship not in ('parent', 'guardian', 'sibling', 'spouse', 'relative', 'friend', 'other') then
    raise exception 'Invalid relationship';
  end if;
  if p_phone is null or p_phone !~ '^\+?[0-9]{7,15}$' then
    raise exception 'Enter a valid phone number for this contact';
  end if;
  if p_alt_phone is not null and length(trim(p_alt_phone)) > 0 and p_alt_phone !~ '^\+?[0-9]{7,15}$' then
    raise exception 'Enter a valid alternate phone number, or leave it blank';
  end if;

  if not public.check_rate_limit(v_user, 'emergency_contacts_write', 20, 3600) then
    raise exception 'RATE_LIMITED: too many emergency contact changes, slow down';
  end if;

  if p_id is not null then
    select * into v_existing from public.emergency_contacts where id = p_id;
    if not found or v_existing.user_id <> v_user then
      raise exception 'Contact not found';
    end if;
  else
    select count(*) into v_count from public.emergency_contacts where user_id = v_user;
    if v_count >= 5 then
      raise exception 'You can have at most 5 emergency contacts -- remove one first';
    end if;
  end if;

  if p_is_primary then
    update public.emergency_contacts set is_primary = false
      where user_id = v_user and is_primary and id is distinct from p_id;
  end if;

  if p_id is not null then
    update public.emergency_contacts set
      contact_name = trim(p_contact_name),
      relationship = p_relationship,
      phone = trim(p_phone),
      alt_phone = nullif(trim(coalesce(p_alt_phone, '')), ''),
      email = nullif(trim(coalesce(p_email, '')), ''),
      is_primary = p_is_primary,
      -- editing resets verification -- see header comment.
      verified = false, verified_by = null, verified_at = null, verification_notes = null
    where id = p_id
    returning * into v_row;
  else
    insert into public.emergency_contacts (
      user_id, contact_name, relationship, phone, alt_phone, email, is_primary
    ) values (
      v_user, trim(p_contact_name), p_relationship, trim(p_phone),
      nullif(trim(coalesce(p_alt_phone, '')), ''), nullif(trim(coalesce(p_email, '')), ''), p_is_primary
    ) returning * into v_row;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id)
  values (v_user, case when p_id is null then 'emergency_contact.create' else 'emergency_contact.update' end, 'emergency_contact', v_row.id::text);

  return v_row;
end;
$$;

grant execute on function public.upsert_emergency_contact(uuid, text, text, text, text, text, boolean) to authenticated;

create or replace function public.delete_emergency_contact(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  delete from public.emergency_contacts where id = p_id and user_id = v_user;
  if not found then
    raise exception 'Contact not found';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id)
  values (v_user, 'emergency_contact.delete', 'emergency_contact', p_id::text);
end;
$$;

grant execute on function public.delete_emergency_contact(uuid) to authenticated;

-- =========================================================
-- RPC: verify_emergency_contact -- the reviewer side. Also resettable back
-- to unverified (p_verified = false) in case a reviewer confirms a number
-- is actually dead/wrong, without deleting the row out from under the
-- student.
-- =========================================================

create or replace function public.verify_emergency_contact(
  p_id uuid,
  p_verified boolean,
  p_notes text default null
)
returns public.emergency_contacts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.emergency_contacts;
begin
  if not (public.has_permission(v_user, 'emergency_contacts.verify') or public.current_user_is_admin()) then
    raise exception 'Not authorized to verify emergency contacts';
  end if;

  update public.emergency_contacts set
    verified = p_verified,
    verified_by = case when p_verified then v_user else null end,
    verified_at = case when p_verified then now() else null end,
    verification_notes = p_notes
  where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'Contact not found';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, reason)
  values (v_user, case when p_verified then 'emergency_contact.verify' else 'emergency_contact.unverify' end, 'emergency_contact', p_id::text, p_notes);

  return v_row;
end;
$$;

grant execute on function public.verify_emergency_contact(uuid, boolean, text) to authenticated;

-- =========================================================
-- RPC: admin_list_pending_emergency_contacts -- the verification queue.
-- SECURITY DEFINER so it can resolve student name/USN itself rather than
-- relying on a profiles embed, which would silently return nulls for a
-- facilities_staff reviewer the same way get_report_context()/
-- transition_ticket_status() call sites already had to work around --
-- facilities_staff holds emergency_contacts.verify but not the broader
-- users.read that a direct profiles RLS embed would need.
-- =========================================================

create or replace function public.admin_list_pending_emergency_contacts()
returns table (
  id uuid, user_id uuid, contact_name text, relationship text, phone text,
  alt_phone text, email text, is_primary boolean, created_at timestamptz,
  student_name text, student_usn text, student_course text, student_year text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if not (public.has_permission(v_user, 'emergency_contacts.verify') or public.current_user_is_admin()) then
    raise exception 'Not authorized to view emergency contact verification requests';
  end if;

  return query
    select c.id, c.user_id, c.contact_name, c.relationship, c.phone, c.alt_phone, c.email,
      c.is_primary, c.created_at, p.name, p.usn, p.course, p.year
    from public.emergency_contacts c
    join public.profiles p on p.id = c.user_id
    where c.verified = false
    order by c.created_at asc;
end;
$$;

grant execute on function public.admin_list_pending_emergency_contacts() to authenticated;

-- =========================================================
-- RPC: get_emergency_contacts_for_alert -- the SOS-response integration
-- point. Deliberately narrower than "any sos.respond holder can browse any
-- student's contacts": only works against a real active/acknowledged
-- alert, scoped to the same campus visibility list_active_sos_alerts()
-- already uses, and every call is audit-logged (who pulled whose
-- emergency contacts, and when) since this is sensitive personal data
-- being accessed under real-emergency justification.
-- =========================================================

create or replace function public.get_emergency_contacts_for_alert(p_alert_id uuid)
returns table (
  id uuid, contact_name text, relationship text, phone text, alt_phone text,
  email text, is_primary boolean, verified boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_campus uuid;
  v_alert public.sos_alerts;
begin
  if not (public.has_permission(v_user, 'sos.respond') or public.current_user_is_admin()) then
    raise exception 'Not authorized to view SOS alert contacts';
  end if;

  -- Qualified with the table alias -- RETURNS TABLE(id uuid, ...) makes
  -- `id` a live PL/pgSQL variable throughout this function body, so a bare
  -- `where id = ...` is ambiguous against sos_alerts.id (caught live: see
  -- scripts/live-check-emergency-contacts.mjs).
  select * into v_alert from public.sos_alerts sa where sa.id = p_alert_id;
  if not found then
    raise exception 'Alert not found';
  end if;
  if v_alert.status not in ('active', 'acknowledged') then
    raise exception 'Alert is no longer active';
  end if;

  select p.campus_id into v_campus from public.profiles p where p.id = v_user;
  if not (public.has_role(v_user, 'super_admin') or v_alert.campus_id = v_campus or v_alert.campus_id is null) then
    raise exception 'Not authorized to view this alert';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id)
  values (v_user, 'sos.view_emergency_contacts', 'sos_alert', p_alert_id::text);

  return query
    select c.id, c.contact_name, c.relationship, c.phone, c.alt_phone, c.email, c.is_primary, c.verified
    from public.emergency_contacts c
    where c.user_id = v_alert.user_id
    order by c.is_primary desc, c.verified desc, c.created_at asc;
end;
$$;

grant execute on function public.get_emergency_contacts_for_alert(uuid) to authenticated;
