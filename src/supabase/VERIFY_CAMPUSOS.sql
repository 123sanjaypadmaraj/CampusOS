-- =============================================================================
-- VERIFY_CAMPUSOS.sql
-- Run this AFTER CAMPUSOS_RESET_AND_SEED.sql
-- =============================================================================

-- 1. Row counts (expected values shown in comments)
select 'campuses'           as tbl, count(*) as rows from public.campuses          -- 1
union all
select 'canteens',           count(*) from public.canteens                          -- 4
union all
select 'food_categories',    count(*) from public.food_categories                  -- 11
union all
select 'food_items',         count(*) from public.food_items                       -- 20
union all
select 'clubs',              count(*) from public.clubs                             -- 4
union all
select 'events',             count(*) from public.events                            -- 3
union all
select 'services',           count(*) from public.services                          -- 3
union all
select 'locations',          count(*) from public.locations                         -- 6
union all
select 'resources',          count(*) from public.resources                         -- 4
order by tbl;

-- 2. UUID consistency check (should return 0 rows)
-- If this returns ANY rows, stop and report the output.
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and column_name in (
    'id', 'club_id', 'event_id', 'user_id',
    'campus_id', 'canteen_id', 'food_item_id'
  )
  and data_type <> 'uuid';

-- 3. Verify canteens belong to NHCE campus
select cn.name as canteen, c.name as campus
from public.canteens cn
join public.campuses c on c.id = cn.campus_id
order by cn.name;

-- 4. Verify food items are seeded correctly
select cn.name as canteen, fi.name as item, fi.price, fi.is_vegetarian
from public.food_items fi
join public.canteens cn on cn.id = fi.canteen_id
order by cn.name, fi.name;

-- 5. Verify clubs
select name, category, members from public.clubs order by name;

-- 6. Verify events with club names
select e.title, e.category, cl.name as club, e.event_date::date as date
from public.events e
left join public.clubs cl on cl.id = e.club_id
order by e.event_date;

-- 7. Verify handle_new_user trigger exists
select trigger_name, event_object_table
from information_schema.triggers
where trigger_name = 'on_auth_user_created';
