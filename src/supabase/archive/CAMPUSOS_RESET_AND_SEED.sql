-- =============================================================================
-- CAMPUSOS_RESET_AND_SEED.sql
-- =============================================================================
-- Run this ONE TIME in Supabase -> SQL Editor -> New query.
-- WARNING: All existing rows in public.* will be deleted. auth.users is NOT touched.
-- =============================================================================

create extension if not exists pgcrypto;

-- 1. DROP ALL TABLES (children first)
drop table if exists public.audit_logs             cascade;
drop table if exists public.content_reports        cascade;
drop table if exists public.notifications          cascade;
drop table if exists public.marketplace_listings   cascade;
drop table if exists public.lost_found_items       cascade;
drop table if exists public.print_jobs             cascade;
drop table if exists public.service_requests       cascade;
drop table if exists public.bookings               cascade;
drop table if exists public.resources              cascade;
drop table if exists public.services               cascade;
drop table if exists public.locations              cascade;
drop table if exists public.saved_events           cascade;
drop table if exists public.event_registrations    cascade;
drop table if exists public.events                 cascade;
drop table if exists public.club_members           cascade;
drop table if exists public.clubs                  cascade;
drop table if exists public.comments               cascade;
drop table if exists public.post_likes             cascade;
drop table if exists public.posts                  cascade;
drop table if exists public.order_items            cascade;
drop table if exists public.orders                 cascade;
drop table if exists public.food_items             cascade;
drop table if exists public.food_categories        cascade;
drop table if exists public.canteens               cascade;
drop table if exists public.profiles               cascade;
drop table if exists public.campuses               cascade;

-- 2. DROP OLD TRIGGERS / FUNCTIONS
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

-- 3. CAMPUSES
create table public.campuses (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text unique not null,
  city       text,
  created_at timestamptz not null default now()
);
alter table public.campuses enable row level security;
create policy campuses_public_read on public.campuses for select using (true);

-- 4. PROFILES
create table public.profiles (
  id               uuid primary key references auth.users on delete cascade,
  campus_id        uuid references public.campuses(id) on delete set null,
  name             text not null default 'Campus Student',
  email            text,
  usn              text,
  course           text,
  year             text,
  avatar_url       text,
  bio              text,
  skills           text[]      not null default '{}',
  role             text        not null default 'student'
                     check (role in ('student','club_admin','vendor','facilities_staff','college_admin','super_admin')),
  open_to_projects boolean     not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy profiles_public_read on public.profiles for select using (true);
create policy profiles_own_insert  on public.profiles for insert with check (auth.uid() = id);
create policy profiles_own_update  on public.profiles for update using (auth.uid() = id);

-- 5. HANDLE_NEW_USER TRIGGER
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_campus_id uuid;
begin
  select id into v_campus_id from public.campuses where slug = 'nhce' limit 1;
  insert into public.profiles (id, campus_id, name, email, usn, course, year)
  values (
    new.id, v_campus_id,
    coalesce(new.raw_user_meta_data->>'name', split_part(coalesce(new.email,''),'@',1), 'Campus Student'),
    new.email,
    coalesce(new.raw_user_meta_data->>'usn',''),
    coalesce(new.raw_user_meta_data->>'course','Computer Science & Engineering'),
    coalesce(new.raw_user_meta_data->>'year','2nd Year')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 6. CANTEENS
create table public.canteens (
  id          uuid primary key default gen_random_uuid(),
  campus_id   uuid references public.campuses(id) on delete cascade,
  name        text not null,
  subtitle    text,
  status      text not null default 'Open',
  eta_min     int  not null default 5,
  eta_max     int  not null default 15,
  queue_level text,
  load        int  not null default 0,
  color       text not null default 'green',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table public.canteens enable row level security;
create policy canteens_public_read on public.canteens for select using (true);

-- 7. FOOD_CATEGORIES
create table public.food_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);
alter table public.food_categories enable row level security;
create policy food_categories_public_read on public.food_categories for select using (true);

-- 8. FOOD_ITEMS
create table public.food_items (
  id            uuid primary key default gen_random_uuid(),
  canteen_id    uuid references public.canteens(id) on delete cascade,
  category_id   uuid references public.food_categories(id) on delete set null,
  name          text         not null,
  description   text,
  price         numeric(8,2) not null,
  image_url     text,
  is_vegetarian boolean      not null default true,
  available     boolean      not null default true,
  created_at    timestamptz  not null default now()
);
alter table public.food_items enable row level security;
create policy food_items_public_read on public.food_items for select using (true);

-- 9. ORDERS
create table public.orders (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references public.profiles(id) on delete cascade,
  canteen_id     uuid references public.canteens(id) on delete set null,
  status         text not null default 'pending'
                   check (status in ('pending','accepted','preparing','ready','completed','cancelled')),
  subtotal       numeric(10,2) not null default 0,
  platform_fee   numeric(10,2) not null default 0,
  total          numeric(10,2) not null default 0,
  payment_status text not null default 'pending'
                   check (payment_status in ('pending','paid','failed','refunded')),
  pickup_code    text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.orders enable row level security;
create policy orders_own_select on public.orders for select using (auth.uid() = user_id);
create policy orders_own_insert on public.orders for insert with check (auth.uid() = user_id);

-- 10. ORDER_ITEMS
create table public.order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid references public.orders(id) on delete cascade,
  food_item_id uuid references public.food_items(id) on delete set null,
  quantity     int          not null default 1,
  unit_price   numeric(8,2) not null,
  total_price  numeric(8,2) not null,
  created_at   timestamptz  not null default now()
);
alter table public.order_items enable row level security;
create policy order_items_own_select on public.order_items
  for select using (exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid()));
create policy order_items_own_insert on public.order_items
  for insert with check (exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid()));

