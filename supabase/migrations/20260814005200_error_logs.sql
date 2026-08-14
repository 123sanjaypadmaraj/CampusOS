-- =============================================================================
-- 0052: ERROR LOGGING / MONITORING
-- In-house client + server error capture. No third-party account needed --
-- errors land in this table via a SECURITY DEFINER RPC (log_client_error),
-- viewable/resolvable by admins in the Admin CMS "Errors" tab.
-- =============================================================================

create table if not exists public.error_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid references public.profiles(id) on delete set null,
  campus_id uuid references public.campuses(id) on delete set null,
  source text not null default 'client' check (source in ('client', 'server')),
  severity text not null default 'error' check (severity in ('debug', 'info', 'warning', 'error', 'fatal')),
  message text not null check (char_length(message) between 1 and 2000),
  stack text check (stack is null or char_length(stack) <= 8000),
  url text,
  user_agent text,
  context jsonb not null default '{}'::jsonb check (pg_column_size(context) <= 10000),
  resolved boolean not null default false,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz
);

create index if not exists error_logs_created_idx on public.error_logs (created_at desc);
create index if not exists error_logs_resolved_idx on public.error_logs (resolved, created_at desc);
create index if not exists error_logs_severity_idx on public.error_logs (severity);
create index if not exists error_logs_user_idx on public.error_logs (user_id);

alter table public.error_logs enable row level security;

-- Read/resolve: admins (or anyone holding the dedicated permission) only.
-- Insert deliberately has NO permission gate -- an error can happen on the
-- login screen before anyone is authenticated, and the whole point is to
-- capture that. What keeps this from being an abuse vector: the CHECK
-- constraints above cap every field's size, all inserts go through
-- log_client_error() below (never a raw table insert from the client -- see
-- grants), and authenticated inserts are rate-limited the same way
-- posts/comments/etc. are (rl_error_logs, below). Anonymous (pre-login)
-- inserts are NOT rate-limited at the DB level -- auth.uid() is null before
-- sign-in, and enforce_rate_limit() intentionally no-ops for anon writes
-- everywhere else in this schema too (see 0016) -- accepted as a known gap
-- rather than building IP-based limiting with no edge-layer support.
drop policy if exists "error_logs_read_admin" on public.error_logs;
create policy "error_logs_read_admin" on public.error_logs for select
  to authenticated
  using (public.has_permission(auth.uid(), 'system.errors.read') or public.current_user_is_admin());

drop policy if exists "error_logs_update_admin" on public.error_logs;
create policy "error_logs_update_admin" on public.error_logs for update
  to authenticated
  using (public.has_permission(auth.uid(), 'system.errors.read') or public.current_user_is_admin())
  with check (public.has_permission(auth.uid(), 'system.errors.read') or public.current_user_is_admin());

-- Resolving an error is the only allowed update from the UI. resolved_by/
-- resolved_at are never trusted from the client -- same discipline as
-- content_reports.reviewed_by, profiles.role, etc. elsewhere in this schema.
create or replace function public.set_error_log_resolution_meta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.resolved and not old.resolved then
    new.resolved_by := auth.uid();
    new.resolved_at := now();
  elsif not new.resolved then
    new.resolved_by := null;
    new.resolved_at := null;
  else
    new.resolved_by := old.resolved_by;
    new.resolved_at := old.resolved_at;
  end if;
  return new;
end;
$$;

drop trigger if exists error_logs_resolution_meta on public.error_logs;
create trigger error_logs_resolution_meta
  before update on public.error_logs
  for each row execute function public.set_error_log_resolution_meta();

drop trigger if exists rl_error_logs on public.error_logs;
create trigger rl_error_logs before insert on public.error_logs
  for each row execute function public.enforce_rate_limit('error_logs', 60, 3600);

-- log_client_error(): the only insert path. security definer so an
-- unauthenticated caller (anon key, no session) can still log a pre-login
-- crash despite RLS having no anon insert policy at all.
create or replace function public.log_client_error(
  p_message text,
  p_stack text default null,
  p_url text default null,
  p_user_agent text default null,
  p_severity text default 'error',
  p_context jsonb default '{}'::jsonb,
  p_source text default 'client'
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

  insert into public.error_logs (user_id, campus_id, source, severity, message, stack, url, user_agent, context)
  values (
    auth.uid(),
    v_campus,
    v_source,
    v_severity,
    left(p_message, 2000),
    left(p_stack, 8000),
    left(coalesce(p_url, ''), 500),
    left(coalesce(p_user_agent, ''), 500),
    coalesce(p_context, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.log_client_error(text, text, text, text, text, jsonb, text) to anon, authenticated;

-- Retention: error logs older than 90 days are pruned. Called by a
-- scheduled job (see docs/DATA_RETENTION.md) -- admin/service-role only,
-- deliberately not exposed to `authenticated`.
create or replace function public.prune_old_error_logs(p_older_than_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from public.error_logs
  where created_at < now() - make_interval(days => p_older_than_days)
  and resolved = true;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

insert into public.permissions (key, description) values
  ('system.errors.read', 'View and resolve client/server error logs (Admin CMS Errors tab)')
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where p.key = 'system.errors.read' and r.key in ('college_admin', 'super_admin')
on conflict do nothing;
