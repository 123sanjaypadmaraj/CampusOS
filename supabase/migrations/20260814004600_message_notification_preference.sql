-- =============================================================================
-- 0046: MESSAGE NOTIFICATION PREFERENCE
-- create_notification()'s v_col mapping (0010) has no 'message' branch --
-- without this, message notifications would silently bypass the preference
-- check entirely (same treatment as 'emergency'), which is wrong: unlike an
-- emergency alert, a DM notification has no safety reason to be
-- un-optional. Every other category (food/events/clubs/...) is individually
-- toggleable, so messages should be too.
-- =============================================================================

alter table public.notification_preferences add column if not exists messages boolean not null default true;

create or replace function public.create_notification(
  target_user uuid,
  notification_title text,
  notification_body text default null,
  notification_type text default 'official',
  action_type_value text default null,
  action_id_value text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  v_pref record;
  v_col text;
begin
  select * into v_pref from public.notification_preferences where user_id = target_user;
  v_col := case notification_type
    when 'order' then 'food' when 'event' then 'events' when 'club' then 'clubs'
    when 'community' then 'community' when 'service' then 'services' when 'print' then 'services'
    when 'marketplace' then 'marketplace' when 'official' then 'announcements'
    when 'message' then 'messages' else null end;

  -- Emergency notifications always go through regardless of preferences.
  if notification_type <> 'emergency' and v_pref is not null and v_col is not null then
    if v_col = 'food' and not v_pref.food then return null; end if;
    if v_col = 'events' and not v_pref.events then return null; end if;
    if v_col = 'clubs' and not v_pref.clubs then return null; end if;
    if v_col = 'community' and not v_pref.community then return null; end if;
    if v_col = 'services' and not v_pref.services then return null; end if;
    if v_col = 'marketplace' and not v_pref.marketplace then return null; end if;
    if v_col = 'announcements' and not v_pref.announcements then return null; end if;
    if v_col = 'messages' and not v_pref.messages then return null; end if;
  end if;

  insert into public.notifications (user_id, type, title, body, action_type, action_id, read)
  values (target_user, notification_type, notification_title, notification_body, action_type_value, action_id_value, false)
  returning id into new_id;

  return new_id;
end;
$$;
