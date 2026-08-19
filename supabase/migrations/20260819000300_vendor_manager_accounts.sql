-- =============================================================================
-- VENDOR MANAGER ACCOUNTS -- extends stage 1 (20260817000400_food_vendor_staff.sql,
-- canteen-only) to store and print, and widens what a delegated account can
-- do. Explicit user decision made while planning this pass: there is no
-- kitchen/cashier split -- one sub-role, "manager", with FULL owner-equivalent
-- access (orders, pricing/menu/rate-card, refunds/payouts, and adding/
-- removing other managers). The only thing that stays distinct from a manager
-- is literal ownership (`owner_id` on canteens/stores, or the print rate
-- card's owner_id standing in for "who runs this campus's print shop") --
-- that only ever moves via the existing admin-gated
-- admin_transfer_vendor_ownership() (20260818000800_vendor_management.sql),
-- never via anything in this migration.
--
-- Reused across all three vendor types rather than one role per type: the
-- `vendor_staff` role/`food.staff.manage`-shaped permission convention stage 1
-- already established. A profile can hold active rows in more than one of the
-- three staff tables below (e.g. a store manager who is also canteen staff
-- somewhere else) -- same "role is just a UI/RLS gate, the *_staff_accounts
-- row is what actually scopes access" model stage 1 used.
-- =============================================================================

-- ============================================================
-- PART 1/3 -- CANTEEN: widen is_canteen_owner() itself so every RLS policy
-- and RPC that already calls it (canteen_hours/canteen_closures/
-- food_item_variants/food_item_addon_groups+options from 20260817000500,
-- the payouts read policy from 20260817000700) picks up manager access with
-- no per-callsite change needed. Semantics shift deliberately: this
-- function now means "has full manager access to this canteen", not
-- literally "is the owner_id" -- the header comment above is the record of
-- that decision. Recreated from the latest copy (20260817000400).
-- ============================================================

create or replace function public.is_canteen_owner(p_user uuid, p_canteen_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_is_admin()
    or exists (select 1 from public.canteens c where c.id = p_canteen_id and c.owner_id = p_user)
    or exists (
      select 1 from public.canteen_staff_accounts csa
      where csa.canteen_id = p_canteen_id and csa.user_id = p_user and csa.active
    );
$$;

-- food.staff.manage was owner-role-only in stage 1 (granted to 'vendor' but
-- not 'vendor_staff') -- per this pass's "manager can add/remove other
-- managers" decision, vendor_staff now needs it too. add_canteen_staff_
-- account's own authorization check (has_permission(...,'food.staff.manage')
-- and is_canteen_owner(...)) is unchanged; both halves now resolve true for
-- an active manager, not just the literal owner.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.key = 'vendor_staff' and p.key = 'food.staff.manage'
on conflict do nothing;

-- ---- canteens / food_items: recreated from their latest copy
-- (20260814002200_vendor_dashboard.sql) -- these two predate is_canteen_owner
-- and hardcoded `owner_id = auth.uid()` directly, so they never picked up
-- stage 1's staff concept at all until now. ----

drop policy if exists "canteens_write" on public.canteens;
create policy "canteens_write" on public.canteens for all to authenticated
  using (
    public.current_user_is_admin()
    or (public.has_permission(auth.uid(),'food.menu.write') and public.is_canteen_owner(auth.uid(), id))
  )
  with check (
    public.current_user_is_admin()
    or (public.has_permission(auth.uid(),'food.menu.write') and public.is_canteen_owner(auth.uid(), id))
  );

drop policy if exists "canteens_vendor_read" on public.canteens;
create policy "canteens_vendor_read" on public.canteens for select to authenticated
  using (public.is_canteen_owner(auth.uid(), id));

drop policy if exists "food_items_write" on public.food_items;
create policy "food_items_write" on public.food_items for all to authenticated
  using (
    public.current_user_is_admin()
    or (public.has_permission(auth.uid(),'food.menu.write') and public.is_canteen_owner(auth.uid(), food_items.canteen_id))
  )
  with check (
    public.current_user_is_admin()
    or (public.has_permission(auth.uid(),'food.menu.write') and public.is_canteen_owner(auth.uid(), food_items.canteen_id))
  );

drop policy if exists "food_items_vendor_read" on public.food_items;
create policy "food_items_vendor_read" on public.food_items for select to authenticated
  using (public.is_canteen_owner(auth.uid(), food_items.canteen_id));

-- ---- request_refund / refunds_read: recreated from the latest copy
-- (printing_v2's refunds_read, which itself layered onto vendor_order_ops'
-- request_refund -- the print_job_id clause on refunds_read is untouched). ----

create or replace function public.request_refund(p_order_id uuid, p_amount numeric, p_reason text)
returns public.refunds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_order public.orders;
  v_payment public.payments;
  v_refund public.refunds;
  v_can_manage boolean;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found';
  end if;

  v_can_manage := public.current_user_is_admin()
    or (public.has_permission(v_user, 'food.refunds.create') and public.is_canteen_owner(v_user, v_order.canteen_id));
  if not v_can_manage then
    raise exception 'Not authorized to issue refunds for this order';
  end if;

  if not exists (
    select 1 from public.order_status_transitions
    where from_status = v_order.status and to_status = 'REFUND_PENDING'
  ) then
    raise exception 'ORDER_INVALID_TRANSITION: cannot refund an order in % status', v_order.status;
  end if;

  select * into v_payment from public.payments where order_id = p_order_id and status = 'captured' order by created_at desc limit 1;
  if not found then
    raise exception 'No captured payment found for this order';
  end if;

  if p_amount is null or p_amount <= 0 or p_amount > v_order.total then
    raise exception 'Invalid refund amount';
  end if;

  insert into public.refunds (payment_id, order_id, amount, reason, refund_type, initiated_by)
  values (v_payment.id, p_order_id, p_amount, p_reason, case when p_amount >= v_order.total then 'full' else 'partial' end, v_user)
  returning * into v_refund;

  update public.orders set status = 'REFUND_PENDING', payment_status = 'refund_pending' where id = p_order_id;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, 'REFUND_PENDING', v_user, p_reason);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value, reason)
  values (v_user, 'refund.request', 'order', p_order_id::text, jsonb_build_object('amount', p_amount), p_reason);

  return v_refund;
