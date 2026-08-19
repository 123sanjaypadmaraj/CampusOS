-- =============================================================================
-- SUPPORT TICKETS (module 42, new). Didn't exist in any form before this --
-- "issues"/`service_requests` in this app is facilities maintenance
-- (broken AC, leaking pipe), not general support (account problems, a
-- payment that didn't go through, "the app crashed"). campuses.support_
-- email/support_phone (20260818001100_campus_settings.sql) exist but
-- nothing has ever surfaced them -- this migration finally gives students
-- somewhere to actually go instead of a dead-end contact field.
--
-- Deliberately lightweight per explicit user decision made while planning
-- this pass: routed to the existing college_admin/super_admin pool via a new
-- `support.manage` permission, no new dedicated support-staff role. Same
-- overall shape as service_requests (ticket + status machine + assignment,
-- `assign_ticket` in 20260818000900_facilities_oversight.sql as the closest
-- precedent) but smaller: no SLA/priority fields, and a real threaded-reply
-- table (service_requests only has a single resolution_notes field; support
-- tickets need a back-and-forth conversation).
-- =============================================================================

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  campus_id uuid references public.campuses(id) on delete set null,
  category text not null default 'general'
    check (category in ('account', 'payment', 'technical', 'general', 'other')),
  subject text not null,
  description text not null default '',
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  assigned_to uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_tickets_user_idx on public.support_tickets(user_id, created_at desc);
create index if not exists support_tickets_status_idx on public.support_tickets(status, created_at desc);
create index if not exists support_tickets_campus_idx on public.support_tickets(campus_id);

drop trigger if exists support_tickets_set_updated_at on public.support_tickets;
create trigger support_tickets_set_updated_at
before update on public.support_tickets
for each row execute function public.set_updated_at();

create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  is_staff boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists support_ticket_messages_ticket_idx on public.support_ticket_messages(ticket_id, created_at);

alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;

insert into public.permissions (key, description) values
  ('support.manage', 'Triage, reply to, assign and resolve general support tickets')
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.key in ('college_admin', 'super_admin') and p.key = 'support.manage'
on conflict do nothing;

-- Reads only -- writes are RPC-only below, same "no insert/update policy for
-- authenticated" pattern as service_requests/bookings/orders.
create policy "support_tickets_read" on public.support_tickets for select to authenticated
  using (
    user_id = auth.uid()
    or assigned_to = auth.uid()
    or public.has_permission(auth.uid(), 'support.manage')
    or public.current_user_is_admin()
  );

create policy "support_ticket_messages_read" on public.support_ticket_messages for select to authenticated
  using (exists (
    select 1 from public.support_tickets t
    where t.id = support_ticket_messages.ticket_id
      and (t.user_id = auth.uid() or t.assigned_to = auth.uid()
           or public.has_permission(auth.uid(), 'support.manage') or public.current_user_is_admin())
  ));

-- =========================================================
-- RPC: create_support_ticket -- student-facing entry point. The reporting
-- student's own first message is inserted as the ticket's opening message
-- too, so the thread view never needs to special-case "the description
-- IS the first message" -- same shape as every messaging thread elsewhere
-- in this schema.
-- =========================================================

create or replace function public.create_support_ticket(
  p_category text,
  p_subject text,
  p_description text
)
returns public.support_tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_campus uuid;
  v_ticket public.support_tickets;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;
  if not public.check_rate_limit(v_user, 'support_tickets', 10, 3600) then
    raise exception 'RATE_LIMITED: too many support tickets submitted, slow down';
  end if;
  if p_category not in ('account', 'payment', 'technical', 'general', 'other') then
    raise exception 'Invalid category';
  end if;
  if p_subject is null or length(trim(p_subject)) = 0 then
    raise exception 'A subject is required';
  end if;

  select campus_id into v_campus from public.profiles where id = v_user;

  insert into public.support_tickets (user_id, campus_id, category, subject, description)
  values (v_user, v_campus, p_category, trim(p_subject), coalesce(trim(p_description), ''))
  returning * into v_ticket;

  if coalesce(trim(p_description), '') <> '' then
    insert into public.support_ticket_messages (ticket_id, sender_id, body, is_staff)
    values (v_ticket.id, v_user, trim(p_description), false);
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value)
  values (v_user, 'support_ticket.create', 'support_ticket', v_ticket.id::text, jsonb_build_object('category', p_category, 'subject', p_subject));

  return v_ticket;
end;
$$;

revoke all on function public.create_support_ticket(text, text, text) from public, anon;
grant execute on function public.create_support_ticket(text, text, text) to authenticated;

-- =========================================================
-- RPC: add_support_ticket_message -- either the ticket owner or assigned/
-- support.manage staff can reply. A staff reply auto-advances a still-open
-- ticket to in_progress (same "first real touch moves it off the raw queue"
-- convention transition_ticket_status's callers already follow for
-- service_requests); a student reply on a resolved/closed ticket reopens it.
-- =========================================================

