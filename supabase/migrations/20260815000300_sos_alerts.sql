-- =============================================================================
-- 0055: SOS / EMERGENCY -- real dispatch, replacing pure UI theater.
-- =============================================================================
-- Before this, "Hold to activate SOS" and the three quick-action buttons
-- (Security/Medical/Campus help) each just called notify("... simulated")
-- and closed the modal -- nothing was written anywhere, no one was ever
-- actually alerted. Worse, the modal itself was unreachable: the Emergency
-- service card's onClick was `notify("Open Emergency from the service
-- card")`, a stub that doesn't even open the modal (fixed on the frontend
-- alongside this migration -- see src/App.jsx's Services component, which
-- also never destructured the `openModal` prop it was already being
-- passed). This migration is what makes an SOS trigger a real event: a
-- persisted alert, real-time visibility for facilities staff/admins, and
-- an audited acknowledge/resolve lifecycle.

create table if not exists public.sos_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  campus_id uuid references public.campuses(id) on delete cascade,
  alert_type text not null default 'general'
    check (alert_type in ('general', 'security', 'medical', 'help')),
  status text not null default 'active'
    check (status in ('active', 'acknowledged', 'resolved', 'cancelled')),
  latitude numeric,
  longitude numeric,
  location_accuracy_m numeric,
  contact_name text,
  contact_phone text,
  notes text,
  acknowledged_by uuid references public.profiles(id) on delete set null,
  acknowledged_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  resolution_notes text,
  created_at timestamptz not null default now()
);

create index if not exists sos_alerts_status_idx on public.sos_alerts(status, created_at desc);
create index if not exists sos_alerts_campus_idx on public.sos_alerts(campus_id, status);
create index if not exists sos_alerts_user_idx on public.sos_alerts(user_id);

alter table public.sos_alerts enable row level security;

-- Every write goes through the RPCs below (SECURITY DEFINER, bypass RLS by
-- design -- same convention as user_activity_daily/touch_activity()). Only
-- SELECT gets a direct policy: the reporter can see their own alerts, and
-- responders (sos.respond permission, or admin) can see every alert for
-- their campus.
create policy "sos_alerts_read" on public.sos_alerts for select to authenticated
  using (user_id = auth.uid() or public.has_permission(auth.uid(), 'sos.respond') or public.current_user_is_admin());

insert into public.permissions (key, description) values
  ('sos.respond', 'See and respond to SOS/emergency alerts')
on conflict (key) do nothing;

with rp as (
  select r.id as role_id, p.id as permission_id
  from public.roles r
  join public.permissions p on p.key = 'sos.respond'
  where r.key in ('facilities_staff', 'college_admin', 'super_admin')
)
insert into public.role_permissions (role_id, permission_id)
select role_id, permission_id from rp
on conflict do nothing;

-- =========================================================
-- RPC: trigger_sos_alert -- the only way an alert gets created. Snapshots
-- the reporter's name/phone (so responders don't need separate profile
-- access), fans out a real, preference-proof notification ('emergency'
-- type bypasses notification_preferences entirely, same as
-- publish_announcement()'s admin-broadcast Emergency category) to every
-- facilities_staff/admin on the reporter's campus, and audit-logs who
-- triggered it. Rate-limited like every other creation RPC in this schema,
-- but deliberately looser on the ceiling (an SOS button is not something
-- to silently rate-limit into failure) -- 5/hour still stops a scripted
-- spam attack without getting in a real caller's way.
-- =========================================================

create or replace function public.trigger_sos_alert(
  p_alert_type text default 'general',
  p_latitude numeric default null,
  p_longitude numeric default null,
  p_location_accuracy_m numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_profile public.profiles;
  v_alert public.sos_alerts;
  v_recipient record;
  v_notified integer := 0;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;
  if p_alert_type not in ('general', 'security', 'medical', 'help') then
    raise exception 'Invalid alert type %', p_alert_type;
  end if;
  if not public.check_rate_limit(v_user, 'sos_alerts', 5, 3600) then
    raise exception 'RATE_LIMITED: too many SOS alerts, slow down -- if this is a real emergency, call campus security directly';
  end if;

  select * into v_profile from public.profiles where id = v_user;

  insert into public.sos_alerts (
    user_id, campus_id, alert_type, latitude, longitude, location_accuracy_m,
    contact_name, contact_phone
  ) values (
    v_user, v_profile.campus_id, p_alert_type, p_latitude, p_longitude, p_location_accuracy_m,
    v_profile.name, v_profile.phone
  ) returning * into v_alert;

  for v_recipient in
    select ur.user_id as id
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.profiles p on p.id = ur.user_id
    where r.key in ('facilities_staff', 'college_admin', 'super_admin')
      and (v_profile.campus_id is null or p.campus_id = v_profile.campus_id)
  loop
    perform public.create_notification(
      v_recipient.id,
      case p_alert_type
        when 'security' then 'SOS: Security needed'
        when 'medical' then 'SOS: Medical emergency'
        when 'help' then 'SOS: Campus help requested'
        else 'SOS alert'
      end,
      coalesce(v_profile.name, 'A student') || ' triggered an SOS alert' || (case when p_latitude is not null then ' with location' else '' end) || '.',
      'emergency',
      'sos_alert', v_alert.id::text
    );
    v_notified := v_notified + 1;
  end loop;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value)
  values (v_user, 'sos.trigger', 'sos_alert', v_alert.id::text, jsonb_build_object('alert_type', p_alert_type, 'responders_notified', v_notified));

  return jsonb_build_object(
    'id', v_alert.id, 'status', v_alert.status, 'created_at', v_alert.created_at,
    'responders_notified', v_notified
  );
end;
$$;

grant execute on function public.trigger_sos_alert(text, numeric, numeric, numeric) to authenticated;

-- =========================================================
-- RPC: acknowledge_sos_alert / resolve_sos_alert -- the responder side.
-- =========================================================

create or replace function public.acknowledge_sos_alert(p_alert_id uuid)
returns public.sos_alerts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_alert public.sos_alerts;
begin
  if not (public.has_permission(v_user, 'sos.respond') or public.current_user_is_admin()) then
    raise exception 'Not authorized to respond to SOS alerts';
  end if;

  update public.sos_alerts
    set status = 'acknowledged', acknowledged_by = v_user, acknowledged_at = now()
    where id = p_alert_id and status = 'active'
    returning * into v_alert;

  if not found then
    raise exception 'Alert not found or already acknowledged/resolved';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id)
  values (v_user, 'sos.acknowledge', 'sos_alert', p_alert_id::text);

  return v_alert;