-- 11. POSTS
create table public.posts (
  id         uuid primary key default gen_random_uuid(),
  campus_id  uuid references public.campuses(id) on delete cascade,
  author_id  uuid references public.profiles(id) on delete cascade,
  type       text not null default 'General',
  title      text not null,
  content    text,
  tags       text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.posts enable row level security;
create policy posts_public_read on public.posts for select using (true);
create policy posts_auth_insert  on public.posts for insert with check (auth.uid() = author_id);
create policy posts_own_delete   on public.posts for delete using (auth.uid() = author_id);

-- 12. POST_LIKES
create table public.post_likes (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid references public.posts(id) on delete cascade,
  user_id    uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (post_id, user_id)
);
alter table public.post_likes enable row level security;
create policy post_likes_public_read on public.post_likes for select using (true);
create policy post_likes_auth_insert on public.post_likes for insert with check (auth.uid() = user_id);
create policy post_likes_own_delete  on public.post_likes for delete using (auth.uid() = user_id);

-- 13. COMMENTS
create table public.comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid references public.posts(id) on delete cascade,
  author_id  uuid references public.profiles(id) on delete cascade,
  content    text not null,
  created_at timestamptz not null default now()
);
alter table public.comments enable row level security;
create policy comments_public_read on public.comments for select using (true);
create policy comments_auth_insert on public.comments for insert with check (auth.uid() = author_id);
create policy comments_own_delete  on public.comments for delete using (auth.uid() = author_id);

-- 14. CLUBS
create table public.clubs (
  id          uuid primary key default gen_random_uuid(),
  campus_id   uuid references public.campuses(id) on delete cascade,
  name        text not null,
  category    text not null default 'General',
  members     int  not null default 0,
  events      int  not null default 0,
  description text,
  logo_url    text,
  created_at  timestamptz not null default now()
);
alter table public.clubs enable row level security;
create policy clubs_public_read on public.clubs for select using (true);

-- 15. CLUB_MEMBERS
create table public.club_members (
  id        uuid primary key default gen_random_uuid(),
  club_id   uuid references public.clubs(id) on delete cascade,
  user_id   uuid references public.profiles(id) on delete cascade,
  role      text not null default 'member'
              check (role in ('member','admin','president')),
  joined_at timestamptz not null default now(),
  unique (club_id, user_id)
);
alter table public.club_members enable row level security;
create policy club_members_public_read on public.club_members for select using (true);
create policy club_members_auth_insert on public.club_members for insert with check (auth.uid() = user_id);
create policy club_members_own_delete  on public.club_members for delete using (auth.uid() = user_id);

-- 16. EVENTS
create table public.events (
  id          uuid primary key default gen_random_uuid(),
  campus_id   uuid references public.campuses(id) on delete cascade,
  club_id     uuid references public.clubs(id) on delete set null,
  title       text not null,
  category    text not null default 'Event',
  event_date  timestamptz,
  place       text,
  description text,
  attendees   int not null default 0,
  created_at  timestamptz not null default now()
);
alter table public.events enable row level security;
create policy events_public_read on public.events for select using (true);

