-- =============================================================================
-- FOOD ORDERING hardening, part 1/4: vendor staff sub-accounts (doc Phase 3
-- "still missing" list). A canteen owner can add a real, separately-
-- logged-in staff account (e.g. kitchen staff) scoped to their own canteen
-- that can run the order queue but never touch pricing/menu/payouts/refunds.
--
-- Built first (before menu-depth/inventory/billing) because those later
-- migrations' RLS policies want to distinguish "can manage this canteen's
-- orders" (owner OR staff) from "can manage this canteen's menu/money"
-- (owner only) via the two helpers defined here.
--
-- Deliberately NOT the same thing as the existing `canteen_staff` table
-- (20260815001000_vendor_order_ops.sql) -- that's a free-text name roster
-- for "who's making this order" with no login of its own. This is a real
-- auth account with its own session, restricted by role+RLS, same as every
-- other role in this app.
-- =============================================================================

-- =========================================================
-- New role: vendor_staff. Both places that enumerate roles have to move
-- together (doc lesson from the academic-module pass): the profiles check
-- constraint and admin_set_user_role's allow-list.
-- =========================================================

insert into public.roles (key, name, description) values
  ('vendor_staff', 'Vendor Staff', 'Runs a canteen''s order queue on behalf of its owner; no menu/pricing/payout access')
on conflict (key) do nothing;

insert into public.permissions (key, description) values
  ('food.staff.manage', 'Add/remove staff accounts for a canteen you own')
on conflict (key) do nothing;

with rp as (
  select r.id as role_id, p.id as permission_id
  from public.roles r
  join public.permissions p on true
  where r.key = 'vendor_staff' and p.key in ('food.menu.read', 'food.orders.read', 'food.orders.update')
     or (r.key = 'vendor' and p.key = 'food.staff.manage')
)
insert into public.role_permissions (role_id, permission_id)
select role_id, permission_id from rp
on conflict do nothing;

do $$ begin
  alter table public.profiles drop constraint if exists profiles_role_check;
  alter table public.profiles add constraint profiles_role_check
    check (role in ('student','club_admin','vendor','vendor_staff','facilities_staff','college_admin','super_admin'));
exception when others then null;
end $$;

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

  if p_new_role not in ('student','club_admin','vendor','vendor_staff','facilities_staff','college_admin','super_admin') then
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

-- =========================================================
-- canteen_staff_accounts -- the real link between a login account and the
-- one canteen it may operate. RPC-only writes (touches profiles.role, same
-- "no insert/update policy for authenticated" pattern as reminders/
-- academic_deadlines) -- add_canteen_staff_account/remove_canteen_staff_account
-- below are the only writers.
-- =========================================================

