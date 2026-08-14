-- =============================================================================
-- 0043: MARKETPLACE SELLER-RATING DEPTH.
-- =============================================================================
-- seller_ratings (0009) already existed as a table + RLS policies, but
-- nothing in the app ever wrote to it or read it: no RPC, no buyer record
-- on a sold listing to gate a rating against, no summary, no UI. This
-- migration is what actually turns it into a feature.

-- A sold listing now records WHO bought it, not just that it sold. This is
-- also the only thing that lets a rating be tied to a real transaction
-- instead of any authenticated user rating any seller they like.
alter table public.marketplace_listings add column if not exists buyer_id uuid references public.profiles(id) on delete set null;
create index if not exists marketplace_listings_buyer_idx on public.marketplace_listings(buyer_id);

-- mark_listing_sold(uuid) already exists (0009) with a single p_listing_id
-- argument -- CREATE OR REPLACE cannot widen its argument list without
-- creating a second overload (bit us once already, see
-- 20260814002600_fix_register_for_event_overload.sql), so the old
-- signature is dropped explicitly before the replacement is created.
drop function if exists public.mark_listing_sold(uuid);

create or replace function public.mark_listing_sold(p_listing_id uuid, p_buyer_id uuid default null)
returns public.marketplace_listings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_listing public.marketplace_listings;
begin
  if p_buyer_id is not null and p_buyer_id = v_user then
    raise exception 'You cannot mark a listing sold to yourself';
  end if;
  if p_buyer_id is not null and not exists (select 1 from public.profiles where id = p_buyer_id) then
    raise exception 'Buyer not found';
  end if;

  update public.marketplace_listings set status = 'sold', buyer_id = p_buyer_id
    where id = p_listing_id and seller_id = v_user and status = 'active'
    returning * into v_listing;
  if not found then raise exception 'Listing not found or not yours to update'; end if;
  return v_listing;
end;
$$;

grant execute on function public.mark_listing_sold(uuid, uuid) to authenticated;

-- =========================================================
-- Rating eligibility is enforced at the table level (BEFORE INSERT/UPDATE
-- trigger), not just inside the RPC below -- see the "verified" trigger-
-- guard pattern used for profiles.linkedin_verified_at
-- (20260814003300_protect_linkedin_verification.sql): a SECURITY DEFINER
-- RPC alone does not stop a raw PostgREST insert through
-- seller_ratings_insert_own (0011), which only ever checked
-- rater_id = auth.uid() and nothing about there being a real transaction.
-- =========================================================

create or replace function public.enforce_seller_rating_eligibility()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.rater_id = new.seller_id then
    raise exception 'You cannot rate yourself';
  end if;
  if new.listing_id is null then
    raise exception 'SELLER_RATING_REQUIRES_PURCHASE: a rating must reference the listing you bought';
  end if;
  if not exists (
    select 1 from public.marketplace_listings
    where id = new.listing_id
      and seller_id = new.seller_id
      and status = 'sold'
      and buyer_id = new.rater_id
  ) then
    raise exception 'SELLER_RATING_REQUIRES_PURCHASE: you can only rate a seller for a listing they sold you';
  end if;
  return new;
end;
$$;

drop trigger if exists seller_ratings_enforce_eligibility on public.seller_ratings;
create trigger seller_ratings_enforce_eligibility
before insert or update on public.seller_ratings
for each row execute function public.enforce_seller_rating_eligibility();

-- RPC: submit_seller_rating -- upserts so a buyer can edit their review;
-- the trigger above is what actually enforces eligibility either way.
create or replace function public.submit_seller_rating(
  p_seller_id uuid,
  p_listing_id uuid,
  p_rating integer,
  p_comment text default null
)
returns public.seller_ratings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_rating public.seller_ratings;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5';
  end if;

  insert into public.seller_ratings (seller_id, rater_id, listing_id, rating, comment)
  values (p_seller_id, v_user, p_listing_id, p_rating, nullif(trim(coalesce(p_comment,'')), ''))
  on conflict (seller_id, rater_id, listing_id)
  do update set rating = excluded.rating, comment = excluded.comment
  returning * into v_rating;

  return v_rating;
end;
$$;

grant execute on function public.submit_seller_rating(uuid, uuid, integer, text) to authenticated;

-- Per-seller aggregate, the same "plain view over RLS-protected tables"
-- pattern already used by clubs_with_counts/events_with_counts.
create or replace view public.seller_rating_summary as
select
  seller_id,
  round(avg(rating)::numeric, 2) as avg_rating,
  count(*) as rating_count,
  count(*) filter (where rating >= 4) as positive_count
from public.seller_ratings
group by seller_id;

-- A buyer can only be asked to rate listings they actually bought and
-- haven't rated yet -- powers the "rate this seller" prompt.
create or replace function public.get_my_unrated_purchases()
returns table (listing_id uuid, title text, price numeric, seller_id uuid, seller_name text)
language sql
stable
security definer
set search_path = public
as $$
  select l.id, l.title, l.price, l.seller_id, p.name
  from public.marketplace_listings l
  join public.profiles p on p.id = l.seller_id
  where l.buyer_id = auth.uid()
    and l.status = 'sold'
    and not exists (
      select 1 from public.seller_ratings r
      where r.listing_id = l.id and r.rater_id = auth.uid()
    )
  order by l.updated_at desc;
$$;

grant execute on function public.get_my_unrated_purchases() to authenticated;
