-- =============================================================================
-- 0130: NOTIFICATION DELIVERY INFRASTRUCTURE
-- Cross-cutting gaps identified in a full audit of the notification system
-- (2026-08-17): no per-channel delivery tracking, no retry on a failed push
-- dispatch (dispatch_push_notification has always silently swallowed
-- errors -- see 20260814004500), no de-duplication of repeat notifications,
-- and no quiet-hours suppression. This migration adds the shared plumbing;
-- 20260817001600 wires email/SMS dispatch on top of it.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- notification_deliveries -- one row per (notification, channel) attempted.
-- This IS the delivery-tracking + retry substrate: created up front by
-- create_notification() with a starting status, then updated by whichever
-- Edge Function actually attempts the send (via mark_delivery_result()),
-- and re-driven by retry_failed_deliveries() on a cron schedule.
-- ---------------------------------------------------------------------------
create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  channel text not null check (channel in ('push', 'email', 'sms')),
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'skipped')),
  skip_reason text,
  last_error text,
  attempts integer not null default 0,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notification_deliveries_notification_idx
  on public.notification_deliveries(notification_id);
-- Retry sweep query shape: unresolved rows old enough to presume lost/failed.
create index if not exists notification_deliveries_retry_idx
  on public.notification_deliveries(channel, status, updated_at)
  where status in ('pending', 'failed');

alter table public.notification_deliveries enable row level security;

-- No self-serve read policy -- this is operational/debugging data, not
-- something a student needs surfaced today. Admins can inspect it directly.
drop policy if exists "notification_deliveries_admin_read" on public.notification_deliveries;
create policy "notification_deliveries_admin_read" on public.notification_deliveries
  for select to authenticated using (public.current_user_is_admin());

-- ---------------------------------------------------------------------------
-- Quiet hours + dedup key, layered onto the existing preferences/notifications
-- tables rather than new ones -- same shape as channel_push/channel_email.
-- Campus-local wall-clock time; this app is single-timezone (Asia/Kolkata,
-- per the GST/₹ conventions already baked into food billing) so a fixed
-- zone is used rather than per-user tz tracking, which doesn't exist anywhere
-- in this schema.
-- ---------------------------------------------------------------------------
alter table public.notification_preferences add column if not exists quiet_hours_enabled boolean not null default false;
alter table public.notification_preferences add column if not exists quiet_hours_start time not null default '22:00';
alter table public.notification_preferences add column if not exists quiet_hours_end time not null default '07:00';

-- Email dispatch is a brand-new capability as of this pass -- nothing has
-- ever sent through channel_email since the column was added in 0010, so
-- flipping it on is a real behavior change. Default OFF going forward
-- (opt-in via the new preferences UI) rather than inheriting the old
-- always-true default, which would silently start emailing every student
-- who happens to already have a preferences row (created by touching the
-- push toggle) without them ever having asked for it.
alter table public.notification_preferences alter column channel_email set default false;
update public.notification_preferences set channel_email = false where channel_email = true;

alter table public.notifications add column if not exists dedup_key text;
create index if not exists notifications_dedup_idx on public.notifications(user_id, dedup_key, created_at desc)
  where dedup_key is not null;

