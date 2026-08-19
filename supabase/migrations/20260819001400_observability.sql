-- =============================================================================
-- 0190: OBSERVABILITY (doc item #97)
-- error_logs (20260814005200) has had a `source` ('client'/'server') column
-- since it was built, but nothing has ever written 'server' -- every Edge
-- Function just console.error()s and returns a JSON error, so server/API/
-- payment/notification failures are invisible to the admin Errors tab.
-- Meanwhile notification_deliveries (20260817001700) and orders.payment_status
-- already track real failure data that's never surfaced or alerted on, and
-- no threshold-based alerting exists anywhere in this schema. This migration:
--   1. adds grouping (category + fingerprint) to error_logs
--   2. adds log_server_error() -- the write path Edge Functions were missing
--   3. adds admin_observability_summary() -- the read path for a dashboard
--   4. adds run_observability_alerts() -- a 15-min cron sweep that notifies
--      college_admin/super_admin via the existing create_notification() when
--      a threshold is crossed, reusing its dedup_key mechanism (hour-bucketed
--      key -> at most one alert per type per admin per hour)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. error_logs: category + fingerprint for grouping/trends
-- ---------------------------------------------------------------------------
alter table public.error_logs add column if not exists category text;

alter table public.error_logs add column if not exists fingerprint text
  generated always as (
    md5(source || ':' || coalesce(category, '') || ':' || left(message, 200))
  ) stored;

create index if not exists error_logs_fingerprint_idx
  on public.error_logs (fingerprint, created_at desc);
create index if not exists error_logs_category_idx
  on public.error_logs (category) where category is not null;

-- ---------------------------------------------------------------------------
-- 2. log_client_error: additive p_category param (trailing, default null --
--    existing 6-positional-arg call sites are unaffected).
-- ---------------------------------------------------------------------------
create or replace function public.log_client_error(
  p_message text,
  p_stack text default null,
  p_url text default null,
  p_user_agent text default null,
  p_severity text default 'error',
  p_context jsonb default '{}'::jsonb,
  p_source text default 'client',
  p_category text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_campus uuid;
  v_severity text := p_severity;
  v_source text := p_source;
begin
  if p_message is null or length(btrim(p_message)) = 0 then
    raise exception 'message is required';
  end if;
  if v_severity not in ('debug','info','warning','error','fatal') then
    v_severity := 'error';
  end if;
  if v_source not in ('client','server') then
    v_source := 'client';
  end if;

  if auth.uid() is not null then
    select campus_id into v_campus from public.profiles where id = auth.uid();
  end if;

  insert into public.error_logs (user_id, campus_id, source, severity, message, stack, url, user_agent, context, category)
  values (
    auth.uid(),
    v_campus,
    v_source,
    v_severity,
    left(p_message, 2000),
    left(p_stack, 8000),
    left(coalesce(p_url, ''), 500),
    left(coalesce(p_user_agent, ''), 500),
    coalesce(p_context, '{}'::jsonb),
    p_category
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.log_client_error(text, text, text, text, text, jsonb, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. log_server_error: the write path Edge Functions were missing. No
--    auth.uid()/campus lookup (there's no caller session -- these run with
--    the service key), source is always 'server'. service_role only, same
--    posture as mark_delivery_result.
-- ---------------------------------------------------------------------------
create or replace function public.log_server_error(
  p_message text,
  p_stack text default null,
  p_category text default null,
  p_severity text default 'error',
  p_context jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_severity text := p_severity;
begin
  if p_message is null or length(btrim(p_message)) = 0 then
    raise exception 'message is required';
  end if;
  if v_severity not in ('debug','info','warning','error','fatal') then
    v_severity := 'error';
  end if;

  insert into public.error_logs (source, severity, message, stack, context, category)
  values ('server', v_severity, left(p_message, 2000), left(p_stack, 8000), coalesce(p_context, '{}'::jsonb), p_category)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.log_server_error(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.log_server_error(text, text, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 4. admin_observability_summary(): read path for the dashboard. Same
--    admin-gate pattern as admin_system_health() -- security definer with
--    its own auth check (not RLS), since it aggregates across all users.
-- ---------------------------------------------------------------------------
create or replace function public.admin_observability_summary()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_errors_by_severity jsonb;
  v_errors_by_category jsonb;
  v_top_fingerprints jsonb;
  v_payment jsonb;
  v_notifications jsonb;
  v_jobs_failing integer := 0;
begin
  if not public.current_user_is_admin() then
    raise exception 'Not authorized to view observability summary';
  end if;

  select coalesce(jsonb_object_agg(severity, cnt), '{}'::jsonb) into v_errors_by_severity
  from (
    select severity, count(*) as cnt
    from public.error_logs
    where created_at > now() - interval '24 hours'
    group by severity
  ) s;

  select coalesce(jsonb_object_agg(coalesce(category, 'uncategorized'), cnt), '{}'::jsonb) into v_errors_by_category
  from (
    select category, count(*) as cnt
    from public.error_logs
    where created_at > now() - interval '24 hours'
    group by category
  ) c;

  select coalesce(jsonb_agg(row_to_json(f)), '[]'::jsonb) into v_top_fingerprints
  from (
    select
      fingerprint,
      max(message) as sample_message,
      max(severity) as severity,
      max(category) as category,
      count(*) as occurrences,
      max(created_at) as last_seen
    from public.error_logs
    where created_at > now() - interval '24 hours'
    group by fingerprint
    order by count(*) desc, max(created_at) desc
    limit 10
  ) f;

  select jsonb_build_object(
    'total_24h', count(*),
    'failed_24h', count(*) filter (where payment_status = 'failed'),
    'refund_pending_24h', count(*) filter (where payment_status = 'refund_pending')
  ) into v_payment
  from public.orders
  where created_at > now() - interval '24 hours';

  select coalesce(jsonb_object_agg(channel, jsonb_build_object('total', total, 'failed', failed)), '{}'::jsonb) into v_notifications
  from (
    select channel, count(*) as total, count(*) filter (where status = 'failed') as failed
    from public.notification_deliveries
    where created_at > now() - interval '24 hours'
    group by channel
  ) n;

  begin
    select count(*) into v_jobs_failing
    from (
      select j.jobid,
        (select d.status from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1) as last_status
      from cron.job j
      where j.active
    ) x
    where x.last_status = 'failed';
  exception when others then
    v_jobs_failing := 0;
  end;

  return jsonb_build_object(
    'checked_at', now(),
    'errors_by_severity_24h', v_errors_by_severity,
    'errors_by_category_24h', v_errors_by_category,
    'top_error_fingerprints_24h', v_top_fingerprints,
    'payment_24h', v_payment,
    'notifications_24h', v_notifications,
    'cron_jobs_failing', v_jobs_failing
  );
end;
$$;

grant execute on function public.admin_observability_summary() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. run_observability_alerts(): cron-only sweep (not granted to
--    authenticated, mirrors retry_failed_deliveries's posture). Checks 4
--    thresholds over a rolling 15-minute window; on breach, notifies every
--    college_admin/super_admin via create_notification(), whose existing
--    dedup_key mechanism (10-minute window) is widened here to an hour
--    bucket per alert type so a 15-minute cron cadence can't spam admins.
-- ---------------------------------------------------------------------------
create or replace function public.run_observability_alerts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_error_count integer;
  v_payment_fail_count integer;
  v_notif_fail_count integer;
  v_cron_fail_count integer;
  v_hour_bucket text := to_char(now(), 'YYYYMMDDHH24');
  v_admin record;
  v_fired text[] := '{}';
begin
  select count(*) into v_error_count
  from public.error_logs
  where severity in ('error', 'fatal') and created_at > now() - interval '15 minutes';

  select count(*) into v_payment_fail_count
  from public.orders
  where payment_status = 'failed' and created_at > now() - interval '15 minutes';

  select count(*) into v_notif_fail_count
  from public.notification_deliveries
  where status = 'failed' and updated_at > now() - interval '15 minutes';

  select count(*) into v_cron_fail_count
  from (
    select j.jobid,
      (select d.status from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1) as last_status
    from cron.job j
    where j.active
  ) x
  where x.last_status = 'failed';

  for v_admin in
    select id from public.profiles where role in ('college_admin', 'super_admin')
  loop
    if v_error_count >= 10 then
      perform public.create_notification(v_admin.id, 'Error rate spike',
        v_error_count || ' error/fatal log entries in the last 15 minutes.',
        'official', 'admin_alert', 'error_spike',
        'alert:error_spike:' || v_hour_bucket);
    end if;
    if v_payment_fail_count >= 3 then
      perform public.create_notification(v_admin.id, 'Payment failure spike',
        v_payment_fail_count || ' orders failed payment in the last 15 minutes.',
        'official', 'admin_alert', 'payment_failure_spike',
        'alert:payment_failure_spike:' || v_hour_bucket);
    end if;
    if v_notif_fail_count >= 10 then
      perform public.create_notification(v_admin.id, 'Notification delivery failures',
        v_notif_fail_count || ' notification deliveries failed in the last 15 minutes.',
        'official', 'admin_alert', 'notification_failure_spike',
        'alert:notification_failure_spike:' || v_hour_bucket);
    end if;
    if v_cron_fail_count > 0 then
      perform public.create_notification(v_admin.id, 'Scheduled job failing',
        v_cron_fail_count || ' active cron job(s) failed their last run.',
        'official', 'admin_alert', 'cron_job_failure',
        'alert:cron_job_failure:' || v_hour_bucket);
    end if;
  end loop;

  -- array_append(), not `v_fired || 'text'` -- the latter resolves to the
  -- text||text operator (via an implicit array->text cast of v_fired) in
  -- this context, not anyarray||anyelement, so assigning the result back
  -- into the text[] variable then fails with "malformed array literal".
  if v_error_count >= 10 then v_fired := array_append(v_fired, 'error_spike'); end if;
  if v_payment_fail_count >= 3 then v_fired := array_append(v_fired, 'payment_failure_spike'); end if;
  if v_notif_fail_count >= 10 then v_fired := array_append(v_fired, 'notification_failure_spike'); end if;
  if v_cron_fail_count > 0 then v_fired := array_append(v_fired, 'cron_job_failure'); end if;

  return jsonb_build_object(
    'checked_at', now(),
    'error_count_15m', v_error_count,
    'payment_fail_count_15m', v_payment_fail_count,
    'notif_fail_count_15m', v_notif_fail_count,
    'cron_fail_count', v_cron_fail_count,
    'alerts_fired', to_jsonb(v_fired)
  );
end;
$$;

revoke all on function public.run_observability_alerts() from public, anon, authenticated;
-- Left callable by the default migration/owner role (postgres) so the cron
-- job below can execute it; not granted to authenticated, same posture as
-- retry_failed_deliveries.

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'observability-alerts';
exception when others then null;
end $$;

select cron.schedule('observability-alerts', '*/15 * * * *', $$select public.run_observability_alerts();$$);
