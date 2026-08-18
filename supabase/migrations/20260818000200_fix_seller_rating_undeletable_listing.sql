-- =============================================================================
-- Full-app bug-check pass (2026-08-18), continued: a real, confirmed bug
-- found via scripts/live-check-community-discovery.mjs's cleanup step
-- silently failing (it deletes a marketplace_listings row with no error
-- check -- the delete always 400'd, leaving orphaned test listings/ratings
-- behind on every run, which is what actually caused that script's
-- "seller_rating_summary reflects the new rating" assertion to see a
-- rating_count of 2 instead of 1).
--
-- Root cause: 20260814004900_marketplace_seller_ratings.sql's
-- enforce_seller_rating_eligibility() trigger runs BEFORE INSERT OR UPDATE
-- on seller_ratings, and marketplace_listings.buyer_id/id are referenced by
-- seller_ratings.listing_id with ON DELETE SET NULL. Deleting ANY listing
-- that has a rating attached makes Postgres issue an implicit
-- `UPDATE seller_ratings SET listing_id = NULL` to honor that FK action --
-- which fires this same trigger, sees NEW.listing_id is null, and raises
-- 'SELLER_RATING_REQUIRES_PURCHASE: a rating must reference the listing you
-- bought', aborting the entire DELETE. Net effect, confirmed live: once a
-- listing has ever been rated, it becomes permanently undeletable by
-- anyone -- the seller, an admin, a moderator, even service_role.
--
-- Fix: the application never legitimately updates listing_id (submit_seller_
-- rating's upsert only ever touches rating/comment on conflict), so the only
-- way a row transitions from a real listing_id to null is exactly this FK
-- cascade -- skip the eligibility re-check for that specific transition and
-- let it through unconditionally. Every other path (a genuine INSERT, or a
-- hypothetical future UPDATE that isn't this cascade) is still fully
-- enforced, unchanged.
-- =============================================================================

create or replace function public.enforce_seller_rating_eligibility()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'UPDATE' and new.listing_id is null and old.listing_id is not null then
    return new;
  end if;

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
