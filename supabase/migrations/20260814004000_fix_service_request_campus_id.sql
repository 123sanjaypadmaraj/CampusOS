-- =============================================================================
-- 0040: FIX service_requests.campus_id NEVER BEING SET
-- =============================================================================
-- createCampusServiceRequest() (src/services/mvpService.js) receives
-- campusId as a parameter -- uses it to look up the right `services` row --
-- but never included it in the actual service_requests INSERT. Every
-- facilities ticket ever created has campus_id = null. Harmless for a
-- student (their own tickets are visible regardless via
-- service_requests_read's `user_id = auth.uid()` clause) but broke the
-- facilities staff dashboard being built right now: listActiveTickets()
-- filters by campus_id, which correctly excluded every single existing
-- ticket. Fixed in the same commit as this migration (mvpService.js now
-- sends campus_id); this backfills the rows already created null, onto the
-- one campus this deployment has (same reasoning as 20260814002100's
-- profile.campus_id backfill).

update public.service_requests
  set campus_id = (select id from public.campuses order by created_at limit 1)
  where campus_id is null;