-- 17. EVENT_REGISTRATIONS
create table public.event_registrations (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid references public.events(id) on delete cascade,
  user_id       uuid references public.profiles(id) on delete cascade,
  registered_at timestamptz not null default now(),
  unique (event_id, user_id)
);
alter table public.event_registrations enable row level security;
create policy event_reg_auth_select on public.event_registrations for select using (auth.uid() = user_id);
create policy event_reg_auth_insert on public.event_registrations for insert with check (auth.uid() = user_id);
create policy event_reg_own_delete  on public.event_registrations for delete using (auth.uid() = user_id);

-- 18. SAVED_EVENTS
create table public.saved_events (
  id       uuid primary key default gen_random_uuid(),
  event_id uuid references public.events(id) on delete cascade,
  user_id  uuid references public.profiles(id) on delete cascade,
  saved_at timestamptz not null default now(),
  unique (event_id, user_id)
);
alter table public.saved_events enable row level security;
create policy saved_events_auth_select on public.saved_events for select using (auth.uid() = user_id);
create policy saved_events_auth_insert on public.saved_events for insert with check (auth.uid() = user_id);
create policy saved_events_own_delete  on public.saved_events for delete using (auth.uid() = user_id);

-- 19. LOCATIONS
create table public.locations (
  id         uuid primary key default gen_random_uuid(),
  campus_id  uuid references public.campuses(id) on delete cascade,
  name       text not null,
  building   text,
  floor      text,
  room       text,
  type       text,
  created_at timestamptz not null default now()
);
alter table public.locations enable row level security;
create policy locations_public_read on public.locations for select using (true);

