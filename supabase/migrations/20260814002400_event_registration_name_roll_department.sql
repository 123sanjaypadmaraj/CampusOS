-- =============================================================================
-- 0024: EVENT REGISTRATION -- editable name + roll number + department
-- =============================================================================
-- The registration confirmation dialog previously locked Name to the
-- signed-in profile (anti-spoofing, since it doubled as an identity check
-- alongside USN/email). The user now wants Name editable per-registration
-- (e.g. a preferred name), plus two new optional fields nothing captured
-- before: roll number (distinct from USN) and department (profiles.
-- department already existed but no UI ever wrote to it). USN and email
-- stay server-sourced from the profile -- those remain the actual identity
-- check; Name/roll number/department are just contact-card fields now.

alter table public.profiles add column if not exists roll_number text;

alter table public.event_registrations add column if not exists contact_roll_number text;
alter table public.event_registrations add column if not exists contact_department text;
alter table public.event_waitlist add column if not exists contact_roll_number text;
alter table public.event_waitlist add column if not exists contact_department text;

create or replace function public.register_for_event(
  p_event_id uuid,
  p_contact_phone text default null,
  p_contact_name text default null,
  p_roll_number text default null,
  p_department text default null
)
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
  v_name text;
  v_roll text := nullif(trim(p_roll_number), '');
  v_dept text := nullif(trim(p_department), '');
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

  -- Name is now editable per-registration (e.g. a preferred name) --
  -- falls back to the profile's name if left blank. USN/email stay
  -- server-sourced only, unspoofable.
  v_name := coalesce(nullif(trim(p_contact_name), ''), v_profile.name);
  if v_name is null or v_name = '' then
    raise exception 'CONTACT_NAME_INVALID: enter a name';
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

  -- Keep phone/roll number/department on file so they're prefilled again
  -- next time. Only overwrite roll number / department when a non-blank
  -- value was actually given, so leaving them blank this time doesn't wipe
  -- out what's already on file.
  update public.profiles set
      phone = v_phone,
      roll_number = coalesce(v_roll, roll_number),
      department = coalesce(v_dept, department),
      updated_at = now()
    where id = v_user
      and (phone is distinct from v_phone or v_roll is not null or v_dept is not null);

  select count(*) into v_confirmed_count from public.event_registrations where event_id = p_event_id and status = 'confirmed';

  if v_event.capacity is not null and v_confirmed_count >= v_event.capacity then
    select coalesce(max(position), 0) + 1 into v_next_position from public.event_waitlist where event_id = p_event_id;
    insert into public.event_waitlist (event_id, user_id, position, contact_name, contact_usn, contact_email, contact_phone, contact_roll_number, contact_department)
      values (p_event_id, v_user, v_next_position, v_name, v_profile.usn, v_profile.email, v_phone, v_roll, v_dept)
      on conflict (event_id, user_id) do update set
        position = excluded.position, contact_name = excluded.contact_name, contact_usn = excluded.contact_usn,
        contact_email = excluded.contact_email, contact_phone = excluded.contact_phone,
        contact_roll_number = excluded.contact_roll_number, contact_department = excluded.contact_department;
    update public.events set registration_status = 'WAITLIST' where id = p_event_id and registration_status = 'OPEN';
    return jsonb_build_object('status', 'waitlisted', 'position', v_next_position);
  end if;

  -- Revive a previously-cancelled row instead of erroring on the
  -- (event_id, user_id) unique constraint when re-registering.
  insert into public.event_registrations (event_id, user_id, contact_name, contact_usn, contact_email, contact_phone, contact_roll_number, contact_department, status, registered_at)
    values (p_event_id, v_user, v_name, v_profile.usn, v_profile.email, v_phone, v_roll, v_dept, 'confirmed', now())
    on conflict (event_id, user_id) do update set
      status = 'confirmed', contact_name = excluded.contact_name, contact_usn = excluded.contact_usn,
      contact_email = excluded.contact_email, contact_phone = excluded.contact_phone,
      contact_roll_number = excluded.contact_roll_number, contact_department = excluded.contact_department,
      registered_at = now()
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

-- Carry roll number / department forward on waitlist promotion too, same
-- as the other contact fields already do.
create or replace function public.cancel_event_registration(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_promoted record;
  v_event public.events;
  v_registration public.event_registrations;
begin
  select * into v_event from public.events where id = p_event_id for update;

  update public.event_registrations set status = 'cancelled'
    where event_id = p_event_id and user_id = v_user and status = 'confirmed'
    returning * into v_registration;

  if not found then
    raise exception 'No active registration found';
  end if;

  select * into v_promoted from public.event_waitlist where event_id = p_event_id order by position asc limit 1;
  if found then
    delete from public.event_waitlist where id = v_promoted.id;
    insert into public.event_registrations (event_id, user_id, contact_name, contact_usn, contact_email, contact_phone, contact_roll_number, contact_department)
      values (p_event_id, v_promoted.user_id, v_promoted.contact_name, v_promoted.contact_usn, v_promoted.contact_email, v_promoted.contact_phone, v_promoted.contact_roll_number, v_promoted.contact_department)
      on conflict (event_id, user_id) do update set
        status = 'confirmed', contact_name = excluded.contact_name, contact_usn = excluded.contact_usn,
        contact_email = excluded.contact_email, contact_phone = excluded.contact_phone,
        contact_roll_number = excluded.contact_roll_number, contact_department = excluded.contact_department;
    insert into public.event_tickets (event_id, registration_id)
      select p_event_id, id from public.event_registrations where event_id = p_event_id and user_id = v_promoted.user_id;
    insert into public.notifications (user_id, type, title, body, action_type, action_id)
      values (v_promoted.user_id, 'event', 'You are off the waitlist!',
              'A spot opened up for ' || coalesce(v_event.title,'an event') || '.', 'event', p_event_id::text);
  else
    update public.events set registration_status = 'OPEN' where id = p_event_id and registration_status in ('FULL','WAITLIST');
  end if;
end;
$$;
