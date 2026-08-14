-- =============================================================================
-- 0042: MESSAGING (marketplace buyer/seller + classmate-to-classmate DMs)
-- Previously explicitly out of scope (see 0009's header comment) -- sellers
-- and finders were reachable only through their public profile. This adds
-- real 1:1 conversations: a "Message seller" button on a marketplace
-- listing, and a "Message" button on a classmate in the Connect directory.
-- No group chat -- each conversation has exactly two participants.
-- =============================================================================

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'dm' check (kind in ('dm', 'listing')),
  listing_id uuid references public.marketplace_listings(id) on delete set null,
  campus_id uuid references public.campuses(id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create table if not exists public.conversation_participants (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (length(btrim(body)) > 0 and length(body) <= 4000),
  created_at timestamptz not null default now()
);

create index if not exists conversation_participants_user_idx on public.conversation_participants(user_id);
create index if not exists conversation_participants_conv_idx on public.conversation_participants(conversation_id);
create index if not exists messages_conversation_idx on public.messages(conversation_id, created_at);
create index if not exists conversations_listing_idx on public.conversations(listing_id);

alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;

-- Reads only, scoped to participants -- every write goes through the
-- SECURITY DEFINER RPCs below (same pattern as orders/bookings/etc: no
-- insert/update policy for authenticated means the table can't be written
-- to directly from the browser, only through an audited entry point).
create policy "conversations_read_participant" on public.conversations for select to authenticated
  using (exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = id and cp.user_id = auth.uid()
  ));

create policy "conversation_participants_read_own" on public.conversation_participants for select to authenticated
  using (user_id = auth.uid());

create policy "messages_read_participant" on public.messages for select to authenticated
  using (exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = messages.conversation_id and cp.user_id = auth.uid()
  ));

-- =========================================================
-- RPCs
-- =========================================================

create or replace function public.is_conversation_participant(p_conversation uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.conversation_participants
    where conversation_id = p_conversation and user_id = p_user
  );
$$;

-- Finds an existing DM (or listing-scoped) conversation between the caller
-- and p_other_user, or creates one. A listing conversation is keyed to the
-- specific listing so "message seller" on two different listings from the
-- same seller opens two separate threads (buyer context matters); a plain
-- classmate DM has no listing and is reused for any future message.
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

create or replace function public.send_message(p_conversation_id uuid, p_body text)
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
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if v_body = '' then raise exception 'Message cannot be empty'; end if;
  if length(v_body) > 4000 then raise exception 'Message is too long (4000 characters max)'; end if;

  if not public.is_conversation_participant(p_conversation_id, v_user) then
    raise exception 'Not a participant in this conversation';
  end if;

  if not public.check_rate_limit(v_user, 'messages', 60, 60) then
    raise exception 'You are sending messages too fast -- slow down and try again shortly';
  end if;

  insert into public.messages (conversation_id, sender_id, body)
  values (p_conversation_id, v_user, v_body)
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
      left(v_body, 140),
      'message', 'conversation', p_conversation_id::text
    );
  end loop;

  return v_msg;
end;
$$;

create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversation_participants
    set last_read_at = now()
    where conversation_id = p_conversation_id and user_id = auth.uid();
  if not found then raise exception 'Not a participant in this conversation'; end if;
end;
$$;

-- One row per conversation the caller is in, with the *other* participant's
-- safe display info (never email/phone -- same trust boundary as
-- get_profile_snippets), the last message preview, and an unread count.
-- SECURITY DEFINER so it can read conversation_participants/profiles for
-- the other participant, which the caller's own RLS wouldn't otherwise see.
create or replace function public.list_conversations()
returns table (
  conversation_id uuid, kind text, listing_id uuid, listing_title text,
  other_user_id uuid, other_user_name text, other_user_avatar text,
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
    lm.body, c.last_message_at,
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
    select body from public.messages m2 where m2.conversation_id = c.id order by m2.created_at desc limit 1
  ) lm on true
  where me.archived = false
  order by c.last_message_at desc;
$$;

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
    and m.created_at > coalesce(me.last_read_at, 'epoch'::timestamptz);
$$;

grant execute on function public.start_conversation(uuid, uuid) to authenticated;
grant execute on function public.send_message(uuid, text) to authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
grant execute on function public.list_conversations() to authenticated;
grant execute on function public.get_unread_message_count() to authenticated;

-- =========================================================
-- Suspension enforcement -- messages are inserted by send_message(), a
-- SECURITY DEFINER RPC that bypasses RLS entirely, so the one place that
-- can actually stop a suspended account from messaging is a BEFORE INSERT
-- trigger (same reasoning as 0030/0031: RLS/RPC checks alone don't cover
-- every path uniformly, a trigger does).
-- =========================================================

create or replace function public.reject_if_suspended()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_status text;
begin
  if TG_TABLE_NAME = 'posts' or TG_TABLE_NAME = 'comments' then
    v_user := new.author_id;
  elsif TG_TABLE_NAME = 'marketplace_listings' then
    v_user := new.seller_id;
  elsif TG_TABLE_NAME = 'messages' then
    v_user := new.sender_id;
  else
    v_user := new.user_id;
  end if;

  if v_user is null then
    return new;
  end if;

  select status into v_status from public.profiles where id = v_user;

  if v_status = 'suspended' then
    raise exception 'ACCOUNT_SUSPENDED: your account has been suspended and cannot do this. Contact a campus admin.';
  end if;

  return new;
end;
$$;

drop trigger if exists messages_reject_if_suspended on public.messages;
create trigger messages_reject_if_suspended
before insert on public.messages
for each row execute function public.reject_if_suspended();

-- =========================================================
-- Realtime -- live message delivery in an open thread, and live
-- conversation-list updates (new thread, new last message).
-- =========================================================

do $$
declare
  t text;
  tables text[] := array['conversations', 'conversation_participants', 'messages'];
begin
  foreach t in array tables loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
