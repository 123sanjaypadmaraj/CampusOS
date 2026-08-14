-- =============================================================================
-- 0029: ADMIN USER MANAGEMENT -- suspend/reactivate accounts (doc §54-58).
-- =============================================================================
-- admin_set_user_role() (0002) already covers role changes; there was no
-- equivalent for profiles.status even though the column, its CHECK
-- constraint ('active'/'suspended'/'deleted'), and the 'users.suspend'
-- permission all already existed. profiles_update_self (0011) only allows
-- a user to update their OWN row, so an admin has no path at all to suspend
-- someone else's account without this.

create or replace function public.admin_set_user_status(
  p_target_user uuid,
  p_status text,
  p_reason text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
begin
  if not (public.has_permission(auth.uid(), 'users.suspend') or public.current_user_is_admin()) then
    raise exception 'Not authorized to change account status';
  end if;

  if p_status not in ('active', 'suspended') then
    raise exception 'Invalid status %  -- only active/suspended are settable here', p_status;
  end if;

  select * into v_profile from public.profiles where id = p_target_user for update;
  if not found then
    raise exception 'User not found';
  end if;

  if v_profile.role in ('college_admin', 'super_admin') and p_target_user <> auth.uid() then
    raise exception 'Cannot suspend another admin account through this action';
  end if;

  update public.profiles
    set status = p_status,
        suspended_reason = case when p_status = 'suspended' then p_reason else null end
    where id = p_target_user
    returning * into v_profile;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_value, new_value, reason)
  values (auth.uid(), 'user.status.change', 'profile', p_target_user::text,
          jsonb_build_object('status', case when p_status = 'suspended' then 'active' else 'suspended' end),
          jsonb_build_object('status', p_status), p_reason);

  return v_profile;
end;
$$;

grant execute on function public.admin_set_user_status(uuid, text, text) to authenticated;
