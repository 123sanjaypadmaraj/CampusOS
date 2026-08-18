-- =============================================================================
-- Permission-driven-app audit, part 1: small, safe backend fixes found by a
-- full-stack RBAC audit (frontend/RPC/edge-functions/storage/RLS/views/
-- triggers). Two confirmed genuine role-only-where-a-permission-should-apply
-- gaps; everything else the audit flagged (food_categories_write admin-only,
-- the has_role(super_admin) campus-widening check in the SOS/emergency-
-- contacts RPCs) turned out to be deliberate, correctly-scoped design on
-- inspection, not bugs -- left untouched rather than "fixed" into something
-- worse. Frontend permission layer and new vendor/security roles are
-- separate, larger follow-on passes (not in this migration).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Academic announcements: faculty can publish_announcement() for
-- Academic/Exam/Assignment (20260817000300's academics.publish permission)
-- but announcements_update_admin/delete_admin stayed admin-only -- a faculty
-- member who posts a typo'd exam notice has no way to fix or retract it
-- themselves. Add a permission-based author path alongside the existing
-- admin override (admin override untouched, still current_user_is_admin()).
-- Deliberately narrower than the create RPC's own rule: author's own row
-- only, and still locked to the three academic categories, so a faculty
-- account can't repurpose this into editing e.g. an Emergency announcement
-- even if one somehow had them as author_id.
-- ---------------------------------------------------------------------------

drop policy if exists "announcements_update_admin" on public.announcements;
create policy "announcements_update_admin" on public.announcements for update to authenticated
  using (
    public.current_user_is_admin()
    or (
      author_id = auth.uid()
      and category in ('Academic','Exam','Assignment')
      and public.has_permission(auth.uid(), 'academics.publish')
    )
  )
  with check (
    public.current_user_is_admin()
    or (
      author_id = auth.uid()
      and category in ('Academic','Exam','Assignment')
      and public.has_permission(auth.uid(), 'academics.publish')
    )
  );

drop policy if exists "announcements_delete_admin" on public.announcements;
create policy "announcements_delete_admin" on public.announcements for delete to authenticated
  using (
    public.current_user_is_admin()
    or (
      author_id = auth.uid()
      and category in ('Academic','Exam','Assignment')
      and public.has_permission(auth.uid(), 'academics.publish')
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Project/Team Matching (20260817000200) is the one feature module with
-- zero permission-key coverage -- every management path is
-- `owner_id = auth.uid() OR current_user_is_admin()`, so a moderation.act
-- holder (who can already take down an abusive post/listing/lost&found item
-- everywhere else in this app) has no way to remove an abusive team listing
-- without being promoted all the way to college_admin/super_admin. Extend
-- the delete path only (not edit, not roster management -- those stay
-- owner's-own-business) with the same moderation.act permission already
-- used for posts/comments/marketplace_listings, so team moderation is
-- consistent with every other user-generated-content module.
-- ---------------------------------------------------------------------------

drop policy if exists "project_teams_delete_own" on public.project_teams;
create policy "project_teams_delete_own" on public.project_teams for delete to authenticated
  using (
    owner_id = auth.uid()
    or public.current_user_is_admin()
    or public.has_permission(auth.uid(), 'moderation.act')
  );

-- ---------------------------------------------------------------------------
-- 3. Not part of the original audit -- caught live while verifying fix #1
-- above: a concurrent session's 20260817000400_food_vendor_staff.sql
-- (already applied on staging) recreated admin_set_user_role() from
-- 20260814000200_rbac.sql's ORIGINAL allow-list (adding 'vendor_staff') but
-- didn't rebase on 20260817000300_academic_module.sql's later addition of
-- 'faculty' to that same allow-list -- so faculty promotion currently
-- fails live with "Invalid role faculty". Recreated here with BOTH additions
-- present; whichever migration lands last in any given environment, the
-- allow-list must carry every role ever added, not just the adder's own.
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_user_role(p_target_user uuid, p_new_role text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_role text;
begin
  if not public.has_permission(auth.uid(), 'users.roles.manage') and not public.current_user_is_admin() then
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

do $$ begin
  alter table public.profiles drop constraint if exists profiles_role_check;
  alter table public.profiles add constraint profiles_role_check
    check (role in ('student','club_admin','vendor','vendor_staff','facilities_staff','faculty','college_admin','super_admin'));
exception when others then null;
end $$;

create or replace function public.delete_project_team(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_team public.project_teams;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  select * into v_team from public.project_teams where id = p_team_id;
  if not found then raise exception 'Team not found'; end if;
  if not (v_team.owner_id = v_user or public.current_user_is_admin() or public.has_permission(v_user, 'moderation.act')) then
    raise exception 'Not authorized to delete this team';
  end if;

  delete from public.project_teams where id = p_team_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_value)
  values (v_user, 'project_team.delete', 'project_team', p_team_id::text, to_jsonb(v_team));
end;
$$;
