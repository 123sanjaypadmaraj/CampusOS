-- =============================================================================
-- FIX: create_support_ticket(text, text, text) is a dead overload left
-- behind by 20260819001100_support_priority_escalation_attachments.sql.
-- That migration's own comment claimed "CREATE OR REPLACE with a new
-- trailing default-valued param is safe" -- true in plain SQL, but adding a
-- 4th parameter gives the function a *different signature*
-- (create_support_ticket(text,text,text,text)), so CREATE OR REPLACE
-- created a second, separate overload rather than replacing the original
-- 3-arg one. Both have lived in the schema side by side since.
--
-- Real, live risk: PostgREST (and plain SQL) dispatches RPC calls by
-- *named* arguments, and Postgres cannot pick a "best candidate" between
-- two overloads where one's required parameters are a strict prefix of the
-- other's -- a call that omits p_attachment_url entirely (not just passes
-- null for it) fails with "could not choose the best candidate function"
-- rather than falling through to the 4-arg version's default. Every real
-- caller in src/ happens to always pass all 4 params today (confirmed by
-- grep), so this hasn't broken production traffic yet, but the ambiguity
-- itself is a live landmine -- any future caller, admin script, or Edge
-- Function that (reasonably) omits an unused optional param would silently
-- break ticket creation with a cryptic PGRST203 error. Found via a live-
-- check run exercising the RPC with 3 args (scripts/live-check-operational-
-- gaps.mjs), not a code review.
--
-- Fix: drop the obsolete 3-arg overload. The 4-arg version's
-- p_attachment_url already defaults to null, so every existing call shape
-- (3 args or 4) keeps working -- there's just one function to resolve to.
-- =============================================================================

drop function if exists public.create_support_ticket(text, text, text);

-- =============================================================================
-- The exact same "CREATE OR REPLACE with a new trailing default-valued
-- param created a second overload instead of replacing the original"
-- mistake, found by auditing every public function for duplicate names
-- with a query against pg_proc rather than assuming this was the only
-- instance:
--
-- - add_support_ticket_message(uuid, text) vs (uuid, text, text) -- same
--   migration, same bug. Real caller (mvpService.js) always passes all 3,
--   but a 2-arg call is exactly as ambiguous as create_support_ticket's was.
-- - log_client_error(text, text, text, text, text, jsonb, text) vs the same
--   7 plus a trailing p_category text default null (20260819001700, the
--   observability pass). Every param past the first already has a default
--   on *both* overloads, so this one is ambiguous for any call shape from
--   1 to 7 args, not just one specific arity -- worth closing even though
--   the one real caller (logClientError() in mvpService.js) always passes
--   all 8 and is unaffected today.
--
-- pg_proc was also checked for every other function name defined more than
-- once: dispatch_email_notification/dispatch_push_notification/
-- dispatch_sms_notification each have a genuine 0-arg ("process the pending
-- queue") and a 1-arg, no-default p_notification_id ("process this one")
-- overload -- a real, unambiguous, intentional pair, not this bug. Nothing
-- else in the schema has the "same params + one more with a default"
-- shape.
-- =============================================================================

drop function if exists public.add_support_ticket_message(uuid, text);
drop function if exists public.log_client_error(text, text, text, text, text, jsonb, text);