create table if not exists public.canteen_staff_accounts (
  id uuid primary key default gen_random_uuid(),
  canteen_id uuid not null references public.canteens(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  active boolean not null default true,
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (canteen_id, user_id)
);

create index if not exists canteen_staff_accounts_canteen_idx on public.canteen_staff_accounts(canteen_id);
create index if not exists canteen_staff_accounts_user_idx on public.canteen_staff_accounts(user_id) where active;

alter table public.canteen_staff_accounts enable row level security;

drop policy if exists "canteen_staff_accounts_read" on public.canteen_staff_accounts;
create policy "canteen_staff_accounts_read" on public.canteen_staff_accounts for select to authenticated
  using (
    user_id = auth.uid()
    or public.current_user_is_admin()
    or exists (select 1 from public.canteens c where c.id = canteen_staff_accounts.canteen_id and c.owner_id = auth.uid())
  );
-- No insert/update/delete policy for authenticated -- RPC-only below.

-- =========================================================
-- Helpers used by every order-ops RPC/RLS policy from here on:
--   can_manage_canteen_orders -- owner OR admin OR an active staff account
--     (order queue operations: accept/reject/status/notes/pickup redeem).
--   is_canteen_owner -- owner OR admin only (menu/pricing/hours/payouts/
--     refunds/staff-roster management -- never delegated to staff).
-- =========================================================

create or replace function public.is_canteen_owner(p_user uuid, p_canteen_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_is_admin()
    or exists (select 1 from public.canteens c where c.id = p_canteen_id and c.owner_id = p_user);
$$;

create or replace function public.can_manage_canteen_orders(p_user uuid, p_canteen_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_canteen_owner(p_user, p_canteen_id)
    or exists (
      select 1 from public.canteen_staff_accounts csa
      where csa.canteen_id = p_canteen_id and csa.user_id = p_user and csa.active
    );
$$;

-- =========================================================
-- RPC: add_canteen_staff_account -- owner/admin only. Looks up an EXISTING
-- profile by email (no self-serve signup path in this app -- same
-- provisioning-only convention org_requests already established for vendor
-- accounts themselves). Refuses to hijack an account that already holds a
-- real role of its own (vendor/admin/facilities/club_admin) -- only
-- 'student' or already-'vendor_staff' accounts can be promoted.
-- =========================================================

create or replace function public.add_canteen_staff_account(p_canteen_id uuid, p_email text)
returns public.canteen_staff_accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_target public.profiles;
  v_row public.canteen_staff_accounts;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;

  if not (public.has_permission(v_user, 'food.staff.manage') and public.is_canteen_owner(v_user, p_canteen_id)) then
    raise exception 'Not authorized to manage staff for this canteen';
  end if;

  select * into v_target from public.profiles where lower(email) = lower(trim(p_email));
  if not found then
    raise exception 'No CampusOS account found with that email -- they need to sign up first';
  end if;

  if v_target.role not in ('student', 'vendor_staff') then
    raise exception 'That account already has a % role and can''t be added as canteen staff', v_target.role;
  end if;

  -- Set the role directly rather than going through admin_set_user_role()
  -- (that RPC is gated to users.roles.manage/admin, which a canteen owner
  -- correctly does NOT hold -- this function's own owner/food.staff.manage
  -- check above is the real authorization here). Same
  -- set_config('campusos.allow_role_change', ...) technique
  -- admin_set_user_role() itself uses to get past protect_profile_role().
  if v_target.role = 'student' then
    perform set_config('campusos.allow_role_change', 'true', true);
    update public.profiles set role = 'vendor_staff' where id = v_target.id;
    perform set_config('campusos.allow_role_change', 'false', true);

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_value, new_value, reason)
    values (v_user, 'role.change', 'profile', v_target.id::text,
            jsonb_build_object('role', 'student'), jsonb_build_object('role', 'vendor_staff'), 'added as canteen staff');
  end if;

  insert into public.canteen_staff_accounts (canteen_id, user_id, added_by, active)
  values (p_canteen_id, v_target.id, v_user, true)
  on conflict (canteen_id, user_id) do update set active = true
  returning * into v_row;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value)
  values (v_user, 'canteen_staff.add', 'canteen', p_canteen_id::text, jsonb_build_object('user_id', v_target.id, 'email', v_target.email));

  return v_row;
end;
$$;

-- =========================================================
-- RPC: remove_canteen_staff_account -- owner/admin only. Deactivates the
-- link and, if this was the staff member's only active canteen, reverts
-- their role back to 'student' so they don't keep a dangling permission
-- grant with nothing to scope it to.
-- =========================================================

create or replace function public.remove_canteen_staff_account(p_staff_account_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.canteen_staff_accounts;
  v_other_active integer;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;

  select * into v_row from public.canteen_staff_accounts where id = p_staff_account_id for update;
  if not found then
    raise exception 'Staff account not found';
  end if;

  if not (public.has_permission(v_user, 'food.staff.manage') and public.is_canteen_owner(v_user, v_row.canteen_id)) then
    raise exception 'Not authorized to manage staff for this canteen';
  end if;

  update public.canteen_staff_accounts set active = false where id = p_staff_account_id;

  select count(*) into v_other_active from public.canteen_staff_accounts
    where user_id = v_row.user_id and active and id <> p_staff_account_id;

  if v_other_active = 0 then
    perform set_config('campusos.allow_role_change', 'true', true);
    update public.profiles set role = 'student' where id = v_row.user_id and role = 'vendor_staff';
    perform set_config('campusos.allow_role_change', 'false', true);

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_value, new_value, reason)
    values (v_user, 'role.change', 'profile', v_row.user_id::text,
            jsonb_build_object('role', 'vendor_staff'), jsonb_build_object('role', 'student'), 'removed as canteen staff');
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_value)
  values (v_user, 'canteen_staff.remove', 'canteen', v_row.canteen_id::text, jsonb_build_object('user_id', v_row.user_id));
end;
$$;

grant execute on function public.add_canteen_staff_account(uuid, text) to authenticated;
grant execute on function public.remove_canteen_staff_account(uuid) to authenticated;
revoke execute on function public.is_canteen_owner(uuid, uuid) from public, anon;
revoke execute on function public.can_manage_canteen_orders(uuid, uuid) from public, anon;

-- =========================================================
-- Extend order-ops RPCs/RLS to accept staff, not just owner. Recreated from
-- the LATEST prior versions (transition_order_status from
-- 20260815000800_food_stock_tracking.sql, which layered stock-restore on top
-- of 20260814002401's ownership fix; redeem_pickup_token/set_order_ops_fields
-- from their own latest versions) -- not the originals, per this repo's own
-- documented "recreate from the latest copy" rule.
-- =========================================================

