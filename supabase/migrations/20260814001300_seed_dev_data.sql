-- =============================================================================
-- 0013: DEV/DEMO SEED DATA -- catalog content only. Deliberately contains NO
-- user accounts, passwords or auth bypasses (see docs/SECURITY.md for why
-- the old "kingpin" demo login was removed). Safe to run in dev/staging;
-- review before running against a real production campus.
-- =============================================================================

insert into public.canteens (campus_id, name, subtitle, status, eta_min, eta_max, queue_level, load, color)
select c.id, v.name, v.subtitle, v.status, v.eta_min, v.eta_max, v.queue_level, v.load, v.color
from public.campuses c
cross join (values
  ('Udupi','South Indian','Quiet',8,12,'quiet',32,'green'),
  ('Tango','Rolls - Noodles - Biryani - Pasta','Moderate',12,18,'moderate',58,'moderate'),
  ('Munch','Fried Rice - Noodles - Chinese','Busy',20,28,'busy',84,'busy'),
  ('Nescafe','Coffee - Maggi - Snacks','Quiet',6,10,'quiet',26,'green')
) as v(name,subtitle,status,eta_min,eta_max,queue_level,load,color)
where c.slug = 'nhce'
on conflict (campus_id, name) do update set subtitle = excluded.subtitle, active = true;

insert into public.food_categories(name) values
  ('South Indian'),('Rolls'),('Noodles'),('Biryani'),('Pasta'),('Sandwich'),
  ('Fried Rice'),('Chinese'),('Coffee'),('Maggi'),('Snacks')
on conflict (name) do nothing;

insert into public.food_items (canteen_id, category_id, name, description, price, is_vegetarian)
select c.id, fc.id, v.name, v.description, v.price, v.veg
from public.canteens c
cross join lateral (values
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
where c.name = v.canteen_name and c.campus_id = (select id from public.campuses where slug='nhce')
on conflict (canteen_id, name) do update set description = excluded.description, price = excluded.price, available = true, active = true;

insert into public.clubs (campus_id, name, category, description)
select c.id, v.name, v.category, v.description
from public.campuses c
cross join (values
  ('AI Club','Technology','AI workshops, research projects and paper discussions.'),
  ('Robotics Club','Technology','Build robots, autonomous systems and embedded projects.'),
  ('Coding Club','Technology','Hackathons, DSA sessions, open source and team formation.'),
  ('Design Club','Creative','UI/UX, branding, motion and creative technology.')
) as v(name, category, description)
where c.slug = 'nhce'
on conflict (campus_id, name) do update set category = excluded.category, description = excluded.description;

insert into public.events (campus_id, club_id, title, category, event_date, place, capacity)
select c.id, cl.id, v.title, v.category, v.event_date::timestamptz, v.place, v.capacity
from public.campuses c
join public.clubs cl on cl.campus_id = c.id
cross join (values
  ('AI Club','Generative AI Workshop','Workshop','2026-08-12 14:00:00+05:30','Seminar Hall 2', 200),
  ('Coding Club','Campus Hackathon 2026','Hackathon','2026-08-14 09:00:00+05:30','Innovation Lab', 500),
  ('Robotics Club','Robotics Project Showcase','Showcase','2026-08-16 16:30:00+05:30','Main Auditorium', 150)
) as v(club_name, title, category, event_date, place, capacity)
where c.slug = 'nhce' and cl.name = v.club_name
on conflict (campus_id, title, event_date) do update set place = excluded.place, capacity = excluded.capacity;

insert into public.locations (campus_id, name, type, building, floor)
select c.id, v.name, v.type, v.building, v.floor
from public.campuses c
cross join (values
  ('Seminar Hall 2', 'Auditorium', 'Block C', '2nd Floor'),
  ('Innovation Lab', 'Lab', 'Block A', 'Ground Floor'),
  ('Main Library', 'Library', 'Central Block', '1st Floor'),
  ('Central Food Court', 'Food Court', 'Student Center', 'Ground Floor')
) as v(name, type, building, floor)
where c.slug = 'nhce'
on conflict (campus_id, name) do nothing;

insert into public.services (campus_id, name, category, description)
select c.id, v.name, v.category, v.description
from public.campuses c
cross join (values
  ('Wi-Fi Support','Wi-Fi','Report connectivity issues in classrooms, labs and hostels'),
  ('Facility Maintenance','Other','Report classroom, lab or hostel repairs to facilities staff'),
  ('Document Printing','Other','High-speed cloud printing at library & lab kiosks'),
  -- Matches the literal serviceName the "Report an Issue" quick-action UI
  -- sends (App.jsx IssueService) -- without this row, every category button
  -- on that screen fails with `Service "Report an Issue" is not configured.`
  ('Report an Issue','Other','Catch-all facilities ticket intake used by the Report an Issue quick action')
) as v(name, category, description)
where c.slug = 'nhce'
on conflict (campus_id, name) do nothing;

insert into public.resources (campus_id, name, resource_type, approval_required)
select c.id, v.name, v.resource_type, v.approval_required
from public.campuses c
cross join (values
  ('Discussion Room A', 'Room', false),
  ('Discussion Room B', 'Room', false),
  ('High-Performance GPU Workstation', 'Hardware', true),
  ('Seminar Hall 2', 'Hall', true)
) as v(name, resource_type, approval_required)
where c.slug = 'nhce'
on conflict (campus_id, name) do nothing;

NOTIFY pgrst, 'reload schema';
