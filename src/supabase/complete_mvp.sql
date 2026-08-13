-- Apply after supabase_mvp.sql and campusos_production.sql.
-- Completes student-facing persistence omitted by the original prototype.

alter table public.profiles add column if not exists open_to_projects boolean not null default false;
alter table public.lost_found_items add column if not exists claimed_by uuid references auth.users(id) on delete set null;

create table if not exists public.saved_events (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

alter table public.saved_events enable row level security;
drop policy if exists "saved events read own" on public.saved_events;
create policy "saved events read own" on public.saved_events for select to authenticated using (user_id = auth.uid());
drop policy if exists "saved events create own" on public.saved_events;
create policy "saved events create own" on public.saved_events for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "saved events delete own" on public.saved_events;
create policy "saved events delete own" on public.saved_events for delete to authenticated using (user_id = auth.uid());

-- Price print jobs at the database boundary; browser-supplied values are ignored.
create or replace function public.calculate_print_job_price()
returns trigger language plpgsql as $$
begin
  new.price := (new.total_pages * new.copies * case when new.color_mode in ('color', 'colour') then 5 else 2 end)
    + case when new.binding is null or new.binding = '' then 0 else 20 end;
  return new;
end;
$$;
drop trigger if exists print_jobs_calculate_price on public.print_jobs;
create trigger print_jobs_calculate_price
before insert or update of total_pages, copies, color_mode, binding, price on public.print_jobs
for each row execute function public.calculate_print_job_price();

-- Keep profile roles server-owned. This trigger rejects browser attempts to alter role.
create or replace function public.protect_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null then
    raise exception 'Role changes are restricted';
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role before update on public.profiles for each row execute function public.protect_profile_role();