end;
$$;

drop policy if exists "refunds_read" on public.refunds;
create policy "refunds_read" on public.refunds for select to authenticated
  using (
    exists (select 1 from public.orders o where o.id = refunds.order_id and o.user_id = auth.uid())
    or exists (select 1 from public.print_jobs pj where pj.id = refunds.print_job_id and pj.user_id = auth.uid())
    or public.has_permission(auth.uid(),'finance.read')
    or public.current_user_is_admin()
    or exists (
      select 1 from public.orders o
      where o.id = refunds.order_id
        and public.has_permission(auth.uid(),'food.refunds.create') and public.is_canteen_owner(auth.uid(), o.canteen_id)
    )
  );

-- canteen_staff_accounts_read: recreated so any active manager (not just the
-- literal owner) can see the staff roster too -- consistent with "manager
-- can add/remove other managers".
drop policy if exists "canteen_staff_accounts_read" on public.canteen_staff_accounts;
create policy "canteen_staff_accounts_read" on public.canteen_staff_accounts for select to authenticated
  using (
    user_id = auth.uid()
    or public.current_user_is_admin()
    or public.is_canteen_owner(auth.uid(), canteen_staff_accounts.canteen_id)
  );

-- ============================================================
-- PART 2/3 -- STORE: same shape as canteen, built fresh since stage 1 never
-- touched stores. stores.owner_id already exists (20260815000100), so this
-- is a direct copy of the canteen_staff_accounts pattern.
-- ============================================================

insert into public.permissions (key, description) values
  ('store.staff.manage', 'Add/remove manager accounts for a campus store you own')
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where (r.key = 'vendor' and p.key = 'store.staff.manage')
   or (r.key = 'vendor_staff' and p.key in ('store.menu.write','store.orders.read','store.orders.update','store.staff.manage'))
