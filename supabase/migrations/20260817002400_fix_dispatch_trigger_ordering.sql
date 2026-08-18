-- =============================================================================
-- 0240: FIX DISPATCH ORDERING BUG
-- create_notification() (20260817001700) inserts into public.notifications
-- FIRST, then public.notification_deliveries. The AFTER INSERT dispatch
-- triggers on notifications (push/email/sms, 20260814004500 + 20260817002000)
-- fire immediately on that first insert -- before any notification_deliveries
-- row exists for it -- so every trigger's "find my pending delivery row"
-- lookup came back empty and silently no-op'd (`if v_delivery_id is null
-- then return new`). Caught live during staging smoke-testing: delivery
-- rows sat at status='pending', attempts=0 forever, and net._http_response
-- never saw a single dispatch call. No notification has actually been
-- pushed/emailed/texted since 20260817001700 landed.
--
-- Fix: dispatch is no longer trigger-driven off notifications INSERT.
-- create_notification() now calls each channel's dispatch function directly,
-- by uuid, AFTER both inserts have committed within the same function body
-- -- ordering is explicit instead of implicit-via-trigger-timing. The three
-- dispatch functions are converted from trigger functions to plain
-- (p_notification_id uuid) functions; their internal logic (secret lookup,
-- pg_net call, exception-swallowing) is unchanged.
-- =============================================================================

drop trigger if exists notifications_dispatch_push on public.notifications;
drop trigger if exists notifications_dispatch_email on public.notifications;
drop trigger if exists notifications_dispatch_sms on public.notifications;

create or replace function public.dispatch_push_notification(p_notification_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_delivery_id uuid;
begin
  select id into v_delivery_id from public.notification_deliveries
    where notification_id = p_notification_id and channel = 'push' and status = 'pending';
  if v_delivery_id is null then
    return;
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_dispatch_secret';
  if v_secret is null then
    return;
  end if;

  perform net.http_post(
    url := 'https://dzjzjlylsfpmymkcavrq.functions.supabase.co/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Push-Secret', v_secret),
    body := jsonb_build_object('notification_id', p_notification_id, 'delivery_id', v_delivery_id),
    timeout_milliseconds := 5000
  );
exception when others then
  return;
end;
$$;

create or replace function public.dispatch_email_notification(p_notification_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_delivery_id uuid;
begin
  select id into v_delivery_id from public.notification_deliveries
    where notification_id = p_notification_id and channel = 'email' and status = 'pending';
  if v_delivery_id is null then
    return;
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'email_dispatch_secret';
  if v_secret is null then
    return;
  end if;

  perform net.http_post(
    url := 'https://dzjzjlylsfpmymkcavrq.functions.supabase.co/send-email',
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Email-Secret', v_secret),
    body := jsonb_build_object('notification_id', p_notification_id, 'delivery_id', v_delivery_id),
    timeout_milliseconds := 8000
  );
exception when others then
  return;
end;
$$;

create or replace function public.dispatch_sms_notification(p_notification_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_delivery_id uuid;
begin
  select id into v_delivery_id from public.notification_deliveries
    where notification_id = p_notification_id and channel = 'sms' and status = 'pending';
  if v_delivery_id is null then
    return;
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'sms_dispatch_secret';
  if v_secret is null then
    return;
  end if;

  perform net.http_post(
    url := 'https://dzjzjlylsfpmymkcavrq.functions.supabase.co/send-sms',
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Sms-Secret', v_secret),
    body := jsonb_build_object('notification_id', p_notification_id, 'delivery_id', v_delivery_id),
    timeout_milliseconds := 5000
  );
exception when others then
  return;
end;
$$;

-- Recreated from its latest version (20260817001700) with the same 7-arg
-- signature (no new overload risk -- see 20260817002300's fix), the only
-- change being explicit dispatch calls at the end instead of relying on an
-- insert trigger.
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
     -- Emergency SMS bypasses the channel_sms opt-in the same way emergency
     -- already bypasses the category gate above -- a life-safety alert
     -- shouldn't be silently dropped just because the user never explicitly
     -- turned general SMS on (20260817002200's own doc "Emergency SMS"
     -- item). Reapplied here, not just in 20260817001700, because this
     -- migration recreates create_notification() from that file's body --
     -- whichever definition runs last wins, so both copies need to agree.
     or (chan.name = 'sms' and (notification_type = 'emergency' or (v_pref is not null and v_pref.channel_sms)));

  if not v_in_quiet_hours then
    perform public.dispatch_push_notification(new_id);
    perform public.dispatch_email_notification(new_id);
    perform public.dispatch_sms_notification(new_id);
  end if;

  return new_id;
end;
$$;
