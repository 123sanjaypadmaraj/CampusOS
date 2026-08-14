-- =============================================================================
-- 0016: RATE LIMITING (doc §64) applied at the database level via BEFORE
-- INSERT triggers, so it's enforced no matter which path (RPC or direct
-- table insert under RLS) a write comes through -- not just the paths that
-- happen to go through an Edge Function.
-- =============================================================================

-- Generic trigger: TG_ARGV[0] = rate_limit_hits bucket name,
-- TG_ARGV[1] = max hits, TG_ARGV[2] = window in seconds.
create or replace function public.enforce_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bucket text := TG_ARGV[0];
  v_max integer := TG_ARGV[1]::integer;
  v_window integer := TG_ARGV[2]::integer;
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return new; -- service-role/system writes are never rate limited
  end if;

  if not public.check_rate_limit(v_user, v_bucket, v_max, v_window) then
    raise exception 'RATE_LIMITED: too many % actions, slow down', v_bucket;
  end if;

  return new;
end;
$$;

drop trigger if exists rl_posts on public.posts;
create trigger rl_posts before insert on public.posts
  for each row execute function public.enforce_rate_limit('posts', 10, 3600);

drop trigger if exists rl_comments on public.comments;
create trigger rl_comments before insert on public.comments
  for each row execute function public.enforce_rate_limit('comments', 30, 3600);

drop trigger if exists rl_post_likes on public.post_likes;
create trigger rl_post_likes before insert on public.post_likes
  for each row execute function public.enforce_rate_limit('likes', 120, 3600);

drop trigger if exists rl_marketplace_listings on public.marketplace_listings;
create trigger rl_marketplace_listings before insert on public.marketplace_listings
  for each row execute function public.enforce_rate_limit('marketplace_listings', 10, 3600);

drop trigger if exists rl_lost_found_items on public.lost_found_items;
create trigger rl_lost_found_items before insert on public.lost_found_items
  for each row execute function public.enforce_rate_limit('lost_found_items', 10, 3600);

drop trigger if exists rl_content_reports on public.content_reports;
create trigger rl_content_reports before insert on public.content_reports
  for each row execute function public.enforce_rate_limit('content_reports', 20, 3600);