on conflict do nothing;

create table if not exists public.store_staff_accounts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  active boolean not null default true,
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (store_id, user_id)
);

create index if not exists store_staff_accounts_store_idx on public.store_staff_accounts(store_id);
create index if not exists store_staff_accounts_user_idx on public.store_staff_accounts(user_id) where active;

alter table public.store_staff_accounts enable row level security;

-- is_store_owner has to be created before the read policy below (which
-- calls it) -- a `language sql` function's body is parsed against real
-- catalog objects at CREATE FUNCTION time, unlike plpgsql, so it in turn has
-- to come after store_staff_accounts itself exists (same ordering stage 1
-- used for is_canteen_owner/canteen_staff_accounts).
create or replace function public.is_store_owner(p_user uuid, p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_is_admin()
    or exists (select 1 from public.stores s where s.id = p_store_id and s.owner_id = p_user)
    or exists (
      select 1 from public.store_staff_accounts ssa
      where ssa.store_id = p_store_id and ssa.user_id = p_user and ssa.active
    );
$$;

revoke execute on function public.is_store_owner(uuid, uuid) from public, anon;

create policy "store_staff_accounts_read" on public.store_staff_accounts for select to authenticated
  using (
    user_id = auth.uid()
    or public.current_user_is_admin()
    or public.is_store_owner(auth.uid(), store_staff_accounts.store_id)
  );
-- No insert/update/delete policy for authenticated -- RPC-only below, same
-- as canteen_staff_accounts.

create or replace function public.add_store_staff_account(p_store_id uuid, p_email text)
returns public.store_staff_accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_target public.profiles;
  v_row public.store_staff_accounts;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if not (public.has_permission(v_user, 'store.staff.manage') and public.is_store_owner(v_user, p_store_id)) then
    raise exception 'Not authorized to manage staff for this store';
  end if;

  select * into v_target from public.profiles where lower(email) = lower(trim(p_email));
  if not found then
    raise exception 'No CampusOS account found with that email -- they need to sign up first';
  end if;
  if v_target.role not in ('student', 'vendor_staff') then
    raise exception 'That account already has a % role and can''t be added as store staff', v_target.role;
  end if;

  if v_target.role = 'student' then
    perform set_config('campusos.allow_role_change', 'true', true);
    update public.profiles set role = 'vendor_staff' where id = v_target.id;
    perform set_config('campusos.allow_role_change', 'false', true);

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_value, new_value, reason)
    values (v_user, 'role.change', 'profile', v_target.id::text,
            jsonb_build_object('role', 'student'), jsonb_build_object('role', 'vendor_staff'), 'added as store staff');
  end if;

  insert into public.store_staff_accounts (store_id, user_id, added_by, active)
  values (p_store_id, v_target.id, v_user, true)
  on conflict (store_id, user_id) do update set active = true
  returning * into v_row;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value)
  values (v_user, 'store_staff.add', 'store', p_store_id::text, jsonb_build_object('user_id', v_target.id, 'email', v_target.email));

  return v_row;
end;
$$;

create or replace function public.remove_store_staff_account(p_staff_account_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.store_staff_accounts;
  v_other_active integer;
begin
  if v_user is null then raise exception 'Sign in required'; end if;

  select * into v_row from public.store_staff_accounts where id = p_staff_account_id for update;
  if not found then raise exception 'Staff account not found'; end if;

  if not (public.has_permission(v_user, 'store.staff.manage') and public.is_store_owner(v_user, v_row.store_id)) then
    raise exception 'Not authorized to manage staff for this store';
  end if;

  update public.store_staff_accounts set active = false where id = p_staff_account_id;

  select count(*) into v_other_active from public.store_staff_accounts
    where user_id = v_row.user_id and active and id <> p_staff_account_id;
  -- A profile may also hold an active canteen or print staff row -- only
  -- revert to student if NONE of the three grant them vendor_staff anymore.
  if v_other_active = 0
     and not exists (select 1 from public.canteen_staff_accounts where user_id = v_row.user_id and active)
     and not exists (select 1 from public.print_staff_accounts where user_id = v_row.user_id and active)
  then
    perform set_config('campusos.allow_role_change', 'true', true);
    update public.profiles set role = 'student' where id = v_row.user_id and role = 'vendor_staff';
    perform set_config('campusos.allow_role_change', 'false', true);

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_value, new_value, reason)
    values (v_user, 'role.change', 'profile', v_row.user_id::text,
            jsonb_build_object('role', 'vendor_staff'), jsonb_build_object('role', 'student'), 'removed as store staff');
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_value)
  values (v_user, 'store_staff.remove', 'store', v_row.store_id::text, jsonb_build_object('user_id', v_row.user_id));
