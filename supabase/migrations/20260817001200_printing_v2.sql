-- =============================================================================
-- 0033: PRINTING v2 (Phase 6 checklist) -- real payment, cancellation +
-- refund, duplex/binding pricing, pickup-code validation, reprint, printer
-- status, job history/daily sales, signed downloads, file expiry + cleanup.
-- Virus scanning is deliberately OUT of scope for this pass (explicit user
-- call -- no AV engine is reachable from an Edge Function here); what IS
-- enforced is real, honest structural validation (type/size), not a fake
-- "scanned clean" claim.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- print_jobs: new columns for the real state machine below.
-- ---------------------------------------------------------------------------
alter table public.print_jobs add column if not exists duplex boolean not null default false;
alter table public.print_jobs add column if not exists payment_id uuid references public.payments(id) on delete set null;
alter table public.print_jobs add column if not exists cancelled_at timestamptz;
alter table public.print_jobs add column if not exists cancel_reason text;
alter table public.print_jobs add column if not exists collected_at timestamptz;
alter table public.print_jobs add column if not exists attempt_count integer not null default 1;
alter table public.print_jobs add column if not exists expires_at timestamptz;
alter table public.print_jobs add column if not exists file_deleted_at timestamptz;

-- Real payment now gates entry into the vendor queue: a job is created
-- AWAITING_PAYMENT and only becomes UPLOADED (visible to the print shop)
-- once record_payment_event() sees a captured, signature-verified payment.
do $$ begin
  alter table public.print_jobs drop constraint if exists print_jobs_status_check;
  alter table public.print_jobs add constraint print_jobs_status_check
    check (status in ('AWAITING_PAYMENT','UPLOADED','PROCESSING','QUEUED','PRINTING','READY','COLLECTED','FAILED','CANCELLED'));
exception when others then null; end $$;
alter table public.print_jobs alter column status set default 'AWAITING_PAYMENT';

-- ---------------------------------------------------------------------------
-- payments / refunds: generalize from "always an order" to "an order OR a
-- print job" via an explicit XOR check, rather than duplicating the whole
-- ledger for a second charge type. record_payment_event/mark_refund_completed
-- (and the razorpay-webhook/razorpay-refund Edge Functions that call them)
-- stay the single choke points for both.
-- ---------------------------------------------------------------------------
alter table public.payments alter column order_id drop not null;
alter table public.payments add column if not exists print_job_id uuid references public.print_jobs(id) on delete cascade;
do $$ begin
  alter table public.payments add constraint payments_target_xor
    check ((order_id is not null)::int + (print_job_id is not null)::int = 1);
exception when duplicate_object then null; end $$;
create index if not exists payments_print_job_idx on public.payments(print_job_id) where print_job_id is not null;

alter table public.refunds alter column order_id drop not null;
alter table public.refunds add column if not exists print_job_id uuid references public.print_jobs(id) on delete cascade;
do $$ begin
  alter table public.refunds add constraint refunds_target_xor
    check ((order_id is not null)::int + (print_job_id is not null)::int = 1);
exception when duplicate_object then null; end $$;
create index if not exists refunds_print_job_idx on public.refunds(print_job_id) where print_job_id is not null;

