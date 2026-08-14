-- CampusOS Canonical Schema & Dynamic Seed Script
-- Standardizes all primary keys to UUID and dynamically links relational data.

create extension if not exists pgcrypto;

-- =========================================================
-- 1. CAMPUS + PROFILES
-- =========================================================

create table if not exists public.campuses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  created_at timestamptz not null default now()
);

insert into public.campuses (name, slug)
values ('New Horizon College of Engineering', 'nhce')
on conflict (slug) do update set name = excluded.name;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid references public.campuses(id) on delete set null,
  name text not null default 'Campus Student',
  email text,
  usn text,
  course text,
  year text,
  avatar_url text,
  bio text,
  skills text[] not null default '{}',
  role text not null default 'student' check (role in ('student', 'club_admin', 'vendor', 'facilities_staff', 'college_admin', 'super_admin')),
  open_to_projects boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id,
    name,
    email,
    usn,
    course,
    year
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(coalesce(new.email,''),'@',1), 'Campus Student'),
    new.email,
    coalesce(new.raw_user_meta_data->>'usn', ''),
    coalesce(new.raw_user_meta_data->>'course', 'Computer Science & Engineering'),
    coalesce(new.raw_user_meta_data->>'year', '2nd Year')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Protect profile role modifications
create or replace function public.protect_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null then
    raise exception 'Role changes are restricted';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role
before update on public.profiles
for each row execute function public.protect_profile_role();

-- =========================================================
-- 2. CANTEENS & FOOD
-- =========================================================

create table if not exists public.canteens (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid references public.campuses(id) on delete cascade,
  name text not null,
  subtitle text,
  status text not null default 'Open',
  eta_min integer not null default 5,
  eta_max integer not null default 15,
  queue_level text not null default 'quiet',
  load integer not null default 25,
  color text not null default 'green',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(campus_id, name)
);

create table if not exists public.food_categories (
  id uuid primary key default gen_random_uuid(),
  name text unique not null
);

create table if not exists public.food_items (
  id uuid primary key default gen_random_uuid(),
  canteen_id uuid not null references public.canteens(id) on delete cascade,
  category_id uuid references public.food_categories(id) on delete set null,
  name text not null,
  description text,
  price numeric(10,2) not null default 0,
  image_url text,
  is_vegetarian boolean not null default true,
  available boolean not null default true,
  created_at timestamptz not null default now(),
  unique(canteen_id, name)
);

insert into public.canteens
  (campus_id, name, subtitle, status, eta_min, eta_max, queue_level, load, color)
select
  c.id, v.name, v.subtitle, v.status, v.eta_min, v.eta_max, v.queue_level, v.load, v.color
from public.campuses c
cross join (
  values
    ('Udupi','South Indian','Quiet',8,12,'quiet',32,'green'),
    ('Tango','Rolls · Noodles · Biryani · Pasta','Moderate',12,18,'moderate',58,'moderate'),
    ('Munch','Fried Rice · Noodles · Chinese','Busy',20,28,'busy',84,'busy'),
    ('Nescafe','Coffee · Maggi · Snacks','Quiet',6,10,'quiet',26,'green')
) as v(name,subtitle,status,eta_min,eta_max,queue_level,load,color)
where c.slug = 'nhce'
on conflict (campus_id, name) do update set
  subtitle = excluded.subtitle,
  status = excluded.status,
  eta_min = excluded.eta_min,
  eta_max = excluded.eta_max,
  queue_level = excluded.queue_level,
  load = excluded.load,
  color = excluded.color,
  active = true;

insert into public.food_categories(name)
values
  ('South Indian'),
  ('Rolls'),
  ('Noodles'),
  ('Biryani'),
  ('Pasta'),
  ('Sandwich'),
  ('Fried Rice'),
  ('Chinese'),
  ('Coffee'),
  ('Maggi'),
  ('Snacks')
on conflict (name) do nothing;

insert into public.food_items
  (canteen_id, category_id, name, description, price, is_vegetarian)
select
  c.id,
  fc.id,
  v.name,
  v.description,
  v.price,
  v.veg
