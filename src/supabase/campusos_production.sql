/*
============================================================
CAMPUSOS PRODUCTION UPGRADE
Run AFTER supabase_mvp.sql
============================================================
*/

create extension if not exists pgcrypto;


/* =========================================================
   1. ROLE SYSTEM
========================================================= */

alter table public.profiles
add column if not exists role text
not null default 'student';

alter table public.profiles
drop constraint if exists profiles_role_check;

alter table public.profiles
add constraint profiles_role_check
check (
  role in (
    'student',
    'club_admin',
    'vendor',
    'facilities_staff',
    'college_admin',
    'super_admin'
  )
);


/* =========================================================
   2. PROFILE INDEXES
========================================================= */

create index if not exists
profiles_campus_idx
on public.profiles(campus_id);

create index if not exists
profiles_role_idx
on public.profiles(role);

create index if not exists
profiles_skills_idx
on public.profiles
using gin(skills);


/* =========================================================
   3. POST INDEXES
========================================================= */

create index if not exists
posts_campus_created_idx
on public.posts(
  campus_id,
  created_at desc
);

create index if not exists
post_likes_post_idx
on public.post_likes(post_id);

create index if not exists
comments_post_created_idx
on public.comments(
  post_id,
  created_at
);


/* =========================================================
   4. EVENT INDEXES
========================================================= */

create index if not exists
events_campus_date_idx
on public.events(
  campus_id,
  event_date
);

create index if not exists
event_reg_user_idx
on public.event_registrations(user_id);

create index if not exists
event_reg_event_idx
on public.event_registrations(event_id);


/* =========================================================
   5. FOOD ORDER INDEXES
========================================================= */

create index if not exists
orders_user_created_idx
on public.orders(
  user_id,
  created_at desc
);

create index if not exists
orders_canteen_status_idx
on public.orders(
  canteen_id,
  status
);

create index if not exists
order_items_order_idx
on public.order_items(order_id);


/* =========================================================
   6. SERVICE REQUEST INDEXES
========================================================= */

create index if not exists
service_requests_user_idx
on public.service_requests(user_id);

create index if not exists
service_requests_status_idx
on public.service_requests(status);

create index if not exists
service_requests_created_idx
on public.service_requests(
  created_at desc
);


/* =========================================================
   7. BOOKING INDEXES
========================================================= */

create index if not exists
bookings_resource_time_idx
on public.bookings(
  resource_id,
  start_time,
  end_time
);

create index if not exists
bookings_user_idx
on public.bookings(user_id);


/* =========================================================
   8. PRINT INDEXES
========================================================= */

create index if not exists
print_jobs_user_idx
on public.print_jobs(
  user_id,
  created_at desc
);

create index if not exists
print_jobs_status_idx
on public.print_jobs(status);


/* =========================================================
   9. NOTIFICATION INDEX
========================================================= */

create index if not exists
notifications_user_read_idx
on public.notifications(
  user_id,
  read,
  created_at desc
);


/* =========================================================
   10. AUDIT LOG
========================================================= */

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),

  actor_id uuid
    references auth.users(id)
    on delete set null,

  action text not null,

  entity_type text,

  entity_id text,

  metadata jsonb
    not null default '{}',

  created_at timestamptz
    not null default now()
);

create index if not exists
audit_logs_actor_idx
on public.audit_logs(actor_id);

create index if not exists
audit_logs_created_idx
on public.audit_logs(
  created_at desc
);


/* =========================================================
   11. CONTENT REPORTS
========================================================= */

create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),

  reporter_id uuid
    not null
    references auth.users(id)
    on delete cascade,

  target_type text not null,

  target_id text not null,

  reason text not null,

  details text,

  status text not null default 'open',

  reviewed_by uuid
    references auth.users(id)
    on delete set null,

  reviewed_at timestamptz,

  created_at timestamptz
    not null default now(),

  constraint content_reports_status_check
  check (
    status in (
      'open',
      'reviewing',
      'resolved',
      'dismissed'
    )
  )
);

create index if not exists
content_reports_status_idx
on public.content_reports(status);

