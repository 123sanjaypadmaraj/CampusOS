-- =============================================================================
-- 0160: EMAIL + SMS DISPATCH
-- Mirrors 20260814004500's push dispatch exactly (pg_net firing an Edge
-- Function, fire-and-forget, a failure here must never break notification
-- creation) but keyed off the notification_deliveries rows created in
-- 20260817001300 rather than re-deriving the decision -- a channel is only
-- dispatched if create_notification() already decided it was owed one
-- (enabled in preferences, not quiet-hours-suppressed).
--
-- Email: wired to a real provider (Resend -- see supabase/functions/send-
-- email) -- this is genuine delivery, gated entirely behind channel_email,
-- which now defaults OFF (0130) so nobody gets emailed without opting in.
--
-- SMS: plumbing only. There is no ongoing-free SMS provider to wire up
-- (Twilio/MSG91 etc. are paid past a trial credit), so send-sms always
-- reports 'skipped' with a clear reason rather than silently pretending to
-- send -- the dispatch trigger, delivery tracking, retry sweep and
-- preference column all work end-to-end today; swapping in a real provider
-- later is just filling in that one Edge Function.
-- =============================================================================

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'email_dispatch_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'email_dispatch_secret',
      'Shared secret sent as X-Email-Secret so send-email can verify a call originated from our own notifications trigger.'
    );
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'sms_dispatch_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'sms_dispatch_secret',
      'Shared secret sent as X-Sms-Secret so send-sms can verify a call originated from our own notifications trigger.'
    );
  end if;
end $$;

create or replace function public.dispatch_email_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_delivery_id uuid;
begin
  select id into v_delivery_id from public.notification_deliveries
    where notification_id = new.id and channel = 'email' and status = 'pending';
  if v_delivery_id is null then
    return new; -- email not enabled for this user, or suppressed by quiet hours.
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'email_dispatch_secret';
  if v_secret is null then
    return new;
  end if;

  perform net.http_post(
    url := 'https://dzjzjlylsfpmymkcavrq.functions.supabase.co/send-email',
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Email-Secret', v_secret),
    body := jsonb_build_object('notification_id', new.id, 'delivery_id', v_delivery_id),
    timeout_milliseconds := 8000
  );
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists notifications_dispatch_email on public.notifications;
create trigger notifications_dispatch_email
after insert on public.notifications
for each row execute function public.dispatch_email_notification();

create or replace function public.dispatch_sms_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_delivery_id uuid;
begin
  select id into v_delivery_id from public.notification_deliveries
    where notification_id = new.id and channel = 'sms' and status = 'pending';
  if v_delivery_id is null then
    return new;
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'sms_dispatch_secret';
  if v_secret is null then
    return new;
  end if;

  perform net.http_post(
    url := 'https://dzjzjlylsfpmymkcavrq.functions.supabase.co/send-sms',
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Sms-Secret', v_secret),
    body := jsonb_build_object('notification_id', new.id, 'delivery_id', v_delivery_id),
    timeout_milliseconds := 5000
  );
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists notifications_dispatch_sms on public.notifications;
create trigger notifications_dispatch_sms
after insert on public.notifications
for each row execute function public.dispatch_sms_notification();

-- ---------------------------------------------------------------------------
-- dispatch_push_notification -- recreated from its latest version
-- (20260814004500) to look up its own notification_deliveries row and pass
-- delivery_id through, so send-push can call mark_delivery_result() and
-- close the loop on tracking/retry the same way email/sms now do.
-- ---------------------------------------------------------------------------
create or replace function public.dispatch_push_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_delivery_id uuid;
begin
  select id into v_delivery_id from public.notification_deliveries
    where notification_id = new.id and channel = 'push' and status = 'pending';
  if v_delivery_id is null then
    return new;
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_dispatch_secret';
  if v_secret is null then
    return new;
  end if;

  perform net.http_post(
    url := 'https://dzjzjlylsfpmymkcavrq.functions.supabase.co/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Push-Secret', v_secret),
    body := jsonb_build_object('notification_id', new.id, 'delivery_id', v_delivery_id),
    timeout_milliseconds := 5000
  );
  return new;
exception when others then
  return new;
end;
$$;
