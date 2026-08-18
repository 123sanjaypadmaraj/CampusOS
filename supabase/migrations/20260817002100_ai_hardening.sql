-- =============================================================================
-- AI production-hardening pass (doc "AI" checklist) -- Campus AI already had
-- real auth context, RLS-scoped tools, a fixed tool allowlist, and a
-- propose-then-confirm permission boundary (see supabase/functions/
-- campus-assistant + AI_ACTION_EXECUTORS in src/App.jsx, 2026-08-16/17).
-- This migration adds the schema for the four gap groups picked by the
-- user: security hardening, reliability, trust & quality, feedback/
-- analytics. The edge function itself (prompt-injection guarding, input
-- sanitization, timeout, model fallback) is a code change, not a schema one
-- -- see supabase/functions/campus-assistant/index.ts.
-- =============================================================================

-- =========================================================
-- SECURITY: admin kill-switch (abuse prevention)
-- =========================================================

alter table public.profiles add column if not exists ai_blocked boolean not null default false;
alter table public.profiles add column if not exists ai_blocked_reason text;

create or replace function public.admin_set_ai_access(p_target_user uuid, p_blocked boolean, p_reason text default null)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
begin
  if not public.current_user_is_admin() then
    raise exception 'Not authorized to change AI access';
  end if;

  update public.profiles
    set ai_blocked = p_blocked,
        ai_blocked_reason = case when p_blocked then p_reason else null end
    where id = p_target_user
    returning * into v_profile;

  if not found then
    raise exception 'User not found';
  end if;

  insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id, new_value, reason)
    values (auth.uid(), (select role from public.profiles where id = auth.uid()),
            case when p_blocked then 'ai_access_blocked' else 'ai_access_restored' end,
            'profile', p_target_user::text, jsonb_build_object('ai_blocked', p_blocked), p_reason);

  return v_profile;
end;
$$;

revoke all on function public.admin_set_ai_access(uuid, boolean, text) from public, anon;
grant execute on function public.admin_set_ai_access(uuid, boolean, text) to authenticated;

-- =========================================================
-- SECURITY: action audit log -- reuses the existing audit_logs table (every
-- other privileged mutation in this app already writes here; own-row-or-
-- admin read access via `audit_logs_read` already covers this). The AI
-- layer's mutations happen client-side (see AI_ACTION_EXECUTORS in
-- App.jsx) through the app's normal, already-audited RPCs -- this call logs
-- the *proposal's disposition* (confirmed/cancelled/error) specifically so
-- "what did the AI draft, and did the student actually go through with it"
-- has its own visible trail, distinct from whatever the underlying RPC
-- itself may or may not log.
-- =========================================================

create or replace function public.log_ai_action(p_action_type text, p_action_payload jsonb, p_status text, p_result_text text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  if p_status not in ('confirmed', 'cancelled', 'error') then
    raise exception 'Invalid status %', p_status;
  end if;

  insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id, new_value, reason)
    values (auth.uid(), (select role from public.profiles where id = auth.uid()),
            'ai_action_' || p_status, 'ai_action', p_action_type,
            jsonb_build_object('payload', p_action_payload, 'result', left(coalesce(p_result_text, ''), 500)),
            null);
end;
$$;

revoke all on function public.log_ai_action(text, jsonb, text, text) from public, anon;
grant execute on function public.log_ai_action(text, jsonb, text, text) to authenticated;

-- =========================================================
-- RELIABILITY / cost control: per-turn usage log (token counts from Groq's
-- own `usage` field). Not a raw-insert table -- write-only through
-- log_ai_usage(), same "RPC only, no client insert policy" posture as
-- rate_limit_hits/idempotency_keys, since these numbers back a cost
-- dashboard and a student has no legitimate reason to write here directly.
-- =========================================================

create table if not exists public.ai_usage_log (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id) on delete set null,
  campus_id uuid references public.campuses(id) on delete set null,
  model text not null,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens integer not null default 0,
  tool_rounds integer not null default 0,
  fell_back boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_log_user_idx on public.ai_usage_log(user_id, created_at desc);
create index if not exists ai_usage_log_created_idx on public.ai_usage_log(created_at desc);

alter table public.ai_usage_log enable row level security;
-- No select/insert policy for anon/authenticated at all -- admin reads go
-- through ai_admin_usage_summary() below (security definer bypasses RLS),
-- same "intentionally no direct policy" posture as rate_limit_hits.