create index if not exists
content_reports_created_idx
on public.content_reports(
  created_at desc
);


/* =========================================================
   12. LOST & FOUND
========================================================= */

create table if not exists public.lost_found_items (
  id uuid primary key default gen_random_uuid(),

  campus_id uuid
    references public.campuses(id)
    on delete cascade,

  user_id uuid
    not null
    references auth.users(id)
    on delete cascade,

  item_type text not null,

  title text not null,

  description text,

  category text,

  location text,

  image_url text,

  status text not null default 'open',

  created_at timestamptz
    not null default now(),

  updated_at timestamptz
    not null default now(),

  constraint lost_found_type_check
  check (
    item_type in (
      'lost',
      'found'
    )
  ),

  constraint lost_found_status_check
  check (
    status in (
      'open',
      'claimed',
      'closed'
    )
  )
);

create index if not exists
lost_found_campus_idx
on public.lost_found_items(campus_id);

create index if not exists
lost_found_status_idx
on public.lost_found_items(status);


/* =========================================================
   13. MARKETPLACE
========================================================= */

create table if not exists public.marketplace_listings (
  id uuid primary key default gen_random_uuid(),

  campus_id uuid
    references public.campuses(id)
    on delete cascade,

  seller_id uuid
    not null
    references auth.users(id)
    on delete cascade,

  title text not null,

  description text,

  category text,

  price numeric(10,2)
    not null default 0,

  condition text,

  location text,

  image_url text,

  status text
    not null default 'active',

  created_at timestamptz
    not null default now(),

  updated_at timestamptz
    not null default now(),

  constraint marketplace_status_check
  check (
    status in (
      'active',
      'reserved',
      'sold',
      'removed'
    )
  )
);

create index if not exists
marketplace_campus_idx
on public.marketplace_listings(campus_id);

create index if not exists
marketplace_status_idx
on public.marketplace_listings(status);


/* =========================================================
   14. PUSH / SYSTEM NOTIFICATION BODY
========================================================= */

alter table public.notifications
add column if not exists
body text;

alter table public.notifications
add column if not exists
action_type text;

alter table public.notifications
add column if not exists
action_id text;


/* =========================================================
   15. ENABLE RLS
========================================================= */

alter table public.audit_logs
enable row level security;

alter table public.content_reports
enable row level security;

alter table public.lost_found_items
enable row level security;

alter table public.marketplace_listings
enable row level security;


/* =========================================================
   16. PROFILE ROLE POLICIES
========================================================= */

drop policy if exists
"profiles readable"
on public.profiles;

create policy
"profiles readable"
on public.profiles
for select
to authenticated
using (true);

drop policy if exists
"users update own profile"
on public.profiles;

create policy
"users update own profile"
on public.profiles
for update
to authenticated
using (
  auth.uid() = id
)
with check (
  auth.uid() = id
);


/* =========================================================
   17. CONTENT REPORT POLICIES
========================================================= */

drop policy if exists
"users create reports"
on public.content_reports;

create policy
"users create reports"
on public.content_reports
for insert
to authenticated
with check (
  reporter_id = auth.uid()
);

drop policy if exists
"users read own reports"
on public.content_reports;

create policy
"users read own reports"
on public.content_reports
for select
to authenticated
using (
  reporter_id = auth.uid()
);


/* =========================================================
   18. LOST & FOUND POLICIES
========================================================= */

drop policy if exists
"lost found read"
on public.lost_found_items;

create policy
"lost found read"
on public.lost_found_items
for select
to authenticated
using (true);

drop policy if exists
"lost found create own"
on public.lost_found_items;

create policy
"lost found create own"
on public.lost_found_items
for insert
to authenticated
with check (
  user_id = auth.uid()
);

drop policy if exists
"lost found update own"
on public.lost_found_items;

create policy
"lost found update own"
on public.lost_found_items
for update
to authenticated
using (
  user_id = auth.uid()
)
with check (
  user_id = auth.uid()
);


/* =========================================================
   19. MARKETPLACE POLICIES
========================================================= */

