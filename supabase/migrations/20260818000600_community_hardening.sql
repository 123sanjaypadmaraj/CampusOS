-- =============================================================================
-- COMMUNITY HARDENING -- saved posts, profanity filtering, duplicate/spam
-- content detection, and a suspension appeal process.
--
-- Everything else on the "Community" checklist (posts/comments/replies,
-- likes, reporting, blocking, moderation, rate limiting, account suspension,
-- content-removal audit trail) already existed -- see 20260814000600_community.sql,
-- 20260814001600_rate_limiting_triggers.sql, 20260814002900_admin_user_management.sql,
-- 20260814003000_enforce_account_suspension.sql. This migration only adds
-- the pieces that were genuinely missing.
-- =============================================================================

-- =========================================================
-- SAVED POSTS -- mirrors saved_events (0005) exactly: a plain owner-scoped
-- join table, no RPC needed, client reads/writes it directly under RLS.
-- =========================================================

create table if not exists public.saved_posts (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table public.saved_posts enable row level security;
drop policy if exists "saved_posts_own" on public.saved_posts;
create policy "saved_posts_own" on public.saved_posts for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create index if not exists posts_tags_idx on public.posts using gin(tags);

-- =========================================================
-- PROFANITY FILTERING -- admin-managed word list, token-matched (never used
-- as a regex pattern, so an admin-entered "word" can't turn into a regex
-- injection against arbitrary post/comment text).
-- =========================================================

create table if not exists public.banned_words (
  word text primary key,
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.banned_words enable row level security;
drop policy if exists "banned_words_admin_read" on public.banned_words;
create policy "banned_words_admin_read" on public.banned_words for select to authenticated
  using (public.has_permission(auth.uid(), 'moderation.act') or public.current_user_is_admin());
-- No insert/update/delete policy at all -- writes only via the RPCs below,
-- which are audited (same "RPC gate, don't rely on role-only RLS alone for
-- anything worth an audit trail" posture used throughout this project).

create or replace function public.contains_banned_word(p_text text)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from unnest(regexp_split_to_array(lower(coalesce(p_text, '')), '[^a-z0-9]+')) as tok
    join public.banned_words b on b.word = tok
    where tok <> ''
  );
$$;

create or replace function public.admin_add_banned_word(p_word text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.has_permission(auth.uid(), 'moderation.act') or public.current_user_is_admin()) then
    raise exception 'Not authorized to manage the profanity filter';
  end if;
  if p_word is null or trim(p_word) = '' then
    raise exception 'Word cannot be empty';
  end if;

  insert into public.banned_words (word, added_by)
  values (lower(trim(p_word)), auth.uid())
  on conflict (word) do nothing;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, reason)
  values (auth.uid(), 'moderation.banned_word.add', 'banned_word', lower(trim(p_word)), null);
end;
$$;

create or replace function public.admin_remove_banned_word(p_word text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.has_permission(auth.uid(), 'moderation.act') or public.current_user_is_admin()) then
    raise exception 'Not authorized to manage the profanity filter';
  end if;

  delete from public.banned_words where word = lower(trim(coalesce(p_word, '')));

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, reason)
  values (auth.uid(), 'moderation.banned_word.remove', 'banned_word', lower(trim(coalesce(p_word, ''))), null);
end;
$$;

create or replace function public.reject_profanity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_text text;
  v_row jsonb := to_jsonb(new);
begin
  -- This trigger is shared across posts and comments, whose row shapes
  -- differ (posts has title+content, comments has content only). A direct
  -- `new.title` reference would fail to even compile when this function is
  -- bound to the comments table's row type, regardless of which CASE branch
  -- would actually run -- to_jsonb()->>'key' resolves fields dynamically at
  -- runtime instead, returning null for a key that isn't there.
  v_text := case TG_TABLE_NAME
    when 'posts' then coalesce(v_row->>'title', '') || ' ' || coalesce(v_row->>'content', '')
    when 'comments' then coalesce(v_row->>'content', '')
    else ''
  end;

  if public.contains_banned_word(v_text) then
    raise exception 'PROFANITY_DETECTED: This % contains language that is not allowed here. Please revise it and try again.',
      case TG_TABLE_NAME when 'posts' then 'post' else 'comment' end;
  end if;

  return new;
