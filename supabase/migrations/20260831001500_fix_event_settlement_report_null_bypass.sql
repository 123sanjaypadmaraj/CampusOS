-- =============================================================================
-- Fix a real null-comparison authorization bypass in event_settlement_report()
-- (20260831001400_event_payouts.sql), found by the pentest re-sweep's
-- follow-up pass on the event_payouts ledger (the one surface commit
-- 6f8d30c's 4-surface sweep didn't cover -- it shipped via a separate merge
-- the same day).
--
-- Same bug class as 20260831000500_fix_academic_scope_null_bypass.sql:
--   v_event.organizer_id = v_user
-- In plpgsql, `x = y` is NULL (not false) whenever x or y is NULL, and an
-- `if not (a or b or c or d)` whose first term evaluates to NULL rather than
-- a real boolean can itself evaluate to NULL instead of TRUE even when every
-- other term is a real FALSE -- and `if <null>` never fires in plpgsql, same
-- as `if <false>`. events.organizer_id is NULL for every club-run event by
-- design (this migration's own header: "Payee: events.club_id when the event
-- belongs to a club ... else events.organizer_id for a lone-organizer
-- event") -- i.e. NULL organizer_id is the *common* case, not an edge case,
-- so this bypassed authorization for the settlement report of essentially
-- every club event, not just a rare null-profile corner case.
--
-- Confirmed live on staging before this fix: e2e.alice (a plain student,
-- not a leader of the target club) called event_settlement_report() against
-- a real club event with organizer_id NULL and got HTTP 200 back (an empty
-- result only because that particular event had no paid registrations yet --
-- a populated one would have handed her its itemized ticket revenue and
-- refunds) instead of the expected 'Not authorized' exception.
--
-- Fix: `is not distinct from` (Postgres' null-safe equality) instead of `=`,
-- same remedy 20260831000500 already applied to publish_announcement()/
-- create_academic_deadline(). v_user is guaranteed non-null by the earlier
-- `if v_user is null then raise exception 'Sign in required'` check, so this
-- is now false (never null) whenever organizer_id doesn't exactly match the
-- caller -- including whenever it's NULL. Everything else in the function is
-- byte-for-byte unchanged from 20260831001400.
-- =============================================================================

create or replace function public.event_settlement_report(p_event_id uuid)
returns table (
  row_type text,
  occurred_on date,
  registration_id uuid,
  description text,
  gross_amount numeric,
  platform_fee numeric,
  net_amount numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_event public.events;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;

  select * into v_event from public.events where id = p_event_id;
  if not found then
    raise exception 'Event not found';
  end if;

  if not (
    v_event.organizer_id is not distinct from v_user
    or (v_event.club_id is not null and public.is_club_leader(v_user, v_event.club_id))
    or public.has_permission(v_user, 'finance.read')
    or public.current_user_is_admin()
  ) then
    raise exception 'Not authorized to view this event''s settlement report';
  end if;

  return query
  select
    'registration'::text as row_type, r.registered_at::date as occurred_on, r.id as registration_id,
    ('Registration ' || upper(left(r.id::text, 8)))::text as description,
    p.amount::numeric as gross_amount, round(p.amount * 0.05, 2)::numeric as platform_fee,
    (p.amount - round(p.amount * 0.05, 2))::numeric as net_amount
  from public.event_registrations r
  join public.payments p on p.id = r.payment_id
  where r.event_id = p_event_id and r.payment_status in ('paid', 'refund_pending', 'refunded')
  union all
  select
    'refund'::text, rf.updated_at::date, rf.event_registration_id,
    ('Refund: ' || coalesce(rf.reason, '—'))::text,
    (-rf.amount)::numeric, 0::numeric, (-rf.amount)::numeric
  from public.refunds rf
  where rf.event_registration_id in (select id from public.event_registrations where event_id = p_event_id)
    and rf.status = 'completed'
  order by occurred_on, row_type;
end;
$$;

grant execute on function public.event_settlement_report(uuid) to authenticated;
