-- =============================================================================
-- 0008: PRINTING (doc §29-30). Price is always computed server-side from a
-- rate card, never trusted from the client.
-- =============================================================================

create table if not exists public.print_rate_card (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid references public.campuses(id) on delete cascade,
  color_mode text not null check (color_mode in ('black_white','colour')),
  price_per_page numeric(10,2) not null,
  unique(campus_id, color_mode)
);

insert into public.print_rate_card (campus_id, color_mode, price_per_page)
select c.id, v.color_mode, v.price
from public.campuses c
cross join (values ('black_white', 2.00), ('colour', 8.00)) as v(color_mode, price)
where c.slug = 'nhce'
on conflict (campus_id, color_mode) do nothing;

create table if not exists public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  campus_id uuid references public.campuses(id) on delete cascade,
  file_url text not null,
  file_name text not null,
  file_size_bytes bigint,
  pages integer not null check (pages > 0),
  copies integer not null default 1 check (copies > 0),
  color_mode text not null default 'black_white' check (color_mode in ('black_white', 'colour')),
  paper_size text not null default 'A4',
  binding text default 'none' check (binding in ('none','staple','spiral')),
  price numeric(10,2) not null check (price >= 0),
  status text not null default 'UPLOADED'
    check (status in ('UPLOADED','PROCESSING','QUEUED','PRINTING','READY','COLLECTED','FAILED','CANCELLED')),
  virus_scan_status text not null default 'pending' check (virus_scan_status in ('pending','clean','infected','error')),
  pickup_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.print_jobs add column if not exists campus_id uuid references public.campuses(id) on delete cascade;
alter table public.print_jobs add column if not exists file_size_bytes bigint;
alter table public.print_jobs add column if not exists virus_scan_status text not null default 'pending';
alter table public.print_jobs add column if not exists updated_at timestamptz not null default now();

-- Some installs' print_jobs predates this migration and used `file_path`
-- (not `file_url`) and a boolean `binding` column (this migration wants
-- text: 'none'/'staple'/'spiral') -- both are 0-row tables in practice, so
-- fix them outright rather than trying to coerce incompatible data. Guarded
-- because a fresh install's print_jobs never had `file_path` to begin with
-- (found live applying this migration set to a second, from-scratch project
-- -- `alter column ... drop not null` unconditionally referencing a column
-- that was never created is not actually idempotent).
do $$ begin
  alter table public.print_jobs alter column file_path drop not null;
exception when undefined_column then null;
end $$;
alter table public.print_jobs add column if not exists file_url text;
do $$ begin
  alter table public.print_jobs drop column if exists binding;
exception when others then null; end $$;
alter table public.print_jobs add column if not exists binding text default 'none' check (binding in ('none','staple','spiral'));

update public.print_jobs set status = 'UPLOADED' where status = 'pending';
do $$ begin
  alter table public.print_jobs drop constraint if exists print_jobs_status_check;
  alter table public.print_jobs add constraint print_jobs_status_check
    check (status in ('UPLOADED','PROCESSING','QUEUED','PRINTING','READY','COLLECTED','FAILED','CANCELLED'));
exception when others then null; end $$;

drop trigger if exists print_jobs_set_updated_at on public.print_jobs;
create trigger print_jobs_set_updated_at
before update on public.print_jobs
for each row execute function public.set_updated_at();

-- =========================================================
-- RPC: create_print_job -- server computes price from the rate card + page
-- count reported by the upload-processing Edge Function, never from the
-- browser (doc §29, §66).
-- =========================================================

create or replace function public.create_print_job(
  p_file_url text,
  p_file_name text,
  p_pages integer,
  p_copies integer default 1,
  p_color_mode text default 'black_white',
  p_paper_size text default 'A4',
  p_binding text default 'none'
)
returns public.print_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_campus uuid;
  v_rate numeric(10,2);
  v_price numeric(10,2);
  v_job public.print_jobs;
  v_pickup_code text;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if not public.check_rate_limit(v_user, 'print_jobs', 20, 3600) then
    raise exception 'RATE_LIMITED: too many print jobs submitted, slow down';
  end if;
  if p_pages <= 0 or p_copies <= 0 then raise exception 'Invalid page/copy count'; end if;

  select campus_id into v_campus from public.profiles where id = v_user;
  select price_per_page into v_rate from public.print_rate_card where campus_id = v_campus and color_mode = p_color_mode;
  v_rate := coalesce(v_rate, case when p_color_mode = 'colour' then 8.00 else 2.00 end);

  v_price := round(v_rate * p_pages * p_copies, 2);
  v_pickup_code := lpad((floor(random()*1000000))::text, 6, '0');

  insert into public.print_jobs (user_id, campus_id, file_url, file_name, pages, copies, color_mode, paper_size, binding, price, pickup_code, status)
  values (v_user, v_campus, p_file_url, p_file_name, p_pages, p_copies, p_color_mode, p_paper_size, p_binding, v_price, v_pickup_code, 'QUEUED')
  returning * into v_job;

  return v_job;
end;
$$;

create index if not exists print_jobs_user_idx on public.print_jobs(user_id, created_at desc);
create index if not exists print_jobs_status_idx on public.print_jobs(status);
