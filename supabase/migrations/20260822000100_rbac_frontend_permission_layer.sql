-- =============================================================================
-- RBAC FRONTEND PERMISSION LAYER (readiness-audit phase 2) -- the server-side
-- permission model (roles/permissions/role_permissions/user_roles,
-- has_permission()/has_role()/current_user_is_admin(), 20260814000200_rbac.sql)
-- has been the real enforcement layer since the original hardening pass. The
-- frontend never had a way to read it -- every conditional render in src/
-- checks a role string against `profiles.role` directly instead, and that
-- list has already drifted from the real model twice in production:
--   1. src/App.jsx's admin/vendor/facilities nav+route gates check
--      profile.role === 'vendor' only -- 'vendor_staff' (the manager-account
--      role added by 20260819000300_vendor_manager_accounts.sql) was never
--      added to the allow-list, so a manager account can never reach the
--      Vendor Dashboard at all despite the backend granting it full access.
--   2. src/features/academics/AcademicHub.jsx gates the Announcements
--      composer on profile.role === 'faculty' only, missing the
--      college_admin/super_admin path create_academic_announcement() itself
--      accepts via has_permission(..., 'academics.publish').
--   3. src/features/admin/AdminCMS.jsx's UsersTab checks
--      authUser?.role === 'super_admin' -- authUser is the raw
--      supabase.auth.getUser() object, whose .role field is GoTrue's fixed
--      "authenticated" string, never a profiles.role value. This condition
--      is always false, so the super_admin-only instant-role-change path
--      admin_set_user_role() was rewritten for
--      (20260818000400_role_change_approval_and_verification_lockdown.sql)
--      has never actually been reachable from the UI -- every role change,
--      even a real super_admin's own, silently falls through to the
--      dual-admin propose/approve flow instead.
--
-- This migration adds the one RPC the frontend needs to stop guessing:
-- get_my_access() returns the calling user's real permission keys, real role
-- keys, and the same is_admin boolean current_user_is_admin() already backs
-- every RLS policy with, in one round trip. src/hooks/usePermissions.js
-- fetches it once per session; call sites replace their own
-- profile.role === '<string>' checks with can()/hasRole()/isAdmin from that
-- hook instead of adding yet another one-off comparison.
-- =============================================================================

create or replace function public.get_my_access()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'permissions', coalesce((
      select jsonb_agg(distinct p.key)
      from public.user_roles ur
      join public.role_permissions rp on rp.role_id = ur.role_id
      join public.permissions p on p.id = rp.permission_id
      where ur.user_id = auth.uid()
    ), '[]'::jsonb),
    'roles', coalesce((
      select jsonb_agg(distinct r.key)
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where ur.user_id = auth.uid()
    ), '[]'::jsonb),
    'is_admin', public.current_user_is_admin()
  );
$$;

-- No arguments, reads only auth.uid()'s own rows -- safe for any signed-in
-- user to call about themselves; nobody can pass another user's id in.
revoke all on function public.get_my_access() from public, anon;
grant execute on function public.get_my_access() to authenticated;