end;
$$;

drop trigger if exists posts_reject_profanity on public.posts;
create trigger posts_reject_profanity before insert or update of title, content on public.posts
  for each row execute function public.reject_profanity();

drop trigger if exists comments_reject_profanity on public.comments;
create trigger comments_reject_profanity before insert or update of content on public.comments
  for each row execute function public.reject_profanity();

-- Seed a small starter list -- deliberately not exhaustive; admins extend it
-- via admin_add_banned_word() (AdminCMS Moderation tab) rather than a redeploy.
insert into public.banned_words (word) values
  ('fuck'), ('fucking'), ('fucker'), ('shit'), ('bullshit'),
  ('bitch'), ('bastard'), ('asshole'), ('dumbass'), ('cunt'),
  ('slut'), ('whore'), ('nigger'), ('faggot'), ('retard')
on conflict (word) do nothing;

-- =========================================================
-- DUPLICATE / SPAM CONTENT DETECTION -- pg_trgm similarity on posts (near-
-- duplicate, same author, short window); exact-match on comments (short
-- replies like "thanks" are common and legitimate, so comments use exact
-- match rather than fuzzy similarity to avoid false positives).
-- =========================================================

create or replace function public.reject_duplicate_post()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_text text := coalesce(new.title, '') || ' ' || coalesce(new.content, '');
  v_hit boolean;
begin
  select exists (
    select 1 from public.posts p
    where p.author_id = new.author_id
      and p.status <> 'removed'
      and p.created_at > now() - interval '30 minutes'
      and similarity(coalesce(p.title, '') || ' ' || coalesce(p.content, ''), v_new_text) > 0.85
  ) into v_hit;

  if v_hit then
    raise exception 'DUPLICATE_POST: You already posted something very similar recently. Please wait a bit or change the content.';
  end if;

  return new;
end;
$$;

drop trigger if exists posts_reject_duplicate on public.posts;
create trigger posts_reject_duplicate before insert on public.posts
  for each row execute function public.reject_duplicate_post();

create or replace function public.reject_duplicate_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hit boolean;
begin
  select exists (
    select 1 from public.comments c
    where c.author_id = new.author_id
      and c.post_id = new.post_id
      and c.status <> 'removed'
      and c.created_at > now() - interval '10 minutes'
      and c.content = new.content
  ) into v_hit;

  if v_hit then
    raise exception 'DUPLICATE_COMMENT: You already posted this exact comment here recently.';
  end if;

  return new;
end;
$$;

drop trigger if exists comments_reject_duplicate on public.comments;
create trigger comments_reject_duplicate before insert on public.comments
  for each row execute function public.reject_duplicate_comment();

