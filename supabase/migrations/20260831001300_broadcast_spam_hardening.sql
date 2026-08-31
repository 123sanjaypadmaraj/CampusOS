-- =============================================================================
-- SECURITY FIX (found during the post-31-Aug pentest re-sweep of the 4 newly
-- shipped surfaces -- attendance, club/vendor broadcasts, paid events, native
-- push): publish_club_announcement()'s new p_audience='all_students' path and
-- the brand-new broadcast_vendor_message() (both 20260831000300) can each fan
-- one call out to every active student on a campus, or every past customer of
-- a canteen/the print shop, respectively -- and neither has a rate limit or a
-- title/body length cap, unlike every other user-facing fan-out RPC in this
-- schema (send_message: check_rate_limit(...,'messages',60,60); a message
-- body itself is capped at 4000 chars). Before this pass, publish_club_
-- announcement's blast radius was capped at a single club's membership; the
-- audience-widening + the new vendor tool are what turn a pre-existing
-- missing-limits gap into a real campus-wide spam/storage-exhaustion vector a
-- single compromised or malicious club-leader/canteen-owner/print-manager
-- account could pull the trigger on, repeatedly, with an unbounded-length
-- title/body multiplied across every recipient's notifications row.
--
-- Fix: same shape as every other rate-limited write path in this schema --
-- check_rate_limit() gates call frequency (20/hour, matching register_for_
-- event's own cap), and an explicit length check on p_title/p_body rejects
-- (rather than silently truncates, which would leave an oversized value on
-- the audit_logs/vendor_broadcasts/club_announcements row even though the
-- delivered message was cut short) an oversized broadcast before any row is
-- written. Both checks land in the same slot right after the existing
-- authorization check, before either function does any work. Everything
-- else in both functions -- signature, authorization rule, delivery
-- mechanics -- is byte-for-byte unchanged from 20260831000300.
-- =============================================================================

create or replace function public.publish_club_announcement(
  p_club_id uuid, p_title text, p_body text default null, p_pinned boolean default false,
  p_audience text default 'members'
)
returns public.club_announcements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_club public.clubs;
  v_ann public.club_announcements;
  v_member record;
  v_channel uuid;
  v_msg_body text;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if not (public.is_club_leader(v_user, p_club_id) or public.has_permission(v_user,'clubs.manage') or public.current_user_is_admin()) then
    raise exception 'Not authorized to post announcements for this club';
  end if;
  if coalesce(trim(p_title),'') = '' then raise exception 'Title is required'; end if;
  if p_audience not in ('members', 'all_students') then raise exception 'Invalid audience'; end if;
  if length(p_title) > 200 then raise exception 'Title is too long (200 characters max)'; end if;
  if p_body is not null and length(p_body) > 4000 then raise exception 'Body is too long (4000 characters max)'; end if;
  if not public.check_rate_limit(v_user, 'club_broadcast', 20, 3600) then
    raise exception 'RATE_LIMITED: too many broadcasts, slow down and try again shortly';
  end if;

  select * into v_club from public.clubs where id = p_club_id;
  if not found then raise exception 'Club not found'; end if;

  insert into public.club_announcements (club_id, title, body, pinned, created_by)
  values (p_club_id, trim(p_title), p_body, coalesce(p_pinned, false), v_user)
  returning * into v_ann;

  -- Deliver into the club's broadcast channel (Messages tab): get or create
  -- it, then lazily sync membership from the current roster. This only
  -- needs to be right at broadcast time -- the channel is read-only for
  -- everyone but leaders anyway, so drift between broadcasts (a member who
  -- joined/left since the last one) has no visible effect in between.
  select id into v_channel from public.conversations where kind = 'club_channel' and club_id = p_club_id;
  if v_channel is null then
    insert into public.conversations (kind, club_id, title, campus_id, created_by)
    values ('club_channel', p_club_id, v_club.name, v_club.campus_id, v_user)
    returning id into v_channel;
  end if;

  insert into public.conversation_participants (conversation_id, user_id, role)
  select v_channel, cm.user_id, case when public.is_club_leader(cm.user_id, p_club_id) then 'admin' else 'member' end
  from public.club_members cm where cm.club_id = p_club_id
  on conflict (conversation_id, user_id) do update set role = excluded.role;

  delete from public.conversation_participants cp
  where cp.conversation_id = v_channel
    and not exists (select 1 from public.club_members cm where cm.club_id = p_club_id and cm.user_id = cp.user_id);

  -- The caller might be posting via clubs.manage/admin rather than a literal
  -- club_members row (e.g. a college admin standing in for a club) -- make
  -- sure they can still post, even though the delete above wouldn't have
  -- kept them (inserted after, so it survives).
  insert into public.conversation_participants (conversation_id, user_id, role)
  values (v_channel, v_user, 'admin')
  on conflict (conversation_id, user_id) do update set role = 'admin';

  v_msg_body := trim(p_title) || coalesce(chr(10) || chr(10) || nullif(p_body, ''), '');
  insert into public.messages (conversation_id, sender_id, body)
  values (v_channel, v_user, left(v_msg_body, 4000));
  update public.conversations set last_message_at = now() where id = v_channel;

  if p_audience = 'all_students' then
    for v_member in
      select id as user_id from public.profiles
      where campus_id = v_club.campus_id and role = 'student' and status = 'active'
    loop
      perform public.create_notification(v_member.user_id, v_club.name || ': ' || v_ann.title, p_body, 'club', 'club', p_club_id::text);
    end loop;
  else
    for v_member in select user_id from public.club_members where club_id = p_club_id
    loop
      perform public.create_notification(v_member.user_id, v_club.name || ': ' || v_ann.title, p_body, 'club', 'club', p_club_id::text);
    end loop;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value)
  values (v_user, 'club_announcement.publish', 'club_announcement', v_ann.id::text, jsonb_build_object('title', p_title, 'audience', p_audience));

  return v_ann;
