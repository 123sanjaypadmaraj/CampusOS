-- =============================================================================
-- 0045: PUSH NOTIFICATION DISPATCH
-- push_subscriptions/notification_preferences.channel_push have existed
-- since 0010 -- nothing ever wrote a subscription or sent anything through
-- them. This wires create_notification() (the single existing entry point
-- every in-app notification already goes through -- orders, events,
-- announcements, messages, everything) to also fire an actual Web Push via
-- pg_net calling the `send-push` Edge Function, fire-and-forget, without
-- blocking whatever RPC/trigger created the notification.
-- =============================================================================

create extension if not exists pg_net;

-- Random, generated here, never in git -- the send-push Edge Function is
-- deployed with --no-verify-jwt (it's invoked by this DB trigger, not a
-- signed-in browser) so this header is what proves a request actually came
-- from our own database rather than anyone who finds the function's URL.
do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'push_dispatch_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'push_dispatch_secret',
      'Shared secret sent as X-Push-Secret so send-push can verify a call originated from our own notifications trigger.'
    );
  end if;
end $$;

create or replace function public.dispatch_push_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_dispatch_secret';
  if v_secret is null then
    return new; -- not configured yet -- in-app notification still landed, just no push.
  end if;

  perform net.http_post(
    url := 'https://dzjzjlylsfpmymkcavrq.functions.supabase.co/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Push-Secret', v_secret),
    body := jsonb_build_object('notification_id', new.id),
    timeout_milliseconds := 5000
  );

  return new;
exception when others then
  -- A push-dispatch failure must never break notification creation itself.
  return new;
end;
$$;

drop trigger if exists notifications_dispatch_push on public.notifications;
create trigger notifications_dispatch_push
after insert on public.notifications
for each row execute function public.dispatch_push_notification();
