-- =============================================================================
-- Fix production/staging schema drift on public.orders discovered by
-- re-running scripts/live-check-vendor-order-ops.mjs against production
-- during the 2026-08-19 backlog-ship pass: a real refund request
-- ("Owning vendor can request a refund on a rejected, paid order") failed
-- outright with a check-constraint violation.
--
-- Root cause: production's live orders_payment_status_check only allowed
-- ('pending','paid','failed','refunded') -- missing 'refund_pending', which
-- 20260814000300_food_ordering.sql's own CREATE TABLE always included and
-- staging already has. orders_fulfillment_type_check was missing from
-- production entirely (staging has it). Both drifted for the same reason
-- documented repeatedly elsewhere in this migration history: production's
-- `orders` table predates some ALTERs that only ever landed on staging's
-- schema, and every later migration's `create table if not exists` silently
-- no-ops once the table already exists, so a missing constraint never gets
-- a second chance to be added except via an explicit fix like this one.
--
-- Defensive/idempotent on both environments -- drops if present, re-adds
-- with the correct definition, so this is a safe no-op on staging (already
-- correct) and a real fix on production.
-- =============================================================================

alter table public.orders drop constraint if exists orders_payment_status_check;
alter table public.orders add constraint orders_payment_status_check
  check (payment_status in ('pending','paid','failed','refund_pending','refunded'));

alter table public.orders drop constraint if exists orders_fulfillment_type_check;
alter table public.orders add constraint orders_fulfillment_type_check
  check (fulfillment_type in ('pickup','delivery'));
