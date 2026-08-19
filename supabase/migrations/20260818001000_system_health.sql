-- =============================================================================
-- System health (AdminCMS pass, part 3/5): admin_system_health() surfaces
-- whether the pg_cron jobs already scheduled across this repo (notification
-- delivery retries, booking reminders, marketplace hardening, etc. -- see
-- 20260814001000/20260817001700/20260817001900/20260818000700) are actually
-- RUNNING, not just scheduled. Nothing before this pass exposed job-run
-- history anywhere -- a silently-broken cron job (the exact failure mode
-- the AI-hardening pass's own Groq-model-retirement outages were, one layer
-- up the stack) would have been invisible until something downstream broke
-- loudly enough to notice.
--
-- Reads from pg_cron's own `cron.job`/`cron.job_run_details` -- these are
-- superuser/cron-schema-owned views, not covered by RLS at all, so this is
-- wrapped in its own auth check (not RLS) and the whole introspection block
-- is exception-guarded: if a future environment's `cron` schema grants ever
-- come out narrower than this project's migration-running role, admins get
-- an empty job list instead of a broken tab.
-- =============================================================================

create or replace function public.admin_system_health()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jobs jsonb := '[]'::jsonb;
begin
  if not public.current_user_is_admin() then
    raise exception 'Not authorized to view system health';
  end if;

  begin
    select coalesce(jsonb_agg(row_to_json(j) order by j.jobname), '[]'::jsonb) into v_jobs
    from (
      select
        j.jobname,
        j.schedule,
        j.active,
        lr.status as last_status,
        lr.start_time as last_start,
        lr.end_time as last_end,
        left(lr.return_message, 500) as last_message
      from cron.job j
      left join lateral (
        select d.status, d.start_time, d.end_time, d.return_message
        from cron.job_run_details d
        where d.jobid = j.jobid
        order by d.start_time desc
        limit 1
      ) lr on true
    ) j;
  exception when others then
    v_jobs := '[]'::jsonb;
  end;

  return jsonb_build_object('checked_at', now(), 'jobs', v_jobs);
end;
$$;

grant execute on function public.admin_system_health() to authenticated;
