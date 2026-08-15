-- =============================================================================
-- 0114: FIX log_club_membership_event() -- deleting a clubs row cascades to
-- delete every club_members row for it, which fired the DELETE branch of
-- the trigger added in 20260815001100 for each one, trying to INSERT a
-- club_membership_history row referencing a club_id whose parent `clubs`
-- row had, by that point in the cascade, already been removed (FK checks
-- see the post-delete snapshot within the same transaction) -- an
-- immediate foreign key violation that made it impossible to ever hard-
-- delete a club with members. Found live: cleaning up this migration's own
-- staging test data (scripts/live-check-club-cms.mjs) hit exactly this.
--
-- No shipped feature hard-deletes a clubs row today (AdminCMS only
-- archives via `active = false`), so this never broke anything a real user
-- could trigger -- but it's a real correctness bug in what this pass just
-- added, worth fixing now rather than leaving a landmine for whenever a
-- "delete club" admin action exists.
-- =============================================================================

create or replace function public.log_club_membership_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.club_membership_history (club_id, user_id, event_type, role, actor_id)
    values (new.club_id, new.user_id, 'joined', new.role, auth.uid());
    return new;
  elsif tg_op = 'UPDATE' then
    if new.role is distinct from old.role then
      insert into public.club_membership_history (club_id, user_id, event_type, role, previous_role, actor_id)
      values (new.club_id, new.user_id, 'role_changed', new.role, old.role, auth.uid());
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    -- Skip logging when the parent club itself is gone (a cascading
    -- delete) -- nothing to log for a club that no longer exists, and the
    -- FK on club_membership_history.club_id would reject the insert
    -- anyway. A normal leave/removal (club still exists) logs as before.
    if exists (select 1 from public.clubs where id = old.club_id) then
      insert into public.club_membership_history (club_id, user_id, event_type, role, actor_id)
      values (old.club_id, old.user_id, case when old.user_id = auth.uid() then 'left' else 'removed' end, old.role, auth.uid());
    end if;
    return old;
  end if;
  return null;
end;
$$;
