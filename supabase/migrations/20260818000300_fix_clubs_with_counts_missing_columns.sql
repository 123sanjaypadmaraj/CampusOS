-- =============================================================================
-- Full-app bug-check pass (2026-08-18), continued: a real, LIVE PRODUCTION
-- bug found via a browser console error while walking through the vendor
-- dashboard ("Club loading failed: Object", with zero network request ever
-- sent -- meaning it failed client-side inside the query builder, not RLS).
--
-- Root cause: 20260814000500_events_clubs.sql created
-- `public.clubs_with_counts` as `select c.*, ... from public.clubs c`.
-- Postgres expands `c.*` into a FIXED column list at CREATE VIEW time -- it
-- is NOT re-evaluated on every query. 20260815001100_club_cms_complete.sql
-- later ran `alter table public.clubs add column recruitment_mode ...` and
-- `add column recruitment_message ...` on the base table, but never
-- re-created the view -- so `clubs_with_counts` has been missing both
-- columns ever since. `getClubs()` (src/services/mvpService.js) selects
-- `recruitment_mode`/`recruitment_message` from this view, so EVERY call to
-- it has been failing with `42703: column clubs_with_counts.recruitment_mode
-- does not exist` since that migration landed -- confirmed live on BOTH
-- staging and production via a read-only probe. Net effect: the clubs list
-- (Explore Clubs, club discovery, anywhere `getClubs()` is called) has been
-- silently empty for every real user since 2026-08-15, with the failure
-- only ever reaching the browser console, never surfaced to a user as an
-- error state.
--
-- Fix: re-create the view with the exact same definition. Postgres
-- re-expands `c.*` against the base table's CURRENT columns, picking up
-- recruitment_mode/recruitment_message for free. Byte-identical to the
-- original definition otherwise -- every RPC that already reads from this
-- view (get_club_dashboard, etc.) is unaffected.
-- =============================================================================

-- CREATE OR REPLACE VIEW can only append columns at the end, not shift where
-- an existing column sits -- and re-expanding `c.*` now inserts
-- recruitment_mode/recruitment_message ahead of the view's own computed
-- members/events columns, which CREATE OR REPLACE refuses ("cannot change
-- name of view column \"members\" to \"recruitment_mode\""). Nothing else in
-- this schema has a hard catalog dependency on this view (every consumer --
-- get_club_dashboard() etc. -- references it from inside a plpgsql function
-- body, which Postgres does not track as a view dependency), so a plain
-- drop-and-recreate is safe.
drop view if exists public.clubs_with_counts;

create view public.clubs_with_counts as
select c.*,
  (select count(*) from public.club_members m where m.club_id = c.id) as members,
  (select count(*) from public.events e where e.club_id = c.id) as events
from public.clubs c;
