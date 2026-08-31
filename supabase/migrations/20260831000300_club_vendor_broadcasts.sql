-- =============================================================================
-- BROADCASTS: club broadcasts widen beyond members-only, plus a brand-new
-- vendor (canteen / print shop) broadcast tool. Both funnel into the same
-- delivery surface: a real notification (as before) PLUS a genuine message
-- in the recipient's Messages tab, via a new one-way "channel" conversation
-- kind that only the club/vendor can post into (everyone else is read-only).
--
-- Two audience models, deliberately different (user decision):
--  - Clubs: leader picks "Club members" (unchanged default behaviour) or
--    "All campus students" for the notification fan-out. Either way the
--    channel thread itself stays scoped to actual club members -- adding
--    every student on campus to a chat thread for a club they're not in
--    would be permanent noise in their Messages tab for no benefit; the
--    wider audience still gets notified + the announcement is (and always
--    was) publicly readable on the club's own page.
--  - Vendors: no audience picker -- always "everyone who has a past order
--    from this canteen" (or a past print job on this campus, for the print
--    shop, which has no per-shop entity of its own -- see is_canteen_owner/
--    can_manage_print's own header comments for why). Append-only: once a
--    customer, always on the list, even if they never order again.
-- =============================================================================

-- =========================================================
-- 1. CONVERSATIONS: two new kinds, keyed to a club or a canteen (a null
-- canteen_id on a 'vendor_channel' row means "the print shop", scoped by
-- campus_id instead -- print has no per-shop entity, see PART 3/3 of
-- 20260819000300).
-- =========================================================

alter table public.conversations add column if not exists club_id uuid references public.clubs(id) on delete cascade;
alter table public.conversations add column if not exists canteen_id uuid references public.canteens(id) on delete cascade;

do $$ begin
  alter table public.conversations drop constraint if exists conversations_kind_check;
  alter table public.conversations add constraint conversations_kind_check
    check (kind in ('dm', 'listing', 'group', 'club_channel', 'vendor_channel'));
exception when others then null; end $$;

-- One channel per club / per canteen / per campus print shop. Belt-and-
-- braces against a rare concurrent-broadcast race creating a duplicate --
-- the get-or-create logic in the RPCs below is the normal path, this is
-- just the backstop.
create unique index if not exists conversations_club_channel_idx on public.conversations(club_id) where kind = 'club_channel';
create unique index if not exists conversations_vendor_canteen_channel_idx on public.conversations(canteen_id) where kind = 'vendor_channel' and canteen_id is not null;
create unique index if not exists conversations_vendor_campus_channel_idx on public.conversations(campus_id) where kind = 'vendor_channel' and canteen_id is null;

-- =========================================================
-- 2. send_message(): a channel is one-way -- only a participant whose role
-- is 'admin' (the club's leaders / the vendor's owner+managers, upserted by
-- the broadcast RPCs below) may post into one. Same signature as the
-- 20260830 copy, no drop needed.
-- =========================================================

create or replace function public.send_message(
  p_conversation_id uuid,
  p_body text,
  p_attachment_path text default null,
  p_reply_to_message_id uuid default null
)
returns public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_msg public.messages;
  v_body text := btrim(coalesce(p_body, ''));
  v_sender_name text;
  v_recipient record;
  v_other uuid;
  v_kind text;
  v_role text;
  v_reply_conv uuid;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if v_body = '' and p_attachment_path is null then raise exception 'Message cannot be empty'; end if;
  if length(v_body) > 4000 then raise exception 'Message is too long (4000 characters max)'; end if;

  if not public.is_conversation_participant(p_conversation_id, v_user) then
    raise exception 'Not a participant in this conversation';
  end if;

  select kind into v_kind from public.conversations where id = p_conversation_id;

  if v_kind in ('club_channel', 'vendor_channel') then
    select role into v_role from public.conversation_participants
      where conversation_id = p_conversation_id and user_id = v_user;
    if v_role is distinct from 'admin' then
      raise exception 'This is a broadcast channel -- only its owner can post here.';
    end if;
  end if;

  -- Blocking is inherently pairwise -- for a group/channel conversation,
  -- picking "the other participant" via limit 1 (as the dm/listing path
  -- does) would check an arbitrary member, so both skip the block check.
  if v_kind not in ('group', 'club_channel', 'vendor_channel') then
    select user_id into v_other from public.conversation_participants
    where conversation_id = p_conversation_id and user_id <> v_user limit 1;

    if v_other is not null and public.is_blocked_pair(v_user, v_other) then
      raise exception 'You can''t send messages in this conversation anymore.';
    end if;
  end if;

  if p_reply_to_message_id is not null then
    select conversation_id into v_reply_conv from public.messages where id = p_reply_to_message_id;
    if v_reply_conv is null or v_reply_conv <> p_conversation_id then
      raise exception 'Invalid message to reply to';
    end if;
  end if;

  if not public.check_rate_limit(v_user, 'messages', 60, 60) then
    raise exception 'You are sending messages too fast -- slow down and try again shortly';
  end if;

  insert into public.messages (conversation_id, sender_id, body, attachment_path, reply_to_message_id)
  values (p_conversation_id, v_user, v_body, p_attachment_path, p_reply_to_message_id)
  returning * into v_msg;

  update public.conversations set last_message_at = now() where id = p_conversation_id;

  select name into v_sender_name from public.profiles where id = v_user;

  for v_recipient in
    select user_id from public.conversation_participants
    where conversation_id = p_conversation_id and user_id <> v_user
  loop
    perform public.create_notification(
      v_recipient.user_id,
      coalesce(v_sender_name, 'Someone') || ' sent you a message',
      case when v_body = '' then '📷 Photo' else left(v_body, 140) end,
      'message', 'conversation', p_conversation_id::text
    );
  end loop;

  return v_msg;
