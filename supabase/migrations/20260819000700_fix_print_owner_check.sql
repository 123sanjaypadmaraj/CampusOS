-- =============================================================================
-- Real bug found live while running scripts/live-check-operational-gaps.mjs
-- against staging (not by inspection): can_manage_print()
-- (20260819000300_vendor_manager_accounts.sql) never actually checked
-- print_rate_card.owner_id -- despite that migration's own header comment
-- calling it "the closest thing to who runs this campus's print shop", the
-- function only checked current_user_is_admin(), the flat print.manage
-- permission, and active print_staff_accounts rows. In practice this was
-- mostly harmless (every real print_rate_card.owner_id today also holds
-- role='vendor', which already grants print.manage), but it silently broke
-- the one case this pass explicitly designed for: a print_rate_card owner
-- who isn't (yet) a full 'vendor' role holder still needs to be able to
-- add their own first staff account.
-- =============================================================================

create or replace function public.can_manage_print(p_user uuid, p_campus_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_is_admin()
    or public.has_permission(p_user, 'print.manage')
    or exists (
      select 1 from public.print_rate_card prc
      where prc.campus_id = p_campus_id and prc.owner_id = p_user
    )
    or exists (
      select 1 from public.print_staff_accounts psa
      where psa.campus_id = p_campus_id and psa.user_id = p_user and psa.active
    );
$$;
