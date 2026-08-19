-- =============================================================================
-- LOST & FOUND MATCHING (module 14). The rest of this pass's Lost & Found
-- work (photo upload into the already-existing but never-populated
-- `image_urls` column + `lost-found-media` bucket, and a real claim-proof
-- modal replacing `window.prompt()`) is frontend-only -- `createLostFoundItem`/
-- `claimLostFoundItem` (`src/services/mvpService.js`) already accept
-- everything needed, no RPC changes required for those.
--
-- What's genuinely new here: surfacing "someone already reported the item
-- you're describing" instead of two reports about the same object sitting
-- unlinked forever. pg_trgm is already enabled campus-wide
-- (20260814000100_extensions_and_core.sql), so this uses real trigram
-- similarity rather than a brittle ILIKE substring match.
-- =============================================================================

create index if not exists lost_found_items_title_trgm_idx
  on public.lost_found_items using gin (title gin_trgm_ops);

-- =========================================================
-- RPC: list_lost_found_matches -- opposite item_type, same campus+category,
-- still open, title similarity above a real threshold (0.2, same floor
-- smart_search.sql already established for "plausible match" rather than
-- "near duplicate"). Read-only, available to the reporting user themselves
-- or staff -- same visibility as the item itself would have.
-- =========================================================

create or replace function public.list_lost_found_matches(p_item_id uuid)
returns table (
  id uuid,
  item_type text,
  title text,
  description text,
  category text,
  location text,
  image_urls text[],
  created_at timestamptz,
  similarity real
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_item public.lost_found_items;
begin
  select * into v_item from public.lost_found_items where id = p_item_id;
  if not found then
    raise exception 'Item not found';
  end if;

  return query
    select
      li.id, li.item_type, li.title, li.description, li.category, li.location,
      li.image_urls, li.created_at,
      greatest(similarity(li.title, v_item.title), similarity(li.description, v_item.description))::real as similarity
    from public.lost_found_items li
    where li.id <> v_item.id
      and li.status = 'open'
      and li.item_type <> v_item.item_type
      and (li.campus_id = v_item.campus_id or li.campus_id is null or v_item.campus_id is null)
      and (
        li.category = v_item.category
        or similarity(li.title, v_item.title) > 0.2
        or similarity(li.description, v_item.description) > 0.2
      )
    order by
      (li.category = v_item.category) desc,
      greatest(similarity(li.title, v_item.title), similarity(li.description, v_item.description)) desc,
      li.created_at desc
    limit 10;
end;
$$;

revoke all on function public.list_lost_found_matches(uuid) from public, anon;
grant execute on function public.list_lost_found_matches(uuid) to authenticated;

-- =========================================================
-- Trigger: notify_lost_found_matches -- fires on every new report (whichever
-- path inserts it -- createLostFoundItem does a direct client insert, not an
-- RPC, so a trigger reaches it regardless of call site, unlike adding a
-- second explicit RPC the frontend would have to remember to call). Notifies
-- the new report's own author AND every matched open item's author, using
-- the same threshold as list_lost_found_matches above so "you have a
-- possible match" is never shown without a corresponding notification, or
-- vice versa. Capped at the 3 best matches to avoid a notification storm if
-- a vague report ("black bag") matches a lot of open items.
-- =========================================================

create or replace function public.notify_lost_found_matches()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record;
  v_match_count integer := 0;
begin
  for v_match in
    select li.id, li.user_id, li.title
    from public.lost_found_items li
    where li.id <> new.id
      and li.status = 'open'
      and li.item_type <> new.item_type
      and (li.campus_id = new.campus_id or li.campus_id is null or new.campus_id is null)
      and (
        li.category = new.category
        or similarity(li.title, new.title) > 0.2
        or similarity(li.description, new.description) > 0.2
      )
    order by
      (li.category = new.category) desc,
      greatest(similarity(li.title, new.title), similarity(li.description, new.description)) desc,
      li.created_at desc
    limit 3
  loop
    v_match_count := v_match_count + 1;

    -- Each matched item's own author is notified individually (they care
    -- about their specific item), but the new reporter gets exactly one
    -- summary notification after the loop, not one per match -- see below.
    perform public.create_notification(
      v_match.user_id, 'Possible match for your lost & found report',
      case when new.item_type = 'found' then 'Someone reported finding something that might match "' || v_match.title || '"'
           else 'Someone reported losing something that might match "' || v_match.title || '"' end,
      'lost_found', 'lost_found_item', v_match.id::text
    );
  end loop;

  if v_match_count > 0 then
    perform public.create_notification(
      new.user_id, 'Possible match found',
      'Your report "' || new.title || '" might match ' ||
        (case when v_match_count = 1 then 'an existing ' else v_match_count || ' existing ' end) ||
        (case when new.item_type = 'found' then 'lost' else 'found' end) ||
        (case when v_match_count = 1 then ' report' else ' reports' end) || ' -- check it out.',
      'lost_found', 'lost_found_item', new.id::text
    );
  end if;

  return new;
end;
$$;

drop trigger if exists lost_found_notify_matches on public.lost_found_items;
create trigger lost_found_notify_matches
after insert on public.lost_found_items
for each row execute function public.notify_lost_found_matches();
