-- =============================================================================
-- 0017: USN + PASSWORD LOGIN (alongside magic-link email login)
-- Supabase Auth is still email-based under the hood -- signups through this
-- flow get a synthetic, never-shown email derived deterministically from
-- their USN (lower(usn) || '@usn.campusos.internal'), created server-side
-- via the signup-with-usn Edge Function (service_role, email_confirm=true)
-- so no real inbox is ever needed and no project-wide "confirm email"
-- setting has to change. Real students who used magic-link before this
-- migration are unaffected -- this is purely additive.
-- =============================================================================

-- USN must be unique per student, case-insensitively, campus-wide.
create unique index if not exists profiles_usn_unique_idx on public.profiles (upper(usn)) where usn is not null and usn <> '';

-- Let admins edit/retract an announcement after publishing (the original
-- publish_announcement() RPC only supported create). Same authorization as
-- publishing: college_admin/super_admin only (emergency alerts are
-- deliberately even more locked down -- doc §53 -- so this doesn't touch them).
drop policy if exists "announcements_update_admin" on public.announcements;
create policy "announcements_update_admin" on public.announcements for update to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

drop policy if exists "announcements_delete_admin" on public.announcements;
create policy "announcements_delete_admin" on public.announcements for delete to authenticated
  using (public.current_user_is_admin());
