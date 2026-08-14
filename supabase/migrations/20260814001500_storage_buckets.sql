-- =============================================================================
-- 0015: STORAGE BUCKETS + POLICIES (doc §65-66)
-- Neither the old schema nor this one previously created any buckets, so
-- every supabase.storage.from(...).upload() call in the frontend would have
-- failed against a fresh project. Convention used throughout: object paths
-- are prefixed `${auth.uid()}/...`, which is how the policies below scope
-- write access to "your own folder" without needing a metadata column.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 5242880, array['image/png','image/jpeg','image/webp']),
  ('food-images', 'food-images', true, 5242880, array['image/png','image/jpeg','image/webp']),
  ('post-media', 'post-media', true, 10485760, array['image/png','image/jpeg','image/webp']),
  ('event-media', 'event-media', true, 10485760, array['image/png','image/jpeg','image/webp']),
  ('marketplace-media', 'marketplace-media', true, 10485760, array['image/png','image/jpeg','image/webp']),
  ('lost-found-media', 'lost-found-media', true, 10485760, array['image/png','image/jpeg','image/webp']),
  ('print-files', 'print-files', false, 26214400, array['application/pdf']),
  ('documents', 'documents', false, 26214400, array['application/pdf','image/png','image/jpeg']),
  ('vendor-documents', 'vendor-documents', false, 26214400, array['application/pdf','image/png','image/jpeg'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Public buckets: anyone can view; only the owner (first path segment ==
-- their auth.uid()) can upload/update/delete their own files.
do $$
declare
  b text;
  public_buckets text[] := array['avatars','food-images','post-media','event-media','marketplace-media','lost-found-media'];
begin
  foreach b in array public_buckets loop
    execute format('drop policy if exists %I on storage.objects', b || '_read');
    execute format(
      'create policy %I on storage.objects for select to anon, authenticated using (bucket_id = %L)',
      b || '_read', b
    );

    execute format('drop policy if exists %I on storage.objects', b || '_write_own');
    execute format(
      'create policy %I on storage.objects for insert to authenticated with check (bucket_id = %L and (storage.foldername(name))[1] = auth.uid()::text)',
      b || '_write_own', b
    );

    execute format('drop policy if exists %I on storage.objects', b || '_update_own');
    execute format(
      'create policy %I on storage.objects for update to authenticated using (bucket_id = %L and (storage.foldername(name))[1] = auth.uid()::text)',
      b || '_update_own', b
    );

    execute format('drop policy if exists %I on storage.objects', b || '_delete_own');
    execute format(
      'create policy %I on storage.objects for delete to authenticated using (bucket_id = %L and (storage.foldername(name))[1] = auth.uid()::text)',
      b || '_delete_own', b
    );
  end loop;
end $$;

-- Private buckets: only the owner can read/write their own files. Vendor
-- staff/admins get read access via has_permission() for the buckets they
-- legitimately need to review (print jobs, KYC documents).
drop policy if exists "print_files_owner_rw" on storage.objects;
create policy "print_files_owner_rw" on storage.objects for all to authenticated
  using (bucket_id = 'print-files' and ((storage.foldername(name))[1] = auth.uid()::text or public.has_permission(auth.uid(),'print.manage') or public.current_user_is_admin()))
  with check (bucket_id = 'print-files' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "documents_owner_rw" on storage.objects;
create policy "documents_owner_rw" on storage.objects for all to authenticated
  using (bucket_id = 'documents' and ((storage.foldername(name))[1] = auth.uid()::text or public.current_user_is_admin()))
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);

-- vendor-documents (business/KYC docs, doc §57) -- admin-only, no self-serve
-- read even for the uploader once submitted, matching "do not expose these
-- documents to ordinary users".
drop policy if exists "vendor_documents_admin_only" on storage.objects;
create policy "vendor_documents_admin_only" on storage.objects for all to authenticated
  using (bucket_id = 'vendor-documents' and public.current_user_is_admin())
  with check (bucket_id = 'vendor-documents' and public.current_user_is_admin());

drop policy if exists "vendor_documents_upload_own" on storage.objects;
create policy "vendor_documents_upload_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'vendor-documents' and (storage.foldername(name))[1] = auth.uid()::text);