from public.canteens c
cross join lateral (
  values
    ('Udupi','Masala Dosa','South Indian','Crispy dosa with spiced potato masala, chutney and sambar',55,true),
    ('Udupi','Idli Vada','South Indian','Soft idlis with crispy vada, sambar and coconut chutney',45,true),
    ('Udupi','Paneer Masala Dosa','South Indian','Crispy dosa filled with paneer and masala',85,true),
    ('Udupi','Set Dosa','South Indian','Soft fluffy set dosas served with chutney and sambar',50,true),
    ('Tango','Chicken Roll','Rolls','Spiced chicken wrapped in a soft roll with fresh vegetables',90,false),
    ('Tango','Veg Noodles','Noodles','Wok-tossed noodles with fresh vegetables',75,true),
    ('Tango','Chicken Biryani','Biryani','Aromatic chicken biryani with fragrant basmati rice',120,false),
    ('Tango','Penne Pasta','Pasta','Penne pasta tossed in a rich creamy sauce',95,true),
    ('Tango','Grilled Sandwich','Sandwich','Crispy grilled sandwich with a cheesy vegetable filling',70,true),
    ('Munch','Chicken Fried Rice','Fried Rice','Wok-fried rice with chicken, vegetables and seasoning',100,false),
    ('Munch','Schezwan Fried Rice','Fried Rice','Spicy Schezwan-style fried rice with vegetables',90,true),
    ('Munch','Schezwan Noodles','Noodles','Spicy wok-tossed noodles with Schezwan sauce',90,true),
    ('Munch','Chilli Chicken','Chinese','Crispy chicken tossed with peppers, onions and chilli sauce',120,false),
    ('Munch','Veg Manchurian','Chinese','Crispy vegetable balls in savoury Indo-Chinese sauce',90,true),
    ('Nescafe','Classic Coffee','Coffee','Hot creamy college-style coffee',35,true),
    ('Nescafe','Cold Coffee','Coffee','Chilled creamy coffee served cold',60,true),
    ('Nescafe','Masala Maggi','Maggi','Hot Maggi noodles tossed with Indian masala',50,true),
    ('Nescafe','Chicken Maggi','Maggi','Maggi noodles with spicy chicken pieces',80,false),
    ('Nescafe','Chicken Nuggets','Snacks','Crispy golden chicken nuggets',85,false),
    ('Nescafe','French Fries','Snacks','Crispy golden fries with seasoning',60,true)
) as v(canteen_name,name,category_name,description,price,veg)
join public.food_categories fc on fc.name = v.category_name
where c.name = v.canteen_name
  and c.campus_id = (select id from public.campuses where slug='nhce')
on conflict (canteen_id, name) do update set
  description = excluded.description,
  price = excluded.price,
  is_vegetarian = excluded.is_vegetarian,
  available = true;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  canteen_id uuid not null references public.canteens(id),
  status text not null default 'pending',
  subtotal numeric(10,2) not null default 0,
  platform_fee numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  payment_status text not null default 'pending',
  pickup_code text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  food_item_id uuid not null references public.food_items(id),
  quantity integer not null check (quantity > 0),
  unit_price numeric(10,2) not null,
  total_price numeric(10,2) not null
);

-- =========================================================
-- 3. POSTS & SOCIAL
-- =========================================================

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  campus_id uuid references public.campuses(id) on delete set null,
  type text not null default 'General',
  title text not null,
  content text not null default '',
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint posts_author_id_fkey foreign key (author_id) references public.profiles(id) on delete cascade
);

create table if not exists public.post_likes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(post_id,user_id)
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now(),
  constraint comments_author_id_fkey foreign key (author_id) references public.profiles(id) on delete cascade,
  constraint comments_post_id_fkey foreign key (post_id) references public.posts(id) on delete cascade
);

-- =========================================================
-- 4. CLUBS & EVENTS (CANONICAL UUID PK ARCHITECTURE)
-- =========================================================

create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid references public.campuses(id) on delete cascade,
  name text not null,
  category text,
  members integer not null default 0,
  events integer not null default 0,
  description text,
  logo_url text,
  unique(campus_id, name)
);

create table if not exists public.club_members (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member',
  joined_at timestamptz not null default now(),
  unique(club_id, user_id)
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid references public.campuses(id) on delete cascade,
  club_id uuid references public.clubs(id) on delete set null,
  title text not null,
  category text,
  event_date timestamptz not null,
  place text,
  description text,
  attendees integer not null default 0,
  unique(campus_id, title, event_date)
);

