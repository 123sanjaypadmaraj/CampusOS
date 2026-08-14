-- =============================================================================
-- 0014: REALTIME PUBLICATION (doc §14 order tracking, plus other live views)
-- =============================================================================

do $$
declare
  t text;
  tables text[] := array[
    'orders','order_status_history','notifications','service_requests','bookings',
    'print_jobs','posts','post_likes','comments','clubs','club_members','events',
    'event_registrations','saved_events','canteens','food_items',
    'marketplace_listings','lost_found_items','announcements'
  ];
begin
  foreach t in array tables loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
