-- =============================================================================
-- 0039: FIX club_members_role_check -- same "predates this migration set,
-- create table if not exists was a no-op" drift found everywhere else today.
-- =============================================================================
-- 0005 declares club_members.role's CHECK as
-- ('owner','president','vice_president','secretary','coordinator','member')
-- in its `create table if not exists`, but the table already existed with
-- the legacy constraint ('member','admin','president') and nothing ever
-- ALTERed it -- unlike other tables in this migration set that got an
-- explicit `alter table ... drop/add constraint` for exactly this reason.
-- Two real, previously-undiscovered breakages from it: the existing
-- ClubMembersModal admin UI (src/features/admin/AdminCMS.jsx) already
-- offers coordinator/secretary/vice_president/owner as role choices -- any
-- of those has been rejected by the DB since it shipped -- and
-- approve_org_request() (0038) fails inserting the requester as 'owner'
-- when their club request is approved. Found live via the second one.

alter table public.club_members drop constraint if exists club_members_role_check;
alter table public.club_members add constraint club_members_role_check
  check (role in ('owner','president','vice_president','secretary','coordinator','member'));