create table if not exists public.event_registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  registered_at timestamptz not null default now(),
  unique(event_id, user_id)
);

create table if not exists public.saved_events (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

-- Dynamic Seed: Clubs (without manual ID assignment)
insert into public.clubs (
  campus_id,
  name,
  category,
  members,
  events,
  description
)
select
  c.id,
  v.name,
  v.category,
  v.members,
  v.events,
  v.description
from public.campuses c
cross join (
  values
    (
      'AI Club',
      'Technology',
      426,
      12,
      'AI workshops, research projects and paper discussions.'
    ),
    (
      'Robotics Club',
      'Technology',
      218,
      8,
      'Build robots, autonomous systems and embedded projects.'
    ),
    (
      'Coding Club',
      'Technology',
      612,
      16,
      'Hackathons, DSA sessions, open source and team formation.'
    ),
    (
      'Design Club',
      'Creative',
      188,
      9,
      'UI/UX, branding, motion and creative technology.'
    )
) as v(name, category, members, events, description)
where c.slug = 'nhce'
on conflict (campus_id, name) do update set
  category = excluded.category,
  members = excluded.members,
  events = excluded.events,
  description = excluded.description;

-- Dynamic Seed: Events (referencing parent clubs by name)
insert into public.events (
  campus_id,
  club_id,
  title,
  category,
  event_date,
  place,
  attendees
)
select
  c.id,
  cl.id,
  v.title,
  v.category,
  v.event_date::timestamptz,
  v.place,
  v.attendees
from public.campuses c
join public.clubs cl
  on cl.campus_id = c.id
cross join (
  values
    (
      'AI Club',
      'Generative AI Workshop',
      'Workshop',
      '2026-08-12 14:00:00+05:30',
      'Seminar Hall 2',
      184
    ),
    (
      'Coding Club',
      'Campus Hackathon 2026',
      'Hackathon',
      '2026-08-14 09:00:00+05:30',
      'Innovation Lab',
      420
    ),
    (
      'Robotics Club',
      'Robotics Project Showcase',
      'Showcase',
      '2026-08-16 16:30:00+05:30',
      'Main Auditorium',
      142
    )
) as v(club_name, title, category, event_date, place, attendees)
where c.slug = 'nhce'
  and cl.name = v.club_name
on conflict (campus_id, title, event_date) do update set
  club_id = excluded.club_id,
  category = excluded.category,
  place = excluded.place,
  attendees = excluded.attendees;

-- =========================================================
-- 5. SERVICES, LOCATIONS, RESOURCES
-- =========================================================

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid references public.campuses(id) on delete cascade,
  name text not null,
  description text,
  active boolean not null default true,
  unique(campus_id, name)
);

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid references public.campuses(id) on delete cascade,
  name text not null,
  type text,
  building text,
  floor text,
  room text,
  latitude numeric,
  longitude numeric,
  unique(campus_id, name)
);

create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid references public.campuses(id) on delete cascade,
  name text not null,
  resource_type text,
  location_id uuid references public.locations(id),
  capacity integer,
  available boolean not null default true,
  unique(campus_id, name)
);

create table if not exists public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  file_url text not null,
  file_name text not null,
  pages integer not null check (pages > 0),
  copies integer not null default 1 check (copies > 0),
  color_mode text not null default 'black_white' check (color_mode in ('black_white', 'colour')),
  paper_size text not null default 'A4',
  price numeric(10,2) not null check (price >= 0),
  status text not null default 'pending',
  pickup_code text,
  created_at timestamptz not null default now()
);

create table if not exists public.service_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  service_id uuid references public.services(id),
  title text not null,
  details jsonb not null default '{}',
  status text not null default 'pending',
  assigned_to uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources(id),
  user_id uuid not null references public.profiles(id) on delete cascade,
  start_time timestamptz not null,
  end_time timestamptz not null,
  status text not null default 'pending',
  notes text,
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null default 'official',
  title text not null,
  body text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

-- =========================================================
-- 6. MARKETPLACE & LOST AND FOUND
-- =========================================================

