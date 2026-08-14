-- =============================================================================
-- 0005: CLUBS & EVENTS -- registration limits, waitlist, QR check-in
-- (doc §37-39).
-- =============================================================================

create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid references public.campuses(id) on delete cascade,
  name text not null,
  category text,
  description text,
  logo_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(campus_id, name)
);

alter table public.clubs add column if not exists active boolean not null default true;
alter table public.clubs add column if not exists created_at timestamptz not null default now();
-- members/events counters are now derived (see clubs_with_counts view) rather
-- than hand-maintained integer columns that can drift from reality. This
-- project's clubs table already had hand-maintained `members`/`events`
-- integer columns -- drop them so clubs_with_counts (which computes both
-- under the same names) doesn't collide with them.
alter table public.clubs drop column if exists members;
alter table public.clubs drop column if exists events;

create table if not exists public.club_members (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member'
    check (role in ('owner','president','vice_president','secretary','coordinator','member')),
  joined_at timestamptz not null default now(),
  unique(club_id, user_id)
);

create or replace view public.clubs_with_counts as
select c.*,
  (select count(*) from public.club_members m where m.club_id = c.id) as members,
  (select count(*) from public.events e where e.club_id = c.id) as events
from public.clubs c;

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid references public.campuses(id) on delete cascade,
  club_id uuid references public.clubs(id) on delete set null,
  organizer_id uuid references public.profiles(id) on delete set null,
  title text not null,
  category text,
  description text,
  event_date timestamptz not null,
  end_date timestamptz,
  place text,
  cover_image_url text,
  capacity integer,                 -- null = unlimited
  registration_status text not null default 'OPEN'
    check (registration_status in ('OPEN','FULL','WAITLIST','CLOSED','CANCELLED')),
  published boolean not null default true,
  created_at timestamptz not null default now(),
  unique(campus_id, title, event_date)
);

alter table public.events add column if not exists organizer_id uuid references public.profiles(id) on delete set null;
alter table public.events add column if not exists end_date timestamptz;
alter table public.events add column if not exists cover_image_url text;
alter table public.events add column if not exists capacity integer;
alter table public.events add column if not exists registration_status text not null default 'OPEN';
alter table public.events add column if not exists published boolean not null default true;
-- attendees is now derived from event_registrations, see events_with_counts.
-- This project's events table already had a hand-maintained `attendees`
-- integer column -- drop it so events_with_counts (which computes it under
-- the same name) doesn't collide with it.
alter table public.events drop column if exists attendees;

do $$ begin
  alter table public.events drop constraint if exists events_registration_status_check;
  alter table public.events add constraint events_registration_status_check
    check (registration_status in ('OPEN','FULL','WAITLIST','CLOSED','CANCELLED'));
exception when others then null;
end $$;

create table if not exists public.event_registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'confirmed' check (status in ('confirmed','cancelled')),
  registered_at timestamptz not null default now(),
  unique(event_id, user_id)
);

alter table public.event_registrations add column if not exists status text not null default 'confirmed';

-- Needed for the ON CONFLICT (event_id, user_id) clause in
-- cancel_event_registration()'s waitlist-promotion path -- add it in case
-- the live table predates this migration and wasn't created with it.
do $$ begin
  alter table public.event_registrations add constraint event_registrations_event_id_user_id_key unique (event_id, user_id);
exception when duplicate_table then null; when duplicate_object then null;
end $$;

create table if not exists public.event_waitlist (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  position integer not null,
  created_at timestamptz not null default now(),
  unique(event_id, user_id)
);

create table if not exists public.event_tickets (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  registration_id uuid not null references public.event_registrations(id) on delete cascade,
  -- 'base64url' as an encode() target only exists from Postgres 18 -- build
  -- it manually so this works on PG < 18 too (this project runs PG 17).
  token text not null unique default translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_'),
  checked_in_at timestamptz,
  checked_in_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.event_attendance (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  checked_in_at timestamptz not null default now(),
  unique(event_id, user_id)
);

create table if not exists public.saved_events (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create or replace view public.events_with_counts as
select e.*,
  (select count(*) from public.event_registrations r where r.event_id = e.id and r.status = 'confirmed') as attendees
from public.events e;

-- =========================================================
-- RPC: register_for_event -- atomically enforces capacity and moves the
-- registrant to a waitlist when full instead of racing on a client-side
-- count (doc §35, §38).
-- =========================================================

create or replace function public.register_for_event(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_event public.events;
  v_confirmed_count integer;
  v_next_position integer;
  v_registration public.event_registrations;
  v_ticket public.event_tickets;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;

  if not public.check_rate_limit(v_user, 'event_registrations', 20, 3600) then
    raise exception 'RATE_LIMITED: too many registration attempts, slow down';
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

  select count(*) into v_confirmed_count from public.event_registrations where event_id = p_event_id and status = 'confirmed';

  if v_event.capacity is not null and v_confirmed_count >= v_event.capacity then
    select coalesce(max(position), 0) + 1 into v_next_position from public.event_waitlist where event_id = p_event_id;
    insert into public.event_waitlist (event_id, user_id, position) values (p_event_id, v_user, v_next_position)
      on conflict (event_id, user_id) do nothing;
    update public.events set registration_status = 'WAITLIST' where id = p_event_id and registration_status = 'OPEN';
    return jsonb_build_object('status', 'waitlisted', 'position', v_next_position);
  end if;

  insert into public.event_registrations (event_id, user_id) values (p_event_id, v_user)
    returning * into v_registration;

  insert into public.event_tickets (event_id, registration_id) values (p_event_id, v_registration.id)
    returning * into v_ticket;

  if v_event.capacity is not null and v_confirmed_count + 1 >= v_event.capacity then
    update public.events set registration_status = 'FULL' where id = p_event_id;
  end if;

  return jsonb_build_object('status', 'confirmed', 'registration_id', v_registration.id, 'ticket_token', v_ticket.token);
end;
$$;

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
    insert into public.event_registrations (event_id, user_id) values (p_event_id, v_promoted.user_id)
      on conflict (event_id, user_id) do update set status = 'confirmed';
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

create or replace function public.checkin_event_ticket(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_ticket public.event_tickets;
  v_reg public.event_registrations;
begin
  if not (public.has_permission(v_user, 'events.checkin') or public.current_user_is_admin()) then
    raise exception 'Not authorized to check in attendees';
  end if;

  select * into v_ticket from public.event_tickets where token = p_token for update;
  if not found then
    raise exception 'TICKET_INVALID';
  end if;
  if v_ticket.checked_in_at is not null then
    raise exception 'TICKET_ALREADY_USED';
  end if;

  select * into v_reg from public.event_registrations where id = v_ticket.registration_id;

  update public.event_tickets set checked_in_at = now(), checked_in_by = v_user where id = v_ticket.id;
  insert into public.event_attendance (event_id, user_id) values (v_ticket.event_id, v_reg.user_id)
    on conflict (event_id, user_id) do nothing;

  return jsonb_build_object('event_id', v_ticket.event_id, 'user_id', v_reg.user_id);
end;
$$;

create index if not exists events_campus_date_idx on public.events(campus_id, event_date);
create index if not exists event_reg_user_idx on public.event_registrations(user_id);
create index if not exists event_reg_event_idx on public.event_registrations(event_id);
create index if not exists event_waitlist_event_idx on public.event_waitlist(event_id, position);
