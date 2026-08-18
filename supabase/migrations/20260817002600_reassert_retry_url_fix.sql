-- =============================================================================
-- 0260: RE-ASSERT retry_failed_deliveries() URL FIX
-- 20260817002500's fix landed (confirmed in schema_migrations) but a later
-- concurrent write to this same function (from other work happening on this
-- shared staging project at the same time) clobbered it back to the
-- hardcoded-production-URL body. Re-applying as its own migration so it's
-- the last word in migration history rather than a same-timestamp race.
-- =============================================================================

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