-- ---------------------------------------------------------------------------
-- create_notification() -- recreated from its latest version (20260814004600,
-- which added the 'message' category branch) with:
--   * p_dedup_key: if a notification with the same (user, dedup_key) was
--     created in the last 10 minutes, return that existing id instead of
--     inserting a duplicate. Callers opt in by passing a key; existing call
--     sites are unaffected (parameter defaults to null = no dedup).
--   * quiet hours: emergency still always goes through (life-safety, same
--     carve-out preferences already get). Everything else still gets the
--     in-app row (it should be there when the student next opens the app),
--     but push/email/sms delivery rows are created pre-marked 'skipped' so
--     the dispatch triggers never fire the Edge Function during quiet hours.
--   * notification_deliveries: one row per channel that's actually enabled
--     for this user (channel_push/channel_email/channel_sms), so delivery
--     tracking and retry have something to work with from the moment the
--     notification is created.
-- ---------------------------------------------------------------------------
create or replace function public.create_notification(
  target_user uuid,
  notification_title text,
  notification_body text default null,
  notification_type text default 'official',
  action_type_value text default null,
  action_id_value text default null,
  p_dedup_key text default null
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
  v_existing_id uuid;
  v_in_quiet_hours boolean := false;
  v_local_time time;
begin
  if p_dedup_key is not null then
    select id into v_existing_id from public.notifications
      where user_id = target_user and dedup_key = p_dedup_key and created_at > now() - interval '10 minutes'
      order by created_at desc limit 1;
    if v_existing_id is not null then
      return v_existing_id;
    end if;
  end if;

  select * into v_pref from public.notification_preferences where user_id = target_user;
  v_col := case notification_type
    when 'order' then 'food' when 'event' then 'events' when 'club' then 'clubs'
    when 'community' then 'community' when 'service' then 'services' when 'print' then 'services'
    when 'marketplace' then 'marketplace' when 'official' then 'announcements'
    when 'message' then 'messages' else null end;

  -- Emergency notifications always go through regardless of preferences.
  if notification_type <> 'emergency' and v_pref is not null and v_col is not null then
    if v_col = 'food' and not v_pref.food then return null; end if;
    if v_col = 'events' and not v_pref.events then return null; end if;
    if v_col = 'clubs' and not v_pref.clubs then return null; end if;
    if v_col = 'community' and not v_pref.community then return null; end if;
    if v_col = 'services' and not v_pref.services then return null; end if;
    if v_col = 'marketplace' and not v_pref.marketplace then return null; end if;
    if v_col = 'announcements' and not v_pref.announcements then return null; end if;
    if v_col = 'messages' and not v_pref.messages then return null; end if;
  end if;

  if notification_type <> 'emergency' and v_pref is not null and v_pref.quiet_hours_enabled then
    v_local_time := (now() at time zone 'Asia/Kolkata')::time;
    if v_pref.quiet_hours_start <= v_pref.quiet_hours_end then
      v_in_quiet_hours := v_local_time >= v_pref.quiet_hours_start and v_local_time < v_pref.quiet_hours_end;
    else
      -- Window wraps midnight (e.g. 22:00-07:00).
      v_in_quiet_hours := v_local_time >= v_pref.quiet_hours_start or v_local_time < v_pref.quiet_hours_end;
    end if;
  end if;

  insert into public.notifications (user_id, type, title, body, action_type, action_id, read, dedup_key)
  values (target_user, notification_type, notification_title, notification_body, action_type_value, action_id_value, false, p_dedup_key)
  returning id into new_id;

  insert into public.notification_deliveries (notification_id, channel, status, skip_reason)
  select new_id, chan.name,
    case when v_in_quiet_hours then 'skipped' else 'pending' end,
    case when v_in_quiet_hours then 'quiet_hours' else null end
  from (values ('push'), ('email'), ('sms')) as chan(name)
  where (chan.name = 'push' and (v_pref is null or v_pref.channel_push))
     or (chan.name = 'email' and v_pref is not null and v_pref.channel_email)
     -- Emergency SMS (doc "Emergency SMS" item) bypasses the channel_sms
     -- opt-in the same way emergency already bypasses the category gate
     -- above -- a life-safety alert shouldn't be silently dropped just
     -- because the user never explicitly turned general SMS on. Still
     -- gated on an actual phone number existing, checked in send-sms
     -- itself (same "the trigger creates the row, the Edge Function
     -- checks whether there's really somewhere to deliver it" split push
     -- and email already use).
     or (chan.name = 'sms' and (notification_type = 'emergency' or (v_pref is not null and v_pref.channel_sms)));

  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- mark_delivery_result -- callback Edge Functions use to close the loop on a
-- notification_deliveries row after actually attempting a send. service_role
-- only (called with the service key from within an Edge Function, mirroring
-- mark_refund_completed's posture), never exposed to a signed-in browser.
-- ---------------------------------------------------------------------------
create or replace function public.mark_delivery_result(p_delivery_id uuid, p_status text, p_error text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('sent', 'failed', 'skipped') then
    raise exception 'Invalid delivery status %', p_status;
  end if;

  update public.notification_deliveries
    set status = p_status,
        last_error = p_error,
        attempts = attempts + 1,
        delivered_at = case when p_status = 'sent' then now() else delivered_at end,
        updated_at = now()
    where id = p_delivery_id;
end;
$$;

revoke execute on function public.mark_delivery_result(uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- retry_failed_deliveries -- cron-driven sweep (scheduled in
-- 20260817001500). Presumed-lost 'pending' rows (the Edge Function call
-- never came back, e.g. pg_net timeout) and 'failed' rows under the attempt
-- cap are re-dispatched by simply re-firing the same per-channel trigger
-- logic used on insert. Capped at 5 attempts total so a permanently broken
-- endpoint (bad email address, revoked push subscription that somehow
-- wasn't pruned) doesn't retry forever.
-- ---------------------------------------------------------------------------
create or replace function public.retry_failed_deliveries()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_row record;
  v_count integer := 0;
  v_fn_url text;
  v_header text;
begin
  for v_row in
    select d.id as delivery_id, d.channel, n.id as notification_id, n.user_id, n.type, n.title, n.body, n.action_type, n.action_id
    from public.notification_deliveries d
    join public.notifications n on n.id = d.notification_id
    where d.attempts < 5
      and ((d.status = 'pending' and d.updated_at < now() - interval '3 minutes')
        or (d.status = 'failed' and d.updated_at < now() - interval '2 minutes'))
    order by d.updated_at asc
    limit 200
  loop
    v_fn_url := case v_row.channel
      when 'push' then 'https://dzjzjlylsfpmymkcavrq.functions.supabase.co/send-push'
      when 'email' then 'https://dzjzjlylsfpmymkcavrq.functions.supabase.co/send-email'
      when 'sms' then 'https://dzjzjlylsfpmymkcavrq.functions.supabase.co/send-sms'
    end;
    v_header := case v_row.channel
      when 'push' then 'push_dispatch_secret' when 'email' then 'email_dispatch_secret' when 'sms' then 'sms_dispatch_secret' end;

    select decrypted_secret into v_secret from vault.decrypted_secrets where name = v_header;
    if v_secret is null then continue; end if;

    perform net.http_post(
      url := v_fn_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'X-Push-Secret', v_secret, 'X-Email-Secret', v_secret, 'X-Sms-Secret', v_secret),
      body := jsonb_build_object('notification_id', v_row.notification_id, 'delivery_id', v_row.delivery_id),
      timeout_milliseconds := 5000
    );
    update public.notification_deliveries set attempts = attempts + 1, updated_at = now() where id = v_row.delivery_id;
    v_count := v_count + 1;
  end loop;

  return v_count;
exception when others then
  return v_count;
end;
$$;