end;
$$;

grant execute on function public.publish_club_announcement(uuid, text, text, boolean, text) to authenticated;

create or replace function public.broadcast_vendor_message(p_canteen_id uuid, p_title text, p_body text default null)
returns public.vendor_broadcasts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_campus uuid;
  v_label text;
  v_channel uuid;
  v_broadcast public.vendor_broadcasts;
  v_msg_body text;
  v_recipient record;
  v_count integer := 0;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if coalesce(trim(p_title),'') = '' then raise exception 'Title is required'; end if;
  if length(p_title) > 200 then raise exception 'Title is too long (200 characters max)'; end if;
  if p_body is not null and length(p_body) > 4000 then raise exception 'Body is too long (4000 characters max)'; end if;
  if not public.check_rate_limit(v_user, 'vendor_broadcast', 20, 3600) then
    raise exception 'RATE_LIMITED: too many broadcasts, slow down and try again shortly';
  end if;

  if p_canteen_id is not null then
    if not public.is_canteen_owner(v_user, p_canteen_id) then
      raise exception 'Not authorized to broadcast for this canteen';
    end if;
    select campus_id, name into v_campus, v_label from public.canteens where id = p_canteen_id;
    if v_campus is null then raise exception 'Canteen not found'; end if;
  else
    select campus_id into v_campus from public.profiles where id = v_user;
    if v_campus is null or not public.can_manage_print(v_user, v_campus) then
      raise exception 'Not authorized to broadcast for the print shop';
    end if;
    v_label := 'Print Shop';
  end if;

  insert into public.vendor_broadcasts (canteen_id, campus_id, sender_id, title, body)
  values (p_canteen_id, v_campus, v_user, trim(p_title), p_body)
  returning * into v_broadcast;

  if p_canteen_id is not null then
    select id into v_channel from public.conversations where kind = 'vendor_channel' and canteen_id = p_canteen_id;
  else
    select id into v_channel from public.conversations where kind = 'vendor_channel' and canteen_id is null and campus_id = v_campus;
  end if;

  if v_channel is null then
    insert into public.conversations (kind, canteen_id, title, campus_id, created_by)
    values ('vendor_channel', p_canteen_id, v_label, v_campus, v_user)
    returning id into v_channel;
  end if;

  insert into public.conversation_participants (conversation_id, user_id, role)
  values (v_channel, v_user, 'admin')
  on conflict (conversation_id, user_id) do update set role = 'admin';

  -- Audience: everyone with at least one past order from this canteen (or
  -- past print job on this campus, for the print shop). Append-only -- a
  -- customer stays on the list even if they never order again, same
  -- "once subscribed, stays subscribed" model as a real mailing list.
  if p_canteen_id is not null then
    insert into public.conversation_participants (conversation_id, user_id, role)
    select distinct v_channel, o.user_id, 'member' from public.orders o
    where o.canteen_id = p_canteen_id
    on conflict (conversation_id, user_id) do nothing;
  else
    insert into public.conversation_participants (conversation_id, user_id, role)
    select distinct v_channel, pj.user_id, 'member' from public.print_jobs pj
    where pj.campus_id = v_campus
    on conflict (conversation_id, user_id) do nothing;
  end if;

  v_msg_body := trim(p_title) || coalesce(chr(10) || chr(10) || nullif(p_body, ''), '');
  insert into public.messages (conversation_id, sender_id, body)
  values (v_channel, v_user, left(v_msg_body, 4000));
  update public.conversations set last_message_at = now() where id = v_channel;

  for v_recipient in
    select user_id from public.conversation_participants where conversation_id = v_channel and user_id <> v_user
  loop
    perform public.create_notification(
      v_recipient.user_id, v_label || ': ' || trim(p_title), p_body,
      case when p_canteen_id is not null then 'order' else 'print' end,
      'vendor_broadcast', v_broadcast.id::text
    );
    v_count := v_count + 1;
  end loop;

  update public.vendor_broadcasts set recipient_count = v_count where id = v_broadcast.id;
  v_broadcast.recipient_count := v_count;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value)
  values (v_user, 'vendor_broadcast.publish', 'vendor_broadcast', v_broadcast.id::text, jsonb_build_object('title', p_title, 'canteen_id', p_canteen_id));

  return v_broadcast;
end;
$$;

grant execute on function public.broadcast_vendor_message(uuid, text, text) to authenticated;
