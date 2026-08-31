-- =============================================================================
-- 0170: EVENT PAYOUTS -- the bookkeeping layer paid events never got.
-- 0169 (paid_events) built the charge path (create_event_payment_order /
-- record_payment_event) but nothing tracks how much a club/organizer is
-- OWED once the platform has collected their ticket revenue -- unlike Food
-- (0004/0017's vendor_payouts) and Campus Store (0021's settlement report),
-- paid events had no payout ledger at all. This mirrors vendor_payouts
-- closely, with one structural difference: a canteen operates continuously,
-- so its payouts are period-based (period_start/period_end); an event is a
-- one-off, so its payout is scoped to the event itself (one row per event,
-- not per period). The live money transfer still needs a real Razorpay
-- account (phase 04's KYC-blocked half) -- this is the tracking/reporting
-- half, buildable and testable now against test-mode payments exactly like
-- vendor_payouts already is.
--
-- Payee: events.club_id when the event belongs to a club (the common case --
-- club treasurers/officers are the payee), else events.organizer_id for a
-- lone-organizer event (club_id is nullable on events, see 0005). Both are
-- snapshotted onto the payout row at generation time.
--
-- Platform fee: paid_events never introduced a platform-fee concept (create_
-- event_payment_order charges the student exactly events.price, same as
-- Razorpay Checkout amount) -- unlike orders/store_orders, there is no
-- platform_fee column to sum from. Following Food's own pattern (a fixed
-- constant baked into the payout function, not a vendor/organizer-editable
-- column -- see food_billing_payouts' v_platform_fee), this introduces a
-- flat 5% platform cut computed at generation time, applied to gross ticket
-- revenue. A rate, not a fixed amount, because unlike a ₹10 food order fee
-- a ticket can be priced anywhere from ₹49 to several thousand rupees.
-- =============================================================================

-- =========================================================
-- 1. EVENT_PAYOUTS -- one row per event (unique on event_id), not per
-- period. Same status lifecycle as vendor_payouts (pending -> processing ->
-- paid), same "admin-generated/confirmed only" posture (real money leaving
-- the platform is never self-service).
-- =========================================================

create table if not exists public.event_payouts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique references public.events(id) on delete cascade,
  club_id uuid references public.clubs(id) on delete set null,
  organizer_id uuid references public.profiles(id) on delete set null,
  gross_amount numeric(10,2) not null default 0,
  platform_fee_amount numeric(10,2) not null default 0,
  refund_amount numeric(10,2) not null default 0,
  net_amount numeric(10,2) not null default 0,
  status text not null default 'pending' check (status in ('pending', 'processing', 'paid')),
  reference text,
  paid_at timestamptz,
  generated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (club_id is not null or organizer_id is not null)
);

create index if not exists event_payouts_club_idx on public.event_payouts(club_id, created_at desc);
create index if not exists event_payouts_organizer_idx on public.event_payouts(organizer_id, created_at desc) where club_id is null;

alter table public.event_payouts enable row level security;

drop policy if exists "event_payouts_read" on public.event_payouts;
create policy "event_payouts_read" on public.event_payouts for select to authenticated
  using (
    (club_id is not null and public.is_club_leader(auth.uid(), club_id))
    or organizer_id = auth.uid()
    or public.has_permission(auth.uid(), 'finance.read')
    or public.current_user_is_admin()
  );
-- No insert/update/delete policy for authenticated -- generate_event_payout()/mark_event_payout_paid() only.

-- =========================================================
-- 2. RPC: generate_event_payout -- admin only. Gross = sum of every
-- captured payment against this event's registrations (mirrors vendor_
-- payouts' "everything the vendor is owed before the platform's cut", read
-- via event_registrations.payment_id, not a payment_status filter on
-- payments itself -- record_payment_event never writes a per-target status
-- onto payments, event_registrations.payment_status is the source of truth,
-- same as orders.payment_status is for Food). Refuses to double-generate
-- the same event.
-- =========================================================

create or replace function public.generate_event_payout(p_event_id uuid)
returns public.event_payouts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_event public.events;
  v_gross numeric(10,2);
  v_fee numeric(10,2);
  v_refunds numeric(10,2);
  v_net numeric(10,2);
  v_payout public.event_payouts;
begin
  if not public.current_user_is_admin() then
    raise exception 'Only an admin can generate a payout';
  end if;

  select * into v_event from public.events where id = p_event_id;
  if not found then
    raise exception 'Event not found';
  end if;
  if v_event.price is null or v_event.price <= 0 then
    raise exception 'This event never charged for tickets -- nothing to pay out';
  end if;

  if exists (select 1 from public.event_payouts where event_id = p_event_id) then
    raise exception 'A payout for this event already exists';
  end if;

  select coalesce(sum(p.amount), 0) into v_gross
    from public.event_registrations r
    join public.payments p on p.id = r.payment_id
    where r.event_id = p_event_id and r.payment_status in ('paid', 'refund_pending', 'refunded');

  v_fee := round(v_gross * 0.05, 2);

  select coalesce(sum(rf.amount), 0) into v_refunds
    from public.refunds rf
    join public.event_registrations r on r.id = rf.event_registration_id
    where r.event_id = p_event_id and rf.status = 'completed';

  v_net := round(v_gross - v_fee - v_refunds, 2);

  insert into public.event_payouts (
    event_id, club_id, organizer_id, gross_amount, platform_fee_amount, refund_amount, net_amount, generated_by
  ) values (
    p_event_id, v_event.club_id, v_event.organizer_id, v_gross, v_fee, v_refunds, v_net, v_user
  )
  returning * into v_payout;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value)
  values (v_user, 'event_payout.generate', 'event', p_event_id::text, to_jsonb(v_payout));

  return v_payout;