create or replace function public.log_ai_usage(
  p_model text, p_prompt_tokens integer, p_completion_tokens integer,
  p_total_tokens integer, p_tool_rounds integer, p_fell_back boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  insert into public.ai_usage_log (user_id, campus_id, model, prompt_tokens, completion_tokens, total_tokens, tool_rounds, fell_back)
    values (auth.uid(), (select campus_id from public.profiles where id = auth.uid()),
            p_model, greatest(0, p_prompt_tokens), greatest(0, p_completion_tokens), greatest(0, p_total_tokens),
            greatest(0, p_tool_rounds), coalesce(p_fell_back, false));
end;
$$;

revoke all on function public.log_ai_usage(text, integer, integer, integer, integer, boolean) from public, anon;
grant execute on function public.log_ai_usage(text, integer, integer, integer, integer, boolean) to authenticated;

-- =========================================================
-- FEEDBACK: thumbs up/down + "report wrong answer" on any AI reply. Same
-- "no raw insert policy, RPC validates and self-scopes" posture as
-- recommendation_dismissals/reminders.
-- =========================================================

create table if not exists public.ai_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  message_excerpt text not null,
  rating text not null check (rating in ('up', 'down')),
  report_reason text,
  created_at timestamptz not null default now()
);

create index if not exists ai_feedback_user_idx on public.ai_feedback(user_id, created_at desc);
create index if not exists ai_feedback_rating_idx on public.ai_feedback(rating, created_at desc);

alter table public.ai_feedback enable row level security;

create policy "ai_feedback_read" on public.ai_feedback for select to authenticated
  using (user_id = auth.uid() or public.current_user_is_admin());

create or replace function public.submit_ai_feedback(p_message_excerpt text, p_rating text, p_report_reason text default null)
returns public.ai_feedback
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.ai_feedback;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  if p_rating not in ('up', 'down') then
    raise exception 'Invalid rating %', p_rating;
  end if;

  insert into public.ai_feedback (user_id, message_excerpt, rating, report_reason)
    values (auth.uid(), left(coalesce(p_message_excerpt, ''), 500), p_rating,
            nullif(left(coalesce(p_report_reason, ''), 500), ''))
    returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.submit_ai_feedback(text, text, text) from public, anon;
grant execute on function public.submit_ai_feedback(text, text, text) to authenticated;

