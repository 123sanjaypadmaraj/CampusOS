-- =============================================================================
-- Real bug found live while running scripts/live-check-operational-gaps.mjs:
-- list_lost_found_matches() (20260819000500_lost_found_matching.sql) failed
-- every call with "column reference \"id\" is ambiguous". Its RETURNS TABLE
-- declares an output column named `id`, which PL/pgSQL exposes as a bare
-- variable in scope for the whole function body -- the unqualified
-- `where id = p_item_id` in the v_item lookup collided with it (Postgres
-- can't tell whether `id` means the OUT parameter or lost_found_items.id).
-- Every other reference in the function was already table/variable-
-- qualified; this was the one bare column reference. Fixed by qualifying it
-- like everywhere else.
-- =============================================================================

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
  select * into v_item from public.lost_found_items where lost_found_items.id = p_item_id;
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
