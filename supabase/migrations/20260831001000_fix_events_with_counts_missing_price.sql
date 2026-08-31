-- =============================================================================
-- Fix: events_with_counts was last (re)created by
-- 20260819002000_events_production_completion.sql via `select e.*, ...` --
-- and a view's `*` expansion is fixed to the base table's column list AT
-- CREATE TIME in Postgres, not re-evaluated on later reads. events.price
-- was added afterwards, by 20260831000800_paid_events.sql, so the live view
-- never picked it up even though the base table has the column.
--
-- This silently breaks every read that expects events_with_counts.price to
-- exist:
--   * getCampusEvents() (src/services/mvpService/events.js) selects `price`
--     directly from events_with_counts -- the WHOLE campus events list
--     fails with a PostgREST "column does not exist" error, not just the
--     paid-event rows.
--   * get_club_dashboard() (paid_events.sql, section 10) reads e.price from
--     the same view inside its events array -- errors at call time.
--   * campus-assistant's propose_register_event tool (this pass) does the
--     same to surface price in what the AI tells a student before they
--     confirm registration.
--
-- Same drop-and-recreate as 20260819002000 (CREATE OR REPLACE VIEW can't
-- change/add columns via `*` expansion either -- same reasoning as that
-- migration's own comment). Definition is otherwise byte-for-byte
-- unchanged; only the effective column list picks up `price` (and any
-- other events column added since Aug 19, so this class of drift can't
-- recur unnoticed next time a column is added).
-- =============================================================================

drop view if exists public.events_with_counts;
create view public.events_with_counts as
select e.*,
  (select count(*) from public.event_registrations r where r.event_id = e.id and r.status = 'confirmed') as attendees,
  (select count(*) from public.event_attendance a where a.event_id = e.id) as checked_in_count,
  (select round(avg(f.rating)::numeric, 2) from public.event_feedback f where f.event_id = e.id) as avg_rating,
  (select count(*) from public.event_feedback f where f.event_id = e.id) as feedback_count
from public.events e;
