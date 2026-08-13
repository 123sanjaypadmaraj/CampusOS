-- Fix notifications RLS policy
-- The current policy blocks authenticated users from inserting
-- Replace with a permissive policy matching other tables

drop policy if exists "notifications own" on public.notifications;
drop policy if exists "notifications update own" on public.notifications;
drop policy if exists "notifications_policy" on public.notifications;

create policy "notifications_policy"
  on public.notifications
  for all
  to anon, authenticated
  using (auth.uid() = user_id or auth.uid() is null)
  with check (auth.uid() = user_id or auth.uid() is null);

-- Also fix content_reports policy
drop policy if exists "content_reports_policy" on public.content_reports;
drop policy if exists reports_auth_insert on public.content_reports;

create policy "content_reports_policy"
  on public.content_reports
  for all
  to authenticated
  using (auth.uid() = reporter_id)
  with check (auth.uid() = reporter_id);

NOTIFY pgrst, 'reload schema';