create table if not exists public.lost_found_items (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid references public.campuses(id) on delete set null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_type text not null check (item_type in ('lost', 'found')),
  title text not null,
  description text not null default '',
  category text not null default 'Other',
  location text not null,
  image_url text,
  status text not null default 'open' check (status in ('open', 'claimed', 'resolved')),
  claimed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lost_found_items_user_id_fkey foreign key (user_id) references public.profiles(id) on delete cascade,
  constraint lost_found_items_claimed_by_fkey foreign key (claimed_by) references public.profiles(id) on delete set null
);

create table if not exists public.marketplace_listings (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid references public.campuses(id) on delete set null,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text not null default '',
  category text not null default 'Other',
  price numeric(10,2) not null default 0 check (price >= 0),
  condition text not null default 'Used',
  location text not null default 'Campus',
  image_url text,
  status text not null default 'active' check (status in ('active', 'pending', 'sold', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketplace_listings_seller_id_fkey foreign key (seller_id) references public.profiles(id) on delete cascade
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null,
  target_id text not null,
  reason text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

-- Seed Locations & Services
insert into public.locations (campus_id, name, type, building, floor)
select c.id, v.name, v.type, v.building, v.floor
from public.campuses c
cross join (
  values
    ('Seminar Hall 2', 'Auditorium', 'Block C', '2nd Floor'),
    ('Innovation Lab', 'Lab', 'Block A', 'Ground Floor'),
    ('Main Library', 'Library', 'Central Block', '1st Floor'),
    ('Central Food Court', 'Food Court', 'Student Center', 'Ground Floor')
) as v(name, type, building, floor)
where c.slug = 'nhce'
on conflict (campus_id, name) do nothing;

insert into public.services (campus_id, name, description)
select c.id, v.name, v.description
from public.campuses c
cross join (
  values
    ('Document Printing', 'High-speed cloud printing at library & lab kiosks'),
    ('Campus Gate Pass', 'Instant QR-based gate pass approval for day scholars and hostellers'),
    ('Facility Maintenance', 'Report classroom, lab or hostel repairs to facilities staff')
) as v(name, description)
where c.slug = 'nhce'
on conflict (campus_id, name) do nothing;

insert into public.resources (campus_id, name, resource_type)
select c.id, v.name, v.resource_type
from public.campuses c
cross join (
  values
    ('Discussion Room A', 'Room'),
    ('Discussion Room B', 'Room'),
    ('High-Performance GPU Workstation', 'Hardware')
) as v(name, resource_type)
where c.slug = 'nhce'
on conflict (campus_id, name) do nothing;

-- =========================================================
-- 7. COMPREHENSIVE ROW LEVEL SECURITY (RLS) POLICIES
-- Permissive policies for anon & authenticated roles.
-- Ensures guest/demo logins and authenticated JWT users work without RLS crashes.
-- =========================================================

alter table public.campuses enable row level security;
alter table public.profiles enable row level security;
alter table public.canteens enable row level security;
alter table public.food_categories enable row level security;
alter table public.food_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.posts enable row level security;
alter table public.post_likes enable row level security;
alter table public.comments enable row level security;
alter table public.clubs enable row level security;
alter table public.club_members enable row level security;
alter table public.events enable row level security;
alter table public.event_registrations enable row level security;
alter table public.saved_events enable row level security;
alter table public.services enable row level security;
alter table public.locations enable row level security;
alter table public.resources enable row level security;
alter table public.service_requests enable row level security;
alter table public.bookings enable row level security;
alter table public.print_jobs enable row level security;
alter table public.notifications enable row level security;
alter table public.lost_found_items enable row level security;
alter table public.marketplace_listings enable row level security;
alter table public.audit_logs enable row level security;
alter table public.content_reports enable row level security;

-- Create ALL-permissive policies across all tables
drop policy if exists "campuses_policy" on public.campuses;
create policy "campuses_policy" on public.campuses for all to anon, authenticated using (true) with check (true);

drop policy if exists "profiles_policy" on public.profiles;
create policy "profiles_policy" on public.profiles for all to anon, authenticated using (true) with check (true);

drop policy if exists "canteens_policy" on public.canteens;
create policy "canteens_policy" on public.canteens for all to anon, authenticated using (true) with check (true);

drop policy if exists "food_categories_policy" on public.food_categories;
create policy "food_categories_policy" on public.food_categories for all to anon, authenticated using (true) with check (true);

drop policy if exists "food_items_policy" on public.food_items;
create policy "food_items_policy" on public.food_items for all to anon, authenticated using (true) with check (true);

drop policy if exists "orders_policy" on public.orders;
create policy "orders_policy" on public.orders for all to anon, authenticated using (true) with check (true);

drop policy if exists "order_items_policy" on public.order_items;
create policy "order_items_policy" on public.order_items for all to anon, authenticated using (true) with check (true);

drop policy if exists "posts_policy" on public.posts;
create policy "posts_policy" on public.posts for all to anon, authenticated using (true) with check (true);

drop policy if exists "post_likes_policy" on public.post_likes;
create policy "post_likes_policy" on public.post_likes for all to anon, authenticated using (true) with check (true);

drop policy if exists "comments_policy" on public.comments;
create policy "comments_policy" on public.comments for all to anon, authenticated using (true) with check (true);

drop policy if exists "clubs_policy" on public.clubs;
create policy "clubs_policy" on public.clubs for all to anon, authenticated using (true) with check (true);

drop policy if exists "club_members_policy" on public.club_members;
create policy "club_members_policy" on public.club_members for all to anon, authenticated using (true) with check (true);

drop policy if exists "events_policy" on public.events;
create policy "events_policy" on public.events for all to anon, authenticated using (true) with check (true);

drop policy if exists "event_registrations_policy" on public.event_registrations;
create policy "event_registrations_policy" on public.event_registrations for all to anon, authenticated using (true) with check (true);

drop policy if exists "saved_events_policy" on public.saved_events;
create policy "saved_events_policy" on public.saved_events for all to anon, authenticated using (true) with check (true);

drop policy if exists "services_policy" on public.services;
create policy "services_policy" on public.services for all to anon, authenticated using (true) with check (true);

drop policy if exists "locations_policy" on public.locations;
create policy "locations_policy" on public.locations for all to anon, authenticated using (true) with check (true);

drop policy if exists "resources_policy" on public.resources;
create policy "resources_policy" on public.resources for all to anon, authenticated using (true) with check (true);

drop policy if exists "service_requests_policy" on public.service_requests;
create policy "service_requests_policy" on public.service_requests for all to anon, authenticated using (true) with check (true);

drop policy if exists "bookings_policy" on public.bookings;
create policy "bookings_policy" on public.bookings for all to anon, authenticated using (true) with check (true);

drop policy if exists "print_jobs_policy" on public.print_jobs;
create policy "print_jobs_policy" on public.print_jobs for all to anon, authenticated using (true) with check (true);

drop policy if exists "notifications_policy" on public.notifications;
create policy "notifications_policy" on public.notifications for all to anon, authenticated using (true) with check (true);

drop policy if exists "lost_found_items_policy" on public.lost_found_items;
create policy "lost_found_items_policy" on public.lost_found_items for all to anon, authenticated using (true) with check (true);

drop policy if exists "marketplace_listings_policy" on public.marketplace_listings;
create policy "marketplace_listings_policy" on public.marketplace_listings for all to anon, authenticated using (true) with check (true);

drop policy if exists "audit_logs_policy" on public.audit_logs;
create policy "audit_logs_policy" on public.audit_logs for all to anon, authenticated using (true) with check (true);

drop policy if exists "content_reports_policy" on public.content_reports;
create policy "content_reports_policy" on public.content_reports for all to anon, authenticated using (true) with check (true);

-- Enable Realtime for all interactive tables
alter publication supabase_realtime add table public.posts;
alter publication supabase_realtime add table public.post_likes;
alter publication supabase_realtime add table public.comments;
alter publication supabase_realtime add table public.clubs;
alter publication supabase_realtime add table public.club_members;
alter publication supabase_realtime add table public.events;
alter publication supabase_realtime add table public.event_registrations;
alter publication supabase_realtime add table public.saved_events;
alter publication supabase_realtime add table public.canteens;
alter publication supabase_realtime add table public.food_items;
alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.marketplace_listings;
alter publication supabase_realtime add table public.lost_found_items;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.service_requests;
alter publication supabase_realtime add table public.bookings;
alter publication supabase_realtime add table public.print_jobs;