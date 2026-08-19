-- =============================================================================
-- MARKETPLACE HARDENING -- edit + edit history, expiry, report/moderate,
-- prohibited-item text screening, duplicate/spam detection.
--
-- Everything else on the checklist this pass was scoped against already
-- existed and was verified by reading the code first: categories/condition/
-- price (20260814000900), seller profile/rating (20260814004900,
-- 20260818000200), messaging incl. block-enforcement (20260814004200,
-- 20260815001500), sold status (20260814000900, buyer-linked in
-- 20260814004900). Image upload/multi-image and search/filters are frontend-
-- only changes (the marketplace-media bucket and the search param on
-- getMarketplaceListings already existed unused) -- no migration needed for
-- those two. "Block seller from a listing" is also frontend-only: blockUser()
-- already exists and is-already enforced server-side, it just wasn't
-- reachable from the Marketplace UI itself.
-- =============================================================================

-- =========================================================
-- 1. EDIT LISTING + EDIT HISTORY
-- =========================================================

alter table public.marketplace_listings
  add column if not exists expires_at timestamptz not null default (now() + interval '60 days');

do $$ begin
  alter table public.marketplace_listings drop constraint if exists marketplace_listings_status_check;
  alter table public.marketplace_listings add constraint marketplace_listings_status_check
    check (status in ('active', 'pending', 'sold', 'removed', 'expired'));
exception when others then null; end $$;