create or replace function public.add_support_ticket_message(p_ticket_id uuid, p_body text)
returns public.support_ticket_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_ticket public.support_tickets;
  v_is_staff boolean;
  v_message public.support_ticket_messages;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;
  if p_body is null or length(trim(p_body)) = 0 then
    raise exception 'Message cannot be empty';
  end if;

  select * into v_ticket from public.support_tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'Ticket not found';
  end if;

  v_is_staff := public.has_permission(v_user, 'support.manage') or public.current_user_is_admin();

  if not (v_ticket.user_id = v_user or v_ticket.assigned_to = v_user or v_is_staff) then
    raise exception 'Not authorized to reply to this ticket';
  end if;

  insert into public.support_ticket_messages (ticket_id, sender_id, body, is_staff)
  values (p_ticket_id, v_user, trim(p_body), v_is_staff)
  returning * into v_message;

  if v_is_staff and v_ticket.status = 'open' then
    update public.support_tickets set status = 'in_progress' where id = p_ticket_id;
  elsif not v_is_staff and v_ticket.status in ('resolved', 'closed') then
    update public.support_tickets set status = 'open' where id = p_ticket_id;
  end if;

  perform public.create_notification(
    case when v_is_staff then v_ticket.user_id else coalesce(v_ticket.assigned_to, v_ticket.user_id) end,
    'New reply on your support ticket',
    left(trim(p_body), 140),
    'support', 'support_ticket', p_ticket_id::text
  );

  return v_message;
end;
$$;

revoke all on function public.add_support_ticket_message(uuid, text) from public, anon;
grant execute on function public.add_support_ticket_message(uuid, text) to authenticated;

-- =========================================================
-- RPC: set_support_ticket_status -- staff/admin only. The student's own
-- reopen path is handled inside add_support_ticket_message above, not here.
-- =========================================================

create or replace function public.set_support_ticket_status(p_ticket_id uuid, p_status text)
returns public.support_tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_ticket public.support_tickets;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;
  if not (public.has_permission(v_user, 'support.manage') or public.current_user_is_admin()) then
    raise exception 'Not authorized to update this ticket';
  end if;
  if p_status not in ('open', 'in_progress', 'resolved', 'closed') then
    raise exception 'Invalid status';
  end if;

  update public.support_tickets set status = p_status where id = p_ticket_id returning * into v_ticket;
  if not found then
    raise exception 'Ticket not found';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value)
  values (v_user, 'support_ticket.status_change', 'support_ticket', p_ticket_id::text, jsonb_build_object('status', p_status));

  if p_status in ('resolved', 'closed') then
    perform public.create_notification(
      v_ticket.user_id, 'Your support ticket was ' || p_status,
      v_ticket.subject, 'support', 'support_ticket', p_ticket_id::text
    );
  end if;

  return v_ticket;
end;
$$;

revoke all on function public.set_support_ticket_status(uuid, text) from public, anon;
grant execute on function public.set_support_ticket_status(uuid, text) to authenticated;

-- =========================================================
-- RPC: assign_support_ticket -- same shape as assign_ticket() (facilities),
-- staff-only, p_staff_id null unassigns. Not restricted to a specific role
-- (unlike assign_ticket's facilities_staff/college_admin/super_admin check)
-- since support has no dedicated staff role -- any support.manage/admin
-- holder can be assigned.
-- =========================================================

create or replace function public.assign_support_ticket(p_ticket_id uuid, p_staff_id uuid)
returns public.support_tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_staff public.profiles;
  v_ticket public.support_tickets;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;
  if not (public.has_permission(v_user, 'support.manage') or public.current_user_is_admin()) then
    raise exception 'Not authorized to assign this ticket';
  end if;

  select * into v_ticket from public.support_tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'Ticket not found';
  end if;

  if p_staff_id is not null then
    select * into v_staff from public.profiles where id = p_staff_id;
    if not found then
      raise exception 'Staff account not found';
    end if;
    if not (public.has_permission(p_staff_id, 'support.manage') or v_staff.role in ('college_admin', 'super_admin')) then
      raise exception '% does not hold support access and can''t be assigned this ticket', coalesce(v_staff.name, v_staff.email);
    end if;
  end if;

  update public.support_tickets set assigned_to = p_staff_id where id = p_ticket_id returning * into v_ticket;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value)
  values (v_user, 'support_ticket.assign', 'support_ticket', p_ticket_id::text, jsonb_build_object('assigned_to', p_staff_id));

  return v_ticket;
end;
$$;

revoke all on function public.assign_support_ticket(uuid, uuid) from public, anon;
grant execute on function public.assign_support_ticket(uuid, uuid) to authenticated;

do $$
declare
  t text;
  tables text[] := array['support_tickets', 'support_ticket_messages'];
begin
  foreach t in array tables loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