end;
$$;

grant execute on function public.send_message(uuid, text, text, uuid) to authenticated;

-- =========================================================
-- 3. list_conversations(): + is_channel / can_post so the Messages UI can
-- render a channel with its own icon and hide the composer for non-admins.
-- Drop-then-recreate -- adding return columns changes the composite return
-- type, same pitfall the 20260830 migration already documented.
-- =========================================================

drop function if exists public.list_conversations();

create or replace function public.list_conversations()
returns table (
  conversation_id uuid, kind text, listing_id uuid, listing_title text,
  other_user_id uuid, other_user_name text, other_user_avatar text,
  other_user_availability_status text, other_user_availability_message text,
  is_group boolean, is_channel boolean, can_post boolean, title text, member_count bigint,
  last_message_sender_name text, last_message_body text, last_message_at timestamptz, unread_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id, c.kind, c.listing_id, ml.title,
    op.user_id, prof.name, prof.avatar_url,
    prof.availability_status, prof.availability_message,
    (c.kind = 'group'), (c.kind in ('club_channel', 'vendor_channel')),
    (c.kind not in ('club_channel', 'vendor_channel') or me.role = 'admin'),
    c.title,
    (select count(*) from public.conversation_participants cnt where cnt.conversation_id = c.id),
    -- A system row ("Alice created the group") already reads naturally on
    -- its own -- prefixing it with "Alice: " (the normal "who sent the
    -- last message" preview) would repeat the name right next to itself.
    case when lm.message_type = 'system' then null else lsender.name end,
    coalesce(lm.body, case when lm.attachment_path is not null then '📷 Photo' else null end), c.last_message_at,
    (select count(*) from public.messages m
       where m.conversation_id = c.id
         and m.sender_id <> auth.uid()
         and m.message_type = 'text'
         and m.created_at > coalesce(me.last_read_at, 'epoch'::timestamptz))
  from public.conversations c
  join public.conversation_participants me on me.conversation_id = c.id and me.user_id = auth.uid()
  left join lateral (
    select op2.user_id from public.conversation_participants op2
    where op2.conversation_id = c.id and op2.user_id <> auth.uid()
      and c.kind not in ('group', 'club_channel', 'vendor_channel')
    limit 1
  ) op on true
  left join public.profiles prof on prof.id = op.user_id
  left join public.marketplace_listings ml on ml.id = c.listing_id
  left join lateral (
    select body, attachment_path, sender_id, message_type from public.messages m2
    where m2.conversation_id = c.id order by m2.created_at desc limit 1
  ) lm on true
  left join public.profiles lsender on lsender.id = lm.sender_id
  where me.archived = false
  order by c.last_message_at desc;
$$;

grant execute on function public.list_conversations() to authenticated;

-- =========================================================
-- 4. publish_club_announcement(): + p_audience ('members' default, or
-- 'all_students'), + delivery into the club's channel thread. Changing the
-- argument count means CREATE OR REPLACE can't reuse the old function --
-- same pitfall the 20260830 migration documented for send_message().
-- =========================================================

drop function if exists public.publish_club_announcement(uuid, text, text, boolean);

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

-- =========================================================
-- 5. VENDOR BROADCASTS -- brand new; canteens/print shop had no
-- announcement tool at all before this. Public read (same convention as
-- club_announcements: anyone can see a canteen's "closing early today"),
-- no insert/update/delete policy -- RPC only.
-- =========================================================

create table if not exists public.vendor_broadcasts (
  id uuid primary key default gen_random_uuid(),
  canteen_id uuid references public.canteens(id) on delete cascade,
  campus_id uuid not null references public.campuses(id) on delete cascade,
  sender_id uuid references public.profiles(id) on delete set null,
  title text not null,
  body text,
  recipient_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists vendor_broadcasts_canteen_idx on public.vendor_broadcasts(canteen_id, created_at desc);
create index if not exists vendor_broadcasts_campus_idx on public.vendor_broadcasts(campus_id, created_at desc) where canteen_id is null;

alter table public.vendor_broadcasts enable row level security;

drop policy if exists "vendor_broadcasts_read" on public.vendor_broadcasts;
create policy "vendor_broadcasts_read" on public.vendor_broadcasts for select to authenticated using (true);

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
