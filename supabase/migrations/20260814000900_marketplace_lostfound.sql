-- =============================================================================
-- 0009: MARKETPLACE & LOST AND FOUND (doc §44-45)
-- Messaging (doc §46) is out of scope for this hardening pass -- see
-- docs/ROADMAP.md. Sellers/finders are reachable only through their public
-- profile for now.
-- =============================================================================

create table if not exists public.marketplace_listings (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid references public.campuses(id) on delete set null,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text not null default '',
  category text not null default 'Other'
    check (category not in ('weapons','alcohol','drugs','tobacco','live_animals')), -- doc §45: avoid prohibited categories
  price numeric(10,2) not null default 0 check (price >= 0),
  condition text not null default 'Used' check (condition in ('New','Like New','Used','For Parts')),
  location text not null default 'Campus',
  image_urls text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'pending', 'sold', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.marketplace_listings add column if not exists image_urls text[] not null default '{}';
drop trigger if exists marketplace_listings_set_updated_at on public.marketplace_listings;
create trigger marketplace_listings_set_updated_at
before update on public.marketplace_listings
for each row execute function public.set_updated_at();

create table if not exists public.seller_ratings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id) on delete cascade,
  rater_id uuid not null references public.profiles(id) on delete cascade,
  listing_id uuid references public.marketplace_listings(id) on delete set null,
  rating integer not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  unique(seller_id, rater_id, listing_id)
);

create or replace function public.mark_listing_sold(p_listing_id uuid)
returns public.marketplace_listings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_listing public.marketplace_listings;
begin
  update public.marketplace_listings set status = 'sold'
    where id = p_listing_id and seller_id = v_user and status = 'active'
    returning * into v_listing;
  if not found then raise exception 'Listing not found or not yours to update'; end if;
  return v_listing;
end;
$$;

-- =========================================================
-- LOST & FOUND with claim verification + handover record (doc §44)
-- =========================================================

create table if not exists public.lost_found_items (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid references public.campuses(id) on delete set null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_type text not null check (item_type in ('lost', 'found')),
  title text not null,
  description text not null default '',
  category text not null default 'Other',
  location text not null,
  occurred_at timestamptz,
  image_urls text[] not null default '{}',
  status text not null default 'open' check (status in ('open', 'claim_pending', 'resolved')),
  claimed_by uuid references public.profiles(id) on delete set null,
  claim_proof text,
  handled_by uuid references public.profiles(id) on delete set null, -- staff who verified the handover
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.lost_found_items add column if not exists occurred_at timestamptz;
alter table public.lost_found_items add column if not exists image_urls text[] not null default '{}';
alter table public.lost_found_items add column if not exists claim_proof text;
alter table public.lost_found_items add column if not exists handled_by uuid references public.profiles(id) on delete set null;

update public.lost_found_items set status = 'open' where status not in ('open','claim_pending','resolved');
do $$ begin
  alter table public.lost_found_items drop constraint if exists lost_found_items_status_check;
  alter table public.lost_found_items add constraint lost_found_items_status_check
    check (status in ('open', 'claim_pending', 'resolved'));
exception when others then null; end $$;

drop trigger if exists lost_found_set_updated_at on public.lost_found_items;
create trigger lost_found_set_updated_at
before update on public.lost_found_items
for each row execute function public.set_updated_at();

-- Claiming requires proof text and staff verification before the item is
-- released -- it does not instantly complete the handover client-side.
create or replace function public.claim_lost_found_item(p_item_id uuid, p_proof text)
returns public.lost_found_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_item public.lost_found_items;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if coalesce(trim(p_proof), '') = '' then raise exception 'Proof of ownership is required to claim an item'; end if;

  update public.lost_found_items
    set status = 'claim_pending', claimed_by = v_user, claim_proof = p_proof
    where id = p_item_id and status = 'open'
    returning * into v_item;

  if not found then raise exception 'Item is not available to claim'; end if;
  return v_item;
end;
$$;

create or replace function public.verify_lost_found_handover(p_item_id uuid, p_approve boolean)
returns public.lost_found_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_item public.lost_found_items;
begin
  if not (public.has_permission(v_user, 'moderation.act') or public.current_user_is_admin()) then
    raise exception 'Not authorized to verify handovers';
  end if;

  update public.lost_found_items
    set status = case when p_approve then 'resolved' else 'open' end,
        claimed_by = case when p_approve then claimed_by else null end,
        claim_proof = case when p_approve then claim_proof else null end,
        handled_by = v_user
    where id = p_item_id and status = 'claim_pending'
    returning * into v_item;

  if not found then raise exception 'Item is not awaiting handover verification'; end if;
  return v_item;
end;
$$;

create index if not exists marketplace_campus_idx on public.marketplace_listings(campus_id);
create index if not exists marketplace_status_idx on public.marketplace_listings(status);
create index if not exists lost_found_campus_idx on public.lost_found_items(campus_id);
create index if not exists lost_found_status_idx on public.lost_found_items(status);
