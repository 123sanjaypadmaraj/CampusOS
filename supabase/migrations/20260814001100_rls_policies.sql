-- =============================================================================
-- 0011: ROW LEVEL SECURITY -- REPLACES THE OLD "for all using (true)" POLICIES
-- =============================================================================
-- The previous schema (src/supabase/archive/canonical_schema_and_seed.sql)
-- granted `for all to anon, authenticated using (true) with check (true)` on
-- every table, including orders, profiles, payments-adjacent data and
-- audit_logs. That meant any unauthenticated request with only the public
-- anon key could read or write ANY row in the database, including other
-- students' orders, and could set their own profile role to 'super_admin'.
-- This migration drops every such policy and replaces it with real,
-- auth.uid()-scoped access control (doc §60).
-- =============================================================================

-- ---- helper: drop every existing policy on a table, regardless of name ----
create or replace function public._drop_all_policies(p_table text)
returns void language plpgsql as $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = p_table loop
    execute format('drop policy if exists %I on public.%I', r.policyname, p_table);
  end loop;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'campuses','profiles','student_verifications','roles','permissions','role_permissions','user_roles',
    'canteens','food_categories','food_items','orders','order_items','order_status_history',
    'order_pickup_tokens','order_status_transitions','payments','payment_events','refunds','idempotency_keys',
    'clubs','club_members','events','event_registrations','event_waitlist','event_tickets','event_attendance',
    'saved_events','posts','post_likes','comments','content_reports','blocked_users','moderation_actions',
    'services','service_requests','service_request_comments','service_request_status_transitions',
    'locations','resources','bookings','print_rate_card','print_jobs',
    'marketplace_listings','seller_ratings','lost_found_items',
    'notifications','notification_preferences','push_subscriptions','announcements',
    'rate_limit_hits','audit_logs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    perform public._drop_all_policies(t);
  end loop;
end $$;

-- =========================================================
-- CATALOG / REFERENCE DATA -- public read, privileged write
-- =========================================================

create policy "campuses_read" on public.campuses for select to anon, authenticated using (true);
create policy "campuses_write" on public.campuses for all to authenticated
  using (public.current_user_is_admin()) with check (public.current_user_is_admin());

create policy "canteens_read" on public.canteens for select to anon, authenticated using (active);
create policy "canteens_write" on public.canteens for all to authenticated
  using (public.has_permission(auth.uid(),'food.menu.write') or public.current_user_is_admin())
  with check (public.has_permission(auth.uid(),'food.menu.write') or public.current_user_is_admin());

create policy "food_categories_read" on public.food_categories for select to anon, authenticated using (true);
create policy "food_categories_write" on public.food_categories for all to authenticated
  using (public.has_permission(auth.uid(),'food.menu.write') or public.current_user_is_admin())
  with check (public.has_permission(auth.uid(),'food.menu.write') or public.current_user_is_admin());

create policy "food_items_read" on public.food_items for select to anon, authenticated using (active);
create policy "food_items_write" on public.food_items for all to authenticated
  using (public.has_permission(auth.uid(),'food.menu.write') or public.current_user_is_admin())
  with check (public.has_permission(auth.uid(),'food.menu.write') or public.current_user_is_admin());

create policy "print_rate_card_read" on public.print_rate_card for select to authenticated using (true);
create policy "print_rate_card_write" on public.print_rate_card for all to authenticated
  using (public.current_user_is_admin()) with check (public.current_user_is_admin());

create policy "locations_read" on public.locations for select to anon, authenticated using (true);
create policy "locations_write" on public.locations for all to authenticated
  using (public.current_user_is_admin()) with check (public.current_user_is_admin());

create policy "resources_read" on public.resources for select to anon, authenticated using (available);
create policy "resources_write" on public.resources for all to authenticated
  using (public.has_permission(auth.uid(),'services.manage') or public.current_user_is_admin())
  with check (public.has_permission(auth.uid(),'services.manage') or public.current_user_is_admin());

create policy "services_read" on public.services for select to anon, authenticated using (active);
create policy "services_write" on public.services for all to authenticated
  using (public.has_permission(auth.uid(),'services.manage') or public.current_user_is_admin())
  with check (public.has_permission(auth.uid(),'services.manage') or public.current_user_is_admin());

