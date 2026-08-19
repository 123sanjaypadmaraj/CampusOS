-- =============================================================================
-- Facilities oversight (AdminCMS pass, part 2/5). Reads are already fully
-- covered: service_requests_read/bookings_read (20260814001100) already let
-- anyone holding tickets.read/bookings.approve or an admin see every row
-- campus-wide, not just their own -- so this admin tab is mostly a new
-- frontend view over data that was already reachable, not a new read path.
--
-- The one real gap: `service_requests.assigned_to` has existed as a column
-- since 0007 (doc-documented as part of 'tickets.update': "Triage, assign,
-- resolve tickets") but nothing has ever actually been able to SET it --
-- service_requests has no generic UPDATE policy (writes are RPC-gated
-- everywhere else in this table), and transition_ticket_status() only ever
-- touches status/resolution_notes. Assignment has been unreachable in
-- practice since the column was added. This RPC closes that gap.
-- =============================================================================

create or replace function public.assign_ticket(p_request_id uuid, p_staff_id uuid)
returns public.service_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_staff public.profiles;
  v_request public.service_requests;
begin
  if not (public.has_permission(v_user, 'tickets.update') or public.current_user_is_admin()) then
    raise exception 'Not authorized to assign this ticket';
  end if;

  select * into v_request from public.service_requests where id = p_request_id for update;
  if not found then
    raise exception 'Ticket not found';
  end if;

  if p_staff_id is not null then
    select * into v_staff from public.profiles where id = p_staff_id;
    if not found then
      raise exception 'Staff account not found';
    end if;
    if v_staff.role not in ('facilities_staff', 'college_admin', 'super_admin') then
      raise exception '% does not hold a facilities role and can''t be assigned a ticket', coalesce(v_staff.name, v_staff.email);
    end if;
  end if;

  update public.service_requests set assigned_to = p_staff_id where id = p_request_id returning * into v_request;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value)
  values (v_user, 'ticket.assign', 'service_request', p_request_id::text, jsonb_build_object('assigned_to', p_staff_id));

  return v_request;
end;
$$;

grant execute on function public.assign_ticket(uuid, uuid) to authenticated;
