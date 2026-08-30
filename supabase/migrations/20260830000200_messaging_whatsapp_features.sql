-- =============================================================================
-- MESSAGING: WhatsApp-parity pass -- group chat, read receipts, reactions,
-- replies, starred messages. Base 1:1/listing messaging shipped in
-- 20260814004200_messaging.sql (+ 20260815001500, 20260817001000). That
-- migration's header explicitly scoped group chat out ("No group chat --
-- each conversation has exactly two participants"); this migration lifts
-- that limit without breaking anything that depends on the 2-party shape
-- (conversations.kind grows a third value, existing dm/listing rows are
-- untouched).
-- =============================================================================

-- =========================================================
-- 1. GROUP CHAT -- schema
-- =========================================================

alter table public.conversations add column if not exists title text;
alter table public.conversations add column if not exists created_by uuid references public.profiles(id) on delete set null;

do $$ begin
  alter table public.conversations drop constraint if exists conversations_kind_check;
  alter table public.conversations add constraint conversations_kind_check
    check (kind in ('dm', 'listing', 'group'));
exception when others then null; end $$;

alter table public.conversation_participants add column if not exists role text not null default 'member';
do $$ begin
  alter table public.conversation_participants drop constraint if exists conversation_participants_role_check;
  alter table public.conversation_participants add constraint conversation_participants_role_check
    check (role in ('member', 'admin'));
exception when others then null; end $$;

-- message_type distinguishes a real chat message from an inline group-
-- activity log entry ("Alice added Bob", "Group renamed to ...") -- same
-- idea as WhatsApp's centered gray system lines. System rows are inserted
-- directly by the group-management RPCs below, never through send_message().
alter table public.messages add column if not exists message_type text not null default 'text';
do $$ begin
  alter table public.messages drop constraint if exists messages_message_type_check;
  alter table public.messages add constraint messages_message_type_check
    check (message_type in ('text', 'system'));
exception when others then null; end $$;

alter table public.messages add column if not exists reply_to_message_id uuid references public.messages(id) on delete set null;

-- =========================================================
-- 2. REACTIONS
-- =========================================================

