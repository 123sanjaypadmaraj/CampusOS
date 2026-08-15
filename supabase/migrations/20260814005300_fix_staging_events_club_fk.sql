-- =============================================================================
-- 0053: staging is missing events.club_id's foreign key to clubs entirely.
-- =============================================================================
-- Found live-testing Admin CMS's "Events & Clubs" tab against staging:
-- every `events_with_counts` (or `events`) query that embeds `clubs(...)`
-- 400'd with PGRST200 "no relationship found between events and clubs".
-- Root cause: staging's `events` table predates this migration set (it's a
-- repurposed, previously-abandoned project -- see docs/ENVIRONMENTS.md) and
-- already had a `club_id` column with no FK constraint on it when
-- 20260814000500_events_clubs.sql ran; `create table if not exists` is a
-- no-op against an existing table, and unlike most other columns that
-- migration touches, club_id never got an explicit
-- `alter table ... add constraint ... exception when duplicate_object`
-- follow-up the way (for example) service_requests.location_id did in
-- 0007. Production already has this FK (its events table was created fresh
-- by that migration), so this is a no-op there.
--
-- Also drops `events.created_by` on staging if present: a legacy column
-- from the old pre-hardening schema that nothing in this codebase reads or
-- writes (organizer_id is the real column), which was silently causing
-- `events_created_by_fkey` to show up in ambiguous-relationship errors
-- alongside the missing club_id fix.

do $$ begin
  alter table public.events
    add constraint events_club_id_fkey
    foreign key (club_id) references public.clubs(id) on delete set null;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.events drop column if exists created_by;
exception when others then null;
end $$;