end;
$$;

grant execute on function public.add_store_staff_account(uuid, text) to authenticated;
grant execute on function public.remove_store_staff_account(uuid) to authenticated;

-- Widen stores/store_items/store_item_variants/store_orders* RLS from
-- owner_id-only to is_store_owner() (recreated from latest copies:
-- 20260815000100 for stores/store_items/store_orders*,
-- 20260815000900 for store_item_variants).

drop policy if exists "stores_write" on public.stores;
create policy "stores_write" on public.stores for all to authenticated
  using (public.current_user_is_admin() or (public.has_permission(auth.uid(), 'store.menu.write') and public.is_store_owner(auth.uid(), id)))
  with check (public.current_user_is_admin() or (public.has_permission(auth.uid(), 'store.menu.write') and public.is_store_owner(auth.uid(), id)));

drop policy if exists "store_items_write" on public.store_items;
create policy "store_items_write" on public.store_items for all to authenticated
  using (public.current_user_is_admin() or (public.has_permission(auth.uid(), 'store.menu.write') and public.is_store_owner(auth.uid(), store_items.store_id)))
  with check (public.current_user_is_admin() or (public.has_permission(auth.uid(), 'store.menu.write') and public.is_store_owner(auth.uid(), store_items.store_id)));

drop policy if exists "store_orders_read" on public.store_orders;
create policy "store_orders_read" on public.store_orders for select to authenticated
  using (
    user_id = auth.uid()
    or public.current_user_is_admin()
    or (public.has_permission(auth.uid(), 'store.orders.read') and public.is_store_owner(auth.uid(), store_orders.store_id))
  );

drop policy if exists "store_order_status_history_read" on public.store_order_status_history;
create policy "store_order_status_history_read" on public.store_order_status_history for select to authenticated
  using (exists (
    select 1 from public.store_orders so
    where so.id = store_order_status_history.order_id
      and (so.user_id = auth.uid() or public.current_user_is_admin() or public.is_store_owner(auth.uid(), so.store_id))
  ));

drop policy if exists "store_order_items_read" on public.store_order_items;
create policy "store_order_items_read" on public.store_order_items for select to authenticated
  using (exists (
    select 1 from public.store_orders so
    where so.id = store_order_items.order_id
      and (so.user_id = auth.uid() or public.current_user_is_admin() or public.is_store_owner(auth.uid(), so.store_id))
  ));

do $$ begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='store_item_variants') then
    execute 'drop policy if exists "store_item_variants_write" on public.store_item_variants';
    execute $p$create policy "store_item_variants_write" on public.store_item_variants for all to authenticated
      using (public.current_user_is_admin() or (public.has_permission(auth.uid(),'store.menu.write') and exists (select 1 from public.store_items si where si.id = store_item_variants.store_item_id and public.is_store_owner(auth.uid(), si.store_id))))
      with check (public.current_user_is_admin() or (public.has_permission(auth.uid(),'store.menu.write') and exists (select 1 from public.store_items si where si.id = store_item_variants.store_item_id and public.is_store_owner(auth.uid(), si.store_id))))$p$;
  end if;
end $$;

