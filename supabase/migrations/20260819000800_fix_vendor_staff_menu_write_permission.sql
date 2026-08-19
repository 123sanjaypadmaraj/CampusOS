-- =============================================================================
-- Real bug found live while running scripts/live-check-operational-gaps.mjs
-- against staging: 20260819000300_vendor_manager_accounts.sql widened
-- is_canteen_owner() and every RLS policy gated on it (canteens_write,
-- food_items_write, request_refund) to accept an active canteen manager --
-- but forgot that those policies ALSO require the role-level permission
-- `food.menu.write`/`food.refunds.create` in addition to is_canteen_owner()
-- (`has_permission(...) and is_canteen_owner(...)`, both halves required).
-- Stage 1 (20260817000400_food_vendor_staff.sql) only ever granted
-- vendor_staff food.menu.read/food.orders.read/food.orders.update -- never
-- food.menu.write or food.refunds.create, because stage 1 deliberately
-- scoped staff to orders-only. This pass's own explicit "full owner-
-- equivalent access" decision needs those two permissions added to
-- vendor_staff as well, or a manager can add staff/edit orders but silently
-- can't touch pricing/menu/refunds despite is_canteen_owner() now saying
-- yes -- confirmed live: a manager's food_items insert 403'd on RLS even
-- though is_canteen_owner(manager, canteen_id) correctly returned true.
-- =============================================================================

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.key = 'vendor_staff' and p.key in ('food.menu.write', 'food.refunds.create')
on conflict do nothing;
