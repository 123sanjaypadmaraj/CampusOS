-- =============================================================================
-- 0004: PAYMENT LEDGER (doc §24-27). Frontend payment_status is never trusted.
-- The only writer to these tables is the `payments-webhook` Edge Function,
-- running with the service_role key, which verifies the gateway signature
-- before calling public.record_payment_event(). Execute on that function is
-- revoked from anon/authenticated so it cannot be called from the browser.
-- =============================================================================

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  gateway text not null default 'razorpay' check (gateway in ('razorpay','cashfree')),
  gateway_order_id text,
  gateway_payment_id text,
  amount numeric(10,2) not null,
  currency text not null default 'INR',
  status text not null default 'created'
    check (status in ('created','authorized','captured','failed','refunded')),
  signature_verified boolean not null default false,
  raw_payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- This project already had a `payments` table (legacy shape: user_id,
-- transaction_id, no gateway_order_id/currency/signature_verified) --
-- `create table if not exists` above was a no-op against it.
alter table public.payments add column if not exists gateway_order_id text;
alter table public.payments add column if not exists gateway_payment_id text;
alter table public.payments add column if not exists currency text not null default 'INR';
alter table public.payments add column if not exists signature_verified boolean not null default false;
alter table public.payments add column if not exists raw_payload jsonb not null default '{}';
alter table public.payments add column if not exists updated_at timestamptz not null default now();
alter table public.payments alter column gateway set default 'razorpay';
alter table public.payments alter column status set default 'created';

create unique index if not exists payments_gateway_order_idx on public.payments(gateway, gateway_order_id) where gateway_order_id is not null;
create index if not exists payments_order_idx on public.payments(order_id);

drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at
before update on public.payments
for each row execute function public.set_updated_at();

create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid references public.payments(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  amount numeric(10,2) not null check (amount > 0),
  reason text,
  refund_type text not null default 'full' check (refund_type in ('full','partial')),
  status text not null default 'pending' check (status in ('pending','processing','completed','failed')),
  gateway_refund_id text,
  initiated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists refunds_set_updated_at on public.refunds;
create trigger refunds_set_updated_at
before update on public.refunds
for each row execute function public.set_updated_at();

create table if not exists public.idempotency_keys (
  key text primary key,
  scope text not null,
  response jsonb,
  created_at timestamptz not null default now()
);

-- =========================================================
-- RPC: create_payment_order -- called by the authenticated user right before
-- redirecting to the gateway checkout. Locks the order, confirms it belongs
-- to the caller and is awaiting payment, and returns the authoritative
-- amount to charge (never trust an amount posted from the browser).
-- =========================================================

create or replace function public.create_payment_order(p_order_id uuid)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_order public.orders;
  v_payment public.payments;
begin
  if v_user is null then
    raise exception 'Sign in required';
  end if;

  select * into v_order from public.orders where id = p_order_id and user_id = v_user for update;
  if not found then
    raise exception 'Order not found';
  end if;

  if v_order.status not in ('PAYMENT_PENDING') then
    raise exception 'Order is not awaiting payment';
  end if;

  select * into v_payment from public.payments where order_id = p_order_id and status = 'created' order by created_at desc limit 1;
  if found then
    return v_payment;
  end if;

  insert into public.payments (order_id, amount, currency, status)
  values (p_order_id, v_order.total, 'INR', 'created')
  returning * into v_payment;

  return v_payment;
end;
$$;

-- =========================================================
-- RPC: record_payment_event -- service_role only. Called by the
-- payments-webhook Edge Function after it verifies the gateway's HMAC
-- signature. This is the single place orders.payment_status flips to paid.
-- =========================================================

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
    select * into v_order from public.orders where id = v_payment.order_id for update;

    if v_order.status = 'PAYMENT_PENDING' then
      update public.orders set status = 'PAID', payment_status = 'paid' where id = v_order.id;
      insert into public.order_status_history (order_id, from_status, to_status, reason)
      values (v_order.id, 'PAYMENT_PENDING', 'PAID', 'gateway webhook verified');

      -- Immediately mark RECEIVED so the vendor queue picks it up; ACCEPT
      -- still requires an explicit vendor action via transition_order_status.
      update public.orders set status = 'RECEIVED' where id = v_order.id;
      insert into public.order_status_history (order_id, from_status, to_status, reason)
      values (v_order.id, 'PAID', 'RECEIVED', 'auto-forwarded to vendor queue');
    end if;
  elsif p_status = 'failed' then
    update public.orders set payment_status = 'failed' where id = v_payment.order_id;
  end if;

  return v_payment;
end;
$$;

revoke execute on function public.record_payment_event(text, text, text, boolean, jsonb) from public, anon, authenticated;

-- =========================================================
-- RPC: request_refund (doc §26) -- vendor/admin only. Marks the order for
-- refund; the actual gateway refund call happens in the refunds Edge
-- Function which then calls mark_refund_completed().
-- =========================================================

create or replace function public.request_refund(p_order_id uuid, p_amount numeric, p_reason text)
returns public.refunds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_order public.orders;
  v_payment public.payments;
  v_refund public.refunds;
begin
  if not (public.has_permission(v_user, 'food.refunds.create') or public.current_user_is_admin()) then
    raise exception 'Not authorized to issue refunds';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  select * into v_payment from public.payments where order_id = p_order_id and status = 'captured' order by created_at desc limit 1;
  if not found then
    raise exception 'No captured payment found for this order';
  end if;

  insert into public.refunds (payment_id, order_id, amount, reason, refund_type, initiated_by)
  values (v_payment.id, p_order_id, p_amount, p_reason, case when p_amount >= v_order.total then 'full' else 'partial' end, v_user)
  returning * into v_refund;

  update public.orders set status = 'REFUND_PENDING', payment_status = 'refund_pending' where id = p_order_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_value, reason)
  values (v_user, 'refund.request', 'order', p_order_id::text, jsonb_build_object('amount', p_amount), p_reason);

  return v_refund;
end;
$$;

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
  update public.orders set status = 'REFUNDED', payment_status = 'refunded' where id = v_refund.order_id;
  insert into public.order_status_history (order_id, to_status, reason)
  values (v_refund.order_id, 'REFUNDED', 'gateway refund completed');
  return v_refund;
end;
$$;

revoke execute on function public.mark_refund_completed(uuid, text) from public, anon, authenticated;
