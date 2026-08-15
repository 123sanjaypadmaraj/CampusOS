-- =============================================================================
-- Private storage bucket for automated DB backups (see
-- .github/workflows/backup.yml, docs/DISASTER_RECOVERY.md). Deliberately
-- has NO storage.objects policies granted to anon/authenticated -- with RLS
-- enabled (the default on storage.objects) and no policy, nobody using the
-- publishable/anon key can read, list, or write here at all. The backup
-- workflow reaches it via `supabase storage cp`, which authenticates
-- through the Management API using an access token, not this bucket's own
-- (nonexistent) client-facing grants -- same reason no DB password is
-- needed for `supabase db dump --linked` either.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('backups', 'backups', false, 104857600, array['application/gzip', 'application/octet-stream'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
