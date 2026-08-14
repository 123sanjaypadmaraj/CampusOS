-- =============================================================================
-- 0010: NOTIFICATIONS, CAMPUS MAP, RATE LIMITING (doc §36, §47-51, §64)
-- =============================================================================

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null default 'official',
  title text not null,
  body text,
  action_type text,
  action_id text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.notifications add column if not exists action_type text;
alter table public.notifications add column if not exists action_id text;

create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  food boolean not null default true,
  events boolean not null default true,
  clubs boolean not null default true,
  community boolean not null default true,
  services boolean not null default true,
  marketplace boolean not null default true,
  announcements boolean not null default true,
  -- Emergency notifications cannot be disabled (doc §48) -- intentionally no column here.
  channel_push boolean not null default true,
  channel_email boolean not null default true,
  channel_sms boolean not null default false
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  keys jsonb not null,
  device_label text,
  created_at timestamptz not null default now()
);

create or replace function public.create_notification(
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
  v_pref record;
  v_col text;
begin
  select * into v_pref from public.notification_preferences where user_id = target_user;
  v_col := case notification_type
    when 'order' then 'food' when 'event' then 'events' when 'club' then 'clubs'
    when 'community' then 'community' when 'service' then 'services' when 'print' then 'services'
    when 'marketplace' then 'marketplace' when 'official' then 'announcements' else null end;

  -- Emergency notifications always go through regardless of preferences.
  if notification_type <> 'emergency' and v_pref is not null and v_col is not null then
    if v_col = 'food' and not v_pref.food then return null; end if;
    if v_col = 'events' and not v_pref.events then return null; end if;
    if v_col = 'clubs' and not v_pref.clubs then return null; end if;
    if v_col = 'community' and not v_pref.community then return null; end if;
    if v_col = 'services' and not v_pref.services then return null; end if;
    if v_col = 'marketplace' and not v_pref.marketplace then return null; end if;
    if v_col = 'announcements' and not v_pref.announcements then return null; end if;
  end if;

  insert into public.notifications (user_id, type, title, body, action_type, action_id, read)
  values (target_user, notification_type, notification_title, notification_body, action_type_value, action_id_value, false)
  returning id into new_id;

  return new_id;
end;
$$;

-- Order/service/print status-change notifications (kept from the MVP schema,
-- now targeting the new UPPERCASE order status values).
create or replace function public.notify_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (old.status is distinct from new.status) then
    perform public.create_notification(
      new.user_id, 'Food order updated',
      'Order ' || upper(left(new.id::text,8)) || ' is now ' || replace(initcap(lower(new.status)), '_', ' '),
      'order', 'order', new.id::text
    );
  end if;
  return new;
end;
$$;

drop trigger if exists orders_status_notification on public.orders;
create trigger orders_status_notification
after update of status on public.orders
for each row execute function public.notify_order_status_change();

create or replace function public.notify_service_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (old.status is distinct from new.status) then
    perform public.create_notification(
      new.user_id, 'Service request updated',
      coalesce(new.title, 'Your service request') || ' is now ' || replace(initcap(lower(new.status)), '_', ' '),
      'service', 'service', new.id::text
    );
  end if;
  return new;
end;
$$;

drop trigger if exists service_status_notification on public.service_requests;
create trigger service_status_notification
after update of status on public.service_requests
for each row execute function public.notify_service_status_change();

create or replace function public.notify_print_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (old.status is distinct from new.status) then
    perform public.create_notification(
      new.user_id, 'Print order updated',
      new.file_name || ' is now ' || replace(initcap(lower(new.status)), '_', ' '),
      'print', 'print', new.id::text
    );
  end if;
  return new;
end;
$$;

drop trigger if exists print_status_notification on public.print_jobs;
create trigger print_status_notification
after update of status on public.print_jobs
for each row execute function public.notify_print_status_change();

create or replace function public.notify_booking_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (old.status is distinct from new.status) then
    perform public.create_notification(
      new.user_id, 'Booking updated', 'Your booking is now ' || replace(initcap(lower(new.status)), '_', ' '),
      'booking', 'booking', new.id::text
    );
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_status_notification on public.bookings;
create trigger bookings_status_notification
after update of status on public.bookings
for each row execute function public.notify_booking_status_change();

-- =========================================================
-- ANNOUNCEMENTS / EMERGENCY (doc §52-53)
-- =========================================================

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid references public.campuses(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  category text not null default 'General'
    check (category in ('Academic','Exam','Holiday','Emergency','Campus','Maintenance','Transport','General')),
  title text not null,
  body text not null,
  target_scope text not null default 'everyone'
    check (target_scope in ('everyone','department','year','course','hostel','club')),
  target_value text,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists announcements_campus_idx on public.announcements(campus_id, published_at desc);

create or replace function public.publish_announcement(
  p_category text, p_title text, p_body text, p_target_scope text default 'everyone', p_target_value text default null
)
returns public.announcements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_campus uuid;
  v_announcement public.announcements;
  v_recipient record;
begin
  if not public.current_user_is_admin() and p_category <> 'Emergency' then
    raise exception 'Not authorized to publish announcements';
  end if;
  if p_category = 'Emergency' and not (public.current_user_is_admin()) then
    raise exception 'Emergency alerts require college_admin/super_admin (doc §53)';
  end if;

  select campus_id into v_campus from public.profiles where id = v_user;

  insert into public.announcements (campus_id, author_id, category, title, body, target_scope, target_value, published_at)
  values (v_campus, v_user, p_category, p_title, p_body, p_target_scope, p_target_value, now())
  returning * into v_announcement;

  for v_recipient in
    select p.id from public.profiles p
    where p.campus_id = v_campus
      and (p_target_scope = 'everyone'
        or (p_target_scope = 'department' and p.department = p_target_value)
        or (p_target_scope = 'year' and p.year = p_target_value)
        or (p_target_scope = 'course' and p.course = p_target_value))
  loop
    perform public.create_notification(
      v_recipient.id, p_title, p_body,
      case when p_category = 'Emergency' then 'emergency' else 'official' end,
      'announcement', v_announcement.id::text
    );
  end loop;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value)
  values (v_user, 'announcement.publish', 'announcement', v_announcement.id::text,
          jsonb_build_object('category', p_category, 'title', p_title));

  return v_announcement;
end;
$$;

-- =========================================================
-- RATE LIMITING (doc §64) -- sliding window counter table + check function.
-- Called from Edge Functions (and optionally RPCs) before a sensitive action.
-- =========================================================

create table if not exists public.rate_limit_hits (
  id bigint generated always as identity primary key,
  user_id uuid,
  bucket text not null,          -- e.g. 'posts', 'orders', 'login'
  created_at timestamptz not null default now()
);

create index if not exists rate_limit_hits_lookup_idx on public.rate_limit_hits(user_id, bucket, created_at desc);

create or replace function public.check_rate_limit(p_user uuid, p_bucket text, p_max_hits integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.rate_limit_hits
    where user_id = p_user and bucket = p_bucket and created_at > now() - make_interval(secs => p_window_seconds);

  if v_count >= p_max_hits then
    return false;
  end if;

  insert into public.rate_limit_hits (user_id, bucket) values (p_user, p_bucket);
  return true;
end;
$$;

-- Housekeeping: rate_limit_hits grows fast under load; keep only a rolling
-- window. Safe to run on a schedule (pg_cron) or from a periodic Edge
-- Function invocation.
create or replace function public.prune_rate_limit_hits()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.rate_limit_hits where created_at < now() - interval '1 day';
$$;