-- =========================================================
-- SUSPENSION APPEALS -- a suspended account can ask for a human review
-- rather than the suspension being a dead end. RPC-only writes (no insert/
-- update policy at all) so eligibility ("must actually be suspended", "one
-- open appeal at a time") is enforced in one place, same posture as
-- suspension_appeals' sibling tables elsewhere in this file.
-- =========================================================

create table if not exists public.suspension_appeals (
  id uuid primary key default gen_random_uuid(),
  appellant_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  admin_note text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Only one open appeal per user at a time.
create unique index if not exists suspension_appeals_one_pending_idx
  on public.suspension_appeals (appellant_id) where (status = 'pending');

alter table public.suspension_appeals enable row level security;
drop policy if exists "suspension_appeals_read" on public.suspension_appeals;
create policy "suspension_appeals_read" on public.suspension_appeals for select to authenticated
  using (appellant_id = auth.uid() or public.has_permission(auth.uid(), 'users.suspend') or public.current_user_is_admin());

create index if not exists suspension_appeals_status_idx on public.suspension_appeals(status, created_at);

create or replace function public.submit_suspension_appeal(p_reason text)
returns public.suspension_appeals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_status text;
  v_appeal public.suspension_appeals;
begin
  if v_user is null then
    raise exception 'Please sign in first.';
  end if;
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'Please explain why you are appealing.';
  end if;

  select status into v_status from public.profiles where id = v_user;
  if v_status is distinct from 'suspended' then
    raise exception 'Only a suspended account can submit an appeal.';
  end if;

  if exists (select 1 from public.suspension_appeals where appellant_id = v_user and status = 'pending') then
    raise exception 'You already have an appeal under review.';
  end if;

  insert into public.suspension_appeals (appellant_id, reason)
  values (v_user, trim(p_reason))
  returning * into v_appeal;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, reason)
  values (v_user, 'suspension_appeal.submit', 'profile', v_user::text, trim(p_reason));

  return v_appeal;
end;
$$;

create or replace function public.resolve_suspension_appeal(
  p_appeal_id uuid,
  p_decision text,
  p_admin_note text default null
)
returns public.suspension_appeals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appeal public.suspension_appeals;
begin
  if not (public.has_permission(auth.uid(), 'users.suspend') or public.current_user_is_admin()) then
    raise exception 'Not authorized to resolve appeals';
  end if;
  if p_decision not in ('approved', 'denied') then
    raise exception 'Invalid decision % -- only approved/denied are settable here', p_decision;
  end if;

  select * into v_appeal from public.suspension_appeals where id = p_appeal_id for update;
  if not found then
    raise exception 'Appeal not found';
  end if;
  if v_appeal.status <> 'pending' then
    raise exception 'This appeal has already been resolved';
  end if;

  update public.suspension_appeals
    set status = p_decision, admin_note = p_admin_note, reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_appeal_id
    returning * into v_appeal;

  -- Reactivation goes through admin_set_user_status() itself (not a direct
  -- profiles UPDATE) so it stays the single audited entry point for status
  -- changes and correctly sets the profiles-status-change bypass flag on
  -- whichever version of that function is currently live.
  if p_decision = 'approved' then
    perform public.admin_set_user_status(v_appeal.appellant_id, 'active', 'Suspension appeal approved');
  end if;

  perform public.create_notification(
    v_appeal.appellant_id,
    case p_decision when 'approved' then 'Your appeal was approved' else 'Your appeal was reviewed' end,
    case p_decision
      when 'approved' then 'Your account has been reactivated.'
      else coalesce('Your suspension appeal was not approved. ' || p_admin_note, 'Your suspension appeal was not approved.')
    end,
    'official',
    'suspension_appeal',
    p_appeal_id::text
  );

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, reason)
  values (auth.uid(), 'suspension_appeal.' || p_decision, 'suspension_appeal', p_appeal_id::text, p_admin_note);

  return v_appeal;
end;
$$;

create or replace function public.get_my_suspension_appeal()
returns public.suspension_appeals
language sql
stable
security definer
set search_path = public
as $$
  select * from public.suspension_appeals
  where appellant_id = auth.uid()
  order by created_at desc
  limit 1;
$$;

create or replace function public.admin_list_suspension_appeals(p_status text default 'pending')
returns table (
  id uuid,
  appellant_id uuid,
  appellant_name text,
  reason text,
  status text,
  admin_note text,
  created_at timestamptz,
  reviewed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.has_permission(auth.uid(), 'users.suspend') or public.current_user_is_admin()) then
    raise exception 'Not authorized to view appeals';
  end if;

  return query
    select sa.id, sa.appellant_id, p.name, sa.reason, sa.status, sa.admin_note, sa.created_at, sa.reviewed_at
    from public.suspension_appeals sa
    join public.profiles p on p.id = sa.appellant_id
    where p_status is null or sa.status = p_status
    order by sa.created_at desc;
end;
$$;

grant execute on function public.contains_banned_word(text) to authenticated;
grant execute on function public.admin_add_banned_word(text) to authenticated;
grant execute on function public.admin_remove_banned_word(text) to authenticated;
grant execute on function public.submit_suspension_appeal(text) to authenticated;
grant execute on function public.resolve_suspension_appeal(uuid, text, text) to authenticated;
grant execute on function public.get_my_suspension_appeal() to authenticated;
grant execute on function public.admin_list_suspension_appeals(text) to authenticated;

revoke all on public.banned_words from anon;
revoke all on public.suspension_appeals from anon;
revoke all on public.saved_posts from anon;
