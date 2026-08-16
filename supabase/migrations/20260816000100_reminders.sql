-- =============================================================================
-- REMINDERS (doc §16 "AI Action System" -- "Create reminders")
-- Brand new feature -- no reminders concept existed anywhere before this.
-- Deliberately simple: one table, one validating entry point for creation
-- (title/remind_at rules), plain self-scoped RLS for read/complete/delete
-- (no real business rule to enforce there, same reasoning
-- recommendation_dismissals/blocked_users already use elsewhere).
-- =============================================================================

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  campus_id uuid references public.campuses(id) on delete set null,
  title text not null check (length(btrim(title)) > 0 and length(title) <= 200),
  notes text,
  remind_at timestamptz not null,
  done boolean not null default false,
  source text not null default 'manual' check (source in ('manual', 'ai')),
  created_at timestamptz not null default now()
);

create index if not exists reminders_user_idx on public.reminders(user_id, remind_at);

alter table public.reminders enable row level security;

create policy "reminders_select_own" on public.reminders for select to authenticated
  using (user_id = auth.uid());
create policy "reminders_update_own" on public.reminders for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "reminders_delete_own" on public.reminders for delete to authenticated
  using (user_id = auth.uid());
-- No insert policy -- creation always goes through create_reminder() below,
-- so title/remind_at validation can't be bypassed by a raw PostgREST insert.

create or replace function public.create_reminder(p_title text, p_remind_at timestamptz, p_notes text default null, p_source text default 'manual')
returns public.reminders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_campus uuid;
  v_title text := btrim(coalesce(p_title, ''));
  v_row public.reminders;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if v_title = '' then raise exception 'Give the reminder a title'; end if;
  if length(v_title) > 200 then raise exception 'Title is too long (200 characters max)'; end if;
  if p_remind_at is null then raise exception 'Pick a date/time for the reminder'; end if;
  if p_remind_at < now() - interval '5 minutes' then raise exception 'That time has already passed -- pick a time in the future'; end if;
  if p_source not in ('manual', 'ai') then raise exception 'Invalid source'; end if;

  select campus_id into v_campus from public.profiles where id = v_user;

  insert into public.reminders (user_id, campus_id, title, notes, remind_at, source)
  values (v_user, v_campus, v_title, nullif(btrim(coalesce(p_notes, '')), ''), p_remind_at, p_source)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.create_reminder(text, timestamptz, text, text) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reminders'
  ) then
    execute 'alter publication supabase_realtime add table public.reminders';
  end if;
end $$;