-- =========================================================
-- TRUST & QUALITY: admin-controlled knowledge base -- campus-specific facts
-- (wifi password, library hours, hostel policy, etc) an admin can feed the
-- assistant without touching the model or its tool code. Read-scoped like
-- academic_calendar_events (campus-wide, or global when campus_id is null);
-- writes RPC-only + audit-logged, same posture as every other admin-only
-- content surface in this app (deliberately not plain-RLS-write, per the
-- earlier permission audit's own "RPC gate, don't rely on role-only RLS
-- alone for anything worth an audit trail" lesson).
-- =========================================================

create table if not exists public.ai_knowledge (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid references public.campuses(id) on delete cascade,
  question text not null,
  answer text not null,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_knowledge_campus_idx on public.ai_knowledge(campus_id, active);

alter table public.ai_knowledge enable row level security;

-- Readable by any signed-in user (needed by the edge function's
-- userClient, which runs under the caller's own RLS) -- global rows
-- (campus_id null) or rows matching the caller's own campus, active only.
create policy "ai_knowledge_read" on public.ai_knowledge for select to authenticated
  using (active = true and (campus_id is null or campus_id = (select campus_id from public.profiles where id = auth.uid())));

create trigger ai_knowledge_touch_updated_at
  before update on public.ai_knowledge
  for each row execute function public.set_updated_at();

create or replace function public.upsert_ai_knowledge(p_id uuid, p_question text, p_answer text, p_campus_id uuid default null, p_active boolean default true)
returns public.ai_knowledge
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.ai_knowledge;
  v_question text := trim(coalesce(p_question, ''));
  v_answer text := trim(coalesce(p_answer, ''));
begin
  if not public.current_user_is_admin() then
    raise exception 'Not authorized to manage the AI knowledge base';
  end if;
  if v_question = '' or v_answer = '' then
    raise exception 'Question and answer are both required';
  end if;

  if p_id is null then
    insert into public.ai_knowledge (campus_id, question, answer, active, created_by)
      values (p_campus_id, left(v_question, 300), left(v_answer, 2000), coalesce(p_active, true), auth.uid())
      returning * into v_row;
  else
    update public.ai_knowledge
      set campus_id = p_campus_id, question = left(v_question, 300), answer = left(v_answer, 2000), active = coalesce(p_active, true)
      where id = p_id
      returning * into v_row;
    if not found then
      raise exception 'Knowledge entry not found';
    end if;
  end if;

  insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id, new_value)
    values (auth.uid(), (select role from public.profiles where id = auth.uid()), 'ai_knowledge_upsert', 'ai_knowledge', v_row.id::text,
            jsonb_build_object('question', v_row.question, 'active', v_row.active));

  return v_row;
end;
$$;

revoke all on function public.upsert_ai_knowledge(uuid, text, text, uuid, boolean) from public, anon;
grant execute on function public.upsert_ai_knowledge(uuid, text, text, uuid, boolean) to authenticated;

create or replace function public.delete_ai_knowledge(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.current_user_is_admin() then
    raise exception 'Not authorized to manage the AI knowledge base';
  end if;

  delete from public.ai_knowledge where id = p_id;

  insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id)
    values (auth.uid(), (select role from public.profiles where id = auth.uid()), 'ai_knowledge_delete', 'ai_knowledge', p_id::text);
end;
$$;

revoke all on function public.delete_ai_knowledge(uuid) from public, anon;
grant execute on function public.delete_ai_knowledge(uuid) to authenticated;

-- Admin-only read of every row (incl. inactive/other-campus), for the CMS
-- knowledge-base editor -- ai_knowledge_read above only ever exposes
-- active+own-campus rows, which isn't enough to manage the table.
create or replace function public.admin_list_ai_knowledge()
returns setof public.ai_knowledge
language sql
security definer
set search_path = public
as $$
  select * from public.ai_knowledge
  where public.current_user_is_admin()
  order by created_at desc;
$$;

revoke all on function public.admin_list_ai_knowledge() from public, anon;
grant execute on function public.admin_list_ai_knowledge() to authenticated;

-- =========================================================
-- ANALYTICS: admin dashboard reads (usage + feedback), all admin-gated.
-- =========================================================

create or replace function public.ai_admin_usage_summary(p_days integer default 30)
returns table (
  messages bigint,
  unique_users bigint,
  total_tokens bigint,
  avg_tokens_per_message numeric,
  fallback_count bigint,
  feedback_up bigint,
  feedback_down bigint,
  reports_open bigint,
  blocked_users bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.current_user_is_admin() then
    raise exception 'Not authorized to view AI analytics';
  end if;

  return query
  select
    (select count(*) from public.ai_usage_log u where u.created_at > now() - make_interval(days => p_days)),
    (select count(distinct u.user_id) from public.ai_usage_log u where u.created_at > now() - make_interval(days => p_days)),
    (select coalesce(sum(u.total_tokens), 0) from public.ai_usage_log u where u.created_at > now() - make_interval(days => p_days)),
    (select case when count(*) = 0 then 0 else round(avg(u.total_tokens), 1) end from public.ai_usage_log u where u.created_at > now() - make_interval(days => p_days)),
    (select count(*) from public.ai_usage_log u where u.fell_back and u.created_at > now() - make_interval(days => p_days)),
    (select count(*) from public.ai_feedback f where f.rating = 'up' and f.created_at > now() - make_interval(days => p_days)),
    (select count(*) from public.ai_feedback f where f.rating = 'down' and f.created_at > now() - make_interval(days => p_days)),
    (select count(*) from public.ai_feedback f where f.rating = 'down' and f.report_reason is not null and f.created_at > now() - make_interval(days => p_days)),
    (select count(*) from public.profiles p where p.ai_blocked);
end;
$$;

revoke all on function public.ai_admin_usage_summary(integer) from public, anon;
grant execute on function public.ai_admin_usage_summary(integer) to authenticated;

create or replace function public.ai_admin_list_reports(p_limit integer default 50)
returns table (id uuid, user_id uuid, user_name text, message_excerpt text, report_reason text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.current_user_is_admin() then
    raise exception 'Not authorized to view AI reports';
  end if;

  return query
  select f.id, f.user_id, p.name, f.message_excerpt, f.report_reason, f.created_at
  from public.ai_feedback f
  left join public.profiles p on p.id = f.user_id
  where f.rating = 'down'
  order by f.created_at desc
  limit greatest(1, least(p_limit, 200));
end;
$$;

revoke all on function public.ai_admin_list_reports(integer) from public, anon;
grant execute on function public.ai_admin_list_reports(integer) to authenticated;