create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  emoji text not null check (emoji in ('👍', '❤️', '😂', '😮', '😢', '🙏')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists message_reactions_message_idx on public.message_reactions(message_id);
create index if not exists message_reactions_conversation_idx on public.message_reactions(conversation_id);

alter table public.message_reactions enable row level security;

-- Reads only, scoped to conversation participants -- writes go through
-- toggle_message_reaction() below, same "no insert/update policy for
-- authenticated" convention as conversations/messages themselves.
drop policy if exists "message_reactions_read_participant" on public.message_reactions;
create policy "message_reactions_read_participant" on public.message_reactions for select to authenticated
  using (public.is_conversation_participant(conversation_id, auth.uid()));

-- =========================================================
-- 3. STARRED MESSAGES
-- Plain self-service table, same pattern as blocked_users (0011/0043): the
-- table's own RLS is enough, no RPC needed. The `with check` also requires
-- the caller to actually be a participant of the starred message's
-- conversation, so you can't star a message you can't otherwise read.
-- =========================================================

create table if not exists public.starred_messages (
  user_id uuid not null references public.profiles(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);

alter table public.starred_messages enable row level security;

drop policy if exists "starred_messages_own" on public.starred_messages;
create policy "starred_messages_own" on public.starred_messages for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and public.is_conversation_participant(
      (select conversation_id from public.messages where id = message_id),
      auth.uid()
    )
  );

-- =========================================================
-- 4. send_message(): + reply-to, + skip the block check for groups
-- Drop-then-recreate because adding a parameter changes the signature --
-- same pitfall already documented in 20260815001500.
-- =========================================================

drop function if exists public.send_message(uuid, text, text);

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
  v_reply_conv uuid;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if v_body = '' and p_attachment_path is null then raise exception 'Message cannot be empty'; end if;
  if length(v_body) > 4000 then raise exception 'Message is too long (4000 characters max)'; end if;

  if not public.is_conversation_participant(p_conversation_id, v_user) then
    raise exception 'Not a participant in this conversation';
  end if;

  select kind into v_kind from public.conversations where id = p_conversation_id;

  -- Blocking is inherently pairwise -- for a group conversation, picking
  -- "the other participant" via limit 1 (as the dm/listing path does) would
  -- check an arbitrary member and either wrongly block a group send or
  -- wrongly let one through, so groups skip the block check entirely.
  if v_kind <> 'group' then
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
-- 5. REACTIONS RPC
-- =========================================================

create or replace function public.toggle_message_reaction(p_message_id uuid, p_emoji text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_conv uuid;
  v_existing text;
begin
  if v_user is null then raise exception 'Sign in required'; end if;

  select conversation_id into v_conv from public.messages where id = p_message_id;
  if v_conv is null then raise exception 'Message not found'; end if;
  if not public.is_conversation_participant(v_conv, v_user) then
    raise exception 'Not a participant in this conversation';
  end if;

  select emoji into v_existing from public.message_reactions
    where message_id = p_message_id and user_id = v_user;

  if v_existing is null then
    insert into public.message_reactions (message_id, user_id, conversation_id, emoji)
    values (p_message_id, v_user, v_conv, p_emoji);
  elsif v_existing = p_emoji then
    delete from public.message_reactions where message_id = p_message_id and user_id = v_user;
  else
    update public.message_reactions set emoji = p_emoji, created_at = now()
      where message_id = p_message_id and user_id = v_user;
  end if;
end;
$$;

grant execute on function public.toggle_message_reaction(uuid, text) to authenticated;

-- =========================================================
-- 6. GROUP MANAGEMENT RPCs
-- =========================================================

-- Shared by every group RPC below: a plain system-message row plus the
-- usual create_notification() fan-out, so group activity shows up inline
-- in the thread (like WhatsApp's gray system lines) *and* as a real
-- notification, same as every other write path in this file.
create or replace function public.post_group_system_message(p_conversation_id uuid, p_body text, p_notify_users uuid[] default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
begin
  insert into public.messages (conversation_id, sender_id, body, message_type)
  values (p_conversation_id, auth.uid(), left(p_body, 4000), 'system');

  update public.conversations set last_message_at = now() where id = p_conversation_id;

  if p_notify_users is not null then
    foreach v_uid in array p_notify_users loop
      perform public.create_notification(v_uid, p_body, null, 'message', 'conversation', p_conversation_id::text);
    end loop;
  end if;
end;
$$;

-- Internal helper only -- takes no caller-identity/participant check of its
-- own, so it must never be reachable directly by an authenticated user
-- (only via `perform` from the trusted group RPCs below, which run as the
-- function owner). Functions get an implicit EXECUTE grant to PUBLIC at
-- creation; revoke it so this one isn't callable straight from the client,
-- same "revoke from public" convention delete_message() uses.
revoke execute on function public.post_group_system_message(uuid, text, uuid[]) from public;

create or replace function public.create_group_conversation(p_title text, p_member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_title text := btrim(coalesce(p_title, ''));
  v_conv uuid;
  v_campus uuid;
  v_member uuid;
  v_members uuid[];
  v_status text;
  v_sender_name text;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if v_title = '' then raise exception 'Give the group a name'; end if;
  if length(v_title) > 100 then raise exception 'Group name is too long (100 characters max)'; end if;

  select status into v_status from public.profiles where id = v_user;
  if v_status = 'suspended' then raise exception 'ACCOUNT_SUSPENDED: your account has been suspended and cannot do this. Contact a campus admin.'; end if;

  -- Dedupe, drop the creator if they included themselves, drop nulls.
  select array_agg(distinct m) into v_members
    from unnest(coalesce(p_member_ids, array[]::uuid[])) m
    where m is not null and m <> v_user;

  if v_members is null or array_length(v_members, 1) is null then
    raise exception 'Add at least one other member';
  end if;
  if array_length(v_members, 1) > 49 then
    raise exception 'Groups are capped at 50 members';
  end if;

  foreach v_member in array v_members loop
    select status into v_status from public.profiles where id = v_member;
    if v_status is null then raise exception 'One of the people you added could not be found'; end if;
    if v_status = 'suspended' then raise exception 'One of the people you added can''t be messaged'; end if;
  end loop;

  if not public.check_rate_limit(v_user, 'group_create', 10, 3600) then
    raise exception 'You are creating groups too fast -- slow down and try again shortly';
  end if;

  select campus_id into v_campus from public.profiles where id = v_user;

  insert into public.conversations (kind, title, created_by, campus_id)
  values ('group', v_title, v_user, v_campus)
  returning id into v_conv;

  insert into public.conversation_participants (conversation_id, user_id, role)
  values (v_conv, v_user, 'admin');

  foreach v_member in array v_members loop
    insert into public.conversation_participants (conversation_id, user_id, role)
    values (v_conv, v_member, 'member')
    on conflict (conversation_id, user_id) do nothing;
  end loop;

  select name into v_sender_name from public.profiles where id = v_user;
  perform public.post_group_system_message(
    v_conv,
    coalesce(v_sender_name, 'Someone') || ' created the group "' || v_title || '"',
    v_members
  );

  return v_conv;
end;
$$;

grant execute on function public.create_group_conversation(text, uuid[]) to authenticated;

create or replace function public.add_group_member(p_conversation_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_kind text;
  v_role text;
  v_status text;
  v_actor_name text;
  v_target_name text;
  v_count integer;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if p_user_id is null or p_user_id = v_user then raise exception 'Invalid member'; end if;

  select kind into v_kind from public.conversations where id = p_conversation_id;
  if v_kind is distinct from 'group' then raise exception 'Not a group conversation'; end if;

  select role into v_role from public.conversation_participants
    where conversation_id = p_conversation_id and user_id = v_user;
  if v_role is null then raise exception 'Not a member of this group'; end if;

  select count(*) into v_count from public.conversation_participants where conversation_id = p_conversation_id;
  if v_count >= 50 then raise exception 'Groups are capped at 50 members'; end if;

  select status into v_status from public.profiles where id = p_user_id;
  if v_status is null then raise exception 'Person not found'; end if;
  if v_status = 'suspended' then raise exception 'This person can''t be added'; end if;

  insert into public.conversation_participants (conversation_id, user_id, role)
  values (p_conversation_id, p_user_id, 'member')
  on conflict (conversation_id, user_id) do nothing;

  select name into v_actor_name from public.profiles where id = v_user;
  select name into v_target_name from public.profiles where id = p_user_id;
  perform public.post_group_system_message(
    p_conversation_id,
    coalesce(v_actor_name, 'Someone') || ' added ' || coalesce(v_target_name, 'a new member'),
    array[p_user_id]
  );
end;
$$;

grant execute on function public.add_group_member(uuid, uuid) to authenticated;

create or replace function public.remove_group_member(p_conversation_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_kind text;
  v_actor_role text;
  v_actor_name text;
  v_target_name text;
begin
  if v_user is null then raise exception 'Sign in required'; end if;

  select kind into v_kind from public.conversations where id = p_conversation_id;
  if v_kind is distinct from 'group' then raise exception 'Not a group conversation'; end if;

  select role into v_actor_role from public.conversation_participants
    where conversation_id = p_conversation_id and user_id = v_user;
  if v_actor_role <> 'admin' then raise exception 'Only a group admin can remove members'; end if;
  if p_user_id = v_user then raise exception 'Use "leave group" to remove yourself'; end if;

  delete from public.conversation_participants
    where conversation_id = p_conversation_id and user_id = p_user_id;
  if not found then raise exception 'That person is not in this group'; end if;

  select name into v_actor_name from public.profiles where id = v_user;
  select name into v_target_name from public.profiles where id = p_user_id;
  perform public.post_group_system_message(
    p_conversation_id,
    coalesce(v_actor_name, 'An admin') || ' removed ' || coalesce(v_target_name, 'a member'),
    array[p_user_id]
  );
end;
$$;

grant execute on function public.remove_group_member(uuid, uuid) to authenticated;

create or replace function public.leave_group_conversation(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_kind text;
  v_was_admin boolean;
  v_remaining_admins integer;
  v_next_admin uuid;
  v_leaver_name text;
begin
  if v_user is null then raise exception 'Sign in required'; end if;

  select kind into v_kind from public.conversations where id = p_conversation_id;
  if v_kind is distinct from 'group' then raise exception 'Not a group conversation'; end if;

  select role = 'admin' into v_was_admin from public.conversation_participants
    where conversation_id = p_conversation_id and user_id = v_user;
  if v_was_admin is null then raise exception 'Not a member of this group'; end if;

  delete from public.conversation_participants
    where conversation_id = p_conversation_id and user_id = v_user;

  if v_was_admin then
    select count(*) into v_remaining_admins from public.conversation_participants
      where conversation_id = p_conversation_id and role = 'admin';

    if v_remaining_admins = 0 then
      select user_id into v_next_admin from public.conversation_participants
        where conversation_id = p_conversation_id
        order by created_at asc limit 1;

      if v_next_admin is not null then
        update public.conversation_participants set role = 'admin'
          where conversation_id = p_conversation_id and user_id = v_next_admin;
      end if;
    end if;
  end if;

  select name into v_leaver_name from public.profiles where id = v_user;
  perform public.post_group_system_message(
    p_conversation_id,
    coalesce(v_leaver_name, 'Someone') || ' left the group',
    null
  );
end;
$$;

grant execute on function public.leave_group_conversation(uuid) to authenticated;

create or replace function public.rename_group_conversation(p_conversation_id uuid, p_title text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_kind text;
  v_role text;
  v_title text := btrim(coalesce(p_title, ''));
  v_actor_name text;
  v_others uuid[];
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if v_title = '' then raise exception 'Give the group a name'; end if;
  if length(v_title) > 100 then raise exception 'Group name is too long (100 characters max)'; end if;

  select kind into v_kind from public.conversations where id = p_conversation_id;
  if v_kind is distinct from 'group' then raise exception 'Not a group conversation'; end if;

  select role into v_role from public.conversation_participants
    where conversation_id = p_conversation_id and user_id = v_user;
  if v_role <> 'admin' then raise exception 'Only a group admin can rename the group'; end if;

  update public.conversations set title = v_title where id = p_conversation_id;

  select array_agg(user_id) into v_others from public.conversation_participants
    where conversation_id = p_conversation_id and user_id <> v_user;

  select name into v_actor_name from public.profiles where id = v_user;
  perform public.post_group_system_message(
    p_conversation_id,
    coalesce(v_actor_name, 'Someone') || ' renamed the group to "' || v_title || '"',
    v_others
  );
end;
$$;

grant execute on function public.rename_group_conversation(uuid, text) to authenticated;

-- =========================================================
-- 7. get_conversation_participants() -- group member list/roles, group-
-- thread sender-name lookup, and read-receipt data (compare a message's
-- created_at to the other participant(s)' last_read_at) all in one call.
-- =========================================================

create or replace function public.get_conversation_participants(p_conversation_id uuid)
returns table (
  user_id uuid, name text, avatar_url text, role text,
  availability_status text, availability_message text, last_read_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_conversation_participant(p_conversation_id, auth.uid()) then
    raise exception 'Not a participant in this conversation';
  end if;

  return query
    select p.id, p.name, p.avatar_url, cp.role, p.availability_status, p.availability_message, cp.last_read_at
    from public.conversation_participants cp
    join public.profiles p on p.id = cp.user_id
    where cp.conversation_id = p_conversation_id
    order by cp.created_at asc;
end;
$$;

grant execute on function public.get_conversation_participants(uuid) to authenticated;

-- =========================================================
-- 8. list_conversations(): + group fields
-- =========================================================

drop function if exists public.list_conversations();

create or replace function public.list_conversations()
returns table (
  conversation_id uuid, kind text, listing_id uuid, listing_title text,
  other_user_id uuid, other_user_name text, other_user_avatar text,
  other_user_availability_status text, other_user_availability_message text,
  is_group boolean, title text, member_count bigint, last_message_sender_name text,
  last_message_body text, last_message_at timestamptz, unread_count bigint
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
    (c.kind = 'group'), c.title,
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
    where op2.conversation_id = c.id and op2.user_id <> auth.uid() and c.kind <> 'group'
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

-- get_unread_message_count() recreated with the same message_type = 'text'
-- filter as list_conversations() above, so the top-level badge total and
-- the sum of each thread's own unread pill agree -- group system lines
-- ("Alice added Bob") advance the last-message preview but don't inflate
-- the unread count, since they're informational, not conversational.
create or replace function public.get_unread_message_count()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(*)
  from public.messages m
  join public.conversation_participants me
    on me.conversation_id = m.conversation_id and me.user_id = auth.uid()
  where m.sender_id <> auth.uid()
    and m.message_type = 'text'
    and m.created_at > coalesce(me.last_read_at, 'epoch'::timestamptz);
$$;

grant execute on function public.get_unread_message_count() to authenticated;

-- =========================================================
-- 9. Realtime -- message_reactions joins the tables already streamed.
-- =========================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reactions'
  ) then
    execute 'alter publication supabase_realtime add table public.message_reactions';
  end if;
end $$;