create or replace function public.transition_store_order_status(
  p_order_id uuid,
  p_to_status text,
  p_reason text default null
)
returns public.store_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_order public.store_orders;
  v_is_owner_vendor boolean;
  v_from_status text;
begin
  if v_user is null then raise exception 'Sign in required'; end if;

  select * into v_order from public.store_orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;

  v_is_owner_vendor := public.has_permission(v_user, 'store.orders.update') and public.is_store_owner(v_user, v_order.store_id);

  if v_order.user_id = v_user and p_to_status = 'CANCEL_REQUESTED' then
    null;
  elsif v_is_owner_vendor or public.current_user_is_admin() then
    null;
  else
    raise exception 'Not authorized to update this order';
  end if;

  if not exists (
    select 1 from public.store_order_status_transitions
    where from_status = v_order.status and to_status = p_to_status
  ) then
    raise exception 'Invalid transition % -> %', v_order.status, p_to_status;
  end if;

  v_from_status := v_order.status;

  update public.store_orders set status = p_to_status where id = p_order_id returning * into v_order;

  insert into public.store_order_status_history (order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_from_status, p_to_status, v_user, p_reason);

  perform public.create_notification(
    v_order.user_id, 'Store order updated',
    'Order ' || upper(left(v_order.id::text, 8)) || ' is now ' || replace(initcap(lower(p_to_status)), '_', ' '),
    'order', 'store_order', v_order.id::text
  );

  return v_order;
end;
$$;

-- ============================================================
-- PART 3/3 -- PRINT: no owner-scoped shop entity exists (print_jobs has no
-- owner FK; print_rate_card.owner_id is the closest thing to "who runs this
-- campus's print shop"). Scope staff by campus_id, not a shop id -- printing
-- is one operation per campus today, and campus_id survives a future
-- print_rate_card ownership change the same way canteen_id survives a
-- canteen ownership transfer.
--
-- print.manage itself is a flat, campus-agnostic permission already granted
-- to the whole 'vendor' role (20260814000200) -- that pre-existing breadth
-- is untouched here; this only ADDS a second, narrower path (an active
-- print_staff_accounts row for the caller's own campus) so a vendor_staff
-- account can be delegated print-queue access without being handed the
-- (broader, cross-campus) 'vendor' role outright.
-- ============================================================

create table if not exists public.print_staff_accounts (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid not null references public.campuses(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  active boolean not null default true,
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (campus_id, user_id)
);

create index if not exists print_staff_accounts_campus_idx on public.print_staff_accounts(campus_id);
create index if not exists print_staff_accounts_user_idx on public.print_staff_accounts(user_id) where active;

alter table public.print_staff_accounts enable row level security;

create policy "print_staff_accounts_read" on public.print_staff_accounts for select to authenticated
  using (
    user_id = auth.uid()
    or public.current_user_is_admin()
    or public.has_permission(auth.uid(), 'print.manage')
  );
-- No insert/update/delete policy for authenticated -- RPC-only below.

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
      select 1 from public.print_staff_accounts psa
      where psa.campus_id = p_campus_id and psa.user_id = p_user and psa.active
    );
$$;

revoke execute on function public.can_manage_print(uuid, uuid) from public, anon;

create or replace function public.add_print_staff_account(p_campus_id uuid, p_email text)
returns public.print_staff_accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_target public.profiles;
  v_row public.print_staff_accounts;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if not public.can_manage_print(v_user, p_campus_id) then
    raise exception 'Not authorized to manage print-shop staff for this campus';
  end if;

  select * into v_target from public.profiles where lower(email) = lower(trim(p_email));
  if not found then
    raise exception 'No CampusOS account found with that email -- they need to sign up first';
  end if;
  if v_target.role not in ('student', 'vendor_staff') then
    raise exception 'That account already has a % role and can''t be added as print-shop staff', v_target.role;
  end if;

  if v_target.role = 'student' then
    perform set_config('campusos.allow_role_change', 'true', true);
    update public.profiles set role = 'vendor_staff' where id = v_target.id;
    perform set_config('campusos.allow_role_change', 'false', true);

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_value, new_value, reason)
    values (v_user, 'role.change', 'profile', v_target.id::text,
            jsonb_build_object('role', 'student'), jsonb_build_object('role', 'vendor_staff'), 'added as print-shop staff');
  end if;

  insert into public.print_staff_accounts (campus_id, user_id, added_by, active)
  values (p_campus_id, v_target.id, v_user, true)
  on conflict (campus_id, user_id) do update set active = true
  returning * into v_row;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value)
  values (v_user, 'print_staff.add', 'campus', p_campus_id::text, jsonb_build_object('user_id', v_target.id, 'email', v_target.email));

  return v_row;
