-- =============================================================================
-- 0054: staging is missing event_registrations.registered_at entirely.
-- =============================================================================
-- Found live-testing event registration against staging: register_for_event()
-- (rewritten by 20260814002400_event_registration_name_roll_department.sql to
-- explicitly insert registered_at = now() on conflict) 400'd with 42703
-- "column registered_at does not exist" -- every single event registration
-- attempt on staging was silently broken. Same root cause as 0053's
-- events.club_id fix: staging's event_registrations table predates this
-- migration set (it already had its own timestamp column, `created_at`,
-- from the old pre-hardening schema) and 20260814000500_events_clubs.sql's
-- `create table if not exists` was a no-op against it, so registered_at
-- was simply never added -- unlike every other column this table gained
-- since (status, contact_*), which all got proper
-- `add column if not exists` follow-ups. Production already has this
-- column, so this is a no-op there.

alter table public.event_registrations add column if not exists registered_at timestamptz not null default now();

-- Backfill from the legacy created_at column where present, same
-- "exception when undefined_column" pattern used for resources.active ->
-- available (20260814000700_services_bookings.sql).
do $$ begin
  update public.event_registrations set registered_at = created_at where registered_at is null;
exception when undefined_column then null;
end $$;