-- 20. SERVICES
create table public.services (
  id          uuid primary key default gen_random_uuid(),
  campus_id   uuid references public.campuses(id) on delete cascade,
  name        text not null,
  description text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table public.services enable row level security;
create policy services_public_read on public.services for select using (true);

-- 21. RESOURCES
create table public.resources (
  id            uuid primary key default gen_random_uuid(),
  campus_id     uuid references public.campuses(id) on delete cascade,
  location_id   uuid references public.locations(id) on delete set null,
  name          text not null,
  resource_type text not null default 'Room',
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
alter table public.resources enable row level security;
create policy resources_public_read on public.resources for select using (true);

-- 22. PRINT_JOBS
create table public.print_jobs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles(id) on delete cascade,
  file_path   text not null,
  file_name   text not null,
  pages       int  not null default 1,
  copies      int  not null default 1,
  color_mode  text not null default 'black_white'
                check (color_mode in ('black_white','color')),
  paper_size  text not null default 'A4',
  binding     boolean not null default false,
  price       numeric(8,2) not null default 0,
  status      text not null default 'pending'
                check (status in ('pending','printing','ready','collected','cancelled')),
  pickup_code text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.print_jobs enable row level security;
create policy print_jobs_own_select on public.print_jobs for select using (auth.uid() = user_id);
create policy print_jobs_own_insert on public.print_jobs for insert with check (auth.uid() = user_id);

-- 23. SERVICE_REQUESTS
create table public.service_requests (
  id          uuid primary key default gen_random_uuid(),
  service_id  uuid references public.services(id) on delete set null,
  user_id     uuid references public.profiles(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  title       text not null,
  details     jsonb not null default '{}',
  status      text not null default 'reported'
                check (status in ('reported','in_progress','resolved','closed')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.service_requests enable row level security;
create policy service_req_own_select on public.service_requests for select using (auth.uid() = user_id);
create policy service_req_own_insert on public.service_requests for insert with check (auth.uid() = user_id);

-- 24. BOOKINGS
create table public.bookings (
  id          uuid primary key default gen_random_uuid(),
  resource_id uuid references public.resources(id) on delete cascade,
  user_id     uuid references public.profiles(id) on delete cascade,
  start_time  timestamptz not null,
  end_time    timestamptz not null,
  status      text not null default 'pending'
                check (status in ('pending','approved','rejected','cancelled')),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (end_time > start_time)
);
alter table public.bookings enable row level security;
create policy bookings_own_select on public.bookings for select using (auth.uid() = user_id);
create policy bookings_own_insert on public.bookings for insert with check (auth.uid() = user_id);
create policy bookings_own_delete on public.bookings for delete using (auth.uid() = user_id);

-- 25. NOTIFICATIONS
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.profiles(id) on delete cascade,
  type       text not null default 'official',
  title      text not null,
  body       text,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.notifications enable row level security;
create policy notifications_own_select on public.notifications for select using (auth.uid() = user_id);
create policy notifications_own_update on public.notifications for update using (auth.uid() = user_id);

-- 26. LOST_FOUND_ITEMS
create table public.lost_found_items (
  id          uuid primary key default gen_random_uuid(),
  campus_id   uuid references public.campuses(id) on delete cascade,
  user_id     uuid references public.profiles(id) on delete cascade,
  item_type   text not null default 'lost'
                check (item_type in ('lost','found')),
  title       text not null,
  description text,
  category    text not null default 'Other',
  location    text not null,
  status      text not null default 'open'
                check (status in ('open','claimed','closed')),
  claimed_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.lost_found_items enable row level security;
create policy lf_public_read on public.lost_found_items for select using (true);
create policy lf_auth_insert on public.lost_found_items for insert with check (auth.uid() = user_id);
create policy lf_own_update  on public.lost_found_items for update using (auth.uid() = user_id or auth.uid() = claimed_by);

-- 27. MARKETPLACE_LISTINGS
create table public.marketplace_listings (
  id          uuid primary key default gen_random_uuid(),
  campus_id   uuid references public.campuses(id) on delete cascade,
  seller_id   uuid references public.profiles(id) on delete cascade,
  title       text not null,
  description text,
  category    text not null default 'Other',
  price       numeric(10,2) not null default 0,
  condition   text not null default 'Used',
  location    text not null default 'Campus',
  status      text not null default 'active'
                check (status in ('active','sold','removed')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.marketplace_listings enable row level security;
create policy market_public_read on public.marketplace_listings for select using (true);
create policy market_auth_insert on public.marketplace_listings for insert with check (auth.uid() = seller_id);
create policy market_own_update  on public.marketplace_listings for update using (auth.uid() = seller_id);

-- 28. AUDIT_LOGS
create table public.audit_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.profiles(id) on delete set null,
  action     text not null,
  table_name text,
  record_id  uuid,
  details    jsonb,
  created_at timestamptz not null default now()
);
alter table public.audit_logs enable row level security;

-- 29. CONTENT_REPORTS
create table public.content_reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid references public.profiles(id) on delete cascade,
  content_type text not null,
  content_id   uuid not null,
  reason       text not null,
  status       text not null default 'pending'
                 check (status in ('pending','reviewed','dismissed')),
  created_at   timestamptz not null default now()
);
alter table public.content_reports enable row level security;
create policy reports_auth_insert on public.content_reports
  for insert with check (auth.uid() = reporter_id);

-- =============================================================================
-- SEED DATA
-- =============================================================================

-- S1. CAMPUS
insert into public.campuses (name, slug, city)
values ('New Horizon College of Engineering', 'nhce', 'Bengaluru');

-- S2. CANTEENS
insert into public.canteens (campus_id, name, subtitle, status, eta_min, eta_max, load, color, active)
select c.id, v.name, v.subtitle, v.status, v.eta_min, v.eta_max, v.load, v.color, true
from public.campuses c,
(values
  ('Udupi',   'South Indian',                   'Open', 8,  12, 32, 'green'),
  ('Tango',   'Rolls - Noodles - Biryani',       'Open', 12, 18, 58, 'moderate'),
  ('Munch',   'Fried Rice - Noodles - Chinese',  'Open', 20, 28, 84, 'busy'),
  ('Nescafe', 'Coffee - Maggi - Snacks',          'Open', 6,  10, 26, 'green')
) as v(name, subtitle, status, eta_min, eta_max, load, color)
where c.slug = 'nhce';

-- S3. FOOD CATEGORIES
insert into public.food_categories (name) values
  ('South Indian'),('Rolls'),('Noodles'),('Biryani & Rice'),('Pasta'),
  ('Sandwiches'),('Chinese'),('Snacks'),('Coffee'),('Maggi'),('Chicken');

-- S4. FOOD ITEMS - UDUPI
insert into public.food_items (canteen_id, category_id, name, description, price, is_vegetarian, available)
select cn.id, fc.id, v.name, v.item_desc, v.price, v.veg, true
from public.canteens cn, public.food_categories fc,
(values
  ('Masala Dosa',       'South Indian', 'Crispy dosa with spiced potato masala, chutney and sambar', 55,  true),
  ('Idli Vada',         'South Indian', 'Soft idlis with crispy vada, sambar and coconut chutney',   45,  true),
  ('Paneer Masala Dosa','South Indian', 'Crispy dosa filled with paneer and masala',                 85,  true),
  ('Set Dosa',          'South Indian', 'Soft fluffy set dosas served with chutney and sambar',      50,  true),
  ('Rava Idli',         'South Indian', 'Fluffy semolina idlis with coconut chutney',                50,  true)
) as v(name, cat, item_desc, price, veg)
where cn.name = 'Udupi' and fc.name = v.cat;

-- S4. FOOD ITEMS - TANGO
insert into public.food_items (canteen_id, category_id, name, description, price, is_vegetarian, available)
select cn.id, fc.id, v.name, v.item_desc, v.price, v.veg, true
from public.canteens cn, public.food_categories fc,
(values
  ('Chicken Roll',    'Rolls',          'Spiced chicken wrapped in a soft roll',             90,  false),
  ('Veg Noodles',     'Noodles',        'Wok-tossed noodles with fresh vegetables',          75,  true),
  ('Chicken Biryani', 'Biryani & Rice', 'Aromatic chicken biryani with fragrant basmati',   120, false),
  ('Penne Pasta',     'Pasta',          'Penne tossed in a rich creamy sauce',               95,  true),
  ('Grilled Sandwich','Sandwiches',     'Crispy grilled sandwich with cheesy filling',       70,  true)
) as v(name, cat, item_desc, price, veg)
where cn.name = 'Tango' and fc.name = v.cat;

-- S4. FOOD ITEMS - MUNCH
insert into public.food_items (canteen_id, category_id, name, description, price, is_vegetarian, available)
select cn.id, fc.id, v.name, v.item_desc, v.price, v.veg, true
from public.canteens cn, public.food_categories fc,
(values
  ('Chicken Fried Rice',  'Biryani & Rice', 'Wok-fried rice with chicken and vegetables',          100, false),
  ('Schezwan Fried Rice', 'Biryani & Rice', 'Spicy Schezwan-style fried rice with vegetables',     90,  true),
  ('Schezwan Noodles',    'Noodles',        'Spicy wok-tossed noodles with Schezwan sauce',         90,  true),
  ('Chilli Chicken',      'Chicken',        'Crispy chicken with peppers and chilli sauce',         120, false),
  ('Veg Manchurian',      'Chinese',        'Crispy veg balls in a savoury Indo-Chinese sauce',     90,  true)
) as v(name, cat, item_desc, price, veg)
where cn.name = 'Munch' and fc.name = v.cat;

-- S4. FOOD ITEMS - NESCAFE
insert into public.food_items (canteen_id, category_id, name, description, price, is_vegetarian, available)
select cn.id, fc.id, v.name, v.item_desc, v.price, v.veg, true
from public.canteens cn, public.food_categories fc,
(values
  ('Classic Coffee', 'Coffee', 'Hot, creamy college-style coffee',          35, true),
  ('Cold Coffee',    'Coffee', 'Chilled creamy coffee served cold',          60, true),
  ('Masala Maggi',   'Maggi',  'Hot Maggi noodles with Indian masala',       50, true),
  ('Chicken Maggi',  'Maggi',  'Maggi noodles with spicy chicken pieces',    80, false),
  ('French Fries',   'Snacks', 'Crispy golden fries with seasoning',         60, true)
) as v(name, cat, item_desc, price, veg)
where cn.name = 'Nescafe' and fc.name = v.cat;

-- S5. CLUBS
insert into public.clubs (campus_id, name, category, members, events, description)
select c.id, v.name, v.cat, v.members, v.events, v.item_desc
from public.campuses c,
(values
  ('AI Club',       'Technology', 426, 12, 'AI workshops, research projects and paper discussions.'),
  ('Robotics Club', 'Technology', 218, 8,  'Build robots, autonomous systems and embedded projects.'),
  ('Coding Club',   'Technology', 612, 16, 'Hackathons, DSA sessions, open source and team formation.'),
  ('Design Club',   'Creative',   188, 9,  'UI/UX, branding, motion and creative technology.')
) as v(name, cat, members, events, item_desc)
where c.slug = 'nhce';

-- S6. EVENTS
insert into public.events (campus_id, club_id, title, category, event_date, place, description, attendees)
select c.id, cl.id, v.title, v.cat, (now() + v.days * interval '1 day')::timestamptz, v.place, v.item_desc, 0
from public.campuses c
cross join (values
  ('AI Club',       'Generative AI Workshop',       'Workshop',  3,  'Seminar Hall 2',  'Hands-on session with LLMs and prompt engineering.'),
  ('Coding Club',   'NHCE Hackathon 2026',          'Hackathon', 7,  'Main Auditorium', '48-hour hackathon open to all departments.'),
  ('Robotics Club', 'Autonomous Systems Demo Day',  'Demo',      14, 'Block B Labs',    'Live demos of autonomous robots and embedded systems.')
) as v(club_name, title, cat, days, place, item_desc)
join public.clubs cl on cl.name = v.club_name and cl.campus_id = c.id
where c.slug = 'nhce';

-- S7. LOCATIONS
insert into public.locations (campus_id, name, building, floor, room, type)
select c.id, v.name, v.building, v.floor, v.room, v.type
from public.campuses c,
(values
  ('Main Auditorium', 'Main Block', 'Ground', 'A001', 'Events'),
  ('Seminar Hall 1',  'Block A',    '1st',    'A101', 'Events'),
  ('Seminar Hall 2',  'Block A',    '2nd',    'A201', 'Events'),
  ('Computer Lab 1',  'Block B',    '1st',    'B101', 'Lab'),
  ('Computer Lab 2',  'Block B',    '2nd',    'B201', 'Lab'),
  ('Library',         'Main Block', '1st',    'L001', 'Library')
) as v(name, building, floor, room, type)
where c.slug = 'nhce';

-- S8. SERVICES
insert into public.services (campus_id, name, description, active)
select c.id, v.name, v.item_desc, true
from public.campuses c,
(values
  ('Wi-Fi & Network', 'Report Wi-Fi outages, slow speeds and network faults.'),
  ('Electrical',      'Report electrical faults, power cuts and equipment issues.'),
  ('Housekeeping',    'Request cleaning, garbage removal and maintenance support.')
) as v(name, item_desc)
where c.slug = 'nhce';

-- S9. RESOURCES
insert into public.resources (campus_id, location_id, name, resource_type, active)
select c.id, l.id, l.name, v.rtype, true
from public.campuses c
cross join (values
  ('Main Auditorium', 'Hall'),
  ('Seminar Hall 1',  'Hall'),
  ('Computer Lab 1',  'Lab'),
  ('Library',         'Study Room')
) as v(loc_name, rtype)
join public.locations l on l.name = v.loc_name and l.campus_id = c.id
where c.slug = 'nhce';

-- =============================================================================
-- DONE. Run VERIFY_CAMPUSOS.sql next.
-- =============================================================================

-- =============================================================================
-- OPTIONAL: KINGPIN PROFILE SEED
-- =============================================================================
-- If the kingpin user already exists in auth.users (you created them via
-- Supabase Dashboard -> Auth -> Users), this block creates their profile.
-- It is safe to run even if the user does not exist yet (it will just do nothing).
-- =============================================================================
do $$
declare
  v_campus_id uuid;
  v_user_id   uuid;
begin
  select id into v_campus_id from public.campuses where slug = 'nhce' limit 1;
  select id into v_user_id   from auth.users where email = 'sanjaypadmaraj@nhce.edu.in' limit 1;

  if v_user_id is not null then
    insert into public.profiles (id, campus_id, name, email, usn, course, year, role)
    values (
      v_user_id,
      v_campus_id,
      'Sanjay Padmaraj',
      'sanjaypadmaraj@nhce.edu.in',
      '1NH22CS101',
      'Computer Science & Engineering',
      '2nd Year',
      'student'
    )
    on conflict (id) do update set
      campus_id = excluded.campus_id,
      name      = excluded.name,
      email     = excluded.email,
      usn       = excluded.usn,
      course    = excluded.course,
      year      = excluded.year;

    raise notice 'Kingpin profile created/updated for user %', v_user_id;
  else
    raise notice 'Kingpin auth user not found — create them in Supabase Auth -> Users first.';
  end if;
end;
$$;

NOTIFY pgrst, 'reload schema';

