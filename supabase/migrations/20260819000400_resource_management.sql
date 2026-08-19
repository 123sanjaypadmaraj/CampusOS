-- =============================================================================
-- RESOURCE CATALOG MANAGEMENT (module 08, booking). `resources`/`bookings`
-- (20260814000700_services_bookings.sql) and the `resources_write` RLS
-- policy (`for all` gated to `services.manage`/admin, 20260814001100) have
-- existed since the very first migration set, but nothing anywhere ever
-- INSERTs or UPDATEs a `resources` row -- confirmed by repo-wide grep before
-- writing this migration. Booking approval (`set_booking_status`,
-- `BookingApprovals` in FacilitiesDashboard.jsx) only ever acts on bookings
-- of resources that already exist. The bookable-room/equipment catalog
-- itself has been completely unmanageable in practice.
--
-- RPC-gated writes rather than relying on `resources_write` RLS directly,
-- matching this repo's own documented convention (see `campus_settings`'s
-- header: "RPC gate, don't rely on role-only RLS alone for anything worth
-- an audit trail") -- every privileged mutation elsewhere in this schema
-- goes through a SECURITY DEFINER RPC, not a raw client `.update()`/
-- `.insert()`, and a resource being taken offline/its hours changing is
-- worth an audit_logs row. `resources_write` itself is left in place
-- unchanged (a future direct-table need could still use it) but the admin
-- UI added alongside this migration only ever calls these RPCs.
-- =============================================================================

create or replace function public.admin_upsert_resource(
  p_id uuid,
  p_campus_id uuid,
  p_name text,
  p_resource_type text,
  p_location_id uuid,
  p_capacity integer,
  p_opening_hours jsonb,
  p_approval_required boolean,
  p_buffer_minutes integer,
  p_available boolean
)
returns public.resources
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.resources;
  v_old public.resources;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;
  if not (public.has_permission(v_user, 'services.manage') or public.current_user_is_admin()) then
    raise exception 'Not authorized to manage resources';
  end if;

  if p_name is null or trim(p_name) = '' then
    raise exception 'Resource name is required';
  end if;
  if p_capacity is not null and p_capacity < 0 then
    raise exception 'Capacity cannot be negative';
  end if;
  if p_buffer_minutes is not null and p_buffer_minutes < 0 then
    raise exception 'Buffer minutes cannot be negative';
  end if;

  if p_id is not null then
    select * into v_old from public.resources where id = p_id;
    if not found then
      raise exception 'Resource not found';
    end if;

    update public.resources set
      campus_id = coalesce(p_campus_id, campus_id),
      name = trim(p_name),
      resource_type = nullif(trim(coalesce(p_resource_type, '')), ''),
      location_id = p_location_id,
      capacity = p_capacity,
      opening_hours = coalesce(p_opening_hours, opening_hours),
      approval_required = coalesce(p_approval_required, approval_required),
      buffer_minutes = coalesce(p_buffer_minutes, buffer_minutes),
      available = coalesce(p_available, available)
    where id = p_id
    returning * into v_row;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_value, new_value)
    values (v_user, 'resource.update', 'resource', p_id::text, to_jsonb(v_old), to_jsonb(v_row));
  else
    if p_campus_id is null then
      raise exception 'Campus is required for a new resource';
    end if;

    insert into public.resources (
      campus_id, name, resource_type, location_id, capacity, opening_hours,
      approval_required, buffer_minutes, available
    )
    values (
      p_campus_id, trim(p_name), nullif(trim(coalesce(p_resource_type, '')), ''), p_location_id,
      p_capacity, coalesce(p_opening_hours, '{"open":"08:00","close":"20:00"}'::jsonb),
      coalesce(p_approval_required, false), coalesce(p_buffer_minutes, 0), coalesce(p_available, true)
    )
    returning * into v_row;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value)
    values (v_user, 'resource.create', 'resource', v_row.id::text, to_jsonb(v_row));
  end if;

  return v_row;
exception
  when unique_violation then
    raise exception 'A resource named "%" already exists on this campus', p_name;
end;
$$;

revoke all on function public.admin_upsert_resource(uuid, uuid, text, text, uuid, integer, jsonb, boolean, integer, boolean) from public, anon;
grant execute on function public.admin_upsert_resource(uuid, uuid, text, text, uuid, integer, jsonb, boolean, integer, boolean) to authenticated;

-- Soft-delete only (available = false), same reasoning as food_items/
-- store_items' own "never hard-delete, a booking history row FKs to this" --
-- bookings.resource_id has no ON DELETE clause, so a hard delete of a
-- resource with any booking history would fail its FK constraint anyway;
-- this makes the real, supported path explicit rather than letting the
-- vendor UI hit a raw FK violation.
create or replace function public.admin_delete_resource(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.resources;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;
  if not (public.has_permission(v_user, 'services.manage') or public.current_user_is_admin()) then
    raise exception 'Not authorized to manage resources';
  end if;

  select * into v_row from public.resources where id = p_id;
  if not found then
    raise exception 'Resource not found';
  end if;

  if exists (select 1 from public.bookings where resource_id = p_id and status in ('PENDING','APPROVED')) then
    raise exception 'This resource has upcoming or pending bookings -- mark it unavailable instead of deleting it, or resolve those bookings first';
  end if;

  if exists (select 1 from public.bookings where resource_id = p_id) then
    update public.resources set available = false where id = p_id;
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_value)
    values (v_user, 'resource.deactivate', 'resource', p_id::text, to_jsonb(v_row));
  else
    delete from public.resources where id = p_id;
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_value)
    values (v_user, 'resource.delete', 'resource', p_id::text, to_jsonb(v_row));
  end if;
end;
$$;

revoke all on function public.admin_delete_resource(uuid) from public, anon;
grant execute on function public.admin_delete_resource(uuid) to authenticated;

-- Admin/facilities read: resources_read (0011) only shows available=true
-- rows (correct for the student booking UI) -- a manager needs to see
-- unavailable ones too in order to re-enable them, same "read policy is
-- scoped for students, admin gets an additional permissive one" pattern
-- used throughout this schema (e.g. stores_admin_read, 20260818000800).
drop policy if exists "resources_admin_read" on public.resources;
create policy "resources_admin_read" on public.resources for select to authenticated
  using (public.has_permission(auth.uid(), 'services.manage') or public.current_user_is_admin());
