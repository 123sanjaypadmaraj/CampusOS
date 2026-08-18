-- =============================================================================
-- FOOD ORDERING hardening, part 4/4: GST configuration, invoice generation,
-- vendor payout system, settlement reports, and refund reconciliation.
-- =============================================================================

-- =========================================================
-- GST configuration -- plain, self-editable columns on canteens (already
-- writable by its owner via the existing canteens_write RLS policy, no new
-- RPC needed). food_items.tax_rate (0003) is the per-item rate actually
-- used to compute orders.tax_amount; gst_registered controls whether an
-- invoice splits that tax into CGST/SGST or shows no GST at all.
-- =========================================================

alter table public.canteens add column if not exists gst_number text;
alter table public.canteens add column if not exists gst_registered boolean not null default false;

-- =========================================================
-- INVOICES -- one per paid order, numbered sequentially, generated on
-- demand (idempotent: unique on order_id) rather than a real PDF service.
-- =========================================================

create sequence if not exists public.order_invoice_seq;

create table if not exists public.order_invoices (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  invoice_number text not null unique,
  canteen_id uuid not null references public.canteens(id),
  user_id uuid not null references public.profiles(id),
  subtotal numeric(10,2) not null,
  tax_amount numeric(10,2) not null,
  cgst_amount numeric(10,2) not null default 0,
  sgst_amount numeric(10,2) not null default 0,
  platform_fee numeric(10,2) not null default 0,
  delivery_fee numeric(10,2) not null default 0,
  discount_amount numeric(10,2) not null default 0,
  total numeric(10,2) not null,
  gst_number text,
  issued_at timestamptz not null default now()
);

alter table public.order_invoices enable row level security;

drop policy if exists "order_invoices_read" on public.order_invoices;
create policy "order_invoices_read" on public.order_invoices for select to authenticated
  using (
    user_id = auth.uid()
    or public.current_user_is_admin()
    or public.can_manage_canteen_orders(auth.uid(), canteen_id)
  );
-- No insert/update/delete policy for authenticated -- generate_order_invoice() only.

-- =========================================================
-- RPC: generate_order_invoice -- callable by the order's own student, the
-- canteen owner/staff, or an admin. Only once an order has actually been
-- paid (payment_status has moved past 'pending'); idempotent, returns the
-- existing invoice on a repeat call rather than erroring or duplicating.
-- =========================================================

create or replace function public.generate_order_invoice(p_order_id uuid)
returns public.order_invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_order public.orders;
  v_canteen public.canteens;
  v_existing public.order_invoices;
  v_invoice public.order_invoices;
  v_cgst numeric(10,2);
  v_sgst numeric(10,2);
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'Order not found';
  end if;

  if not (v_order.user_id = v_user or public.current_user_is_admin() or public.can_manage_canteen_orders(v_user, v_order.canteen_id)) then
    raise exception 'Not authorized to view this order''s invoice';
  end if;

  if v_order.payment_status not in ('paid', 'refund_pending', 'refunded') then
    raise exception 'INVOICE_NOT_READY: invoice is available once payment is confirmed';
  end if;

  select * into v_existing from public.order_invoices where order_id = p_order_id;
  if found then
    return v_existing;
  end if;

  select * into v_canteen from public.canteens where id = v_order.canteen_id;

  if v_canteen.gst_registered then
    v_cgst := round(v_order.tax_amount / 2, 2);
    v_sgst := v_order.tax_amount - v_cgst;
  else
    v_cgst := 0;
    v_sgst := 0;
  end if;

  insert into public.order_invoices (
    order_id, invoice_number, canteen_id, user_id, subtotal, tax_amount, cgst_amount, sgst_amount,
    platform_fee, delivery_fee, discount_amount, total, gst_number
  ) values (
    p_order_id,
    'INV-' || to_char(now(), 'YYYYMM') || '-' || lpad(nextval('public.order_invoice_seq')::text, 6, '0'),
    v_order.canteen_id, v_order.user_id, v_order.subtotal, v_order.tax_amount, v_cgst, v_sgst,
    v_order.platform_fee, v_order.delivery_fee, v_order.discount_amount, v_order.total,
    case when v_canteen.gst_registered then v_canteen.gst_number else null end
  )
  on conflict (order_id) do nothing
  returning * into v_invoice;

  if v_invoice.id is null then
    select * into v_invoice from public.order_invoices where order_id = p_order_id;
  end if;

  return v_invoice;