end;
$$;

grant execute on function public.acknowledge_sos_alert(uuid) to authenticated;

create or replace function public.resolve_sos_alert(p_alert_id uuid, p_notes text default null)
returns public.sos_alerts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_alert public.sos_alerts;
begin
  if not (public.has_permission(v_user, 'sos.respond') or public.current_user_is_admin()) then
    raise exception 'Not authorized to respond to SOS alerts';
  end if;

  update public.sos_alerts
    set status = 'resolved', resolved_by = v_user, resolved_at = now(),
        resolution_notes = p_notes
    where id = p_alert_id and status in ('active', 'acknowledged')
    returning * into v_alert;

  if not found then
    raise exception 'Alert not found or already resolved/cancelled';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, reason)
  values (v_user, 'sos.resolve', 'sos_alert', p_alert_id::text, p_notes);

  return v_alert;
end;
$$;

grant execute on function public.resolve_sos_alert(uuid, text) to authenticated;

-- RPC: cancel_my_sos_alert -- lets the reporter call off their own alert
-- (accidental press / false alarm), but only before anyone has actually
-- acknowledged it -- once a responder is on it, only the responder can
-- close it out (resolve_sos_alert), so a coerced "cancel" can't silently
-- wave off a genuine in-progress response.
create or replace function public.cancel_my_sos_alert(p_alert_id uuid)
returns public.sos_alerts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_alert public.sos_alerts;
begin
  update public.sos_alerts
    set status = 'cancelled'
    where id = p_alert_id and user_id = v_user and status = 'active'
    returning * into v_alert;

  if not found then
    raise exception 'Alert not found, not yours, or already acknowledged -- ask a responder to close it out instead';
  end if;

  return v_alert;
end;
$$;

grant execute on function public.cancel_my_sos_alert(uuid) to authenticated;

-- =========================================================
-- Responder queue: every non-terminal alert for the caller's campus (or
-- every campus for a super_admin), most recent first. A plain RLS-scoped
-- SELECT would also work here, but this keeps the "who reported it" name
-- resolution server-side rather than requiring a second profiles lookup
-- the caller might not have RLS visibility into.
-- =========================================================

create or replace function public.list_active_sos_alerts()
returns table (
  id uuid, user_id uuid, campus_id uuid, alert_type text, status text,
  latitude numeric, longitude numeric, location_accuracy_m numeric,
  contact_name text, contact_phone text, created_at timestamptz,
  acknowledged_by uuid, acknowledged_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_campus uuid;
begin
  if not (public.has_permission(v_user, 'sos.respond') or public.current_user_is_admin()) then
    raise exception 'Not authorized to view SOS alerts';
  end if;

  select p.campus_id into v_campus from public.profiles p where p.id = v_user;

  return query
    select a.id, a.user_id, a.campus_id, a.alert_type, a.status,
      a.latitude, a.longitude, a.location_accuracy_m,
      a.contact_name, a.contact_phone, a.created_at,
      a.acknowledged_by, a.acknowledged_at
    from public.sos_alerts a
    where a.status in ('active', 'acknowledged')
      and (public.has_role(v_user, 'super_admin') or a.campus_id = v_campus or a.campus_id is null)
    order by a.status asc, a.created_at asc;
end;
$$;

grant execute on function public.list_active_sos_alerts() to authenticated;

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sos_alerts'
  ) then
    alter publication supabase_realtime add table public.sos_alerts;
  end if;
end $$;
