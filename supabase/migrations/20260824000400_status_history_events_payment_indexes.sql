-- =========================================================
-- Reliability audit (readiness-audit phase 7, follow-up): remaining index
-- gaps identified by the phase-7 concurrency/index audit but not fixed in
-- that pass (see 20260824000300_moderation_actions_indexes.sql for the
-- first gap it did fix). Same rationale throughout: these are FK/filter
-- columns hit on every read of a table that's written to on every order/
-- event/payment state change, and none of them had a supporting index.
-- =========================================================

-- order_status_history / store_order_status_history: written on every order
-- status transition (food + store), read back per-order for tracking/audit
-- timelines and per-actor for "who changed this" lookups. Only the implicit
-- PK existed before.
create index if not exists order_status_history_order_idx
  on public.order_status_history(order_id, created_at desc);

create index if not exists order_status_history_changed_by_idx
  on public.order_status_history(changed_by)
  where changed_by is not null;

create index if not exists store_order_status_history_order_idx
  on public.store_order_status_history(order_id, created_at desc);

create index if not exists store_order_status_history_changed_by_idx
  on public.store_order_status_history(changed_by)
  where changed_by is not null;

-- events.organizer_id / events.club_id: both are OR-ed together (plus other
-- permission checks) in the events_admin_read RLS USING clause
-- (20260819002000_events_production_completion.sql), and organizer_id is
-- the direct filter for an organizer's "my events" dashboard. Only
-- (campus_id, event_date) existed before -- neither column was covered.
create index if not exists events_organizer_idx
  on public.events(organizer_id)
  where organizer_id is not null;

create index if not exists events_club_idx
  on public.events(club_id)
  where club_id is not null;

-- refunds.order_id / refunds.payment_id: only status and print_job_id were
-- indexed. order_id and payment_id are the two lookup paths ("refunds for
-- this order", "did this payment get refunded") and both are FKs with no
-- automatic index.
create index if not exists refunds_order_idx
  on public.refunds(order_id);

create index if not exists refunds_payment_idx
  on public.refunds(payment_id);

-- payment_events.payment_id: the webhook/event audit trail for a payment
-- (record_payment_event etc.) had no index at all -- every "history for
-- this payment" read was a full table scan.
create index if not exists payment_events_payment_idx
  on public.payment_events(payment_id, created_at desc);

-- Line-item FKs: order_items/store_order_items already had an order_id
-- index but not the catalog-item / variant FKs (used by popularity
-- analytics, stock-affecting variant lookups, and referential-integrity
-- locks on catalog updates/deletes).
create index if not exists order_items_food_item_idx
  on public.order_items(food_item_id);

create index if not exists order_items_variant_idx
  on public.order_items(variant_id)
  where variant_id is not null;

create index if not exists store_order_items_store_item_idx
  on public.store_order_items(store_item_id);

create index if not exists store_order_items_variant_idx
  on public.store_order_items(variant_id)
  where variant_id is not null;