end;
$$;

grant execute on function public.generate_order_invoice(uuid) to authenticated;

-- =========================================================
-- VENDOR PAYOUTS -- the actual settlement record ("we paid you ₹X for
-- period Y"). Admin-generated/confirmed only (real money leaving the
-- platform), never self-service for a vendor -- same posture as every other
-- finance-adjacent RPC in this app (request_refund is vendor-writable
-- because it only *requests*; the corresponding money movement,
-- mark_refund_completed, is service_role only).
-- =========================================================

create table if not exists public.vendor_payouts (
  id uuid primary key default gen_random_uuid(),
  canteen_id uuid not null references public.canteens(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  gross_amount numeric(10,2) not null default 0,
  platform_fee_amount numeric(10,2) not null default 0,
  refund_amount numeric(10,2) not null default 0,
  net_amount numeric(10,2) not null default 0,
  status text not null default 'pending' check (status in ('pending', 'processing', 'paid')),
  reference text,
  paid_at timestamptz,
  generated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (period_end >= period_start)
);

create index if not exists vendor_payouts_canteen_idx on public.vendor_payouts(canteen_id, period_start desc);

alter table public.vendor_payouts enable row level security;

drop policy if exists "vendor_payouts_read" on public.vendor_payouts;
create policy "vendor_payouts_read" on public.vendor_payouts for select to authenticated
  using (public.is_canteen_owner(auth.uid(), canteen_id) or public.has_permission(auth.uid(), 'finance.read'));
-- No insert/update/delete policy for authenticated -- generate_vendor_payout()/mark_payout_paid() only.

-- =========================================================
-- RPC: generate_vendor_payout -- admin only. Computes gross revenue (paid
-- orders' subtotal+tax, i.e. everything the vendor is owed before the
-- platform's own cut) minus platform_fee minus any refund that actually
-- COMPLETED within the period (the refund-reconciliation half: a refund is
-- deducted from whichever settlement window it was actually paid back in,
-- not the window the original order fell in). Refuses to double-generate
-- the exact same period twice.
-- =========================================================

create or replace function public.generate_vendor_payout(p_canteen_id uuid, p_period_start date, p_period_end date)
returns public.vendor_payouts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_gross numeric(10,2);
  v_fee numeric(10,2);
  v_refunds numeric(10,2);
  v_net numeric(10,2);
  v_payout public.vendor_payouts;
begin
  if not public.current_user_is_admin() then
    raise exception 'Only an admin can generate a payout';
  end if;
  if p_period_end < p_period_start then
    raise exception 'Invalid period';
  end if;

  -- Overlap, not exact-match: two payouts for the same canteen whose date
  -- ranges merely intersect (e.g. 08-01..08-15 then 08-10..08-20) would
  -- otherwise both count -- and pay out -- every order in the shared days.
  -- Standard range-overlap test: a<=d and c<=b.
  if exists (
    select 1 from public.vendor_payouts
    where canteen_id = p_canteen_id
      and period_start <= p_period_end
      and period_end >= p_period_start
  ) then
    raise exception 'A payout overlapping this period already exists';
  end if;

  select coalesce(sum(o.subtotal + o.tax_amount), 0), coalesce(sum(o.platform_fee), 0)
    into v_gross, v_fee
    from public.orders o
    where o.canteen_id = p_canteen_id
      and o.payment_status in ('paid', 'refund_pending', 'refunded')
      and o.created_at::date between p_period_start and p_period_end;

  select coalesce(sum(r.amount), 0) into v_refunds
    from public.refunds r
    join public.orders o on o.id = r.order_id
    where o.canteen_id = p_canteen_id and r.status = 'completed'
      and r.updated_at::date between p_period_start and p_period_end;

  v_net := round(v_gross - v_fee - v_refunds, 2);

  insert into public.vendor_payouts (
    canteen_id, period_start, period_end, gross_amount, platform_fee_amount, refund_amount, net_amount, generated_by
  ) values (
    p_canteen_id, p_period_start, p_period_end, round(v_gross, 2), round(v_fee, 2), round(v_refunds, 2), v_net, v_user
  )
  returning * into v_payout;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value)
  values (v_user, 'payout.generate', 'canteen', p_canteen_id::text, to_jsonb(v_payout));

  return v_payout;
end;
$$;

create or replace function public.mark_payout_paid(p_payout_id uuid, p_reference text)
returns public.vendor_payouts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_payout public.vendor_payouts;
  v_owner uuid;
begin
  if not public.current_user_is_admin() then
    raise exception 'Only an admin can mark a payout as paid';
  end if;

  update public.vendor_payouts set status = 'paid', reference = p_reference, paid_at = now()
    where id = p_payout_id
    returning * into v_payout;
  if not found then
    raise exception 'Payout not found';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value)
  values (v_user, 'payout.mark_paid', 'vendor_payout', p_payout_id::text, jsonb_build_object('reference', p_reference));

  select owner_id into v_owner from public.canteens where id = v_payout.canteen_id;
  if v_owner is not null then
    perform public.create_notification(
      v_owner, 'Payout processed',
      'Your payout of ₹' || v_payout.net_amount || ' for ' || v_payout.period_start || ' to ' || v_payout.period_end || ' has been paid.',
      'payout', 'vendor_payout', p_payout_id::text
    );
  end if;

  return v_payout;
