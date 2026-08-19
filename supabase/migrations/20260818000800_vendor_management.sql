-- =============================================================================
-- Vendor management (AdminCMS "administrative operating system" pass, part
-- 1/5): admin oversight of vendor ENTITIES (canteens/stores) -- create,
-- deactivate/reactivate, transfer ownership. This is deliberately NOT menu
-- editing (that stays vendor-only per 20260814002200's own note: "Canteen/
-- menu editing itself no longer has an admin-side UI -- it moved entirely
-- to each canteen's own vendor login") -- it's the one layer above that:
-- who owns a vendor account at all, and whether it's visible to students.
--
-- Real bug fix included: `stores`/`store_items` never got the admin-read
-- policy `canteens`/`food_items` already have (20260814001800). Their
-- public read policies are `using (active)`, so a deactivated store has
-- been completely invisible to admins too, not just students, since Campus
-- Store shipped (20260815000100) -- an admin couldn't even see it to
-- reactivate it. Same fix shape as that earlier migration: an additional
-- permissive read policy, existing policies untouched.
-- =============================================================================

drop policy if exists "stores_admin_read" on public.stores;
create policy "stores_admin_read" on public.stores for select to authenticated
  using (public.current_user_is_admin());

drop policy if exists "store_items_admin_read" on public.store_items;
create policy "store_items_admin_read" on public.store_items for select to authenticated
  using (public.current_user_is_admin());

-- =========================================================
-- RPC: admin_create_vendor -- new canteen or store, owned by an EXISTING
-- profile looked up by email (same "no self-serve signup path in this
-- app" convention as add_canteen_staff_account). Promotes a plain student
-- to 'vendor' inline (same set_config('campusos.allow_role_change', ...)
-- bypass technique, since admin_set_user_role() is now gated to
-- users.roles.manage/super_admin only as of 20260818000400 and a
-- college_admin creating a vendor correctly doesn't hold that) -- refuses
-- to touch an account that already holds a different real role.
-- =========================================================

create or replace function public.admin_create_vendor(
  p_type text,
  p_campus_id uuid,
  p_name text,
  p_owner_email text,
  p_subtitle text default null,
  p_category text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_target public.profiles;
  v_id uuid;
begin
  if not public.current_user_is_admin() then
    raise exception 'Not authorized to create vendors';
  end if;

  if p_type not in ('canteen', 'store') then
    raise exception 'Invalid vendor type %', p_type;
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Vendor name is required';
  end if;
  if p_campus_id is null then
    raise exception 'Campus is required';
  end if;

  select * into v_target from public.profiles where lower(email) = lower(trim(p_owner_email));
  if not found then
    raise exception 'No CampusOS account found with that email -- they need to sign up first';
  end if;
  if v_target.role not in ('student', 'vendor') then
    raise exception 'That account already has a % role and can''t be made a vendor owner', v_target.role;
  end if;

  if v_target.role = 'student' then
    perform set_config('campusos.allow_role_change', 'true', true);
    update public.profiles set role = 'vendor' where id = v_target.id;
    perform set_config('campusos.allow_role_change', 'false', true);

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_value, new_value, reason)
    values (v_user, 'role.change', 'profile', v_target.id::text,
            jsonb_build_object('role', 'student'), jsonb_build_object('role', 'vendor'), 'promoted to own a new vendor account');
  end if;

  if p_type = 'canteen' then
    insert into public.canteens (campus_id, owner_id, name, subtitle, active)
    values (p_campus_id, v_target.id, trim(p_name), nullif(trim(coalesce(p_subtitle, '')), ''), true)
    returning id into v_id;
  else
    insert into public.stores (campus_id, owner_id, name, category, subtitle, active)
    values (p_campus_id, v_target.id, trim(p_name), coalesce(nullif(trim(coalesce(p_category, '')), ''), 'General'),
            nullif(trim(coalesce(p_subtitle, '')), ''), true)
    returning id into v_id;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value)
  values (v_user, 'vendor.create', p_type, v_id::text,
          jsonb_build_object('name', p_name, 'owner_id', v_target.id, 'owner_email', v_target.email));

  return jsonb_build_object('id', v_id, 'type', p_type, 'owner_id', v_target.id);
end;
$$;

grant execute on function public.admin_create_vendor(text, uuid, text, text, text, text) to authenticated;

-- =========================================================
-- RPC: admin_set_vendor_active -- deactivate hides a vendor from students
-- (canteens_read/stores_read are both `using (active)`) without deleting
-- order history; reactivate reverses it.
-- =========================================================

create or replace function public.admin_set_vendor_active(p_type text, p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if not public.current_user_is_admin() then
    raise exception 'Not authorized to manage vendors';
  end if;
  if p_type not in ('canteen', 'store') then
    raise exception 'Invalid vendor type %', p_type;
  end if;

  if p_type = 'canteen' then
    update public.canteens set active = p_active where id = p_id;
  else
    update public.stores set active = p_active where id = p_id;
  end if;
  if not found then
    raise exception 'Vendor not found';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value)
  values (v_user, case when p_active then 'vendor.reactivate' else 'vendor.deactivate' end, p_type, p_id::text,
          jsonb_build_object('active', p_active));
end;
$$;

grant execute on function public.admin_set_vendor_active(text, uuid, boolean) to authenticated;

-- =========================================================
-- RPC: admin_transfer_vendor_ownership -- reassign an existing vendor to a
-- different existing profile (same email-lookup + role-promotion rule as
-- admin_create_vendor above). Deliberately does NOT revert the outgoing
-- owner's role back to 'student' -- unlike remove_canteen_staff_account's
-- "only active canteen -> revert" logic, one person can legitimately own
-- more than one vendor, and this RPC has no way to know that safely; an
-- admin can demote them separately via the Users tab if that's actually
-- warranted.
-- =========================================================

create or replace function public.admin_transfer_vendor_ownership(p_type text, p_id uuid, p_new_owner_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_target public.profiles;
begin
  if not public.current_user_is_admin() then
    raise exception 'Not authorized to manage vendors';
  end if;
  if p_type not in ('canteen', 'store') then
    raise exception 'Invalid vendor type %', p_type;
  end if;

  select * into v_target from public.profiles where lower(email) = lower(trim(p_new_owner_email));
  if not found then
    raise exception 'No CampusOS account found with that email -- they need to sign up first';
  end if;
  if v_target.role not in ('student', 'vendor') then
    raise exception 'That account already has a % role and can''t be made a vendor owner', v_target.role;
  end if;

  if v_target.role = 'student' then
    perform set_config('campusos.allow_role_change', 'true', true);
    update public.profiles set role = 'vendor' where id = v_target.id;
    perform set_config('campusos.allow_role_change', 'false', true);

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_value, new_value, reason)
    values (v_user, 'role.change', 'profile', v_target.id::text,
            jsonb_build_object('role', 'student'), jsonb_build_object('role', 'vendor'), 'promoted via vendor ownership transfer');
  end if;

  if p_type = 'canteen' then
    update public.canteens set owner_id = v_target.id where id = p_id;
  else
    update public.stores set owner_id = v_target.id where id = p_id;
  end if;
  if not found then
    raise exception 'Vendor not found';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value)
  values (v_user, 'vendor.transfer_ownership', p_type, p_id::text,
          jsonb_build_object('new_owner_id', v_target.id, 'new_owner_email', v_target.email));
end;
$$;

grant execute on function public.admin_transfer_vendor_ownership(text, uuid, text) to authenticated;
