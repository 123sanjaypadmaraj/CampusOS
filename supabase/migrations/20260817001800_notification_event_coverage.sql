-- =============================================================================
-- 0140: NOTIFICATION EVENT COVERAGE
-- Closes the event-type gaps found in the 2026-08-17 notification audit:
--   Food:     vendor was never alerted about a new order (student-side
--             "order received" already worked -- notify_order_status_change,
--             0010, fires generically on every status transition including
--             CREATED/PAYMENT_PENDING -> RECEIVED).
--   Services: "ticket received" never fired -- the existing trigger only
--             covers status *changes*, and a ticket's first row is an INSERT.
--   Booking:  same gap -- "requested" never fired, only later status changes.
--   Social:   comments/replies had zero notification wiring (plain RLS
--             table, no RPC, no trigger).
--   Events:   registration/cancellation/changes had zero notification wiring.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- FOOD: new-order alert to the canteen owner + active staff.
-- ---------------------------------------------------------------------------
create or replace function public.notify_new_order_to_vendor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_canteen public.canteens;
  v_staff record;
begin
  if new.status = 'RECEIVED' and (old.status is distinct from 'RECEIVED') then
    select * into v_canteen from public.canteens where id = new.canteen_id;
    if v_canteen.owner_id is not null then
      perform public.create_notification(
        v_canteen.owner_id, 'New order received',
        'Order ' || upper(left(new.id::text, 8)) || ' (₹' || new.total || ') is waiting to be accepted.',
        'order', 'order', new.id::text
      );
    end if;
    for v_staff in select user_id from public.canteen_staff_accounts where canteen_id = new.canteen_id and active
    loop
      perform public.create_notification(
        v_staff.user_id, 'New order received',
        'Order ' || upper(left(new.id::text, 8)) || ' (₹' || new.total || ') is waiting to be accepted.',
        'order', 'order', new.id::text
      );
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_notify_vendor on public.orders;
create trigger orders_notify_vendor
after update of status on public.orders
for each row execute function public.notify_new_order_to_vendor();

