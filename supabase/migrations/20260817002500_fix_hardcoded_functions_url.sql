-- =============================================================================
-- 0250: FIX HARDCODED PRODUCTION FUNCTIONS URL
-- Every pg_net dispatch call (push since 20260814004500, email/sms/retry
-- since 20260817001700-002400) hardcoded
-- 'https://dzjzjlylsfpmymkcavrq.functions.supabase.co' -- production's
-- functions URL -- directly in the migration SQL. Since the SAME migration
-- text is applied to both the staging and production projects (by design,
-- see docs/ENVIRONMENTS.md), staging's triggers have always been calling
-- PRODUCTION's Edge Functions, not its own. Caught live during staging
-- smoke-testing: send-push got a 401 (staging's push_dispatch_secret
-- doesn't match production's vault secret -- they're generated
-- independently per project) and send-email got a 404 (production didn't
-- have that function deployed at all yet).
--
-- Fix: the base URL moves into a tiny per-project config table instead of
-- migration-literal text, so each project can hold its own correct value
-- while the migration/function code stays identical across both.
-- =============================================================================

create table if not exists public.app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_config enable row level security;
drop policy if exists "app_config_admin_read" on public.app_config;
create policy "app_config_admin_read" on public.app_config for select to authenticated using (public.current_user_is_admin());

-- Seeded with production's URL (the value every prior migration hardcoded)
-- so production's behavior is unchanged by this migration. Staging gets
-- its own correct value set once, directly, after this migration runs --
-- an environment-specific data value, not something migration SQL (which
-- is identical across both projects) can express.
insert into public.app_config (key, value)
values ('functions_base_url', 'https://dzjzjlylsfpmymkcavrq.functions.supabase.co')
on conflict (key) do nothing;

-- Dead leftover from 20260817002400's create-or-replace (which added a
-- uuid parameter, creating a second overload instead of replacing the
-- original 0-arg trigger-function version -- same class of bug as
-- 20260817002300's fix, harmless here since nothing referenced the 0-arg
-- form anymore, but worth cleaning up rather than leaving two functions
-- with the same name).
drop function if exists public.dispatch_push_notification();

create or replace function public.dispatch_push_notification(p_notification_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_delivery_id uuid;
  v_base_url text;
begin
  select id into v_delivery_id from public.notification_deliveries
    where notification_id = p_notification_id and channel = 'push' and status = 'pending';
  if v_delivery_id is null then
    return;
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_dispatch_secret';
  select value into v_base_url from public.app_config where key = 'functions_base_url';
  if v_secret is null or v_base_url is null then
    return;
  end if;

  perform net.http_post(
    url := v_base_url || '/send-push',
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
  v_base_url text;
begin
  select id into v_delivery_id from public.notification_deliveries
    where notification_id = p_notification_id and channel = 'email' and status = 'pending';
  if v_delivery_id is null then
    return;
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'email_dispatch_secret';
  select value into v_base_url from public.app_config where key = 'functions_base_url';
  if v_secret is null or v_base_url is null then
    return;
  end if;

  perform net.http_post(
    url := v_base_url || '/send-email',
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
  v_base_url text;
begin
  select id into v_delivery_id from public.notification_deliveries
    where notification_id = p_notification_id and channel = 'sms' and status = 'pending';
  if v_delivery_id is null then
    return;
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'sms_dispatch_secret';
  select value into v_base_url from public.app_config where key = 'functions_base_url';
  if v_secret is null or v_base_url is null then
    return;
  end if;

  perform net.http_post(
    url := v_base_url || '/send-sms',
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Sms-Secret', v_secret),
    body := jsonb_build_object('notification_id', p_notification_id, 'delivery_id', v_delivery_id),
    timeout_milliseconds := 5000
  );
exception when others then
  return;
end;
$$;

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
  v_secret_name text;
  v_base_url text;
begin
  select value into v_base_url from public.app_config where key = 'functions_base_url';
  if v_base_url is null then
    return 0;
  end if;

  for v_row in
    select d.id as delivery_id, d.channel, n.id as notification_id
    from public.notification_deliveries d
    join public.notifications n on n.id = d.notification_id
    where d.attempts < 5
      and ((d.status = 'pending' and d.updated_at < now() - interval '3 minutes')
        or (d.status = 'failed' and d.updated_at < now() - interval '2 minutes'))
    order by d.updated_at asc
    limit 200
  loop
    v_fn_url := v_base_url || case v_row.channel when 'push' then '/send-push' when 'email' then '/send-email' when 'sms' then '/send-sms' end;
    v_secret_name := case v_row.channel when 'push' then 'push_dispatch_secret' when 'email' then 'email_dispatch_secret' when 'sms' then 'sms_dispatch_secret' end;

    select decrypted_secret into v_secret from vault.decrypted_secrets where name = v_secret_name;
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