end;
$$;

grant execute on function public.generate_vendor_payout(uuid, date, date) to authenticated;
grant execute on function public.mark_payout_paid(uuid, text) to authenticated;

-- =========================================================
-- RPC: vendor_settlement_report -- self-service reconciliation for the
-- canteen owner (financial, so owner-only, not staff): every paid order in
-- the window plus every refund that completed in the window, so a vendor
-- can check their own numbers against a payout at any time, not just after
-- an admin generates one.
-- =========================================================

create or replace function public.vendor_settlement_report(p_start date, p_end date)
returns table (
  row_type text,
  occurred_on date,
  order_id uuid,
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
  v_canteen uuid;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;

  select id into v_canteen from public.canteens where owner_id = v_user limit 1;
  if v_canteen is null and not public.current_user_is_admin() then
    raise exception 'No canteen assigned to this account';
  end if;

  return query
  select
    'order'::text as row_type, o.created_at::date as occurred_on, o.id as order_id,
    ('Order ' || upper(left(o.id::text, 8)))::text as description,
    (o.subtotal + o.tax_amount)::numeric as gross_amount, o.platform_fee::numeric as platform_fee,
    (o.subtotal + o.tax_amount - o.platform_fee)::numeric as net_amount
  from public.orders o
  where o.canteen_id = v_canteen and o.payment_status in ('paid', 'refund_pending', 'refunded')
    and o.created_at::date between p_start and p_end
  union all
  select
    'refund'::text, r.updated_at::date, r.order_id,
    ('Refund: ' || coalesce(r.reason, '—'))::text,
    (-r.amount)::numeric, 0::numeric, (-r.amount)::numeric
  from public.refunds r
  join public.orders o on o.id = r.order_id
  where o.canteen_id = v_canteen and r.status = 'completed'
    and r.updated_at::date between p_start and p_end
  order by occurred_on, row_type;
end;
$$;

grant execute on function public.vendor_settlement_report(date, date) to authenticated;
