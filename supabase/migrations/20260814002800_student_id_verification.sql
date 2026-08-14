-- =============================================================================
-- 0028: STUDENT ID VERIFICATION -- wire up the previously-unused
-- student_verifications table (doc §7) to a real document-upload + admin
-- review flow, and make the "VERIFIED STUDENT" badge in the UI actually
-- mean something.
-- =============================================================================
-- Today every profile shows "VERIFIED STUDENT" unconditionally -- and for
-- USN+password signups (20260814001700), the only identity check is that
-- the USN is 10 alphanumeric characters, which anyone can type. This gives
-- students a real way to prove it (upload their ID card to the existing
-- private 'documents' storage bucket, an admin reviews and approves/
-- rejects) and the frontend a real status to gate the badge on.

alter table public.student_verifications add column if not exists document_path text;

-- listPendingVerifications() (admin) needs to join profiles for the
-- requester's name/course/year -- that already works under RLS since
-- current_user_is_admin() is allowed to read every profiles row
-- (0011 profiles_read_self_or_privileged), no new policy needed here.

create index if not exists student_verifications_status_created_idx
  on public.student_verifications(status, created_at);
