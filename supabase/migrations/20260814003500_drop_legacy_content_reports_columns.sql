-- =============================================================================
-- 0035: FIX content_reports -- every report insert has been failing
-- =============================================================================
-- 0006 added target_type/target_id (nullable, to coexist with this table's
-- legacy shape) alongside the existing content_type/content_id columns, but
-- never touched content_type/content_id themselves -- they're still NOT
-- NULL with no default from the pre-migration hand-edited schema (see the
-- comment in 20260814000600_community.sql). Nothing in this codebase has
-- ever read or written content_type/content_id (grep confirms -- only
-- src/supabase/archive/CAMPUSOS_RESET_AND_SEED.sql, the archived legacy
-- schema, mentions them); every current write goes through target_type/
-- target_id. Net effect: reportContent() -- and therefore every "Report"
-- button anywhere in the app, including the one just wired up on posts --
-- has been silently 400'ing on the content_type NOT NULL constraint since
-- this table was first migrated. Found live while testing the moderation
-- console, the first real caller content_reports has ever had.
--
-- Fix: drop the dead legacy columns. There's no data worth preserving --
-- if any pre-migration rows exist, they'd already be unreachable through
-- target_type/target_id anyway, and the moderation UI reads through
-- target_type/target_id exclusively.

alter table public.content_reports drop column if exists content_type;
alter table public.content_reports drop column if exists content_id;

-- target_type/target_id were left nullable to coexist with the columns
-- above; now that those are gone, these are the only identifying columns
-- content_reports has, so they need to actually be required.
alter table public.content_reports alter column target_type set not null;
alter table public.content_reports alter column target_id set not null;
