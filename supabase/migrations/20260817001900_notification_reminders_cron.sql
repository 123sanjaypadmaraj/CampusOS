-- =============================================================================
-- 0150: EVENT + BOOKING REMINDERS (pg_cron)
-- Nothing time-based has ever existed in this schema -- every notification
-- to date has been fired synchronously off an action (an insert/update).
-- "Event reminder" and "Booking reminder" need something to wake up on a
-- schedule and look for what's coming up soon. pg_cron running inside
-- Postgres itself, calling plain SQL functions -- no external scheduler.
-- =============================================================================

create extension if not exists pg_cron;

alter table public.event_registrations add column if not exists reminder_sent_at timestamptz;
alter table public.bookings add column if not exists reminder_sent_at timestamptz;

-- ---------------------------------------------------------------------------
-- Event reminder -- fires once, roughly a day ahead (24-25h window so a
-- 15-minute sweep interval can't skip past it or double-send).
-- ---------------------------------------------------------------------------
create or replace function public.send_event_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    select er.id as registration_id, er.user_id, e.id as event_id, e.title, e.event_date, e.place
    from public.event_registrations er
    join public.events e on e.id = er.event_id
    where er.status = 'confirmed'
      and er.reminder_sent_at is null
      and e.registration_status <> 'CANCELLED'
      and e.event_date > now() + interval '23 hours'
      and e.event_date <= now() + interval '25 hours'
  loop
    perform public.create_notification(
      v_row.user_id, 'Reminder: ' || v_row.title || ' is tomorrow',
      v_row.title || ' starts ' || to_char(v_row.event_date, 'DD Mon, HH24:MI') ||
        case when v_row.place is not null then ' at ' || v_row.place else '' end || '.',
      'event', 'event', v_row.event_id::text,
      'event_reminder_' || v_row.registration_id::text
    );
    update public.event_registrations set reminder_sent_at = now() where id = v_row.registration_id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Booking reminder -- resource bookings are short-lived slots (a room, a
-- piece of equipment), so a day-ahead reminder isn't useful; this fires in
-- roughly the hour before the slot starts.
-- ---------------------------------------------------------------------------
create or replace function public.send_booking_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    select b.id as booking_id, b.user_id, b.start_time, r.name as resource_name
    from public.bookings b
    join public.resources r on r.id = b.resource_id
    where b.status = 'APPROVED'
      and b.reminder_sent_at is null
      and b.start_time > now() + interval '45 minutes'
      and b.start_time <= now() + interval '75 minutes'
  loop
    perform public.create_notification(
      v_row.user_id, 'Booking reminder',
      'Your booking for ' || coalesce(v_row.resource_name, 'a resource') || ' starts at ' || to_char(v_row.start_time, 'HH24:MI') || '.',
      'booking', 'booking', v_row.booking_id::text,
      'booking_reminder_' || v_row.booking_id::text
    );
    update public.bookings set reminder_sent_at = now() where id = v_row.booking_id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Schedule both sweeps + the delivery retry sweep (function defined in
-- 20260817001300) every 15 minutes. cron.schedule() upserts by job name in
-- modern pg_cron, but unschedule-then-schedule is used defensively since the
-- exact behavior varies by extension version.
-- ---------------------------------------------------------------------------
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'send-event-reminders';
  perform cron.unschedule(jobid) from cron.job where jobname = 'send-booking-reminders';
  perform cron.unschedule(jobid) from cron.job where jobname = 'retry-failed-deliveries';
exception when others then null;
end $$;

select cron.schedule('send-event-reminders', '*/15 * * * *', $$select public.send_event_reminders();$$);
select cron.schedule('send-booking-reminders', '*/15 * * * *', $$select public.send_booking_reminders();$$);
select cron.schedule('retry-failed-deliveries', '*/5 * * * *', $$select public.retry_failed_deliveries();$$);
