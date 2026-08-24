-- =============================================================================
-- PAYMENT RECONCILIATION JOB (readiness-audit phase 04's engineering-doable
-- subset: "Payment reconciliation job -- settlement reports vs. the
-- internal ledger"). Doesn't need a live Razorpay account -- it reconciles
-- against whatever Razorpay account is configured (test-mode today), same
-- as everything else this pass touched.
--
-- What it's actually for: record_payment_event() is only ever reached by
-- Razorpay's webhook delivery. Razorpay retries a webhook that doesn't 2xx,
-- but a payment can still go uncaptured-in-our-books forever if the webhook
-- URL was ever briefly down/misconfigured past its retry window, or (more
-- mundane) a student pays but their browser tab dies before create-
-- razorpay-order's response even matters -- Razorpay still captures the
-- payment, our webhook fires, but if that ONE delivery is ever lost there's
-- no second chance today. This job is that second chance: every 15 minutes
-- it asks Razorpay directly (GET /v1/orders/:id/payments, the same secret-
-- key auth create-razorpay-order already uses) about every payment that's
-- been sitting in 'created'/'authorized' too long, and self-heals through
-- the exact same record_payment_event() RPC the webhook itself calls --
-- with p_signature_verified true, since a direct authenticated pull with
-- the account's own secret key is at least as strong a trust boundary as a
-- pushed HMAC.
--
-- Known, accepted gap: this only reconciles payments stuck short of
-- 'captured'/'failed'. A refund issued directly from the Razorpay dashboard
-- (bypassing request_refund/razorpay-refund entirely) would still go
-- unnoticed -- out of scope for this pass; refunds already have their own
-- real-time completion path (razorpay-refund -> mark_refund_completed) that
-- doesn't depend on a webhook at all.
--
-- Wiring mirrors 20260814004500/20260817002500's dispatch-secret + pg_net
-- pattern exactly: a random Vault secret proves the call came from this
-- trigger (not a browser), and the target URL comes from app_config.
-- functions_base_url (per-project, see 20260817002500's own header) rather
-- than being hardcoded.
-- =============================================================================

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'reconciliation_dispatch_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'reconciliation_dispatch_secret',
      'Shared secret sent as X-Reconciliation-Secret so payment-reconciliation can verify a call originated from this cron trigger.'
    );
  end if;
end $$;

create or replace function public.trigger_payment_reconciliation()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_base_url text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'reconciliation_dispatch_secret';
  select value into v_base_url from public.app_config where key = 'functions_base_url';
  if v_secret is null or v_base_url is null then
    return; -- not configured yet
  end if;

  perform net.http_post(
    url := v_base_url || '/payment-reconciliation',
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Reconciliation-Secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
exception when others then
  return;
end;
$$;

revoke execute on function public.trigger_payment_reconciliation() from public, anon, authenticated;

select cron.schedule('payment-reconciliation', '*/15 * * * *', $$select public.trigger_payment_reconciliation();$$);
