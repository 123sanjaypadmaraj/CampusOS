-- =============================================================================
-- 0006: COMMUNITY -- posts, likes, comments, reports, blocking, moderation
-- (doc §40-41).
-- =============================================================================

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  campus_id uuid references public.campuses(id) on delete set null,
  type text not null default 'General',
  title text not null,
  content text not null default '',
  tags text[] not null default '{}',
  image_urls text[] not null default '{}',
  status text not null default 'visible' check (status in ('visible','hidden','removed')),
  created_at timestamptz not null default now()
);

alter table public.posts add column if not exists image_urls text[] not null default '{}';
alter table public.posts add column if not exists status text not null default 'visible';
do $$ begin
  alter table public.posts drop constraint if exists posts_status_check;
  alter table public.posts add constraint posts_status_check check (status in ('visible','hidden','removed'));
exception when others then null; end $$;

create table if not exists public.post_likes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(post_id,user_id)
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  parent_comment_id uuid references public.comments(id) on delete cascade,
  content text not null,
  status text not null default 'visible' check (status in ('visible','hidden','removed')),
  created_at timestamptz not null default now()
);

alter table public.comments add column if not exists parent_comment_id uuid references public.comments(id) on delete cascade;
alter table public.comments add column if not exists status text not null default 'visible';

create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('post','comment','marketplace_listing','lost_found_item','profile')),
  target_id uuid not null,
  reason text not null,
  details text,
  status text not null default 'open' check (status in ('open','reviewing','resolved','dismissed')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

-- This project's content_reports predates this migration (legacy shape:
-- content_type/content_id, no target_type/target_id/details/reviewed_*).
alter table public.content_reports add column if not exists target_type text;
alter table public.content_reports add column if not exists target_id uuid;
alter table public.content_reports add column if not exists details text;
alter table public.content_reports add column if not exists reviewed_by uuid references public.profiles(id) on delete set null;
alter table public.content_reports add column if not exists reviewed_at timestamptz;
alter table public.content_reports alter column status set default 'open';
do $$ begin
  alter table public.content_reports drop constraint if exists content_reports_target_type_check;
  alter table public.content_reports add constraint content_reports_target_type_check
    check (target_type in ('post','comment','marketplace_listing','lost_found_item','profile'));
exception when others then null; end $$;
do $$ begin
  alter table public.content_reports drop constraint if exists content_reports_status_check;
  alter table public.content_reports add constraint content_reports_status_check
    check (status in ('open','reviewing','resolved','dismissed'));
exception when others then null; end $$;

create table if not exists public.blocked_users (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table if not exists public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  moderator_id uuid references public.profiles(id) on delete set null,
  target_type text not null,
  target_id uuid not null,
  action text not null check (action in ('approve','hide','remove','warn','suspend','ban')),
  reason text,
  created_at timestamptz not null default now()
);

-- =========================================================
-- RPC: moderate_content -- single, audited entry point for all moderation
-- actions on posts/comments (doc §40, §41, §58).
-- =========================================================

create or replace function public.moderate_content(
  p_target_type text,
  p_target_id uuid,
  p_action text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_new_status text;
begin
  if not (public.has_permission(v_user, 'moderation.act') or public.current_user_is_admin()) then
    raise exception 'Not authorized to moderate content';
  end if;

  v_new_status := case p_action when 'approve' then 'visible' when 'hide' then 'hidden' when 'remove' then 'removed' else null end;

  if v_new_status is not null then
    if p_target_type = 'post' then
      update public.posts set status = v_new_status where id = p_target_id;
    elsif p_target_type = 'comment' then
      update public.comments set status = v_new_status where id = p_target_id;
    end if;
  end if;

  insert into public.moderation_actions (moderator_id, target_type, target_id, action, reason)
  values (v_user, p_target_type, p_target_id, p_action, p_reason);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, reason)
  values (v_user, 'moderation.' || p_action, p_target_type, p_target_id::text, p_reason);
end;
$$;

create index if not exists posts_campus_created_idx on public.posts(campus_id, created_at desc);
create index if not exists posts_author_idx on public.posts(author_id);
create index if not exists post_likes_post_idx on public.post_likes(post_id);
create index if not exists comments_post_created_idx on public.comments(post_id, created_at);
create index if not exists content_reports_status_idx on public.content_reports(status);
create index if not exists content_reports_target_idx on public.content_reports(target_type, target_id);

-- Basic full-text search support for the global search feature (doc §11).
alter table public.posts add column if not exists search_vector tsvector
  generated always as (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(content,''))) stored;
create index if not exists posts_search_idx on public.posts using gin(search_vector);
