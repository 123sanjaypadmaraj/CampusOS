-- =============================================================================
-- 0169: PAID EVENTS. The events-production-completion pass (0150) explicitly
-- scoped paid events out: "events have no price column and no payment
-- integration today." That's no longer true of the platform as a whole --
-- the payment-hardening pass built a real gateway/webhook/refund pipeline
-- (0004, 0017, printing_v2's extension of it) keyed on a shared `payments`
-- table with an XOR target column per payable thing (order_id, print_job_id).
-- This migration adds a third target (event_registration_id) the same way
-- printing_v2 added the second one -- record_payment_event/
-- mark_refund_completed/payments_read/refunds_read get one more branch each,
-- byte-for-byte unchanged for the existing two targets.
--
-- Design notes:
--  * events.price is null/0 for a free event -- register_for_event's
--    existing free flow is completely unchanged in that case.
--  * A paid registration reserves its capacity slot immediately (status =
--    'confirmed', payment_status = 'pending') -- same reasoning as a
--    PAYMENT_PENDING food order holding stock -- but does NOT mint an
--    event_ticket until record_payment_event sees a captured+verified
--    payment. No ticket = no valid entry, so an abandoned checkout can never
--    grant access even if the row lingers.
--  * Abandoned/failed paid registrations are swept by
--    expire_stale_event_registrations() on the same pg_cron cadence as
--    expire_stale_food_orders(), releasing the seat (and promoting the next
--    waitlisted person) after 30 minutes -- otherwise a closed Razorpay tab
--    would squat a seat forever.
--  * Waitlist promotion (both on cancellation and on expiry) now checks the
--    event's price: a free event promotes straight to a ticketed
--    registration exactly as before; a paid event promotes to a
--    payment-pending registration and notifies the student they have 30
--    minutes to pay before the seat is offered to the next person in line.
-- =============================================================================

-- =========================================================
-- 1. SCHEMA
-- =========================================================

alter table public.events add column if not exists price numeric(10,2);
do $$ begin
  alter table public.events add constraint events_price_non_negative check (price is null or price >= 0);
exception when duplicate_object then null; end $$;

alter table public.event_registrations add column if not exists payment_status text not null default 'not_required';
do $$ begin
  alter table public.event_registrations add constraint event_registrations_payment_status_check
    check (payment_status in ('not_required','pending','paid','failed','refund_pending','refunded','expired'));
exception when duplicate_object then null; end $$;
alter table public.event_registrations add column if not exists payment_id uuid references public.payments(id) on delete set null;

alter table public.payments add column if not exists event_registration_id uuid references public.event_registrations(id) on delete cascade;
do $$ begin
  alter table public.payments drop constraint if exists payments_target_xor;
  alter table public.payments add constraint payments_target_xor
    check ((order_id is not null)::int + (print_job_id is not null)::int + (event_registration_id is not null)::int = 1);
exception when others then null; end $$;
create index if not exists payments_event_registration_idx on public.payments(event_registration_id) where event_registration_id is not null;

alter table public.refunds add column if not exists event_registration_id uuid references public.event_registrations(id) on delete cascade;
do $$ begin
  alter table public.refunds drop constraint if exists refunds_target_xor;
  alter table public.refunds add constraint refunds_target_xor
    check ((order_id is not null)::int + (print_job_id is not null)::int + (event_registration_id is not null)::int = 1);
exception when others then null; end $$;
create index if not exists refunds_event_registration_idx on public.refunds(event_registration_id) where event_registration_id is not null;

-- =========================================================
-- 2. RLS -- extend, don't replace, the existing clauses (mirrors printing_v2)
-- =========================================================

drop policy if exists "payments_read" on public.payments;
create policy "payments_read" on public.payments for select to authenticated
  using (
    exists (select 1 from public.orders o where o.id = payments.order_id and o.user_id = auth.uid())
    or exists (select 1 from public.print_jobs pj where pj.id = payments.print_job_id and pj.user_id = auth.uid())
    or exists (select 1 from public.event_registrations er where er.id = payments.event_registration_id and er.user_id = auth.uid())
    or public.has_permission(auth.uid(),'finance.read') or public.current_user_is_admin()
  );

drop policy if exists "refunds_read" on public.refunds;
create policy "refunds_read" on public.refunds for select to authenticated
  using (
    exists (select 1 from public.orders o where o.id = refunds.order_id and o.user_id = auth.uid())
    or exists (select 1 from public.print_jobs pj where pj.id = refunds.print_job_id and pj.user_id = auth.uid())
    or exists (select 1 from public.event_registrations er where er.id = refunds.event_registration_id and er.user_id = auth.uid())
    or public.has_permission(auth.uid(),'finance.read')
    or public.current_user_is_admin()
    or exists (
      select 1 from public.orders o join public.canteens c on c.id = o.canteen_id
      where o.id = refunds.order_id
        and public.has_permission(auth.uid(),'food.refunds.create') and c.owner_id = auth.uid()
    )
  );

-- =========================================================
-- 3. create_event_payment_order -- mirrors create_print_payment_order().
-- =========================================================

create or replace function public.create_event_payment_order(p_registration_id uuid)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_reg public.event_registrations;
  v_event public.events;
  v_payment public.payments;
begin
  if v_user is null then raise exception 'Sign in required'; end if;

  select * into v_reg from public.event_registrations where id = p_registration_id and user_id = v_user for update;
  if not found then raise exception 'Registration not found'; end if;

  if v_reg.status <> 'confirmed' or v_reg.payment_status not in ('pending','failed') then
    raise exception 'This registration is not awaiting payment';
  end if;

  select * into v_event from public.events where id = v_reg.event_id;
  if v_event.price is null or v_event.price <= 0 then
    raise exception 'This event does not require payment';
  end if;

  select * into v_payment from public.payments where event_registration_id = p_registration_id and status = 'created' order by created_at desc limit 1;
  if found then
    return v_payment;
  end if;

  insert into public.payments (event_registration_id, amount, currency, status)
  values (p_registration_id, v_event.price, 'INR', 'created')
  returning * into v_payment;

  return v_payment;
end;
$$;
revoke all on function public.create_event_payment_order(uuid) from public, anon;
grant execute on function public.create_event_payment_order(uuid) to authenticated;

-- =========================================================
-- 4. record_payment_event -- add the event-registration branch. Order/
-- print-job behaviour below is byte-for-byte unchanged from printing_v2.
-- =========================================================

create or replace function public.record_payment_event(
  p_gateway_order_id text,
  p_gateway_payment_id text,
  p_status text,
  p_signature_verified boolean,
  p_raw_payload jsonb
)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments;
  v_order public.orders;
  v_job public.print_jobs;
  v_reg public.event_registrations;
  v_event public.events;
begin
  select * into v_payment from public.payments where gateway_order_id = p_gateway_order_id for update;
  if not found then
    raise exception 'Unknown gateway_order_id %', p_gateway_order_id;
  end if;

  update public.payments
    set gateway_payment_id = p_gateway_payment_id,
        status = p_status,
        signature_verified = p_signature_verified,
        raw_payload = p_raw_payload
    where id = v_payment.id
    returning * into v_payment;

  insert into public.payment_events (payment_id, event_type, payload)
  values (v_payment.id, p_status, p_raw_payload);

  if p_status = 'captured' and p_signature_verified then

    if v_payment.order_id is not null then
      select * into v_order from public.orders where id = v_payment.order_id for update;

      if v_order.status = 'PAYMENT_PENDING' then
        update public.orders set status = 'PAID', payment_status = 'paid' where id = v_order.id;
        insert into public.order_status_history (order_id, from_status, to_status, reason)
        values (v_order.id, 'PAYMENT_PENDING', 'PAID', 'gateway webhook verified');

        update public.orders set status = 'RECEIVED' where id = v_order.id;
        insert into public.order_status_history (order_id, from_status, to_status, reason)
        values (v_order.id, 'PAID', 'RECEIVED', 'auto-forwarded to vendor queue');
      end if;

    elsif v_payment.print_job_id is not null then
      select * into v_job from public.print_jobs where id = v_payment.print_job_id for update;

      if v_job.status = 'AWAITING_PAYMENT' then
        update public.print_jobs
          set status = 'UPLOADED', payment_id = v_payment.id, expires_at = now() + interval '14 days'
          where id = v_job.id;
      end if;

    elsif v_payment.event_registration_id is not null then
      select * into v_reg from public.event_registrations where id = v_payment.event_registration_id for update;

      if v_reg.status = 'confirmed' and v_reg.payment_status in ('pending','failed') then
        update public.event_registrations
          set payment_status = 'paid', payment_id = v_payment.id
          where id = v_reg.id;

        -- A retried-after-failure attempt may have left a stale ticket from
        -- an earlier partial run; start clean, same defensive pattern
        -- register_for_event already uses for a revived cancelled row.
        delete from public.event_tickets where registration_id = v_reg.id;
        insert into public.event_tickets (event_id, registration_id) values (v_reg.event_id, v_reg.id);

        select * into v_event from public.events where id = v_reg.event_id;
        insert into public.notifications (user_id, type, title, body, action_type, action_id)
        values (v_reg.user_id, 'event', 'Payment confirmed',
                'Your payment for ' || coalesce(v_event.title, 'the event') || ' is confirmed -- your ticket is ready.',
                'event', v_reg.event_id::text);
      end if;
    end if;

  elsif p_status = 'failed' then
    if v_payment.order_id is not null then
      update public.orders set payment_status = 'failed' where id = v_payment.order_id;
    elsif v_payment.event_registration_id is not null then
      update public.event_registrations set payment_status = 'failed' where id = v_payment.event_registration_id;
    end if;
    -- A failed print-job payment needs no state change -- the job just stays
    -- AWAITING_PAYMENT so the student can retry, and expires on its own.
  end if;

  return v_payment;
end;
$$;

revoke execute on function public.record_payment_event(text, text, text, boolean, jsonb) from public, anon, authenticated;

-- =========================================================
-- 5. mark_refund_completed -- add the event-registration branch.
-- =========================================================

create or replace function public.mark_refund_completed(p_refund_id uuid, p_gateway_refund_id text)
returns public.refunds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refund public.refunds;
begin
  update public.refunds set status = 'completed', gateway_refund_id = p_gateway_refund_id where id = p_refund_id returning * into v_refund;

  if v_refund.order_id is not null then
    update public.orders set status = 'REFUNDED', payment_status = 'refunded' where id = v_refund.order_id;
    insert into public.order_status_history (order_id, to_status, reason)
    values (v_refund.order_id, 'REFUNDED', 'gateway refund completed');
  elsif v_refund.event_registration_id is not null then
    update public.event_registrations set payment_status = 'refunded' where id = v_refund.event_registration_id;
  end if;
  -- print_job_id case: the job is already CANCELLED (set by cancel_print_job
  -- at request time); the refunds row itself is the source of truth for
  -- "did the money actually come back", same as payments is for the charge.

  return v_refund;
end;
$$;

revoke execute on function public.mark_refund_completed(uuid, text) from public, anon, authenticated;

-- =========================================================
-- 6. register_for_event -- price-aware. Free-event behaviour (price is
-- null/0) is unchanged; resuming an existing pending/failed payment returns
-- the same registration instead of raising EVENT_ALREADY_REGISTERED.
-- =========================================================

create or replace function public.register_for_event(
  p_event_id uuid,
  p_contact_phone text default null,
  p_contact_name text default null,
  p_roll_number text default null,
  p_department text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_event public.events;
  v_profile public.profiles;
  v_confirmed_count integer;
  v_next_position integer;
  v_registration public.event_registrations;
  v_ticket public.event_tickets;
  v_existing public.event_registrations;
  v_needs_payment boolean;
  v_phone text := nullif(trim(p_contact_phone), '');
  v_name text;
  v_roll text := nullif(trim(p_roll_number), '');
  v_dept text := nullif(trim(p_department), '');
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;

  if not public.check_rate_limit(v_user, 'event_registrations', 20, 3600) then
    raise exception 'RATE_LIMITED: too many registration attempts, slow down';
  end if;

  if v_phone is null or v_phone !~ '^\+?[0-9]{7,15}$' then
    raise exception 'CONTACT_PHONE_INVALID: enter a valid phone number';
  end if;

  select * into v_profile from public.profiles where id = v_user;
  if not found then
    raise exception 'Profile not found';
  end if;

  v_name := coalesce(nullif(trim(p_contact_name), ''), v_profile.name);
  if v_name is null or v_name = '' then
    raise exception 'CONTACT_NAME_INVALID: enter a name';
  end if;

  select * into v_event from public.events where id = p_event_id for update;
  if not found then
    raise exception 'Event not found';
  end if;

  if v_event.registration_status in ('CLOSED','CANCELLED') then
    raise exception 'EVENT_REGISTRATION_CLOSED';
  end if;

  v_needs_payment := v_event.price is not null and v_event.price > 0;

  select * into v_existing from public.event_registrations where event_id = p_event_id and user_id = v_user and status = 'confirmed';
  if found then
    if v_existing.payment_status in ('pending','failed') then
      -- Resume: same registration, let the caller ask for a fresh gateway
      -- order instead of erroring out on a checkout the student never
      -- finished (or that failed and they're retrying).
      return jsonb_build_object('status', 'payment_pending', 'registration_id', v_existing.id, 'amount', v_event.price);
    end if;
    raise exception 'EVENT_ALREADY_REGISTERED';
  end if;

  update public.profiles set
      phone = v_phone,
      roll_number = coalesce(v_roll, roll_number),
      department = coalesce(v_dept, department),
      updated_at = now()
    where id = v_user
      and (phone is distinct from v_phone or v_roll is not null or v_dept is not null);

  select count(*) into v_confirmed_count from public.event_registrations where event_id = p_event_id and status = 'confirmed';

  if v_event.capacity is not null and v_confirmed_count >= v_event.capacity then
    select coalesce(max(position), 0) + 1 into v_next_position from public.event_waitlist where event_id = p_event_id;
    insert into public.event_waitlist (event_id, user_id, position, contact_name, contact_usn, contact_email, contact_phone, contact_roll_number, contact_department)
      values (p_event_id, v_user, v_next_position, v_name, v_profile.usn, v_profile.email, v_phone, v_roll, v_dept)
      on conflict (event_id, user_id) do update set
        position = excluded.position, contact_name = excluded.contact_name, contact_usn = excluded.contact_usn,
        contact_email = excluded.contact_email, contact_phone = excluded.contact_phone,
        contact_roll_number = excluded.contact_roll_number, contact_department = excluded.contact_department;
    update public.events set registration_status = 'WAITLIST' where id = p_event_id and registration_status = 'OPEN';
    return jsonb_build_object('status', 'waitlisted', 'position', v_next_position);
  end if;

  insert into public.event_registrations (event_id, user_id, contact_name, contact_usn, contact_email, contact_phone, contact_roll_number, contact_department, status, payment_status, registered_at)
    values (p_event_id, v_user, v_name, v_profile.usn, v_profile.email, v_phone, v_roll, v_dept, 'confirmed', case when v_needs_payment then 'pending' else 'not_required' end, now())
    on conflict (event_id, user_id) do update set
      status = 'confirmed', payment_status = case when v_needs_payment then 'pending' else 'not_required' end,
      contact_name = excluded.contact_name, contact_usn = excluded.contact_usn,
      contact_email = excluded.contact_email, contact_phone = excluded.contact_phone,
      contact_roll_number = excluded.contact_roll_number, contact_department = excluded.contact_department,
      registered_at = now()
    returning * into v_registration;

  if v_event.capacity is not null and v_confirmed_count + 1 >= v_event.capacity then
    update public.events set registration_status = 'FULL' where id = p_event_id;
  end if;

  if v_needs_payment then
    -- No ticket yet -- only record_payment_event mints one, once paid.
    return jsonb_build_object('status', 'payment_pending', 'registration_id', v_registration.id, 'amount', v_event.price);
  end if;

  delete from public.event_tickets where registration_id = v_registration.id;
  insert into public.event_tickets (event_id, registration_id) values (p_event_id, v_registration.id)
    returning * into v_ticket;

  return jsonb_build_object('status', 'confirmed', 'registration_id', v_registration.id, 'ticket_token', v_ticket.token);
end;
$$;

-- =========================================================
-- 7. cancel_event_registration -- now returns jsonb (refund_id, like
-- cancel_print_job) instead of void, and promotion respects the event's
-- price. Return type change means DROP + CREATE, not just CREATE OR REPLACE.
-- =========================================================

drop function if exists public.cancel_event_registration(uuid);

create function public.cancel_event_registration(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_promoted record;
  v_event public.events;
  v_registration public.event_registrations;
  v_payment public.payments;
  v_refund public.refunds;
  v_refund_id uuid;
  v_promoted_needs_payment boolean;
begin
  select * into v_event from public.events where id = p_event_id for update;

  update public.event_registrations set status = 'cancelled'
    where event_id = p_event_id and user_id = v_user and status = 'confirmed'
    returning * into v_registration;

  if not found then
    raise exception 'No active registration found';
  end if;

  -- A captured payment on a cancelled registration gets a refund request
  -- the same way cancel_print_job() does; the frontend drives it through
  -- razorpay-refund right after. A pending/failed payment needed no charge
  -- to begin with, so there's nothing to refund.
  if v_registration.payment_status = 'paid' and v_registration.payment_id is not null then
    select * into v_payment from public.payments where id = v_registration.payment_id;
    if found and v_payment.status = 'captured' then
      update public.event_registrations set payment_status = 'refund_pending' where id = v_registration.id;
      insert into public.refunds (payment_id, event_registration_id, amount, reason, refund_type, initiated_by)
      values (v_payment.id, v_registration.id, v_payment.amount, 'Student cancelled registration', 'full', v_user)
      returning * into v_refund;
      v_refund_id := v_refund.id;
    end if;
  end if;

  select * into v_promoted from public.event_waitlist where event_id = p_event_id order by position asc limit 1;
  if found then
    delete from public.event_waitlist where id = v_promoted.id;
    v_promoted_needs_payment := v_event.price is not null and v_event.price > 0;

    insert into public.event_registrations (event_id, user_id, contact_name, contact_usn, contact_email, contact_phone, contact_roll_number, contact_department, status, payment_status)
      values (p_event_id, v_promoted.user_id, v_promoted.contact_name, v_promoted.contact_usn, v_promoted.contact_email, v_promoted.contact_phone, v_promoted.contact_roll_number, v_promoted.contact_department,
              'confirmed', case when v_promoted_needs_payment then 'pending' else 'not_required' end)
      on conflict (event_id, user_id) do update set
        status = 'confirmed', payment_status = case when v_promoted_needs_payment then 'pending' else 'not_required' end,
        contact_name = excluded.contact_name, contact_usn = excluded.contact_usn,
        contact_email = excluded.contact_email, contact_phone = excluded.contact_phone,
        contact_roll_number = excluded.contact_roll_number, contact_department = excluded.contact_department;

    if v_promoted_needs_payment then
      insert into public.notifications (user_id, type, title, body, action_type, action_id)
        values (v_promoted.user_id, 'event', 'You are off the waitlist -- pay within 30 minutes',
                'A paid spot opened up for ' || coalesce(v_event.title,'an event') || ' (₹' || v_event.price || '). Complete payment within 30 minutes or it goes to the next person.',
                'event', p_event_id::text);
    else
      insert into public.event_tickets (event_id, registration_id)
        select p_event_id, id from public.event_registrations where event_id = p_event_id and user_id = v_promoted.user_id;
      insert into public.notifications (user_id, type, title, body, action_type, action_id)
        values (v_promoted.user_id, 'event', 'You are off the waitlist!',
                'A spot opened up for ' || coalesce(v_event.title,'an event') || '.', 'event', p_event_id::text);
    end if;
  else
    update public.events set registration_status = 'OPEN' where id = p_event_id and registration_status in ('FULL','WAITLIST');
  end if;

  return jsonb_build_object('registration', to_jsonb(v_registration), 'refund_id', v_refund_id);
end;
$$;

-- =========================================================
-- 8. expire_stale_event_registrations -- sweeps paid registrations abandoned
-- mid-checkout (or whose payment failed and was never retried), releasing
-- the seat, same 30-minute/15-minute-cron pattern as
-- expire_stale_food_orders().
-- =========================================================

create or replace function public.expire_stale_event_registrations()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg record;
  v_event public.events;
  v_promoted record;
  v_promoted_needs_payment boolean;
begin
  for v_reg in
    select * from public.event_registrations
    where status = 'confirmed' and payment_status in ('pending','failed') and registered_at < now() - interval '30 minutes'
    for update skip locked
  loop
    select * into v_event from public.events where id = v_reg.event_id for update;

    update public.event_registrations set status = 'cancelled', payment_status = 'expired' where id = v_reg.id;

    select * into v_promoted from public.event_waitlist where event_id = v_reg.event_id order by position asc limit 1;
    if found then
      delete from public.event_waitlist where id = v_promoted.id;
      v_promoted_needs_payment := v_event.price is not null and v_event.price > 0;

      insert into public.event_registrations (event_id, user_id, contact_name, contact_usn, contact_email, contact_phone, contact_roll_number, contact_department, status, payment_status)
        values (v_reg.event_id, v_promoted.user_id, v_promoted.contact_name, v_promoted.contact_usn, v_promoted.contact_email, v_promoted.contact_phone, v_promoted.contact_roll_number, v_promoted.contact_department,
                'confirmed', case when v_promoted_needs_payment then 'pending' else 'not_required' end)
        on conflict (event_id, user_id) do update set
          status = 'confirmed', payment_status = case when v_promoted_needs_payment then 'pending' else 'not_required' end,
          contact_name = excluded.contact_name, contact_usn = excluded.contact_usn,
          contact_email = excluded.contact_email, contact_phone = excluded.contact_phone,
          contact_roll_number = excluded.contact_roll_number, contact_department = excluded.contact_department;

      if v_promoted_needs_payment then
        insert into public.notifications (user_id, type, title, body, action_type, action_id)
          values (v_promoted.user_id, 'event', 'You are off the waitlist -- pay within 30 minutes',
                  'A paid spot opened up for ' || coalesce(v_event.title,'an event') || ' (₹' || v_event.price || '). Complete payment within 30 minutes or it goes to the next person.',
                  'event', v_reg.event_id::text);
      else
        insert into public.event_tickets (event_id, registration_id)
          select v_reg.event_id, id from public.event_registrations where event_id = v_reg.event_id and user_id = v_promoted.user_id;
        insert into public.notifications (user_id, type, title, body, action_type, action_id)
          values (v_promoted.user_id, 'event', 'You are off the waitlist!',
                  'A spot opened up for ' || coalesce(v_event.title,'an event') || '.', 'event', v_reg.event_id::text);
      end if;
    else
      update public.events set registration_status = 'OPEN' where id = v_reg.event_id and registration_status in ('FULL','WAITLIST');
    end if;

    insert into public.notifications (user_id, type, title, body, action_type, action_id)
      values (v_reg.user_id, 'event', 'Registration expired',
              'Your payment window for ' || coalesce(v_event.title,'an event') || ' closed before payment was completed -- your spot was released.',
              'event', v_reg.event_id::text);
  end loop;
end;
$$;
revoke execute on function public.expire_stale_event_registrations() from public, anon, authenticated;

do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'expire-stale-event-registrations';
exception when others then null; end $$;
select cron.schedule('expire-stale-event-registrations', '*/15 * * * *', $$select public.expire_stale_event_registrations();$$);

-- =========================================================
-- 9. get_event_roster -- add payment_status so organizers can tell a paid
-- confirmation apart from one still awaiting payment.
-- =========================================================

drop function if exists public.get_event_roster(uuid);

create function public.get_event_roster(p_event_id uuid)
returns table (
  registration_id uuid,
  user_id uuid,
  name text,
  usn text,
  email text,
  phone text,
  status text,
  payment_status text,
  waitlist_position integer,
  ticket_token text,
  checked_in_at timestamptz,
  registered_at timestamptz
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
  select * into v_event from public.events where id = p_event_id;
  if not found then
    raise exception 'Event not found';
  end if;

  if not (
    v_event.organizer_id = v_user or public.is_club_leader(v_user, v_event.club_id)
    or public.has_permission(v_user, 'events.checkin') or public.current_user_is_admin()
  ) then
    raise exception 'Not authorized to view this event roster';
  end if;

  return query
    select * from (
      select r.id as registration_id, r.user_id, r.contact_name as name, r.contact_usn as usn,
        r.contact_email as email, r.contact_phone as phone,
        'confirmed'::text as status, r.payment_status, null::integer as waitlist_position,
        t.token as ticket_token, t.checked_in_at, r.registered_at
      from public.event_registrations r
      left join public.event_tickets t on t.registration_id = r.id
      where r.event_id = p_event_id and r.status = 'confirmed'
      union all
      select null::uuid as registration_id, w.user_id, w.contact_name as name, w.contact_usn as usn,
        w.contact_email as email, w.contact_phone as phone,
        'waitlisted'::text as status, 'n/a'::text as payment_status, w.position as waitlist_position,
        null::text as ticket_token, null::timestamptz as checked_in_at, w.created_at as registered_at
      from public.event_waitlist w
      where w.event_id = p_event_id
    ) roster
    order by status asc, waitlist_position asc nulls last, registered_at asc;
end;
$$;

grant execute on function public.get_event_roster(uuid) to authenticated;

-- =========================================================
-- 10. get_club_dashboard -- surface price in the club officer's own events
-- list (everything else in this jsonb_build_object is unchanged).
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
        'certificates_enabled', e.certificates_enabled, 'cover_image_url', e.cover_image_url
      ) order by e.event_date desc), '[]'::jsonb)
      from public.events_with_counts e where e.club_id = p_club_id
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