end;
$$;

create or replace function public.remove_print_staff_account(p_staff_account_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.print_staff_accounts;
  v_other_active integer;
begin
  if v_user is null then raise exception 'Sign in required'; end if;

  select * into v_row from public.print_staff_accounts where id = p_staff_account_id for update;
  if not found then raise exception 'Staff account not found'; end if;

  if not public.can_manage_print(v_user, v_row.campus_id) then
    raise exception 'Not authorized to manage print-shop staff for this campus';
  end if;

  update public.print_staff_accounts set active = false where id = p_staff_account_id;

  select count(*) into v_other_active from public.print_staff_accounts
    where user_id = v_row.user_id and active and id <> p_staff_account_id;
  if v_other_active = 0
     and not exists (select 1 from public.canteen_staff_accounts where user_id = v_row.user_id and active)
     and not exists (select 1 from public.store_staff_accounts where user_id = v_row.user_id and active)
  then
    perform set_config('campusos.allow_role_change', 'true', true);
    update public.profiles set role = 'student' where id = v_row.user_id and role = 'vendor_staff';
    perform set_config('campusos.allow_role_change', 'false', true);

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_value, new_value, reason)
    values (v_user, 'role.change', 'profile', v_row.user_id::text,
            jsonb_build_object('role', 'vendor_staff'), jsonb_build_object('role', 'student'), 'removed as print-shop staff');
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_value)
  values (v_user, 'print_staff.remove', 'campus', v_row.campus_id::text, jsonb_build_object('user_id', v_row.user_id));
end;
$$;

grant execute on function public.add_print_staff_account(uuid, text) to authenticated;
grant execute on function public.remove_print_staff_account(uuid) to authenticated;

-- Widen every print.manage-gated RLS policy/RPC to also accept
-- can_manage_print() (recreated from latest copies, all in
-- 20260817001200_printing_v2.sql except print_jobs_read/print_jobs_update_manage
-- which are latest in 20260814001100_rls_policies.sql).

drop policy if exists "print_jobs_read" on public.print_jobs;
create policy "print_jobs_read" on public.print_jobs for select to authenticated
  using (user_id = auth.uid() or public.can_manage_print(auth.uid(), print_jobs.campus_id) or public.current_user_is_admin());

drop policy if exists "print_jobs_update_manage" on public.print_jobs;
create policy "print_jobs_update_manage" on public.print_jobs for update to authenticated
  using (public.can_manage_print(auth.uid(), print_jobs.campus_id) or public.current_user_is_admin())
  with check (public.can_manage_print(auth.uid(), print_jobs.campus_id) or public.current_user_is_admin());

drop policy if exists "print_rate_card_write" on public.print_rate_card;
create policy "print_rate_card_write" on public.print_rate_card for all to authenticated
  using (public.current_user_is_admin() or (public.has_permission(auth.uid(),'print.manage') and owner_id = auth.uid()) or public.can_manage_print(auth.uid(), print_rate_card.campus_id))
  with check (public.current_user_is_admin() or (public.has_permission(auth.uid(),'print.manage') and owner_id = auth.uid()) or public.can_manage_print(auth.uid(), print_rate_card.campus_id));

drop policy if exists "print_binding_rates_write" on public.print_binding_rates;
create policy "print_binding_rates_write" on public.print_binding_rates for all to authenticated
  using (public.can_manage_print(auth.uid(), print_binding_rates.campus_id) or public.current_user_is_admin())
  with check (public.can_manage_print(auth.uid(), print_binding_rates.campus_id) or public.current_user_is_admin());

