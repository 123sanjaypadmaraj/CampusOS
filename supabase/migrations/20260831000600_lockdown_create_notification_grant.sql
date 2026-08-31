-- =============================================================================
-- SECURITY FIX: create_notification() and its three dispatch_*_notification()
-- helpers were never explicitly revoked from PUBLIC -- unlike every other
-- "internal only, called from another SECURITY DEFINER function" helper in
-- this schema (record_payment_event, adjust_stock_for_order,
-- restore_store_order_stock, is_canteen_owner, delete_message, ... all
-- revoke execute from public/anon/authenticated right after creation).
-- Postgres grants EXECUTE to PUBLIC by default, and every Supabase role is a
-- member of PUBLIC, so this was reachable as a plain authenticated RPC call
-- the entire time these functions have existed (since 20260814001000 /
-- 20260814004500).
--
-- Verified live on staging before this fix: e2e.bob@nhce.edu.in called
-- `supabase.rpc('create_notification', { target_user: <alice's id>,
-- notification_title: 'SPOOF-PROBE ...', notification_type: 'official' })`
-- directly and it succeeded -- a fabricated "official"-typed notification
-- landed in Alice's notifications with no rate limit, and (since
-- 'official' -> 'announcements', on by default, and channel_push defaults
-- to true) would have gone out over push to any target too. Nothing about
-- this required being a club leader, a vendor, or even the sender/recipient
-- being in any relationship at all -- any signed-in student could spoof an
-- official-looking, arbitrary-body, arbitrary-action_id notification (or
-- spam one) to any other user on the campus. Test row deleted after
-- confirming the bug, re-run after this migration to confirm it now fails
-- with "permission denied for function create_notification" while the real
-- callers (send_message, publish_club_announcement, broadcast_vendor_message,
-- and every other internal caller) keep working -- a SECURITY DEFINER
-- function's *nested* calls run as its owner, so revoking PUBLIC/anon/
-- authenticated here does not affect callers that reach it through another
-- SECURITY DEFINER function, only direct RPC access.
--
-- dispatch_push/email/sms_notification are lower severity (they only
-- re-trigger delivery of an *existing* notification_deliveries row by id,
-- no spoofing possible) but are equally "internal plumbing, not a public
-- API" and get the same treatment for consistency.
-- =============================================================================

revoke execute on function public.create_notification(uuid, text, text, text, text, text, text)
  from public, anon, authenticated;

revoke execute on function public.dispatch_push_notification(uuid) from public, anon, authenticated;
revoke execute on function public.dispatch_email_notification(uuid) from public, anon, authenticated;
revoke execute on function public.dispatch_sms_notification(uuid) from public, anon, authenticated;
