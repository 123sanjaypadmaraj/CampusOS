-- =============================================================================
-- MARKETPLACE MESSAGING GAP-CLOSING PASS (doc §12/§45-46)
-- Conversations/Messages/Read-unread/Listing-context/Notification already
-- shipped in 20260814004200_messaging.sql. This closes the remaining gaps
-- the user picked: Block user, Report conversation + message moderation,
-- Attachments, Seller availability. Conversation search is client-side only
-- (filters the existing list_conversations() result), no DB change needed.
-- =============================================================================

-- =========================================================
-- 1. BLOCK USER
-- blocked_users (table + "blocked_users_own" RLS) already existed from the
-- moderation pass (20260814000600/001100) but nothing ever wrote to it and
-- nothing enforced it -- a blocked user could still message you. The table's
-- own RLS already lets a signed-in user manage their own block list via
-- plain table calls (for all using (blocker_id = auth.uid())), so no new
-- RPC is needed for block/unblock/list -- only the enforcement helper below,
-- used inside the SECURITY DEFINER messaging RPCs (which bypass RLS, so RLS
-- alone can't stop a blocked send).
-- =========================================================

create or replace function public.is_blocked_pair(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.blocked_users
    where (blocker_id = p_a and blocked_id = p_b)
       or (blocker_id = p_b and blocked_id = p_a)
  );
$$;

grant execute on function public.is_blocked_pair(uuid, uuid) to authenticated;

create or replace function public.start_conversation(p_other_user uuid, p_listing_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_conv uuid;
  v_campus uuid;
  v_other_status text;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if p_other_user is null or p_other_user = v_user then raise exception 'Invalid recipient'; end if;

  select status into v_other_status from public.profiles where id = p_other_user;
  if v_other_status is null then raise exception 'Recipient not found'; end if;
  if v_other_status = 'suspended' then raise exception 'This account cannot receive messages'; end if;

  select status into v_other_status from public.profiles where id = v_user;
  if v_other_status = 'suspended' then raise exception 'ACCOUNT_SUSPENDED: your account has been suspended and cannot do this. Contact a campus admin.'; end if;

  if public.is_blocked_pair(v_user, p_other_user) then
    raise exception 'You can''t start a conversation with this person.';
  end if;

  select campus_id into v_campus from public.profiles where id = v_user;

  if p_listing_id is not null then
    select c.id into v_conv
    from public.conversations c
    join public.conversation_participants p1 on p1.conversation_id = c.id and p1.user_id = v_user
    join public.conversation_participants p2 on p2.conversation_id = c.id and p2.user_id = p_other_user
    where c.kind = 'listing' and c.listing_id = p_listing_id
    limit 1;
  else
    select c.id into v_conv
    from public.conversations c
    join public.conversation_participants p1 on p1.conversation_id = c.id and p1.user_id = v_user
    join public.conversation_participants p2 on p2.conversation_id = c.id and p2.user_id = p_other_user
    where c.kind = 'dm'
    limit 1;
  end if;

  if v_conv is not null then return v_conv; end if;

  insert into public.conversations (kind, listing_id, campus_id)
  values (case when p_listing_id is not null then 'listing' else 'dm' end, p_listing_id, v_campus)
  returning id into v_conv;

  insert into public.conversation_participants (conversation_id, user_id)
  values (v_conv, v_user), (v_conv, p_other_user);

  return v_conv;
end;
$$;

-- =========================================================
-- 2. ATTACHMENTS -- one optional image per message
-- =========================================================

alter table public.messages add column if not exists attachment_path text;

do $$ begin
  alter table public.messages drop constraint if exists messages_body_check;
  alter table public.messages add constraint messages_body_check
    check ((length(btrim(body)) > 0 or attachment_path is not null) and length(body) <= 4000);
exception when others then null; end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('message-attachments', 'message-attachments', false, 10485760, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Private, scoped to conversation participants -- object path is always
-- `${conversationId}/...`, so the first path segment doubles as the
-- conversation id (same "first path segment is the scoping key" convention
-- 0015 uses for `${auth.uid()}/...`, just keyed on the conversation instead
-- of the uploader since either participant needs to read the other's image).
drop policy if exists "message_attachments_participant_rw" on storage.objects;
create policy "message_attachments_participant_rw" on storage.objects for all to authenticated
  using (bucket_id = 'message-attachments' and public.is_conversation_participant(((storage.foldername(name))[1])::uuid, auth.uid()))
  with check (bucket_id = 'message-attachments' and public.is_conversation_participant(((storage.foldername(name))[1])::uuid, auth.uid()));

-- =========================================================
-- send_message() recreated: adds p_attachment_path (drop first -- adding a
-- parameter changes the signature, and CREATE OR REPLACE with a different
-- arg list creates a second overload instead of replacing, same pitfall
-- documented repeatedly elsewhere in this migration set) + the block check.
-- =========================================================

drop function if exists public.send_message(uuid, text);

create or replace function public.send_message(p_conversation_id uuid, p_body text, p_attachment_path text default null)
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
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if v_body = '' and p_attachment_path is null then raise exception 'Message cannot be empty'; end if;
  if length(v_body) > 4000 then raise exception 'Message is too long (4000 characters max)'; end if;

  if not public.is_conversation_participant(p_conversation_id, v_user) then
    raise exception 'Not a participant in this conversation';
  end if;

  select user_id into v_other from public.conversation_participants
  where conversation_id = p_conversation_id and user_id <> v_user limit 1;

  if v_other is not null and public.is_blocked_pair(v_user, v_other) then
    raise exception 'You can''t send messages in this conversation anymore.';
  end if;

  if not public.check_rate_limit(v_user, 'messages', 60, 60) then
    raise exception 'You are sending messages too fast -- slow down and try again shortly';
  end if;

  insert into public.messages (conversation_id, sender_id, body, attachment_path)
  values (p_conversation_id, v_user, v_body, p_attachment_path)
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

grant execute on function public.send_message(uuid, text, text) to authenticated;

-- =========================================================
-- 3. REPORT CONVERSATION + MESSAGE MODERATION
-- =========================================================

do $$ begin
  alter table public.content_reports drop constraint if exists content_reports_target_type_check;
  alter table public.content_reports add constraint content_reports_target_type_check
    check (target_type in ('post','comment','marketplace_listing','lost_found_item','profile','conversation'));
exception when others then null; end $$;

-- get_report_context() recreated: adds an optional p_reporter_id so the
-- 'conversation' branch can resolve "the other participant" (the person
-- actually being reported) rather than an arbitrary one -- reportContent()
-- already stores reporter_id on the report row, AdminCMS's listOpenReports()
-- already selects it, so this just threads it through.
drop function if exists public.get_report_context(text, uuid);

create or replace function public.get_report_context(p_target_type text, p_target_id uuid, p_reporter_id uuid default null)
returns table (owner_id uuid, owner_name text, snippet text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.has_permission(auth.uid(), 'moderation.act') or public.current_user_is_admin()) then
    raise exception 'Not authorized';
  end if;

  if p_target_type = 'post' then
    return query
      select p.author_id, pr.name, coalesce(p.title, left(p.content, 140))
      from public.posts p join public.profiles pr on pr.id = p.author_id
      where p.id = p_target_id;
  elsif p_target_type = 'comment' then
    return query
      select c.author_id, pr.name, left(c.content, 140)
      from public.comments c join public.profiles pr on pr.id = c.author_id
      where c.id = p_target_id;
  elsif p_target_type = 'marketplace_listing' then
    return query
      select m.seller_id, pr.name, m.title
      from public.marketplace_listings m join public.profiles pr on pr.id = m.seller_id
      where m.id = p_target_id;
  elsif p_target_type = 'lost_found_item' then
    return query
      select l.user_id, pr.name, l.title
      from public.lost_found_items l join public.profiles pr on pr.id = l.user_id
      where l.id = p_target_id;
  elsif p_target_type = 'profile' then
    return query
      select pr.id, pr.name, pr.bio
      from public.profiles pr
      where pr.id = p_target_id;
  elsif p_target_type = 'conversation' then
    return query
      select pr.id, pr.name, coalesce(lm.body, case when lm.attachment_path is not null then '📷 Photo' else '(no messages yet)' end)
      from public.conversation_participants cp
      join public.profiles pr on pr.id = cp.user_id
      left join lateral (
        select body, attachment_path from public.messages m
        where m.conversation_id = p_target_id order by m.created_at desc limit 1
      ) lm on true
      where cp.conversation_id = p_target_id
        and (p_reporter_id is null or cp.user_id <> p_reporter_id)
      limit 1;
  end if;
end;
$$;

grant execute on function public.get_report_context(text, uuid, uuid) to authenticated;

-- =========================================================
-- 4. SELLER / PROFILE AVAILABILITY
-- Plain self-editable columns (no trust boundary, same as bio/skills) --
-- profiles_update_self (0011) already covers this, no new RPC needed.
-- Surfaced through get_profile_snippets() (the one safe "who is this"
-- lookup every feature already reuses) and list_conversations(), so it
-- shows up on marketplace listings, seller cards and message threads alike
-- without a bespoke lookup per feature.
-- =========================================================

alter table public.profiles add column if not exists availability_status text not null default 'available';
do $$ begin
  alter table public.profiles drop constraint if exists profiles_availability_status_check;
  alter table public.profiles add constraint profiles_availability_status_check
    check (availability_status in ('available','away'));
exception when others then null; end $$;
alter table public.profiles add column if not exists availability_message text;

drop function if exists public.get_profile_snippets(uuid[]);

create or replace function public.get_profile_snippets(p_ids uuid[])
returns table (id uuid, name text, course text, avatar_url text, availability_status text, availability_message text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.name, p.course, p.avatar_url, p.availability_status, p.availability_message
  from public.profiles p
  where p.id = any(p_ids)
    and p.privacy_level in ('public','campus')
    and p.status = 'active';
$$;

grant execute on function public.get_profile_snippets(uuid[]) to authenticated, anon;

drop function if exists public.list_conversations();

create or replace function public.list_conversations()
returns table (
  conversation_id uuid, kind text, listing_id uuid, listing_title text,
  other_user_id uuid, other_user_name text, other_user_avatar text,
  other_user_availability_status text, other_user_availability_message text,
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
    coalesce(lm.body, case when lm.attachment_path is not null then '📷 Photo' else null end), c.last_message_at,
    (select count(*) from public.messages m
       where m.conversation_id = c.id
         and m.sender_id <> auth.uid()
         and m.created_at > coalesce(me.last_read_at, 'epoch'::timestamptz))
  from public.conversations c
  join public.conversation_participants me on me.conversation_id = c.id and me.user_id = auth.uid()
  join public.conversation_participants op on op.conversation_id = c.id and op.user_id <> auth.uid()
  join public.profiles prof on prof.id = op.user_id
  left join public.marketplace_listings ml on ml.id = c.listing_id
  left join lateral (
    select body, attachment_path from public.messages m2 where m2.conversation_id = c.id order by m2.created_at desc limit 1
  ) lm on true
  where me.archived = false
  order by c.last_message_at desc;
$$;

grant execute on function public.list_conversations() to authenticated;