create or replace function public.transition_order_status(
  p_order_id uuid,
  p_to_status text,
  p_reason text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_order public.orders;
  v_from_status text;
  v_is_owner boolean;
  v_can_manage boolean;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found';
  end if;

  v_is_owner := v_order.user_id = v_user;
  v_can_manage := public.has_permission(v_user, 'food.orders.update') and public.can_manage_canteen_orders(v_user, v_order.canteen_id);

  if p_to_status = 'CANCEL_REQUESTED' then
    if not v_is_owner and not v_can_manage then
      raise exception 'Not authorized to cancel this order';
    end if;
  elsif p_to_status = 'PAID' then
    raise exception 'PAID may only be set by payment verification';
  else
    if not v_can_manage then
      raise exception 'Not authorized to update this order';
    end if;
  end if;

  if not exists (
    select 1 from public.order_status_transitions
    where from_status = v_order.status and to_status = p_to_status
  ) then
    raise exception 'ORDER_INVALID_TRANSITION: cannot move % -> %', v_order.status, p_to_status;
  end if;

  v_from_status := v_order.status;

  update public.orders set status = p_to_status where id = p_order_id returning * into v_order;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_from_status, p_to_status, v_user, p_reason);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_value, new_value, reason)
  values (v_user, 'order.status.change', 'order', p_order_id::text,
          jsonb_build_object('status', v_from_status), jsonb_build_object('status', p_to_status), p_reason);

  if p_to_status in ('REJECTED', 'CANCELLED') and v_from_status not in ('CREATED', 'PAYMENT_PENDING') then
    perform public.adjust_stock_for_order(p_order_id, 1);
  end if;

  return v_order;
end;
$$;

create or replace function public.redeem_pickup_token(p_token text)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_token public.order_pickup_tokens;
  v_order public.orders;
  v_can_manage boolean;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;

  select * into v_token from public.order_pickup_tokens where token = p_token for update;
  if not found then
    raise exception 'PICKUP_TOKEN_INVALID: token not recognised';
  end if;
  if v_token.used_at is not null then
    raise exception 'PICKUP_TOKEN_USED: this code has already been redeemed';
  end if;
  if v_token.expires_at < now() then
    raise exception 'PICKUP_TOKEN_EXPIRED: this code has expired';
  end if;

  select * into v_order from public.orders where id = v_token.order_id for update;

  v_can_manage := public.has_permission(v_user, 'food.orders.update') and public.can_manage_canteen_orders(v_user, v_order.canteen_id);
  if not v_can_manage then
    raise exception 'Not authorized to redeem pickup tokens for this canteen';
  end if;

  if v_order.status <> 'READY' then
    raise exception 'ORDER_NOT_READY: order is not ready for pickup';
  end if;

  update public.order_pickup_tokens set used_at = now(), used_by = v_user where id = v_token.id;
  update public.orders set status = 'COMPLETED' where id = v_order.id returning * into v_order;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by, reason)
  values (v_order.id, 'READY', 'COMPLETED', v_user, 'pickup token redeemed');

  return v_order;
end;
$$;

create or replace function public.set_order_ops_fields(
  p_order_id uuid,
  p_priority text,
  p_internal_note text,
  p_assigned_staff_name text
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_order public.orders;
  v_can_manage boolean;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;

  if p_priority not in ('normal','high','urgent') then
    raise exception 'Invalid priority %', p_priority;
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found';
  end if;

  v_can_manage := public.has_permission(v_user, 'food.orders.update') and public.can_manage_canteen_orders(v_user, v_order.canteen_id);
  if not v_can_manage then
    raise exception 'Not authorized to update this order';
  end if;

  update public.orders
    set priority = p_priority,
        internal_note = nullif(trim(coalesce(p_internal_note,'')),''),
        assigned_staff_name = nullif(trim(coalesce(p_assigned_staff_name,'')),'')
    where id = p_order_id
    returning * into v_order;

  return v_order;
end;
$$;

drop policy if exists "orders_read" on public.orders;
create policy "orders_read" on public.orders for select to authenticated
  using (
    user_id = auth.uid()
    or public.current_user_is_admin()
    or (public.has_permission(auth.uid(),'food.orders.read') and public.can_manage_canteen_orders(auth.uid(), orders.canteen_id))
  );

drop policy if exists "order_items_read" on public.order_items;
create policy "order_items_read" on public.order_items for select to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = order_items.order_id
      and (o.user_id = auth.uid() or public.current_user_is_admin()
        or (public.has_permission(auth.uid(),'food.orders.read') and public.can_manage_canteen_orders(auth.uid(), o.canteen_id)))
  ));

drop policy if exists "order_status_history_read" on public.order_status_history;
create policy "order_status_history_read" on public.order_status_history for select to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = order_status_history.order_id
      and (o.user_id = auth.uid() or public.current_user_is_admin()
        or (public.has_permission(auth.uid(),'food.orders.read') and public.can_manage_canteen_orders(auth.uid(), o.canteen_id)))
  ));

drop policy if exists "order_pickup_tokens_read" on public.order_pickup_tokens;
create policy "order_pickup_tokens_read" on public.order_pickup_tokens for select to authenticated
  using (
    exists (select 1 from public.orders o where o.id = order_pickup_tokens.order_id and o.user_id = auth.uid())
    or public.current_user_is_admin()
    or exists (
      select 1 from public.orders o
      where o.id = order_pickup_tokens.order_id
        and public.has_permission(auth.uid(),'food.orders.update') and public.can_manage_canteen_orders(auth.uid(), o.canteen_id)
    )
  );

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'canteen_staff_accounts'
  ) then
    execute 'alter publication supabase_realtime add table public.canteen_staff_accounts';
  end if;
end $$;
