-- =============================================================================
-- SUPPORT TICKETS: priority, escalation, screenshot attachments (follow-up to
-- 20260819000600_support_tickets.sql). That migration deliberately shipped
-- "no SLA/priority fields" -- this closes that gap plus two more asked for
-- in the same pass: an escalation path and letting a student attach a
-- screenshot when they file or reply to a ticket.
--
-- Escalation model (explicit user decision): no new role tier above
-- college_admin/super_admin -- escalating a ticket sets priority='urgent'
-- and notifies everyone in the existing support.manage/admin pool for that
-- ticket's campus, same "no dedicated support-staff role" call the base
-- migration made.
-- =============================================================================

alter table public.support_tickets
  add column if not exists priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent'));

create index if not exists support_tickets_priority_idx on public.support_tickets(priority, created_at desc);

alter table public.support_ticket_messages
  add column if not exists attachment_url text;

-- =========================================================
-- Storage: support-media bucket for ticket screenshots. Private (not
-- lost-found/marketplace's public-read pattern) -- a payment or account
-- screenshot can contain personal info, so only the ticket's own
-- participants and support staff should ever see it. Same owner-folder
-- write convention as every other bucket (20260814001500_storage_buckets.sql):
-- object path is `${auth.uid()}/...`.
-- =========================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('support-media', 'support-media', false, 10485760, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "support_media_owner_rw" on storage.objects;
create policy "support_media_owner_rw" on storage.objects for all to authenticated
  using (bucket_id = 'support-media' and ((storage.foldername(name))[1] = auth.uid()::text
    or public.has_permission(auth.uid(), 'support.manage') or public.current_user_is_admin()))
  with check (bucket_id = 'support-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- =========================================================
-- create_support_ticket: additive p_attachment_url param (CREATE OR REPLACE
-- with a new trailing default-valued param is safe, doesn't change the
-- existing call sites' behavior). Attaches to the opening message, same as
-- the description text already does.
-- =========================================================

create or replace function public.create_support_ticket(
  p_category text,
  p_subject text,
  p_description text,
  p_attachment_url text default null
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

  if coalesce(trim(p_description), '') <> '' or coalesce(trim(p_attachment_url), '') <> '' then
    insert into public.support_ticket_messages (ticket_id, sender_id, body, is_staff, attachment_url)
    values (v_ticket.id, v_user, trim(coalesce(p_description, '')), false, nullif(trim(coalesce(p_attachment_url, '')), ''));
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value)
  values (v_user, 'support_ticket.create', 'support_ticket', v_ticket.id::text, jsonb_build_object('category', p_category, 'subject', p_subject));

  return v_ticket;
end;
$$;

revoke all on function public.create_support_ticket(text, text, text, text) from public, anon;
grant execute on function public.create_support_ticket(text, text, text, text) to authenticated;

-- =========================================================
-- add_support_ticket_message: additive p_attachment_url param, same shape.
-- A message with a body of '' but a real attachment is now allowed (was
-- previously rejected by the "message cannot be empty" check).
-- =========================================================

create or replace function public.add_support_ticket_message(p_ticket_id uuid, p_body text, p_attachment_url text default null)
returns public.support_ticket_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_ticket public.support_tickets;
  v_is_staff boolean;
  v_attachment text := nullif(trim(coalesce(p_attachment_url, '')), '');
  v_message public.support_ticket_messages;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;
  if (p_body is null or length(trim(p_body)) = 0) and v_attachment is null then
    raise exception 'Message cannot be empty';
  end if;

  select * into v_ticket from public.support_tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'Ticket not found';
  end if;

  v_is_staff := public.has_permission(v_user, 'support.manage') or public.current_user_is_admin();

  -- SECURITY FIX (found live-testing this migration, pre-existing since
  -- 20260819000600): `v_ticket.assigned_to = v_user` is NULL, not false,
  -- on every unassigned ticket -- SQL's three-valued logic then makes
  -- `false OR NULL OR false` evaluate to NULL, and `if not NULL` is falsy
  -- in plpgsql, so the whole authorization check silently passed for ANY
  -- signed-in user on ANY unassigned ticket. Explicit IS NOT NULL guard
  -- closes it.
  if not (v_ticket.user_id = v_user or (v_ticket.assigned_to is not null and v_ticket.assigned_to = v_user) or v_is_staff) then
    raise exception 'Not authorized to reply to this ticket';
  end if;

  insert into public.support_ticket_messages (ticket_id, sender_id, body, is_staff, attachment_url)
  values (p_ticket_id, v_user, trim(coalesce(p_body, '')), v_is_staff, v_attachment)
  returning * into v_message;

  if v_is_staff and v_ticket.status = 'open' then
    update public.support_tickets set status = 'in_progress' where id = p_ticket_id;
  elsif not v_is_staff and v_ticket.status in ('resolved', 'closed') then
    update public.support_tickets set status = 'open' where id = p_ticket_id;
  end if;

  perform public.create_notification(
    case when v_is_staff then v_ticket.user_id else coalesce(v_ticket.assigned_to, v_ticket.user_id) end,
    'New reply on your support ticket',
    left(trim(coalesce(p_body, 'Sent an attachment')), 140),
    'support', 'support_ticket', p_ticket_id::text
  );

  return v_message;
end;
$$;

revoke all on function public.add_support_ticket_message(uuid, text, text) from public, anon;
grant execute on function public.add_support_ticket_message(uuid, text, text) to authenticated;

-- =========================================================
-- RPC: set_support_ticket_priority -- staff/admin only, any of the 4 levels.
-- Distinct from escalate_support_ticket below (student-triggerable, urgent
-- only) so staff retriage (e.g. downgrading a false alarm) isn't blocked.
-- =========================================================

create or replace function public.set_support_ticket_priority(p_ticket_id uuid, p_priority text)
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
  if p_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'Invalid priority';
  end if;

  update public.support_tickets set priority = p_priority where id = p_ticket_id returning * into v_ticket;
  if not found then
    raise exception 'Ticket not found';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value)
  values (v_user, 'support_ticket.priority_change', 'support_ticket', p_ticket_id::text, jsonb_build_object('priority', p_priority));

  return v_ticket;
end;
$$;

revoke all on function public.set_support_ticket_priority(uuid, text) from public, anon;
grant execute on function public.set_support_ticket_priority(uuid, text) to authenticated;

-- =========================================================
-- RPC: escalate_support_ticket -- the ticket owner (stuck waiting) or staff
-- can trigger this. Sets priority to urgent (never downgrades -- escalating
-- an already-urgent ticket just re-notifies), optionally posts p_reason as
-- a message, and notifies every support.manage/admin holder scoped to the
-- ticket's campus (global role holders included, same scoping has_permission
-- already applies elsewhere). Rate-limited per user so it can't be used to
-- spam the whole admin pool.
-- =========================================================

create or replace function public.escalate_support_ticket(p_ticket_id uuid, p_reason text default null)
returns public.support_tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_ticket public.support_tickets;
  v_is_staff boolean;
  v_recipient record;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;

  select * into v_ticket from public.support_tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'Ticket not found';
  end if;

  v_is_staff := public.has_permission(v_user, 'support.manage') or public.current_user_is_admin();
  -- Same NULL-vs-false pitfall fixed in add_support_ticket_message above --
  -- assigned_to is NULL on most tickets, so an unguarded `= v_user` makes
  -- the whole OR chain evaluate to NULL (falsy in `if not ...`) instead of
  -- true, letting any signed-in user through.
  if not (v_ticket.user_id = v_user or (v_ticket.assigned_to is not null and v_ticket.assigned_to = v_user) or v_is_staff) then
    raise exception 'Not authorized to escalate this ticket';
  end if;
  if v_ticket.status in ('resolved', 'closed') then
    raise exception 'Reopen this ticket before escalating it';
  end if;
  if not v_is_staff and not public.check_rate_limit(v_user, 'support_ticket_escalate', 5, 3600) then
    raise exception 'RATE_LIMITED: too many escalations, slow down';
  end if;

  update public.support_tickets set priority = 'urgent' where id = p_ticket_id returning * into v_ticket;

  if coalesce(trim(p_reason), '') <> '' then
    insert into public.support_ticket_messages (ticket_id, sender_id, body, is_staff)
    values (p_ticket_id, v_user, trim(p_reason), v_is_staff);
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value)
  values (v_user, 'support_ticket.escalate', 'support_ticket', p_ticket_id::text, jsonb_build_object('reason', p_reason));

  for v_recipient in
    select distinct pr.id
    from public.profiles pr
    where pr.id <> v_user
      and (
        (pr.role in ('college_admin', 'super_admin') and (v_ticket.campus_id is null or pr.campus_id = v_ticket.campus_id))
        or public.has_permission(pr.id, 'support.manage', v_ticket.campus_id)
      )
  loop
    perform public.create_notification(
      v_recipient.id,
      'Support ticket escalated',
      left(v_ticket.subject, 140),
      'support', 'support_ticket', p_ticket_id::text,
      'support_escalate_' || p_ticket_id::text
    );
  end loop;

  return v_ticket;
end;
$$;

revoke all on function public.escalate_support_ticket(uuid, text) from public, anon;
grant execute on function public.escalate_support_ticket(uuid, text) to authenticated;