end;
$$;

-- =========================================================
-- 3. RPC: mark_event_payout_paid -- admin only. Notifies every club leader
-- when the payee is a club (a treasurer specifically, not just whoever
-- happened to generate it -- reaches every leadership role via is_club_
-- leader's own role list), or the individual organizer otherwise.
-- =========================================================

create or replace function public.mark_event_payout_paid(p_payout_id uuid, p_reference text)
returns public.event_payouts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_payout public.event_payouts;
  v_event_title text;
  v_leader record;
begin
  if not public.current_user_is_admin() then
    raise exception 'Only an admin can mark a payout as paid';
  end if;

  update public.event_payouts set status = 'paid', reference = p_reference, paid_at = now()
    where id = p_payout_id
    returning * into v_payout;
  if not found then
    raise exception 'Payout not found';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value)
  values (v_user, 'event_payout.mark_paid', 'event_payout', p_payout_id::text, jsonb_build_object('reference', p_reference));

  select title into v_event_title from public.events where id = v_payout.event_id;

  if v_payout.club_id is not null then
    for v_leader in
      select user_id from public.club_members
      where club_id = v_payout.club_id
        and role in ('owner', 'president', 'vice_president', 'secretary', 'coordinator', 'treasurer', 'event_manager')
    loop
      perform public.create_notification(
        v_leader.user_id, 'Payout processed',
        'Your club''s payout of ₹' || v_payout.net_amount || ' for ' || coalesce(v_event_title, 'an event') || ' has been paid.',
        'payout', 'event_payout', p_payout_id::text
      );
    end loop;
  elsif v_payout.organizer_id is not null then
    perform public.create_notification(
      v_payout.organizer_id, 'Payout processed',
      'Your payout of ₹' || v_payout.net_amount || ' for ' || coalesce(v_event_title, 'an event') || ' has been paid.',
      'payout', 'event_payout', p_payout_id::text
    );
  end if;

  return v_payout;
end;
$$;

grant execute on function public.generate_event_payout(uuid) to authenticated;
grant execute on function public.mark_event_payout_paid(uuid, text) to authenticated;

-- =========================================================
-- 4. RPC: event_settlement_report -- self-service, itemized, for the club
-- leader/organizer of one specific event: every paid registration plus
-- every completed refund, same row-shape as vendor_settlement_report, so a
-- club/organizer can check their own numbers at any time, not just after an
-- admin generates a payout. The 5% fee is shown per-line the same way
-- generate_event_payout computes it, so the two never silently disagree.
-- =========================================================

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
    v_event.organizer_id = v_user
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

-- =========================================================
-- 5. get_club_dashboard -- surface payout status/net inline per event, so
-- a club officer sees "paid / pending / not generated" at a glance without
-- a separate round trip. Everything else in the events subquery is
-- unchanged from 0169's own extension of this function.
-- =========================================================

create or replace function public.get_club_dashboard(p_club_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_my_role text;
  v_result jsonb;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;

  select role into v_my_role from public.club_members where club_id = p_club_id and user_id = v_user;

  if coalesce(v_my_role, 'member') = 'member'
     and not (public.has_permission(v_user, 'clubs.manage') or public.current_user_is_admin()) then
    raise exception 'Not authorized to manage this club';
  end if;

  select jsonb_build_object(
    'club', (select to_jsonb(c) from public.clubs_with_counts c where c.id = p_club_id),
    'my_role', coalesce(v_my_role, 'admin'),
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id, 'user_id', m.user_id, 'role', m.role, 'joined_at', m.joined_at,
        'name', p.name, 'usn', p.usn, 'course', p.course, 'avatar_url', p.avatar_url
      ) order by m.joined_at), '[]'::jsonb)
      from public.club_members m join public.profiles p on p.id = m.user_id
      where m.club_id = p_club_id
    ),
    'events', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'title', e.title, 'category', e.category, 'event_date', e.event_date,
        'place', e.place, 'capacity', e.capacity, 'attendees', e.attendees, 'price', e.price,
        'checked_in_count', e.checked_in_count, 'avg_rating', e.avg_rating, 'feedback_count', e.feedback_count,
        'registration_status', e.registration_status, 'published', e.published,
        'approval_status', e.approval_status, 'rejection_reason', e.rejection_reason,
        'certificates_enabled', e.certificates_enabled, 'cover_image_url', e.cover_image_url,
        'payout_status', ep.status, 'payout_net_amount', ep.net_amount
      ) order by e.event_date desc), '[]'::jsonb)
      from public.events_with_counts e
      left join public.event_payouts ep on ep.event_id = e.id
      where e.club_id = p_club_id
    ),
    'member_growth', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d, 'new_members', cnt) order by d), '[]'::jsonb)
      from (
        select date_trunc('day', joined_at)::date as d, count(*) as cnt
        from public.club_members
        where club_id = p_club_id and joined_at >= now() - interval '30 days'
        group by 1
      ) t
    )
  ) into v_result;

  if v_result is null or (v_result->'club') = 'null'::jsonb then
    raise exception 'Club not found';
  end if;

  return v_result;
end;
$$;
