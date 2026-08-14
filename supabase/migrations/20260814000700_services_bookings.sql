-- =============================================================================
-- 0007: CAMPUS SERVICES / FACILITIES TICKETS / RESOURCE BOOKING
-- (doc §31-35). Double-booking is prevented at the database level with a
-- PostgreSQL exclusion constraint, not merely a frontend check.
-- =============================================================================

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid references public.campuses(id) on delete cascade,
  name text not null,
  category text not null default 'Other'
    check (category in ('Wi-Fi','AC','Electrical','Projector','Furniture','Cleaning','Plumbing','Security','Other')),
  description text,
  active boolean not null default true,
  unique(campus_id, name)
);

alter table public.services add column if not exists category text not null default 'Other';
do $$ begin
  alter table public.services drop constraint if exists services_category_check;
  alter table public.services add constraint services_category_check
    check (category in ('Wi-Fi','AC','Electrical','Projector','Furniture','Cleaning','Plumbing','Security','Other'));
exception when others then null; end $$;

create table if not exists public.service_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  service_id uuid references public.services(id),
  campus_id uuid references public.campuses(id) on delete cascade,
  title text not null,
  category text not null default 'Other',
  location_id uuid, -- FK to public.locations added below, once that table exists in this same migration
  location text,
  details jsonb not null default '{}',
  attachment_urls text[] not null default '{}',
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'SUBMITTED'
    check (status in ('SUBMITTED','TRIAGED','ASSIGNED','IN_PROGRESS','WAITING','RESOLVED','CLOSED')),
  assigned_to uuid references public.profiles(id),
  sla_due_at timestamptz,
  resolution_notes text,
  satisfaction_rating integer check (satisfaction_rating between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.service_requests add column if not exists campus_id uuid references public.campuses(id) on delete cascade;
alter table public.service_requests add column if not exists category text not null default 'Other';
alter table public.service_requests add column if not exists location text;
alter table public.service_requests add column if not exists attachment_urls text[] not null default '{}';
alter table public.service_requests add column if not exists priority text not null default 'normal';
alter table public.service_requests add column if not exists assigned_to uuid references public.profiles(id);
alter table public.service_requests add column if not exists sla_due_at timestamptz;
alter table public.service_requests add column if not exists resolution_notes text;
alter table public.service_requests add column if not exists satisfaction_rating integer;
alter table public.service_requests add column if not exists updated_at timestamptz not null default now();

update public.service_requests set status = 'SUBMITTED' where status = 'pending';
do $$ begin
  alter table public.service_requests drop constraint if exists service_requests_status_check;
  alter table public.service_requests add constraint service_requests_status_check
    check (status in ('SUBMITTED','TRIAGED','ASSIGNED','IN_PROGRESS','WAITING','RESOLVED','CLOSED'));
exception when others then null; end $$;

drop trigger if exists service_requests_set_updated_at on public.service_requests;
create trigger service_requests_set_updated_at
before update on public.service_requests
for each row execute function public.set_updated_at();

create table if not exists public.service_request_comments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.service_requests(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.service_request_status_transitions (
  from_status text not null,
  to_status text not null,
  primary key (from_status, to_status)
);
insert into public.service_request_status_transitions (from_status, to_status) values
  ('SUBMITTED','TRIAGED'), ('SUBMITTED','CLOSED'),
  ('TRIAGED','ASSIGNED'), ('TRIAGED','CLOSED'),
  ('ASSIGNED','IN_PROGRESS'),
  ('IN_PROGRESS','WAITING'), ('IN_PROGRESS','RESOLVED'),
  ('WAITING','IN_PROGRESS'), ('WAITING','RESOLVED'),
  ('RESOLVED','CLOSED'), ('RESOLVED','IN_PROGRESS')
on conflict do nothing;

create or replace function public.transition_ticket_status(p_request_id uuid, p_to_status text, p_notes text default null)
returns public.service_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_request public.service_requests;
begin
  if not (public.has_permission(v_user, 'tickets.update') or public.current_user_is_admin()) then
    raise exception 'Not authorized to update this ticket';
  end if;

  select * into v_request from public.service_requests where id = p_request_id for update;
  if not found then raise exception 'Ticket not found'; end if;

  if not exists (select 1 from public.service_request_status_transitions where from_status = v_request.status and to_status = p_to_status) then
    raise exception 'TICKET_INVALID_TRANSITION: cannot move % -> %', v_request.status, p_to_status;
  end if;

  update public.service_requests set status = p_to_status,
    resolution_notes = coalesce(p_notes, resolution_notes)
    where id = p_request_id returning * into v_request;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value)
  values (v_user, 'ticket.status.change', 'service_request', p_request_id::text, jsonb_build_object('status', p_to_status));

  return v_request;
end;
$$;

-- =========================================================
-- RESOURCE BOOKING (doc §34-35)
-- =========================================================

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid references public.campuses(id) on delete cascade,
  name text not null,
  type text,
  building text,
  floor text,
  room text,
  latitude numeric,
  longitude numeric,
  unique(campus_id, name)
);

