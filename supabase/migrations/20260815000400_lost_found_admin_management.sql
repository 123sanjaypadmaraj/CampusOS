-- =============================================================================
-- Lost & Found: admin management RLS.
-- The student self-service RPCs (claim_lost_found_item, verify_lost_found_
-- handover, 0009) and lost_found_insert_own/lost_found_update_own (0011)
-- already cover reporting + claiming an item you own. Nothing previously
-- let an admin/moderator touch a report that isn't theirs -- e.g. resolving
-- a stale report by hand, or removing a bogus/spam one -- so the Admin CMS
-- "Lost & Found" tab (adding this alongside) had nothing to call for those
-- two actions. Creating an item on the college's behalf (posting a "found"
-- item security turned in) needs no new policy -- lost_found_insert_own
-- already covers any authenticated user including an admin, posting as
-- themselves.
-- =============================================================================

drop policy if exists "lost_found_admin_manage" on public.lost_found_items;
create policy "lost_found_admin_manage" on public.lost_found_items for update
  to authenticated
  using (public.has_permission(auth.uid(), 'moderation.act') or public.current_user_is_admin())
  with check (public.has_permission(auth.uid(), 'moderation.act') or public.current_user_is_admin());

drop policy if exists "lost_found_admin_delete" on public.lost_found_items;
create policy "lost_found_admin_delete" on public.lost_found_items for delete
  to authenticated
  using (public.has_permission(auth.uid(), 'moderation.act') or public.current_user_is_admin());
