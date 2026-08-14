-- =============================================================================
-- 0023: FIX register_for_event() RE-REGISTRATION AFTER CANCELLING
-- event_registrations has a unique (event_id, user_id) constraint (doc §35-
-- style dedup), but register_for_event()'s INSERT never handled the case
-- where a *cancelled* row already exists for that pair -- re-registering
-- for an event you'd previously cancelled threw a raw 23505 duplicate-key
-- error instead of reviving the row. Same fix applied to the waitlist path
-- for consistency (a user could analogously re-waitlist after leaving).
-- =============================================================================

create or replace function public.register_for_event(p_event_id uuid, p_contact_phone text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_event public.events;
  v_profile public.profiles;
  v_confirmed_count integer;
  v_next_position integer;
  v_registration public.event_registrations;
  v_ticket public.event_tickets;
  v_phone text := nullif(trim(p_contact_phone), '');
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;

  if not public.check_rate_limit(v_user, 'event_registrations', 20, 3600) then
    raise exception 'RATE_LIMITED: too many registration attempts, slow down';
  end if;

  if v_phone is null or v_phone !~ '^\+?[0-9]{7,15}$' then
    raise exception 'CONTACT_PHONE_INVALID: enter a valid phone number';
  end if;

  select * into v_profile from public.profiles where id = v_user;
  if not found then
    raise exception 'Profile not found';
  end if;

  select * into v_event from public.events where id = p_event_id for update;
  if not found then
    raise exception 'Event not found';
  end if;

  if v_event.registration_status in ('CLOSED','CANCELLED') then
    raise exception 'EVENT_REGISTRATION_CLOSED';
  end if;

  if exists (select 1 from public.event_registrations where event_id = p_event_id and user_id = v_user and status = 'confirmed') then
    raise exception 'EVENT_ALREADY_REGISTERED';
  end if;

  -- Keep the phone number on file so it's prefilled again next time.
  update public.profiles set phone = v_phone, updated_at = now()
    where id = v_user and phone is distinct from v_phone;
  v_profile.phone := v_phone;

  select count(*) into v_confirmed_count from public.event_registrations where event_id = p_event_id and status = 'confirmed';

  if v_event.capacity is not null and v_confirmed_count >= v_event.capacity then
    select coalesce(max(position), 0) + 1 into v_next_position from public.event_waitlist where event_id = p_event_id;
    insert into public.event_waitlist (event_id, user_id, position, contact_name, contact_usn, contact_email, contact_phone)
      values (p_event_id, v_user, v_next_position, v_profile.name, v_profile.usn, v_profile.email, v_phone)
      on conflict (event_id, user_id) do update set
        position = excluded.position, contact_name = excluded.contact_name, contact_usn = excluded.contact_usn,
        contact_email = excluded.contact_email, contact_phone = excluded.contact_phone;
    update public.events set registration_status = 'WAITLIST' where id = p_event_id and registration_status = 'OPEN';
    return jsonb_build_object('status', 'waitlisted', 'position', v_next_position);
  end if;

  -- Revive a previously-cancelled row instead of erroring on the
  -- (event_id, user_id) unique constraint when re-registering.
  insert into public.event_registrations (event_id, user_id, contact_name, contact_usn, contact_email, contact_phone, status, registered_at)
    values (p_event_id, v_user, v_profile.name, v_profile.usn, v_profile.email, v_phone, 'confirmed', now())
    on conflict (event_id, user_id) do update set
      status = 'confirmed', contact_name = excluded.contact_name, contact_usn = excluded.contact_usn,
      contact_email = excluded.contact_email, contact_phone = excluded.contact_phone, registered_at = now()
    returning * into v_registration;

  -- A prior cancelled attempt may have left a stale, already-checked-in-or-
  -- not ticket behind; start clean rather than accumulate duplicate tickets.
  delete from public.event_tickets where registration_id = v_registration.id;
  insert into public.event_tickets (event_id, registration_id) values (p_event_id, v_registration.id)
    returning * into v_ticket;

  if v_event.capacity is not null and v_confirmed_count + 1 >= v_event.capacity then
    update public.events set registration_status = 'FULL' where id = p_event_id;
  end if;

  return jsonb_build_object('status', 'confirmed', 'registration_id', v_registration.id, 'ticket_token', v_ticket.token);
end;
$$;