alter table public.locations add column if not exists latitude numeric;
alter table public.locations add column if not exists longitude numeric;

do $$ begin
  alter table public.service_requests
    add constraint service_requests_location_id_fkey
    foreign key (location_id) references public.locations(id);
exception when duplicate_object then null;
end $$;

create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid references public.campuses(id) on delete cascade,
  name text not null,
  resource_type text,
  location_id uuid references public.locations(id),
  capacity integer,
  opening_hours jsonb not null default '{"open":"08:00","close":"20:00"}',
  approval_required boolean not null default false,
  buffer_minutes integer not null default 0,
  available boolean not null default true,
  unique(campus_id, name)
);

alter table public.resources add column if not exists opening_hours jsonb not null default '{"open":"08:00","close":"20:00"}';
alter table public.resources add column if not exists approval_required boolean not null default false;
alter table public.resources add column if not exists buffer_minutes integer not null default 0;
alter table public.resources add column if not exists capacity integer;
-- This project's resources table used `active`, not `available`, for the
-- same purpose -- add `available` and backfill it from `active` if present.
alter table public.resources add column if not exists available boolean not null default true;
do $$ begin
  update public.resources set available = active where active is not null;
exception when undefined_column then null;
end $$;

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources(id),
  user_id uuid not null references public.profiles(id) on delete cascade,
  start_time timestamptz not null,
  end_time timestamptz not null,
  status text not null default 'PENDING'
    check (status in ('PENDING','APPROVED','REJECTED','CANCELLED','COMPLETED')),
  notes text,
  approved_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);

update public.bookings set status = 'APPROVED' where status = 'confirmed';
update public.bookings set status = 'PENDING' where status = 'pending';
do $$ begin
  alter table public.bookings drop constraint if exists bookings_status_check;
  alter table public.bookings add constraint bookings_status_check
    check (status in ('PENDING','APPROVED','REJECTED','CANCELLED','COMPLETED'));
exception when others then null; end $$;

-- The actual double-booking guard: only PENDING/APPROVED bookings occupy a
-- slot, and no two such bookings for the same resource may overlap. This is
-- enforced by Postgres itself, independent of any application code.
do $$ begin
  alter table public.bookings add constraint bookings_no_overlap
    exclude using gist (
      resource_id with =,
      tstzrange(start_time, end_time) with &&
    ) where (status in ('PENDING','APPROVED'));
exception when duplicate_object then null;
end $$;

create or replace function public.create_booking(
  p_resource_id uuid,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_notes text default null
)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_resource public.resources;
  v_booking public.bookings;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if not public.check_rate_limit(v_user, 'bookings', 15, 3600) then
    raise exception 'RATE_LIMITED: too many booking attempts, slow down';
  end if;
  if p_end_time <= p_start_time then raise exception 'End time must be after start time'; end if;

  select * into v_resource from public.resources where id = p_resource_id;
  if not found or not v_resource.available then
    raise exception 'Resource is not available for booking';
  end if;

  begin
    insert into public.bookings (resource_id, user_id, start_time, end_time, notes, status)
    values (p_resource_id, v_user, p_start_time, p_end_time, p_notes,
            case when v_resource.approval_required then 'PENDING' else 'APPROVED' end)
    returning * into v_booking;
  exception when exclusion_violation then
    raise exception 'BOOKING_SLOT_TAKEN: this resource is already booked for the requested time';
  end;

  return v_booking;
end;
$$;

create or replace function public.set_booking_status(p_booking_id uuid, p_status text)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_booking public.bookings;
begin
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;

  if p_status = 'CANCELLED' then
    if v_booking.user_id <> v_user and not public.current_user_is_admin() then
      raise exception 'Not authorized to cancel this booking';
    end if;
  else
    if not (public.has_permission(v_user, 'bookings.approve') or public.current_user_is_admin()) then
      raise exception 'Not authorized to approve/reject bookings';
    end if;
  end if;

  update public.bookings set status = p_status, approved_by = case when p_status = 'APPROVED' then v_user else approved_by end
    where id = p_booking_id returning * into v_booking;

  return v_booking;
end;
$$;

create index if not exists service_requests_user_idx on public.service_requests(user_id);
create index if not exists service_requests_status_idx on public.service_requests(status);
create index if not exists service_requests_created_idx on public.service_requests(created_at desc);
create index if not exists bookings_resource_time_idx on public.bookings(resource_id, start_time, end_time);
create index if not exists bookings_user_idx on public.bookings(user_id);
