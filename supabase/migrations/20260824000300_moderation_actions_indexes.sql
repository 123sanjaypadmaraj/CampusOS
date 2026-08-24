-- =========================================================
-- Reliability audit (readiness-audit phase 7): moderation_actions had zero
-- indexes despite every content-moderation action across 5 entity types
-- (posts/comments via moderate_content, messages, marketplace listings,
-- lost&found items, events) writing to it. Mirrors the audit_logs indexing
-- pattern (20260814000200_rbac.sql) since the two tables serve the same
-- kind of lookup: history for one entity, history for one actor, and a
-- recent-activity feed.
-- =========================================================

create index if not exists moderation_actions_target_idx
  on public.moderation_actions(target_type, target_id);

create index if not exists moderation_actions_moderator_idx
  on public.moderation_actions(moderator_id);

create index if not exists moderation_actions_created_idx
  on public.moderation_actions(created_at desc);