create policy "announcements_read" on public.announcements for select to anon, authenticated using (published_at is not null);
-- writes only via publish_announcement() (security definer) -- no direct insert policy.

-- Lookup/state-machine tables: harmless to read, never written by clients.
create policy "order_status_transitions_read" on public.order_status_transitions for select to authenticated using (true);
create policy "service_request_status_transitions_read" on public.service_request_status_transitions for select to authenticated using (true);
create policy "roles_read" on public.roles for select to authenticated using (true);
create policy "permissions_read" on public.permissions for select to authenticated using (true);
create policy "role_permissions_read" on public.role_permissions for select to authenticated using (true);

-- =========================================================
-- PROFILES -- own row full access; others only through the safe
-- search_people()/get_public_profile() RPCs, never the raw table (doc §42).
-- =========================================================

create policy "profiles_read_self_or_privileged" on public.profiles for select to authenticated
  using (auth.uid() = id or public.has_permission(auth.uid(),'users.read') or public.current_user_is_admin());
create policy "profiles_update_self" on public.profiles for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);
-- No client-side insert policy: rows are created only by handle_new_user().

create policy "student_verifications_read" on public.student_verifications for select to authenticated
  using (auth.uid() = user_id or public.current_user_is_admin());
create policy "student_verifications_insert_own" on public.student_verifications for insert to authenticated
  with check (auth.uid() = user_id);
create policy "student_verifications_admin_update" on public.student_verifications for update to authenticated
  using (public.current_user_is_admin()) with check (public.current_user_is_admin());

create policy "user_roles_read" on public.user_roles for select to authenticated
  using (auth.uid() = user_id or public.current_user_is_admin());
-- writes only via admin_set_user_role() / sync trigger (security definer).

-- =========================================================
-- FOOD ORDERS -- students see only their own; vendor/admin see everything
-- they're permitted to manage. All writes go through the RPCs in 0003/0004.
-- =========================================================

create policy "orders_read" on public.orders for select to authenticated
  using (user_id = auth.uid() or public.has_permission(auth.uid(),'food.orders.read') or public.current_user_is_admin());
-- No insert/update/delete policies: create_food_order()/transition_order_status()
-- (SECURITY DEFINER) are the only writers.

create policy "order_items_read" on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_items.order_id
    and (o.user_id = auth.uid() or public.has_permission(auth.uid(),'food.orders.read') or public.current_user_is_admin())));

create policy "order_status_history_read" on public.order_status_history for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_status_history.order_id
    and (o.user_id = auth.uid() or public.has_permission(auth.uid(),'food.orders.read') or public.current_user_is_admin())));

create policy "order_pickup_tokens_read" on public.order_pickup_tokens for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_pickup_tokens.order_id and o.user_id = auth.uid())
    or public.has_permission(auth.uid(),'food.orders.update') or public.current_user_is_admin());

create policy "payments_read" on public.payments for select to authenticated
  using (exists (select 1 from public.orders o where o.id = payments.order_id and o.user_id = auth.uid())
    or public.has_permission(auth.uid(),'finance.read') or public.current_user_is_admin());

create policy "payment_events_read" on public.payment_events for select to authenticated
  using (public.has_permission(auth.uid(),'finance.read') or public.current_user_is_admin());

create policy "refunds_read" on public.refunds for select to authenticated
  using (exists (select 1 from public.orders o where o.id = refunds.order_id and o.user_id = auth.uid())
    or public.has_permission(auth.uid(),'finance.read') or public.current_user_is_admin());

-- =========================================================
-- CLUBS & EVENTS
-- =========================================================

create policy "clubs_read" on public.clubs for select to anon, authenticated using (active);
create policy "clubs_write" on public.clubs for all to authenticated
  using (public.has_permission(auth.uid(),'clubs.manage') or public.current_user_is_admin()
    or exists (select 1 from public.club_members m where m.club_id = clubs.id and m.user_id = auth.uid() and m.role in ('owner','president')))
  with check (public.has_permission(auth.uid(),'clubs.manage') or public.current_user_is_admin());

