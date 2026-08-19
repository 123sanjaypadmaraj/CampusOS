-- =============================================================================
-- Real bug found live in a manual browser smoke test (not by inspection):
-- add_support_ticket_message() (20260819000600_support_tickets.sql) computed
-- `v_is_staff` from permissions alone (has_permission(...,'support.manage')
-- or current_user_is_admin()), never checking whether the replier is also
-- the ticket's own reporter. A college_admin/super_admin filing their OWN
-- support ticket (a real scenario -- admins have account/payment problems
-- too, same as anyone else) had every one of their own replies mislabelled
-- "Campus support" instead of "You" in the thread, and silently flipped a
-- freshly-OPEN ticket straight to in_progress on their own first reply, as
-- if staff had already picked it up.
-- =============================================================================

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

  v_is_staff := v_user <> v_ticket.user_id
    and (public.has_permission(v_user, 'support.manage') or public.current_user_is_admin());

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
