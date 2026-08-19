-- =============================================================================
-- Raise the `backups` bucket's per-object size limit (created at 100MB in
-- 20260815000500_backups_bucket.sql, sized only for the ~150KB DB dump that
-- existed at the time) to accommodate the new weekly storage-bytes archive
-- from .github/workflows/storage-backup.yml (docs/DISASTER_RECOVERY.md) --
-- a tar.gz of every content bucket's files (avatars, post/event images, ID
-- verification documents, print job PDFs, etc.), which will keep growing as
-- the app is used. 500MB comfortably exceeds the project's total Supabase
-- Storage quota on the current plan, so a single archive can never
-- realistically hit this ceiling; it exists only as a sanity bound, not a
-- real constraint. No policy/security change -- still no RLS grants to
-- anon/authenticated, same as the original migration.
-- =============================================================================

update storage.buckets
set file_size_limit = 524288000 -- 500MB
where id = 'backups';