create policy "club_members_read" on public.club_members for select to anon, authenticated using (true);
create policy "club_members_join_self" on public.club_members for insert to authenticated
  with check (user_id = auth.uid() and role = 'member');
create policy "club_members_leave_self" on public.club_members for delete to authenticated
  using (user_id = auth.uid() or public.has_permission(auth.uid(),'clubs.manage') or public.current_user_is_admin());
create policy "club_members_manage_roles" on public.club_members for update to authenticated
  using (public.has_permission(auth.uid(),'clubs.manage') or public.current_user_is_admin())
  with check (public.has_permission(auth.uid(),'clubs.manage') or public.current_user_is_admin());

create policy "events_read" on public.events for select to anon, authenticated using (published);
create policy "events_write" on public.events for all to authenticated
  using (public.has_permission(auth.uid(),'events.create') or public.current_user_is_admin() or organizer_id = auth.uid())
  with check (public.has_permission(auth.uid(),'events.create') or public.current_user_is_admin() or organizer_id = auth.uid());

create policy "event_registrations_read" on public.event_registrations for select to authenticated
  using (user_id = auth.uid() or public.has_permission(auth.uid(),'events.checkin') or public.current_user_is_admin());
-- writes only via register_for_event()/cancel_event_registration().

create policy "event_waitlist_read" on public.event_waitlist for select to authenticated
  using (user_id = auth.uid() or public.current_user_is_admin());

create policy "event_tickets_read" on public.event_tickets for select to authenticated
  using (exists (select 1 from public.event_registrations r where r.id = event_tickets.registration_id and r.user_id = auth.uid())
    or public.has_permission(auth.uid(),'events.checkin') or public.current_user_is_admin());

create policy "event_attendance_read" on public.event_attendance for select to authenticated
  using (user_id = auth.uid() or public.has_permission(auth.uid(),'events.checkin') or public.current_user_is_admin());

create policy "saved_events_own" on public.saved_events for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =========================================================
-- COMMUNITY
-- =========================================================

create policy "posts_read" on public.posts for select to authenticated using (status = 'visible' or author_id = auth.uid());
create policy "posts_insert_own" on public.posts for insert to authenticated with check (author_id = auth.uid());
create policy "posts_update_own_or_mod" on public.posts for update to authenticated
  using (author_id = auth.uid() or public.has_permission(auth.uid(),'moderation.act') or public.current_user_is_admin())
  with check (author_id = auth.uid() or public.has_permission(auth.uid(),'moderation.act') or public.current_user_is_admin());
create policy "posts_delete_own_or_mod" on public.posts for delete to authenticated
  using (author_id = auth.uid() or public.has_permission(auth.uid(),'moderation.act') or public.current_user_is_admin());

create policy "post_likes_read" on public.post_likes for select to authenticated using (true);
create policy "post_likes_own" on public.post_likes for insert to authenticated with check (user_id = auth.uid());
create policy "post_likes_delete_own" on public.post_likes for delete to authenticated using (user_id = auth.uid());

create policy "comments_read" on public.comments for select to authenticated using (status = 'visible' or author_id = auth.uid());
create policy "comments_insert_own" on public.comments for insert to authenticated with check (author_id = auth.uid());
create policy "comments_update_own_or_mod" on public.comments for update to authenticated
  using (author_id = auth.uid() or public.has_permission(auth.uid(),'moderation.act') or public.current_user_is_admin())
  with check (author_id = auth.uid() or public.has_permission(auth.uid(),'moderation.act') or public.current_user_is_admin());

create policy "content_reports_insert_own" on public.content_reports for insert to authenticated with check (reporter_id = auth.uid());
create policy "content_reports_read" on public.content_reports for select to authenticated
  using (reporter_id = auth.uid() or public.has_permission(auth.uid(),'moderation.act') or public.current_user_is_admin());
create policy "content_reports_update_mod" on public.content_reports for update to authenticated
  using (public.has_permission(auth.uid(),'moderation.act') or public.current_user_is_admin())
  with check (public.has_permission(auth.uid(),'moderation.act') or public.current_user_is_admin());

create policy "blocked_users_own" on public.blocked_users for all to authenticated
  using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());