-- ---------------------------------------------------------------------------
-- print_binding_rates -- binding was priced client-side only (a UI fiction);
-- create_print_job() below now actually charges for it, and the print shop
-- vendor can manage the fee the same way they already manage per-page price.
-- ---------------------------------------------------------------------------
create table if not exists public.print_binding_rates (
  campus_id uuid primary key references public.campuses(id) on delete cascade,
  staple_fee numeric(10,2) not null default 20.00 check (staple_fee >= 0),
  spiral_fee numeric(10,2) not null default 40.00 check (spiral_fee >= 0),
  owner_id uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.print_binding_rates (campus_id)
select id from public.campuses where slug = 'nhce'
on conflict (campus_id) do nothing;

alter table public.print_binding_rates enable row level security;
drop policy if exists "print_binding_rates_read" on public.print_binding_rates;
create policy "print_binding_rates_read" on public.print_binding_rates for select to authenticated using (true);
drop policy if exists "print_binding_rates_write" on public.print_binding_rates;
create policy "print_binding_rates_write" on public.print_binding_rates for all to authenticated
  using (public.has_permission(auth.uid(),'print.manage') or public.current_user_is_admin())
  with check (public.has_permission(auth.uid(),'print.manage') or public.current_user_is_admin());

drop trigger if exists print_binding_rates_set_updated_at on public.print_binding_rates;
create trigger print_binding_rates_set_updated_at
before update on public.print_binding_rates
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- print_shop_status -- "Printer status" (doc §29-30 vendor list). Deliberately
-- campus-scoped like print_jobs itself (no per-shop owner_id anywhere else in
-- this feature), not tied to a specific printer device.
-- ---------------------------------------------------------------------------
create table if not exists public.print_shop_status (
  campus_id uuid primary key references public.campuses(id) on delete cascade,
  status text not null default 'online' check (status in ('online','offline','maintenance')),
  message text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.print_shop_status (campus_id)
select id from public.campuses where slug = 'nhce'
on conflict (campus_id) do nothing;

alter table public.print_shop_status enable row level security;
drop policy if exists "print_shop_status_read" on public.print_shop_status;
create policy "print_shop_status_read" on public.print_shop_status for select to authenticated using (true);
drop policy if exists "print_shop_status_write" on public.print_shop_status;
create policy "print_shop_status_write" on public.print_shop_status for all to authenticated
  using (public.has_permission(auth.uid(),'print.manage') or public.current_user_is_admin())
  with check (public.has_permission(auth.uid(),'print.manage') or public.current_user_is_admin());

drop trigger if exists print_shop_status_set_updated_at on public.print_shop_status;
create trigger print_shop_status_set_updated_at
before update on public.print_shop_status
for each row execute function public.set_updated_at();

create or replace function public.set_print_shop_status(p_status text, p_message text default null)
returns public.print_shop_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_campus uuid;
  v_row public.print_shop_status;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if not (public.has_permission(v_user,'print.manage') or public.current_user_is_admin()) then
    raise exception 'Not authorized to manage the print shop';
  end if;
  if p_status not in ('online','offline','maintenance') then
    raise exception 'Invalid status';
  end if;

  select campus_id into v_campus from public.profiles where id = v_user;
  if v_campus is null then raise exception 'No campus on this account'; end if;

  insert into public.print_shop_status (campus_id, status, message, updated_by)
  values (v_campus, p_status, nullif(trim(coalesce(p_message,'')), ''), v_user)
  on conflict (campus_id) do update
    set status = excluded.status, message = excluded.message, updated_by = excluded.updated_by, updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;
revoke all on function public.set_print_shop_status(text, text) from public, anon;
grant execute on function public.set_print_shop_status(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- create_print_job -- rewritten: real size/page validation, binding actually
-- priced, job starts AWAITING_PAYMENT (no longer auto-queued), short expiry
-- while unpaid.
-- ---------------------------------------------------------------------------
drop function if exists public.create_print_job(text, text, integer, integer, text, text, text);

create or replace function public.create_print_job(
  p_file_url text,
  p_file_name text,
  p_pages integer,
  p_copies integer default 1,
  p_color_mode text default 'black_white',
  p_paper_size text default 'A4',
  p_binding text default 'none',
  p_duplex boolean default false,
  p_file_size_bytes bigint default null
)
returns public.print_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_campus uuid;
  v_rate numeric(10,2);
  v_binding_fee numeric(10,2) := 0;
  v_price numeric(10,2);
  v_job public.print_jobs;
  v_pickup_code text;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if not public.check_rate_limit(v_user, 'print_jobs', 20, 3600) then
    raise exception 'RATE_LIMITED: too many print jobs submitted, slow down';
  end if;
  if p_pages is null or p_pages <= 0 or p_pages > 500 then raise exception 'Invalid page count (1-500)'; end if;
  if p_copies is null or p_copies <= 0 or p_copies > 100 then raise exception 'Invalid copy count (1-100)'; end if;
  if p_color_mode not in ('black_white','colour') then raise exception 'Invalid colour mode'; end if;
  if p_binding not in ('none','staple','spiral') then raise exception 'Invalid binding'; end if;
  -- Defense in depth: the print-files bucket already caps uploads at 25MB
  -- and PDF-only server-side; re-check here too so a bad/omitted client size
  -- never gets recorded as if it were authoritative.
  if p_file_size_bytes is not null and p_file_size_bytes > 26214400 then
    raise exception 'File is larger than the 25MB limit';
  end if;

  select campus_id into v_campus from public.profiles where id = v_user;

  select price_per_page into v_rate from public.print_rate_card where campus_id = v_campus and color_mode = p_color_mode;
  v_rate := coalesce(v_rate, case when p_color_mode = 'colour' then 8.00 else 2.00 end);

  if p_binding = 'staple' then
    select staple_fee into v_binding_fee from public.print_binding_rates where campus_id = v_campus;
    v_binding_fee := coalesce(v_binding_fee, 20.00);
  elsif p_binding = 'spiral' then
    select spiral_fee into v_binding_fee from public.print_binding_rates where campus_id = v_campus;
    v_binding_fee := coalesce(v_binding_fee, 40.00);
  end if;

  v_price := round(v_rate * p_pages * p_copies, 2) + (v_binding_fee * p_copies);
  v_pickup_code := lpad((floor(random()*1000000))::text, 6, '0');

  insert into public.print_jobs (
    user_id, campus_id, file_url, file_name, file_size_bytes, pages, copies,
    color_mode, paper_size, binding, duplex, price, pickup_code, status, expires_at
  )
  values (
    v_user, v_campus, p_file_url, p_file_name, p_file_size_bytes, p_pages, p_copies,
    p_color_mode, p_paper_size, p_binding, coalesce(p_duplex, false), v_price, v_pickup_code,
    'AWAITING_PAYMENT', now() + interval '3 days'
  )
  returning * into v_job;

  return v_job;
end;
$$;
revoke all on function public.create_print_job(text, text, integer, integer, text, text, text, boolean, bigint) from public, anon;
grant execute on function public.create_print_job(text, text, integer, integer, text, text, text, boolean, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- create_print_payment_order -- mirrors create_payment_order() for a
-- print_jobs row instead of an orders row. Called by the same generalized
-- create-razorpay-order Edge Function.
-- ---------------------------------------------------------------------------
create or replace function public.create_print_payment_order(p_print_job_id uuid)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_job public.print_jobs;
  v_payment public.payments;
begin
  if v_user is null then raise exception 'Sign in required'; end if;

  select * into v_job from public.print_jobs where id = p_print_job_id and user_id = v_user for update;
  if not found then raise exception 'Print job not found'; end if;
  if v_job.status <> 'AWAITING_PAYMENT' then raise exception 'This print job is not awaiting payment'; end if;

  select * into v_payment from public.payments where print_job_id = p_print_job_id and status = 'created' order by created_at desc limit 1;
  if found then
    return v_payment;
  end if;

  insert into public.payments (print_job_id, amount, currency, status)
  values (p_print_job_id, v_job.price, 'INR', 'created')
  returning * into v_payment;

  return v_payment;
end;
$$;
revoke all on function public.create_print_payment_order(uuid) from public, anon;
grant execute on function public.create_print_payment_order(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- record_payment_event -- extended to branch on which target the payment is
-- for. The order-side behaviour is byte-for-byte unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.record_payment_event(
  p_gateway_order_id text,
  p_gateway_payment_id text,
  p_status text,               -- 'authorized' | 'captured' | 'failed'
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
    end if;

  elsif p_status = 'failed' then
    if v_payment.order_id is not null then
      update public.orders set payment_status = 'failed' where id = v_payment.order_id;
    end if;
    -- A failed print-job payment needs no state change -- the job just stays
    -- AWAITING_PAYMENT so the student can retry, and expires on its own.
  end if;

  return v_payment;
end;
$$;

revoke execute on function public.record_payment_event(text, text, text, boolean, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- cancel_print_job -- self-service, student-only. Allowed before printing has
-- actually started (materials not yet consumed). If a captured payment
-- exists, records a 'pending' refund the same way request_refund() does --
-- the frontend then calls the existing razorpay-refund Edge Function to
-- actually move the money, closing the loop via mark_refund_completed().
-- ---------------------------------------------------------------------------
create or replace function public.cancel_print_job(p_job_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_job public.print_jobs;
  v_payment public.payments;
  v_refund public.refunds;
  v_refund_id uuid;
begin
  if v_user is null then raise exception 'Sign in required'; end if;

  select * into v_job from public.print_jobs where id = p_job_id and user_id = v_user for update;
  if not found then raise exception 'Print job not found'; end if;

  if v_job.status not in ('AWAITING_PAYMENT','UPLOADED','PROCESSING','QUEUED','FAILED') then
    raise exception 'This job can no longer be cancelled -- it is already printing, ready, or finished';
  end if;

  update public.print_jobs
    set status = 'CANCELLED', cancelled_at = now(), cancel_reason = nullif(trim(coalesce(p_reason,'')), '')
    where id = v_job.id
    returning * into v_job;

  if v_job.payment_id is not null then
    select * into v_payment from public.payments where id = v_job.payment_id;
    if found and v_payment.status = 'captured' then
      insert into public.refunds (payment_id, print_job_id, amount, reason, refund_type, initiated_by)
      values (v_payment.id, v_job.id, v_payment.amount, coalesce(p_reason, 'Student cancelled print job'), 'full', v_user)
      returning * into v_refund;
      v_refund_id := v_refund.id;
    end if;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, reason)
  values (v_user, 'print_job.cancel', 'print_job', v_job.id::text, p_reason);

  return jsonb_build_object('job', to_jsonb(v_job), 'refund_id', v_refund_id);
end;
$$;
revoke all on function public.cancel_print_job(uuid, text) from public, anon;
grant execute on function public.cancel_print_job(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- transition_print_job -- print.manage/admin only. Replaces the bare
-- `update print_jobs set status=...` the vendor UI used to run directly --
-- now that a paid job/pickup code is involved, the legal-edge check and
-- pickup-code validation need to live server-side, not just in the button
-- the vendor UI happens to show.
-- ---------------------------------------------------------------------------
create or replace function public.transition_print_job(p_job_id uuid, p_new_status text, p_pickup_code text default null)
returns public.print_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_job public.print_jobs;
  v_legal boolean := false;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if not (public.has_permission(v_user,'print.manage') or public.current_user_is_admin()) then
    raise exception 'Not authorized to manage print jobs';
  end if;

  select * into v_job from public.print_jobs where id = p_job_id for update;
  if not found then raise exception 'Print job not found'; end if;

  v_legal := (
    (v_job.status = 'UPLOADED' and p_new_status = 'PROCESSING') or
    (v_job.status = 'PROCESSING' and p_new_status = 'QUEUED') or
    (v_job.status = 'QUEUED' and p_new_status = 'PRINTING') or
    (v_job.status = 'PRINTING' and p_new_status = 'READY') or
    (v_job.status = 'READY' and p_new_status = 'COLLECTED') or
    (v_job.status in ('UPLOADED','PROCESSING','QUEUED','PRINTING') and p_new_status = 'FAILED') or
    (v_job.status = 'FAILED' and p_new_status = 'QUEUED')  -- reprint, no charge
  );
  if not v_legal then
    raise exception 'Cannot move a % job to %', v_job.status, p_new_status;
  end if;

  if p_new_status = 'COLLECTED' then
    if p_pickup_code is null or trim(p_pickup_code) <> v_job.pickup_code then
      raise exception 'Pickup code does not match';
    end if;
    update public.print_jobs
      set status = 'COLLECTED', collected_at = now(), expires_at = now() + interval '1 day'
      where id = v_job.id
      returning * into v_job;
  elsif v_job.status = 'FAILED' and p_new_status = 'QUEUED' then
    -- Reprint: extend expires_at the same +14 days record_payment_event grants
    -- on initial payment, or list_print_files_due_for_cleanup can delete the
    -- file out from under an already-paid reprint still sitting in the queue.
    update public.print_jobs
      set status = 'QUEUED', attempt_count = attempt_count + 1, expires_at = now() + interval '14 days'
      where id = v_job.id
      returning * into v_job;
  else
    update public.print_jobs set status = p_new_status where id = v_job.id returning * into v_job;
  end if;

  return v_job;
end;
$$;
revoke all on function public.transition_print_job(uuid, text, text) from public, anon;
grant execute on function public.transition_print_job(uuid, text, text) to authenticated;

-- print_jobs_update_manage (0011) let ANY print.manage holder run a raw
-- PostgREST `update print_jobs set status=...` directly -- which would skip
-- transition_print_job()'s legal-edge check and, critically, the pickup-code
-- match on COLLECTED entirely (a vendor client could just PATCH straight to
-- COLLECTED with no code check at all). Narrow the raw-update escape hatch to
-- admin only; the print-shop vendor role now has no path to mutate a job
-- except through the RPC above.
drop policy if exists "print_jobs_update_manage" on public.print_jobs;
create policy "print_jobs_update_manage" on public.print_jobs for update to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- ---------------------------------------------------------------------------
-- File lifecycle: automatic expiry + deleting collected documents. Deleting
-- the *storage object* itself needs the Storage API (a Postgres DELETE on
-- storage.objects only removes the metadata row, not the underlying file),
-- so this is: a read-only "what's due" RPC + a "mark done" RPC, both
-- service-role only, driven by supabase/functions/print-file-cleanup (which
-- actually calls storage.remove()). See that function's header for how to
-- schedule it.
-- ---------------------------------------------------------------------------
create or replace function public.list_print_files_due_for_cleanup(p_limit integer default 200)
returns table(id uuid, file_url text)
language sql
security definer
set search_path = public
as $$
  select p.id, p.file_url
  from public.print_jobs p
  where p.file_url is not null
    and p.file_deleted_at is null
    and (
      (p.status = 'COLLECTED' and p.collected_at < now() - interval '1 hour')
      or (p.status <> 'COLLECTED' and p.expires_at is not null and p.expires_at < now())
    )
  order by p.created_at
  limit p_limit;
$$;
revoke all on function public.list_print_files_due_for_cleanup(integer) from public, anon, authenticated;

create or replace function public.mark_print_file_deleted(p_job_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.print_jobs set file_deleted_at = now(), file_url = null where id = p_job_id;
$$;
revoke all on function public.mark_print_file_deleted(uuid) from public, anon, authenticated;

create index if not exists print_jobs_cleanup_idx on public.print_jobs(status, expires_at) where file_deleted_at is null;

-- ---------------------------------------------------------------------------
-- mark_refund_completed -- extended the same way record_payment_event was:
-- the original body unconditionally wrote to orders/order_status_history,
-- both NOT NULL on order_id -- a print-job refund (order_id always null)
-- would abort this function entirely, so the razorpay-refund Edge Function
-- would report the refund as failed even after Razorpay had already moved
-- the money. Branch on which target the refund is for, same as above.
-- ---------------------------------------------------------------------------
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
  end if;
  -- print_job_id case: the job is already CANCELLED (set by cancel_print_job
  -- at request time); the refunds row itself is the source of truth for
  -- "did the money actually come back", same as payments is for the charge.

  return v_refund;
end;
$$;

revoke execute on function public.mark_refund_completed(uuid, text) from public, anon, authenticated;

-- Same gap, same fix, one layer up: payments_read (0011) only ever matched
-- payments.order_id, so a student could never read their own print-job
-- payment row either.
drop policy if exists "payments_read" on public.payments;
create policy "payments_read" on public.payments for select to authenticated
  using (
    exists (select 1 from public.orders o where o.id = payments.order_id and o.user_id = auth.uid())
    or exists (select 1 from public.print_jobs pj where pj.id = payments.print_job_id and pj.user_id = auth.uid())
    or public.has_permission(auth.uid(),'finance.read') or public.current_user_is_admin()
  );

-- refunds_read (0015 vendor_order_ops) only ever matched refunds.order_id --
-- a print job's refund row has that column null, so the student who owns
-- the job (and razorpay-refund's own "a successful select IS the
-- authorization check" model, see that function's header) could never see
-- it. Add the equivalent print_job-ownership clause; the three existing
-- clauses are untouched.
drop policy if exists "refunds_read" on public.refunds;
create policy "refunds_read" on public.refunds for select to authenticated
  using (
    exists (select 1 from public.orders o where o.id = refunds.order_id and o.user_id = auth.uid())
    or exists (select 1 from public.print_jobs pj where pj.id = refunds.print_job_id and pj.user_id = auth.uid())
    or public.has_permission(auth.uid(),'finance.read')
    or public.current_user_is_admin()
    or exists (
      select 1 from public.orders o join public.canteens c on c.id = o.canteen_id
      where o.id = refunds.order_id
        and public.has_permission(auth.uid(),'food.refunds.create') and c.owner_id = auth.uid()
    )
  );