create table if not exists public.marketplace_listing_edits (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.marketplace_listings(id) on delete cascade,
  editor_id uuid references public.profiles(id) on delete set null,
  old_values jsonb not null,
  new_values jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists marketplace_listing_edits_listing_idx
  on public.marketplace_listing_edits(listing_id, created_at desc);

alter table public.marketplace_listing_edits enable row level security;
drop policy if exists "marketplace_listing_edits_read" on public.marketplace_listing_edits;
create policy "marketplace_listing_edits_read" on public.marketplace_listing_edits for select to authenticated
  using (
    exists (select 1 from public.marketplace_listings l where l.id = listing_id and l.seller_id = auth.uid())
    or public.has_permission(auth.uid(), 'moderation.act')
    or public.current_user_is_admin()
  );
-- No insert/update/delete policy at all -- only update_marketplace_listing()
-- below (SECURITY DEFINER) ever writes here, same "RPC gate, don't rely on
-- role-only RLS alone for anything worth an audit trail" posture as every
-- other audit-trail table in this project.
revoke all on public.marketplace_listing_edits from anon;

-- update_marketplace_listing(): seller-only, only while the listing is still
-- active/pending (a sold/removed/expired listing is frozen history, not
-- editable -- renew_marketplace_listing() below is the only way back from
-- 'expired'). Records a before/after snapshot on every real change; also
-- refreshes expires_at, since editing a listing is itself a signal it's
-- still genuinely for sale.
create or replace function public.update_marketplace_listing(
  p_listing_id uuid,
  p_title text,
  p_description text,
  p_category text,
  p_price numeric,
  p_condition text,
  p_location text,
  p_image_urls text[] default null
)
returns public.marketplace_listings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_old public.marketplace_listings;
  v_new public.marketplace_listings;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'Title is required'; end if;
  if p_price is null or p_price < 0 then raise exception 'Price must be zero or more'; end if;
  if p_image_urls is not null and array_length(p_image_urls, 1) > 6 then
    raise exception 'A listing can have at most 6 images';
  end if;

  select * into v_old from public.marketplace_listings where id = p_listing_id for update;
  if not found then raise exception 'Listing not found'; end if;
  if v_old.seller_id <> v_user then raise exception 'Not your listing'; end if;
  if v_old.status not in ('active', 'pending') then
    raise exception 'This listing can no longer be edited (status: %)', v_old.status;
  end if;

  update public.marketplace_listings set
    title = trim(p_title),
    description = coalesce(trim(p_description), ''),
    category = coalesce(nullif(trim(p_category), ''), 'Other'),
    price = p_price,
    condition = coalesce(nullif(trim(p_condition), ''), 'Used'),
    location = coalesce(nullif(trim(p_location), ''), 'Campus'),
    image_urls = coalesce(p_image_urls, image_urls),
    expires_at = now() + interval '60 days'
    where id = p_listing_id
    returning * into v_new;

  insert into public.marketplace_listing_edits (listing_id, editor_id, old_values, new_values)
  values (
    p_listing_id, v_user,
    jsonb_build_object('title', v_old.title, 'description', v_old.description, 'category', v_old.category,
      'price', v_old.price, 'condition', v_old.condition, 'location', v_old.location, 'image_urls', v_old.image_urls),
    jsonb_build_object('title', v_new.title, 'description', v_new.description, 'category', v_new.category,
      'price', v_new.price, 'condition', v_new.condition, 'location', v_new.location, 'image_urls', v_new.image_urls)
  );

  return v_new;
end;
$$;

grant execute on function public.update_marketplace_listing(uuid, text, text, text, numeric, text, text, text[]) to authenticated;

-- =========================================================
-- 2. LISTING EXPIRY
-- Best-effort, not a hard SLA: run opportunistically from the client every
-- time the marketplace feed loads (mvpService.js's getMarketplaceListings)
-- rather than needing pg_cron or a new scheduled Edge Function/GitHub
-- Action -- real traffic hits this often enough, and the function is a
-- cheap, idempotent, side-effect-free-if-nothing-is-actually-expired UPDATE.
-- =========================================================

create or replace function public.expire_stale_listings()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.marketplace_listings
    set status = 'expired'
    where status = 'active' and expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.expire_stale_listings() to authenticated;

-- Lets a seller bring an expired (or still-active but soon-expiring) listing
-- back to the top of the feed without re-typing the whole thing.
create or replace function public.renew_marketplace_listing(p_listing_id uuid)
returns public.marketplace_listings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_listing public.marketplace_listings;
begin
  if v_user is null then raise exception 'Sign in required'; end if;

  update public.marketplace_listings
    set status = 'active', expires_at = now() + interval '60 days'
    where id = p_listing_id and seller_id = v_user and status in ('active', 'expired')
    returning * into v_listing;

  if not found then raise exception 'Listing not found or cannot be renewed'; end if;
  return v_listing;
end;
$$;

grant execute on function public.renew_marketplace_listing(uuid) to authenticated;

-- =========================================================
-- 3. PROHIBITED-ITEM TEXT SCREENING
-- marketplace_listings.category already rejects 5 banned category slugs
-- (20260814000900) -- that only closes the loophole for a seller who
-- honestly picks the matching category. A seller can still list a banned
-- item's actual name under 'Other' (or any category) in the free-text
-- title/description, which the category check never sees. This closes that
-- gap with the same admin-managed-word-list shape as posts/comments'
-- banned_words (20260818000600), kept as a separate table since "profanity"
-- and "prohibited item" are different moderation reasons with different
-- admin owners in practice.
-- =========================================================

create table if not exists public.prohibited_listing_terms (
  term text primary key,
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.prohibited_listing_terms enable row level security;
drop policy if exists "prohibited_listing_terms_admin_read" on public.prohibited_listing_terms;
create policy "prohibited_listing_terms_admin_read" on public.prohibited_listing_terms for select to authenticated
  using (public.has_permission(auth.uid(), 'moderation.act') or public.current_user_is_admin());
-- No insert/update/delete policy -- writes only via the RPCs below (audited).
revoke all on public.prohibited_listing_terms from anon;

create or replace function public.contains_prohibited_term(p_text text)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from unnest(regexp_split_to_array(lower(coalesce(p_text, '')), '[^a-z0-9]+')) as tok
    join public.prohibited_listing_terms t on t.term = tok
    where tok <> ''
  );
$$;

create or replace function public.admin_add_prohibited_term(p_term text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.has_permission(auth.uid(), 'moderation.act') or public.current_user_is_admin()) then
    raise exception 'Not authorized to manage the prohibited-item list';
  end if;
  if p_term is null or trim(p_term) = '' then
    raise exception 'Term cannot be empty';
  end if;

  insert into public.prohibited_listing_terms (term, added_by)
  values (lower(trim(p_term)), auth.uid())
  on conflict (term) do nothing;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, reason)
  values (auth.uid(), 'moderation.prohibited_term.add', 'prohibited_listing_term', lower(trim(p_term)), null);
end;
$$;

create or replace function public.admin_remove_prohibited_term(p_term text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.has_permission(auth.uid(), 'moderation.act') or public.current_user_is_admin()) then
    raise exception 'Not authorized to manage the prohibited-item list';
  end if;

  delete from public.prohibited_listing_terms where term = lower(trim(coalesce(p_term, '')));

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, reason)
  values (auth.uid(), 'moderation.prohibited_term.remove', 'prohibited_listing_term', lower(trim(coalesce(p_term, ''))), null);
end;
$$;

-- =========================================================
-- 4. ABUSE DETECTION -- one BEFORE INSERT trigger covering both a create-
-- rate cap (a spammer flooding the feed with many different listings) and
-- near-duplicate detection (the same listing reposted over and over), same
-- pg_trgm similarity() approach as posts' reject_duplicate_post()
-- (20260818000600) -- pg_trgm is already enabled by that migration.
-- Prohibited-item + profanity screening also lives here rather than a
-- second trigger, since all four checks fire on the exact same event.
-- =========================================================

create or replace function public.reject_bad_listing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_text text := coalesce(new.title, '') || ' ' || coalesce(new.description, '');
  v_hit boolean;