drop policy if exists
"marketplace read"
on public.marketplace_listings;

create policy
"marketplace read"
on public.marketplace_listings
for select
to authenticated
using (
  status <> 'removed'
);

drop policy if exists
"marketplace create own"
on public.marketplace_listings;

create policy
"marketplace create own"
on public.marketplace_listings
for insert
to authenticated
with check (
  seller_id = auth.uid()
);

drop policy if exists
"marketplace update own"
on public.marketplace_listings;

create policy
"marketplace update own"
on public.marketplace_listings
for update
to authenticated
using (
  seller_id = auth.uid()
)
with check (
  seller_id = auth.uid()
);


/* =========================================================
   20. AUDIT LOG POLICY
========================================================= */

drop policy if exists
"audit own logs"
on public.audit_logs;

create policy
"audit own logs"
on public.audit_logs
for select
to authenticated
using (
  actor_id = auth.uid()
);


/* =========================================================
   21. REALTIME
========================================================= */

alter publication supabase_realtime
add table public.notifications;

alter publication supabase_realtime
add table public.orders;

alter publication supabase_realtime
add table public.service_requests;

alter publication supabase_realtime
add table public.print_jobs;


/* =========================================================
   22. NOTIFICATION HELPER
========================================================= */

create or replace function
public.create_notification(
  target_user uuid,
  notification_title text,
  notification_body text default null,
  notification_type text default 'official',
  action_type_value text default null,
  action_id_value text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin

  insert into public.notifications (
    user_id,
    type,
    title,
    body,
    action_type,
    action_id,
    read
  )
  values (
    target_user,
    notification_type,
    notification_title,
    notification_body,
    action_type_value,
    action_id_value,
    false
  )
  returning id into new_id;

  return new_id;

end;
$$;


/* =========================================================
   23. ORDER NOTIFICATION TRIGGER
========================================================= */

create or replace function
public.notify_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin

  if (
    old.status is distinct from
    new.status
  ) then

    insert into public.notifications (
      user_id,
      type,
      title,
      body,
      action_type,
      action_id
    )
    values (
      new.user_id,
      'order',
      'Food order updated',
      'Order ' ||
        upper(left(new.id::text,8)) ||
        ' is now ' ||
        replace(
          initcap(new.status),
          '_',
          ' '
        ),
      'order',
      new.id::text
    );

  end if;

  return new;

end;
$$;


drop trigger if exists
orders_status_notification
on public.orders;

create trigger
orders_status_notification
after update of status
on public.orders
for each row
execute function
public.notify_order_status_change();


/* =========================================================
   24. SERVICE REQUEST NOTIFICATION
========================================================= */

create or replace function
public.notify_service_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin

  if (
    old.status is distinct from
    new.status
  ) then

    insert into public.notifications (
      user_id,
      type,
      title,
      body,
      action_type,
      action_id
    )
    values (
      new.user_id,
      'service',
      'Service request updated',
      coalesce(
        new.title,
        'Your service request'
      )
      || ' is now '
      || replace(
        initcap(new.status),
        '_',
        ' '
      ),
      'service',
      new.id::text
    );

  end if;

  return new;

end;
$$;


drop trigger if exists
service_status_notification
on public.service_requests;

create trigger
service_status_notification
after update of status
on public.service_requests
for each row
execute function
public.notify_service_status_change();


/* =========================================================
   25. PRINT NOTIFICATION
========================================================= */

create or replace function
public.notify_print_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin

  if (
    old.status is distinct from
    new.status
  ) then

    insert into public.notifications (
      user_id,
      type,
      title,
      body,
      action_type,
      action_id
    )
    values (
      new.user_id,
      'print',
      'Print order updated',
      new.file_name ||
      ' is now ' ||
      replace(
        initcap(new.status),
        '_',
        ' '
      ),
      'print',
      new.id::text
    );

  end if;

  return new;

end;
$$;


drop trigger if exists
print_status_notification
on public.print_jobs;

create trigger
print_status_notification
after update of status
on public.print_jobs
for each row
execute function
public.notify_print_status_change();