-- =============================================================================
-- 0037: RETARGET FKs FROM auth.users TO public.profiles
-- =============================================================================
-- What looked like a stale PostgREST schema cache on content_reports (0036
-- tried, and failed, to fix it with a forced reload) turned out to be a
-- real, much bigger drift bug: every one of these tables predates this
-- migration set (the same "old hand-edited schema" 0006 already flagged
-- content_reports itself as having) and their `references public.profiles(id)`
-- declarations in `create table if not exists` never took effect, because
-- the tables already existed with the ORIGINAL foreign keys pointing
-- straight at auth.users(id). Referential integrity was never actually
-- broken -- profiles.id IS auth.users.id 1:1 -- but PostgREST can only
-- resolve an embedded `?select=*,profiles(...)` join by walking a real FK
-- that points AT profiles, so every embed through any of these
-- columns has been silently failing with "Could not find a relationship"
-- since the tables were created. Confirmed zero orphaned rows across all
-- 16 (every existing value already has a matching profiles.id, since
-- profiles rows are always created 1:1 with auth.users by handle_new_user())
-- before running this, so every retarget below is safe.
--
-- public.profiles.id -> auth.users(id) itself (profiles_id_fkey) is
-- correct as-is and deliberately left untouched -- that's the actual root
-- of the chain, not drift.

do $$
declare
  fix record;
  fixes text[][] := array[
    array['orders','user_id','orders_user_id_fkey','CASCADE'],
    array['posts','author_id','posts_author_id_fkey','CASCADE'],
    array['post_likes','user_id','post_likes_user_id_fkey','CASCADE'],
    array['comments','author_id','comments_author_id_fkey','CASCADE'],
    array['club_members','user_id','club_members_user_id_fkey','CASCADE'],
    array['event_registrations','user_id','event_registrations_user_id_fkey','CASCADE'],
    array['saved_events','user_id','saved_events_user_id_fkey','CASCADE'],
    array['print_jobs','user_id','print_jobs_user_id_fkey','CASCADE'],
    array['service_requests','user_id','service_requests_user_id_fkey','CASCADE'],
    array['bookings','user_id','bookings_user_id_fkey','CASCADE'],
    array['notifications','user_id','notifications_user_id_fkey','CASCADE'],
    array['lost_found_items','user_id','lost_found_items_user_id_fkey','CASCADE'],
    array['lost_found_items','claimed_by','lost_found_items_claimed_by_fkey','SET NULL'],
    array['marketplace_listings','seller_id','marketplace_listings_seller_id_fkey','CASCADE'],
    array['audit_logs','user_id','audit_logs_user_id_fkey','SET NULL'],
    array['content_reports','reporter_id','content_reports_reporter_id_fkey','CASCADE']
  ];
  row_ text[];
begin
  foreach row_ slice 1 in array fixes loop
    -- Only touch it if it's still pointing at auth.users -- safe to re-run,
    -- and a no-op on a fresh project where the table was created correctly
    -- by this migration set in the first place.
    if exists (
      select 1 from pg_constraint
      where conname = row_[3] and conrelid = row_[1]::regclass and confrelid = 'auth.users'::regclass
    ) then
      execute format('alter table public.%I drop constraint %I', row_[1], row_[3]);
      execute format(
        'alter table public.%I add constraint %I foreign key (%I) references public.profiles(id) on delete %s',
        row_[1], row_[3], row_[2], row_[4]
      );
    end if;
  end loop;
end $$;