-- ---------------------------------------------------------------------------
-- SERVICES: ticket received -- confirm to the student, alert staff/admins.
-- ---------------------------------------------------------------------------
create or replace function public.notify_ticket_received()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff record;
begin
  perform public.create_notification(
    new.user_id, 'Ticket received',
    coalesce(new.title, 'Your service request') || ' has been submitted and is awaiting triage.',
    'service', 'service', new.id::text
  );

  for v_staff in
    select ur.user_id as id
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.profiles p on p.id = ur.user_id
    where r.key in ('facilities_staff', 'college_admin', 'super_admin')
      and (new.campus_id is null or p.campus_id = new.campus_id)
  loop
    perform public.create_notification(
      v_staff.id, 'New service ticket',
      coalesce(new.title, 'A service request') || ' was just submitted (' || new.priority || ' priority).',
      'service', 'service', new.id::text
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists service_requests_notify_received on public.service_requests;
create trigger service_requests_notify_received
after insert on public.service_requests
for each row execute function public.notify_ticket_received();

-- ---------------------------------------------------------------------------
-- BOOKING: requested -- confirm to the student; alert staff/admins only when
-- the resource actually requires manual approval (auto-approved resources
-- don't need a human to look at the queue).
-- ---------------------------------------------------------------------------
create or replace function public.notify_booking_requested()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resource public.resources;
  v_staff record;
begin
  select * into v_resource from public.resources where id = new.resource_id;

  perform public.create_notification(
    new.user_id, 'Booking request submitted',
    'Your booking for ' || coalesce(v_resource.name, 'a resource') || ' on ' || to_char(new.start_time, 'DD Mon, HH24:MI') || ' is ' ||
      (case when v_resource.approval_required then 'awaiting approval.' else 'confirmed.' end),
    'booking', 'booking', new.id::text
  );

  if v_resource.approval_required then
    for v_staff in
      select ur.user_id as id
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      join public.profiles p on p.id = ur.user_id
      where r.key in ('facilities_staff', 'college_admin', 'super_admin')
        and (v_resource.campus_id is null or p.campus_id = v_resource.campus_id)
    loop
      perform public.create_notification(
        v_staff.id, 'Booking needs approval',
        coalesce(v_resource.name, 'A resource') || ' was requested for ' || to_char(new.start_time, 'DD Mon, HH24:MI') || '.',
        'booking', 'booking', new.id::text
      );
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_notify_requested on public.bookings;
create trigger bookings_notify_requested
after insert on public.bookings
for each row execute function public.notify_booking_requested();

-- ---------------------------------------------------------------------------
-- SOCIAL: comment on a post / reply to a comment.
-- ---------------------------------------------------------------------------
create or replace function public.notify_comment_or_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.posts;
  v_parent public.comments;
  v_author_name text;
begin
  select name into v_author_name from public.profiles where id = new.author_id;

  if new.parent_comment_id is not null then
    select * into v_parent from public.comments where id = new.parent_comment_id;
    if v_parent.author_id is not null and v_parent.author_id <> new.author_id then
      perform public.create_notification(
        v_parent.author_id, coalesce(v_author_name, 'Someone') || ' replied to your comment',
        left(new.content, 140),
        'community', 'post', new.post_id::text
      );
    end if;
  else
    select * into v_post from public.posts where id = new.post_id;
    if v_post.author_id is not null and v_post.author_id <> new.author_id then
      perform public.create_notification(
        v_post.author_id, coalesce(v_author_name, 'Someone') || ' commented on your post',
        left(new.content, 140),
        'community', 'post', new.post_id::text
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists comments_notify on public.comments;
create trigger comments_notify
after insert on public.comments
for each row execute function public.notify_comment_or_reply();

-- ---------------------------------------------------------------------------
-- EVENTS: registration confirmation.
-- ---------------------------------------------------------------------------
create or replace function public.notify_event_registration()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events;
begin
  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status is distinct from 'confirmed') then
    select * into v_event from public.events where id = new.event_id;
    perform public.create_notification(
      new.user_id, 'You''re registered!',
      'You''re registered for ' || coalesce(v_event.title, 'the event') ||
        case when v_event.event_date is not null then ' on ' || to_char(v_event.event_date, 'DD Mon, HH24:MI') else '' end || '.',
      'event', 'event', new.event_id::text
    );
  end if;
  return new;
end;
$$;

drop trigger if exists event_registrations_notify on public.event_registrations;
create trigger event_registrations_notify
after insert or update of status on public.event_registrations
for each row execute function public.notify_event_registration();

-- ---------------------------------------------------------------------------
-- EVENTS: whole-event cancellation + detail changes (date/venue), fanned out
-- to every currently-confirmed registrant.
-- ---------------------------------------------------------------------------
create or replace function public.notify_event_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_registrant record;
begin
  if new.registration_status = 'CANCELLED' and old.registration_status is distinct from 'CANCELLED' then
    for v_registrant in select user_id from public.event_registrations where event_id = new.id and status = 'confirmed'
    loop
      perform public.create_notification(
        v_registrant.user_id, 'Event cancelled',
        new.title || ' has been cancelled.',
        'event', 'event', new.id::text
      );
    end loop;
  elsif new.registration_status <> 'CANCELLED'
    and (new.event_date is distinct from old.event_date
      or new.end_date is distinct from old.end_date
      or new.place is distinct from old.place) then
    for v_registrant in select user_id from public.event_registrations where event_id = new.id and status = 'confirmed'
    loop
      perform public.create_notification(
        v_registrant.user_id, 'Event details changed',
        new.title || ' has been updated -- ' || to_char(new.event_date, 'DD Mon, HH24:MI') ||
          case when new.place is not null then ' at ' || new.place else '' end || '.',
        'event', 'event', new.id::text
      );
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists events_notify_changed on public.events;
create trigger events_notify_changed
after update on public.events
for each row execute function public.notify_event_changed();
