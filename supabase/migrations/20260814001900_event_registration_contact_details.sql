-- =============================================================================
-- 0019: EVENT REGISTRATION CONTACT DETAILS
-- The "Register" button now shows a secondary confirmation dialog with the
-- registrant's name/USN/email (read straight from their profile -- already
-- known from login/signup) plus a phone number, which profiles never
-- captured before now. The RPCs, not the client, are the source of truth
-- for name/USN/email (copied server-side from public.profiles) so a
-- registrant can't spoof someone else's contact details; only the phone
-- number is client-supplied, validated, and echoed back onto profiles so
-- it's prefilled next time.
-- =============================================================================

alter table public.profiles add column if not exists phone text;

alter table public.event_registrations add column if not exists contact_name text;
alter table public.event_registrations add column if not exists contact_usn text;
alter table public.event_registrations add column if not exists contact_email text;
alter table public.event_registrations add column if not exists contact_phone text;

alter table public.event_waitlist add column if not exists contact_name text;
alter table public.event_waitlist add column if not exists contact_usn text;
alter table public.event_waitlist add column if not exists contact_email text;
alter table public.event_waitlist add column if not exists contact_phone text;

-- Loose on purpose (7-15 digits, optional leading +) -- campuses admit
-- international students too, this is a sanity check, not a country-format
-- validator.
do $$ begin
  alter table public.profiles drop constraint if exists profiles_phone_check;
  alter table public.profiles add constraint profiles_phone_check
    check (phone is null or phone ~ '^\+?[0-9]{7,15}$');
exception when others then null;
end $$;

do $$ begin
  alter table public.event_registrations drop constraint if exists event_registrations_contact_phone_check;
  alter table public.event_registrations add constraint event_registrations_contact_phone_check
    check (contact_phone is null or contact_phone ~ '^\+?[0-9]{7,15}$');
exception when others then null;
end $$;

do $$ begin
  alter table public.event_waitlist drop constraint if exists event_waitlist_contact_phone_check;
  alter table public.event_waitlist add constraint event_waitlist_contact_phone_check
    check (contact_phone is null or contact_phone ~ '^\+?[0-9]{7,15}$');
exception when others then null;
end $$;

-- register_for_event() gains a p_contact_phone argument -- drop the old
-- single-arg signature first so this replaces it instead of creating a
-- second overload (Postgres identifies functions by name+arg-types).
drop function if exists public.register_for_event(uuid);

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
        contact_name = excluded.contact_name, contact_usn = excluded.contact_usn,
        contact_email = excluded.contact_email, contact_phone = excluded.contact_phone;
    update public.events set registration_status = 'WAITLIST' where id = p_event_id and registration_status = 'OPEN';
    return jsonb_build_object('status', 'waitlisted', 'position', v_next_position);
  end if;

  insert into public.event_registrations (event_id, user_id, contact_name, contact_usn, contact_email, contact_phone)
    values (p_event_id, v_user, v_profile.name, v_profile.usn, v_profile.email, v_phone)
    returning * into v_registration;

  insert into public.event_tickets (event_id, registration_id) values (p_event_id, v_registration.id)
    returning * into v_ticket;

  if v_event.capacity is not null and v_confirmed_count + 1 >= v_event.capacity then
    update public.events set registration_status = 'FULL' where id = p_event_id;
  end if;

  return jsonb_build_object('status', 'confirmed', 'registration_id', v_registration.id, 'ticket_token', v_ticket.token);
end;
$$;

-- Carry the waitlisted registrant's already-collected contact details over
-- to their confirmed registration when a spot opens up, instead of leaving
-- those columns null.
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

  -- Promote the earliest waitlisted user, if any.
  select * into v_promoted from public.event_waitlist where event_id = p_event_id order by position asc limit 1;
  if found then
    delete from public.event_waitlist where id = v_promoted.id;
    insert into public.event_registrations (event_id, user_id, contact_name, contact_usn, contact_email, contact_phone)
      values (p_event_id, v_promoted.user_id, v_promoted.contact_name, v_promoted.contact_usn, v_promoted.contact_email, v_promoted.contact_phone)
      on conflict (event_id, user_id) do update set
        status = 'confirmed', contact_name = excluded.contact_name, contact_usn = excluded.contact_usn,
        contact_email = excluded.contact_email, contact_phone = excluded.contact_phone;
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
