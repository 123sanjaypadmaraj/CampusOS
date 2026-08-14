-- =============================================================================
-- 0018: ADMIN CMS READ ACCESS
-- The public read policies for canteens/food_items/clubs/events only show
-- active/published rows (correctly, for students). Admins managing content
-- need to see inactive/unpublished/draft rows too -- add additional
-- permissive policies (RLS OR-combines multiple policies for the same
-- command) rather than touching the existing ones.
-- =============================================================================

drop policy if exists "canteens_admin_read" on public.canteens;
create policy "canteens_admin_read" on public.canteens for select to authenticated
  using (public.current_user_is_admin());

drop policy if exists "food_items_admin_read" on public.food_items;
create policy "food_items_admin_read" on public.food_items for select to authenticated
  using (public.current_user_is_admin());

drop policy if exists "clubs_admin_read" on public.clubs;
create policy "clubs_admin_read" on public.clubs for select to authenticated
  using (public.current_user_is_admin());

drop policy if exists "events_admin_read" on public.events;
create policy "events_admin_read" on public.events for select to authenticated
  using (public.current_user_is_admin());

drop policy if exists "announcements_admin_read" on public.announcements;
create policy "announcements_admin_read" on public.announcements for select to authenticated
  using (public.current_user_is_admin());