drop policy if exists "print_shop_status_write" on public.print_shop_status;
create policy "print_shop_status_write" on public.print_shop_status for all to authenticated
  using (public.can_manage_print(auth.uid(), print_shop_status.campus_id) or public.current_user_is_admin())
  with check (public.can_manage_print(auth.uid(), print_shop_status.campus_id) or public.current_user_is_admin());

create or replace function public.set_print_shop_status(p_status text, p_message text default null)
returns public.print_shop_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_campus uuid;
  v_row public.print_shop_status;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  select campus_id into v_campus from public.profiles where id = v_user;
  if v_campus is null then raise exception 'No campus on this account'; end if;
  if not public.can_manage_print(v_user, v_campus) then
    raise exception 'Not authorized to manage the print shop';
  end if;
  if p_status not in ('online','offline','maintenance') then
    raise exception 'Invalid status';
  end if;

  insert into public.print_shop_status (campus_id, status, message, updated_by)
  values (v_campus, p_status, nullif(trim(coalesce(p_message,'')), ''), v_user)
  on conflict (campus_id) do update
    set status = excluded.status, message = excluded.message, updated_by = excluded.updated_by, updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;
revoke all on function public.set_print_shop_status(text, text) from public, anon;
grant execute on function public.set_print_shop_status(text, text) to authenticated;

create or replace function public.transition_print_job(p_job_id uuid, p_new_status text, p_pickup_code text default null)
returns public.print_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_job public.print_jobs;
  v_legal boolean := false;
begin
  if v_user is null then raise exception 'Sign in required'; end if;

  select * into v_job from public.print_jobs where id = p_job_id for update;
  if not found then raise exception 'Print job not found'; end if;

  if not (public.can_manage_print(v_user, v_job.campus_id) or public.current_user_is_admin()) then
    raise exception 'Not authorized to manage print jobs';
  end if;

  v_legal := (
    (v_job.status = 'UPLOADED' and p_new_status = 'PROCESSING') or
    (v_job.status = 'PROCESSING' and p_new_status = 'QUEUED') or
    (v_job.status = 'QUEUED' and p_new_status = 'PRINTING') or
    (v_job.status = 'PRINTING' and p_new_status = 'READY') or
    (v_job.status = 'READY' and p_new_status = 'COLLECTED') or
    (v_job.status in ('UPLOADED','PROCESSING','QUEUED','PRINTING') and p_new_status = 'FAILED') or
    (v_job.status = 'FAILED' and p_new_status = 'QUEUED')  -- reprint, no charge
  );
  if not v_legal then
    raise exception 'Cannot move a % job to %', v_job.status, p_new_status;
  end if;

  if p_new_status = 'COLLECTED' then
    if p_pickup_code is null or trim(p_pickup_code) <> v_job.pickup_code then
      raise exception 'Pickup code does not match';
    end if;
    update public.print_jobs
      set status = 'COLLECTED', collected_at = now(), expires_at = now() + interval '1 day'
      where id = v_job.id
      returning * into v_job;
  elsif v_job.status = 'FAILED' and p_new_status = 'QUEUED' then
    update public.print_jobs
      set status = 'QUEUED', attempt_count = attempt_count + 1, expires_at = now() + interval '14 days'
      where id = v_job.id
      returning * into v_job;
  else
    update public.print_jobs set status = p_new_status where id = v_job.id returning * into v_job;
  end if;

  return v_job;
end;
$$;
revoke all on function public.transition_print_job(uuid, text, text) from public, anon;
grant execute on function public.transition_print_job(uuid, text, text) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'store_staff_accounts'
  ) then
    execute 'alter publication supabase_realtime add table public.store_staff_accounts';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'print_staff_accounts'
  ) then
    execute 'alter publication supabase_realtime add table public.print_staff_accounts';
  end if;
end $$;
