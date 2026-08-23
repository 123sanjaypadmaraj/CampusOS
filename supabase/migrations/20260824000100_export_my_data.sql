-- -----------------------------------------------------------------------------
-- Self-service data export (readiness-audit phase 06: legal/DPDP).
--
-- docs/DATA_RETENTION.md and the Privacy Policy in src/App.jsx's
-- LegalContent() both said "to request a copy of your data, contact your
-- campus admin" -- there was no in-app self-service export, only the
-- self-service *deletion* request added in
-- 20260818000500_email_domain_enforcement_and_account_deletion.sql. That's
-- a real gap against DPDP Act data-principal "right to access" -- this
-- closes it the same way deletion was closed: an RPC scoped to auth.uid(),
-- no new storage/table needed since every result is computed on read.
--
-- Deliberately NOT exhaustive over all ~90 tables in this schema -- scoped
-- to the tables that hold a student's own generated content/activity
-- (orders, registrations, memberships, listings, reports, tickets,
-- bookings, jobs, contacts, posts/comments, verification, and any account
-- deletion request history). Tables that are about *other* people's data
-- referencing this user only incidentally (e.g. being on the other side of
-- a marketplace conversation, or a ticket someone else filed that mentions
-- them) are out of scope for the same reason a phone bill export doesn't
-- include the other party's full call history.
-- -----------------------------------------------------------------------------

create or replace function public.export_my_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Please sign in first.';
  end if;

  select jsonb_build_object(
    'exported_at', now(),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = v_uid),
    'orders', coalesce((select jsonb_agg(to_jsonb(o)) from public.orders o where o.user_id = v_uid), '[]'::jsonb),
    'store_orders', coalesce((select jsonb_agg(to_jsonb(o)) from public.store_orders o where o.user_id = v_uid), '[]'::jsonb),
    'event_registrations', coalesce((select jsonb_agg(to_jsonb(r)) from public.event_registrations r where r.user_id = v_uid), '[]'::jsonb),
    'club_memberships', coalesce((select jsonb_agg(to_jsonb(m)) from public.club_members m where m.user_id = v_uid), '[]'::jsonb),
    'marketplace_listings', coalesce((select jsonb_agg(to_jsonb(l)) from public.marketplace_listings l where l.seller_id = v_uid), '[]'::jsonb),
    'lost_found_items', coalesce((select jsonb_agg(to_jsonb(i)) from public.lost_found_items i where i.user_id = v_uid), '[]'::jsonb),
    'support_tickets', coalesce((select jsonb_agg(to_jsonb(t)) from public.support_tickets t where t.user_id = v_uid), '[]'::jsonb),
    'service_requests', coalesce((select jsonb_agg(to_jsonb(s)) from public.service_requests s where s.user_id = v_uid), '[]'::jsonb),
    'bookings', coalesce((select jsonb_agg(to_jsonb(b)) from public.bookings b where b.user_id = v_uid), '[]'::jsonb),
    'print_jobs', coalesce((select jsonb_agg(to_jsonb(j)) from public.print_jobs j where j.user_id = v_uid), '[]'::jsonb),
    'emergency_contacts', coalesce((select jsonb_agg(to_jsonb(c)) from public.emergency_contacts c where c.user_id = v_uid), '[]'::jsonb),
    'posts', coalesce((select jsonb_agg(to_jsonb(p)) from public.posts p where p.author_id = v_uid), '[]'::jsonb),
    'comments', coalesce((select jsonb_agg(to_jsonb(c)) from public.comments c where c.author_id = v_uid), '[]'::jsonb),
    'sos_alerts', coalesce((select jsonb_agg(to_jsonb(a)) from public.sos_alerts a where a.user_id = v_uid), '[]'::jsonb),
    'student_verification', coalesce((select jsonb_agg(to_jsonb(v)) from public.student_verifications v where v.user_id = v_uid), '[]'::jsonb),
    'account_deletion_requests', coalesce((select jsonb_agg(to_jsonb(r)) from public.account_deletion_requests r where r.user_id = v_uid), '[]'::jsonb)
  ) into v_result;

  -- Exports are worth an audit trail too -- someone pulling their own data
  -- isn't suspicious, but a support/legal question later ("did the student
  -- ever actually get their data?") should be answerable from audit_logs
  -- the same way account.delete already is.
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, reason)
  values (v_uid, 'account.export_data', 'profile', v_uid::text, 'self-service data export');

  return v_result;
end;
$$;

revoke execute on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
