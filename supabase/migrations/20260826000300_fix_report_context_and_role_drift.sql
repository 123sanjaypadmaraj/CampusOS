-- =============================================================================
-- Full-app production-readiness test pass (2026-08-26, second pass same day):
-- two real, confirmed bugs found by re-running the live-check suite, both
-- reproduced live and identical on staging AND production (i.e. not test
-- staleness) except where noted.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Bug 1: get_report_context('conversation', ...) resolved the REPORTER's own
-- profile instead of the other participant.
--
-- `where cp.user_id = coalesce(p_reporter_id, cp.user_id)` -- when a reporter
-- id is passed, this collapses to `cp.user_id = p_reporter_id`, i.e. it
-- matches the reporter's OWN participant row, not the person being reported.
-- Every moderator reviewing a reported conversation was shown the reporter's
-- own name/profile as the "owner" of the report, not the other party --
-- confirmed live via scripts/live-check-marketplace-messaging.mjs (bob
-- reports nobody; alice reports a conversation with bob, and
-- get_report_context returned alice's own row instead of bob's).
--
-- Fix: exclude the reporter instead of matching them, so it resolves the
-- OTHER participant. Falls back to "any participant" when no reporter id is
-- given (unchanged from before for that case).
-- -----------------------------------------------------------------------------

create or replace function public.get_report_context(p_target_type text, p_target_id uuid, p_reporter_id uuid default null)
returns table(owner_id uuid, owner_name text, snippet text)
language plpgsql
stable security definer
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
  elsif p_target_type = 'conversation' then
    return query
      select pr.id, pr.name, coalesce(lm.body, case when lm.attachment_path is not null then '📷 Photo' else '(no messages yet)' end)
      from public.conversation_participants cp
      join public.profiles pr on pr.id = cp.user_id
      left join lateral (
        select body, attachment_path from public.messages m
        where m.conversation_id = p_target_id order by m.created_at desc limit 1
      ) lm on true
      where cp.conversation_id = p_target_id
        and (p_reporter_id is null or cp.user_id <> p_reporter_id)
      limit 1;
  elsif p_target_type = 'event' then
    return query
      select e.organizer_id, pr.name, e.title
      from public.events e left join public.profiles pr on pr.id = e.organizer_id
      where e.id = p_target_id;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Bug 2 (staging-only environment drift, re-applied defensively): staging's
-- deployed admin_set_user_role() had reverted to the pre-20260818000400 body
-- (the `or current_user_is_admin()` privilege-escalation bypass that let a
-- college_admin promote anyone, including themselves, straight to
-- super_admin) even though supabase_migrations.schema_migrations on staging
-- shows 20260818000400 as applied and its file content on disk was never
-- edited since (confirmed via `git log --follow`, one commit). Root cause not
-- fully determined -- likely a stray manual `db query` run against staging
-- with stale SQL at some point -- but production's deployed body was
-- confirmed correct (byte-for-byte identical to the migration file) via a
-- direct pg_proc read, so this was never live-exploitable in production.
--
-- Re-stating the already-correct definition here (identical to what
-- 20260818000400 already defines) is a safe no-op on production and a real
-- fix on staging, and routes the fix through the normal reviewed migration
-- pipeline rather than an ad hoc write against a live database.
-- -----------------------------------------------------------------------------

create or replace function public.admin_set_user_role(p_target_user uuid, p_new_role text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_role text;
begin
  if not public.has_permission(auth.uid(), 'users.roles.manage') then
    raise exception 'Not authorized to change roles';
  end if;

  if p_new_role not in ('student','club_admin','vendor','vendor_staff','facilities_staff','faculty','college_admin','super_admin') then
    raise exception 'Invalid role %', p_new_role;
  end if;

  select role into v_old_role from public.profiles where id = p_target_user for update;

  perform set_config('campusos.allow_role_change', 'true', true);
  update public.profiles set role = p_new_role where id = p_target_user;
  perform set_config('campusos.allow_role_change', 'false', true);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_value, new_value, reason)
  values (auth.uid(), 'role.change', 'profile', p_target_user::text,
          jsonb_build_object('role', v_old_role), jsonb_build_object('role', p_new_role), p_reason);
end;
$$;