begin
  if public.contains_prohibited_term(v_new_text) then
    raise exception 'PROHIBITED_ITEM: This listing appears to mention an item that cannot be sold here. Contact a campus admin if you believe this is a mistake.';
  end if;

  if public.contains_banned_word(v_new_text) then
    raise exception 'PROFANITY_DETECTED: This listing contains language that is not allowed here. Please revise it and try again.';
  end if;

  if TG_OP = 'INSERT' then
    if not public.check_rate_limit(new.seller_id, 'marketplace_listing_create', 10, 3600) then
      raise exception 'You are creating listings too fast -- slow down and try again shortly';
    end if;

    select exists (
      select 1 from public.marketplace_listings l
      where l.seller_id = new.seller_id
        and l.status <> 'removed'
        and l.created_at > now() - interval '30 minutes'
        and similarity(coalesce(l.title, '') || ' ' || coalesce(l.description, ''), v_new_text) > 0.85
    ) into v_hit;

    if v_hit then
      raise exception 'DUPLICATE_LISTING: You already posted a very similar listing recently. Please wait a bit, or edit your existing listing instead.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists marketplace_listings_reject_bad on public.marketplace_listings;
create trigger marketplace_listings_reject_bad
  before insert or update of title, description on public.marketplace_listings
  for each row execute function public.reject_bad_listing();

-- Deliberately not exhaustive (same posture as banned_words' seed list) --
-- admins extend it via admin_add_prohibited_term() without a redeploy.
-- Plain "knife" is deliberately excluded (kitchen/utility knives are a
-- legitimate secondhand item; the category-level 'weapons' ban already
-- covers the honest case) -- only unambiguous weapon/drug/alcohol/tobacco/
-- live-animal terms are seeded.
insert into public.prohibited_listing_terms (term) values
  ('gun'), ('guns'), ('pistol'), ('handgun'), ('rifle'), ('firearm'), ('firearms'),
  ('ammunition'), ('ammo'), ('grenade'), ('explosive'), ('explosives'), ('machete'), ('sword'),
  ('alcohol'), ('beer'), ('whisky'), ('whiskey'), ('vodka'), ('rum'), ('wine'), ('liquor'),
  ('weed'), ('marijuana'), ('cannabis'), ('cocaine'), ('heroin'), ('mdma'), ('lsd'), ('drugs'),
  ('cigarette'), ('cigarettes'), ('tobacco'), ('vape'), ('vaping'), ('hookah'),
  ('puppy'), ('puppies'), ('kitten'), ('kittens')
on conflict (term) do nothing;

-- =========================================================
-- 5. REPORT + MODERATE LISTINGS
-- content_reports/get_report_context() already accept target_type
-- 'marketplace_listing' (20260814000600/20260815001500) -- the only real gap
-- was moderate_content() itself only knowing how to act on posts/comments,
-- and the frontend never offering a Report button on a listing at all
-- (that half is AdminCMS.jsx/Marketplace.jsx, not a migration).
--
-- Recreated from moderate_content()'s latest version with the SAME
-- signature (no overload risk) -- just widening the body with a new branch.
-- =========================================================

create or replace function public.moderate_content(
  p_target_type text,
  p_target_id uuid,
  p_action text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_new_status text;
begin
  if not (public.has_permission(v_user, 'moderation.act') or public.current_user_is_admin()) then
    raise exception 'Not authorized to moderate content';
  end if;

  v_new_status := case p_action when 'approve' then 'visible' when 'hide' then 'hidden' when 'remove' then 'removed' else null end;

  if v_new_status is not null then
    if p_target_type = 'post' then
      update public.posts set status = v_new_status where id = p_target_id;
    elsif p_target_type = 'comment' then
      update public.comments set status = v_new_status where id = p_target_id;
    elsif p_target_type = 'marketplace_listing' then
      -- marketplace_listings has no 'hidden'/'visible' state of its own
      -- (20260814000900) -- 'hide' and 'remove' both take the listing off
      -- the public feed (status='removed', already excluded by
      -- getMarketplaceListings' own .eq('status','active') filter);
      -- 'approve' restores a wrongly-removed listing back to 'active'
      -- rather than leaving a dismissed report's target stuck removed.
      if p_action in ('hide', 'remove') then
        update public.marketplace_listings set status = 'removed' where id = p_target_id;
      elsif p_action = 'approve' then
        update public.marketplace_listings set status = 'active' where id = p_target_id and status = 'removed';
      end if;
    end if;
  end if;

  insert into public.moderation_actions (moderator_id, target_type, target_id, action, reason)
  values (v_user, p_target_type, p_target_id, p_action, p_reason);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, reason)
  values (v_user, 'moderation.' || p_action, p_target_type, p_target_id::text, p_reason);
end;
$$;

grant execute on function public.admin_add_prohibited_term(text) to authenticated;
grant execute on function public.admin_remove_prohibited_term(text) to authenticated;
grant execute on function public.contains_prohibited_term(text) to authenticated;

create index if not exists marketplace_listings_expires_idx on public.marketplace_listings(status, expires_at);
