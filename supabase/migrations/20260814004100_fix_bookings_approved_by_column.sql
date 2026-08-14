-- =============================================================================
-- 0041: FIX bookings MISSING approved_by -- same drift pattern as everywhere
-- else today (table predates this migration set, `create table if not
-- exists` never took effect against it).
-- =============================================================================
-- set_booking_status() (0007) has referenced bookings.approved_by since it
-- was written -- every approval/rejection has 400'd with "column
-- approved_by does not exist" since this table was created, not just for
-- the facilities dashboard just built. Found live while testing it.

alter table public.bookings add column if not exists approved_by uuid references public.profiles(id);