create policy "moderation_actions_read" on public.moderation_actions for select to authenticated
  using (public.has_permission(auth.uid(),'moderation.act') or public.current_user_is_admin());

-- =========================================================
-- SERVICES / TICKETS / BOOKINGS
-- =========================================================

create policy "service_requests_read" on public.service_requests for select to authenticated
  using (user_id = auth.uid() or public.has_permission(auth.uid(),'tickets.read') or public.current_user_is_admin());
create policy "service_requests_insert_own" on public.service_requests for insert to authenticated
  with check (user_id = auth.uid() and status = 'SUBMITTED' and assigned_to is null);
-- status transitions only via transition_ticket_status().

create policy "service_request_comments_read" on public.service_request_comments for select to authenticated
  using (exists (select 1 from public.service_requests r where r.id = service_request_comments.request_id
    and (r.user_id = auth.uid() or public.has_permission(auth.uid(),'tickets.read') or public.current_user_is_admin())));
create policy "service_request_comments_insert" on public.service_request_comments for insert to authenticated
  with check (author_id = auth.uid() and exists (select 1 from public.service_requests r where r.id = request_id
    and (r.user_id = auth.uid() or public.has_permission(auth.uid(),'tickets.update') or public.current_user_is_admin())));

create policy "bookings_read" on public.bookings for select to authenticated
  using (user_id = auth.uid() or public.has_permission(auth.uid(),'bookings.approve') or public.current_user_is_admin());
-- writes only via create_booking()/set_booking_status().

-- =========================================================
-- PRINTING
-- =========================================================

create policy "print_jobs_read" on public.print_jobs for select to authenticated
  using (user_id = auth.uid() or public.has_permission(auth.uid(),'print.manage') or public.current_user_is_admin());
-- writes only via create_print_job(); status updates via print.manage RPCs (frontend calls transition-style update gated below).
create policy "print_jobs_update_manage" on public.print_jobs for update to authenticated
  using (public.has_permission(auth.uid(),'print.manage') or public.current_user_is_admin())
  with check (public.has_permission(auth.uid(),'print.manage') or public.current_user_is_admin());

-- =========================================================
-- MARKETPLACE / LOST & FOUND
-- =========================================================

create policy "marketplace_read" on public.marketplace_listings for select to authenticated using (status <> 'removed');
create policy "marketplace_insert_own" on public.marketplace_listings for insert to authenticated with check (seller_id = auth.uid());
create policy "marketplace_update_own_or_mod" on public.marketplace_listings for update to authenticated
  using (seller_id = auth.uid() or public.has_permission(auth.uid(),'moderation.act') or public.current_user_is_admin())
  with check (seller_id = auth.uid() or public.has_permission(auth.uid(),'moderation.act') or public.current_user_is_admin());

create policy "seller_ratings_read" on public.seller_ratings for select to authenticated using (true);
create policy "seller_ratings_insert_own" on public.seller_ratings for insert to authenticated with check (rater_id = auth.uid());

create policy "lost_found_read" on public.lost_found_items for select to authenticated using (true);
create policy "lost_found_insert_own" on public.lost_found_items for insert to authenticated with check (user_id = auth.uid());
create policy "lost_found_update_own" on public.lost_found_items for update to authenticated
  using (user_id = auth.uid() and status = 'open')
  with check (user_id = auth.uid() and status = 'open');
-- claim/handover transitions only via claim_lost_found_item()/verify_lost_found_handover().

-- =========================================================
-- NOTIFICATIONS
-- =========================================================

create policy "notifications_read_own" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "notifications_update_own" on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "notification_preferences_own" on public.notification_preferences for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "push_subscriptions_own" on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =========================================================
-- AUDIT / RATE LIMITS -- no client writes at all
-- =========================================================

create policy "audit_logs_read" on public.audit_logs for select to authenticated
  using (actor_id = auth.uid() or public.has_permission(auth.uid(),'audit.read') or public.current_user_is_admin());

-- rate_limit_hits and idempotency_keys: intentionally NO policies for
-- anon/authenticated, so with RLS enabled every client request is denied by
-- default. Only SECURITY DEFINER functions (which bypass RLS) and the
-- service_role key touch these tables.

drop function if exists public._drop_all_policies(text);
