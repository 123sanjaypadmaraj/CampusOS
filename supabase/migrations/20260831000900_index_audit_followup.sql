-- =========================================================
-- Reliability: DB index audit, third pass. The readiness audit's
-- High-priority "Database performance / index audit under real load" item
-- was still open after 20260824000300_moderation_actions_indexes.sql and
-- 20260824000400_status_history_events_payment_indexes.sql. Static audit of
-- every FK column across all
-- migrations vs. every index/PK/unique constraint that already covers it as
-- a leading column, cross-checked against how each table is actually
-- queried in src/services/mvpService -- so this intentionally does NOT
-- index every bare FK found (most `*_by`/`reviewed_by`/`added_by`-style
-- audit columns on small, admin-only tables are left alone: an index there
-- costs write overhead for a query pattern that barely runs). What's below
-- is the subset that's either a genuine hot read path, sits inside an RLS
-- policy or SECURITY DEFINER function called on ordinary user actions, or
-- backs a "does this exist for me" per-row check rendered in a list.
-- =========================================================

-- Messaging: sender_id backs every conversation's message list and the
-- moderation "messages by user" view; reply_to_message_id backs the
-- WhatsApp-style reply/thread-jump feature (20260830000200); reactions and
-- starred messages are both per-message-per-user existence checks rendered
-- on every message bubble.
create index if not exists messages_sender_idx
  on public.messages(sender_id);

create index if not exists messages_reply_to_idx
  on public.messages(reply_to_message_id)
  where reply_to_message_id is not null;

create index if not exists message_reactions_user_idx
  on public.message_reactions(user_id);

create index if not exists starred_messages_message_idx
  on public.starred_messages(message_id);

-- Community: "did I like/save this" is checked per-post/per-event on every
-- feed and events-list render; comments.author_id backs moderation and
-- "my comments"; parent_comment_id backs threaded-reply rendering.
create index if not exists post_likes_user_idx
  on public.post_likes(user_id);

create index if not exists saved_posts_user_idx
  on public.saved_posts(user_id);

create index if not exists saved_events_user_idx
  on public.saved_events(user_id);

create index if not exists comments_author_idx
  on public.comments(author_id);

create index if not exists comments_parent_idx
  on public.comments(parent_comment_id)
  where parent_comment_id is not null;

-- Events: event_tickets is read by event_id for the organizer roster/
-- check-in screen (get_event_roster) and by registration_id from the
-- student's own ticket lookup; event_attendance/event_waitlist/
-- event_feedback are all per-user existence checks ("am I checked in" /
-- "am I waitlisted" / "did I already leave feedback").
create index if not exists event_tickets_event_idx
  on public.event_tickets(event_id);

create index if not exists event_tickets_registration_idx
  on public.event_tickets(registration_id);

create index if not exists event_attendance_user_idx
  on public.event_attendance(user_id);

create index if not exists event_waitlist_user_idx
  on public.event_waitlist(user_id);

create index if not exists event_feedback_user_idx
  on public.event_feedback(user_id);

-- Campus services: service_requests is listed both by service and by
-- campus (the facilities dashboard queue); its comment thread is read
-- per-request on every ticket detail view; resources are listed by
-- location on the booking picker.
create index if not exists service_requests_service_idx
  on public.service_requests(service_id)
  where service_id is not null;

create index if not exists service_requests_campus_idx
  on public.service_requests(campus_id)
  where campus_id is not null;

create index if not exists service_request_comments_request_idx
  on public.service_request_comments(request_id);

create index if not exists resources_location_idx
  on public.resources(location_id)
  where location_id is not null;

-- Marketplace: ratings are read per-listing on every listing detail page,
-- and per-rater to enforce "already rated this seller".
create index if not exists seller_ratings_listing_idx
  on public.seller_ratings(listing_id)
  where listing_id is not null;

create index if not exists seller_ratings_rater_idx
  on public.seller_ratings(rater_id);

-- Food/print/store: menu filtering by category is a hot read on every
-- canteen page; owner_id backs the vendor's "my canteens" list;
-- payment_id is the reverse lookup from a payment/refund back to the job
-- it's for (print_jobs, event_registrations -- both nullable, set only
-- once payment starts).
create index if not exists food_items_category_idx
  on public.food_items(category_id)
  where category_id is not null;

create index if not exists canteens_owner_idx
  on public.canteens(owner_id)
  where owner_id is not null;

create index if not exists print_jobs_campus_idx
  on public.print_jobs(campus_id)
  where campus_id is not null;

create index if not exists print_jobs_payment_idx
  on public.print_jobs(payment_id)
  where payment_id is not null;

create index if not exists event_registrations_payment_idx
  on public.event_registrations(payment_id)
  where payment_id is not null;

create index if not exists order_invoices_canteen_idx
  on public.order_invoices(canteen_id);

create index if not exists order_invoices_user_idx
  on public.order_invoices(user_id);

create index if not exists store_order_invoices_store_idx
  on public.store_order_invoices(store_id);

create index if not exists store_order_invoices_user_idx
  on public.store_order_invoices(user_id);

-- RBAC/admin: role_id is the reverse lookup ("who has this role") the
-- admin CMS's role-management view uses; mentors.profile_id backs the
-- recommendation engine's mentor-matching query, which runs on every
-- dashboard load for every student with personalization on.
create index if not exists user_roles_role_idx
  on public.user_roles(role_id);

create index if not exists mentors_profile_idx
  on public.mentors(profile_id)
  where profile_id is not null;

-- Academics: attendance_sessions is read per-timetable-entry every time a
-- faculty member opens a class to mark or review attendance
-- (20260831000700_academic_attendance.sql -- brand new, shipped without a
-- supporting index).
create index if not exists attendance_sessions_timetable_entry_idx
  on public.attendance_sessions(timetable_entry_id)
  where timetable_entry_id is not null;

create index if not exists club_meeting_attendance_user_idx
  on public.club_meeting_attendance(user_id);

-- Auth flows: both token tables are looked up by user_id on "resend"
-- (has a pending token for this user already?), not just by the token
-- itself.
create index if not exists email_verification_tokens_user_idx
  on public.email_verification_tokens(user_id);

create index if not exists password_reset_tokens_user_idx
  on public.password_reset_tokens(user_id);

-- Notifications: push_subscriptions is read by user_id on every
-- notification fan-out (send-push iterates all of one user's devices) --
-- previously only had a unique index on endpoint.
create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions(user_id);

-- Messaging moderation: is_blocked_pair() (20260815001500) ORs
-- blocker_id = a AND blocked_id = b with the reverse, called on every
-- start_conversation/send-message check. blocker_id is already the
-- composite PK's leading column; blocked_id (the second half of that OR)
-- had no index of its own.
create index if not exists blocked_users_blocked_idx
  on public.blocked_users(blocked_id);
