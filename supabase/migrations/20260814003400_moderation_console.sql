-- =============================================================================
-- 0034: MODERATION CONSOLE -- give content_reports/moderate_content a UI.
-- =============================================================================
-- moderate_content() (0006) already handles hide/remove/approve for posts
-- and comments, and content_reports_update_mod (0011) already lets a
-- moderator update a report's status directly -- neither needed schema
-- changes. What was missing: any way to know WHO/WHAT a report is actually
-- about. content_reports.target_id is polymorphic (target_type decides
-- which table it points into: post/comment/marketplace_listing/
-- lost_found_item/profile), so PostgREST can't embed it via a normal FK
-- join. This RPC resolves that server-side so the console can show a real
-- snippet + the content owner (needed to offer "suspend this student"
-- inline instead of making a moderator go hunt for them in Users).

create or replace function public.get_report_context(p_target_type text, p_target_id uuid)
returns table (owner_id uuid, owner_name text, snippet text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.has_permission(auth.uid(), 'moderation.act') or public.current_user_is_admin()) then
    raise exception 'Not authorized';
  end if;

  if p_target_type = 'post' then
    return query
      select p.author_id, pr.name, coalesce(p.title, left(p.content, 140))
      from public.posts p join public.profiles pr on pr.id = p.author_id
      where p.id = p_target_id;
  elsif p_target_type = 'comment' then
    return query
      select c.author_id, pr.name, left(c.content, 140)
      from public.comments c join public.profiles pr on pr.id = c.author_id
      where c.id = p_target_id;
  elsif p_target_type = 'marketplace_listing' then
    return query
      select m.seller_id, pr.name, m.title
      from public.marketplace_listings m join public.profiles pr on pr.id = m.seller_id
      where m.id = p_target_id;
  elsif p_target_type = 'lost_found_item' then
    return query
      select l.user_id, pr.name, l.title
      from public.lost_found_items l join public.profiles pr on pr.id = l.user_id
      where l.id = p_target_id;
  elsif p_target_type = 'profile' then
    return query
      select pr.id, pr.name, pr.bio
      from public.profiles pr
      where pr.id = p_target_id;
  end if;
end;
$$;

grant execute on function public.get_report_context(text, uuid) to authenticated;
