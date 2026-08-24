// Edge Function: payment-reconciliation
//
// Not called from a signed-in browser -- invoked every 15 minutes by the
// `payment-reconciliation` pg_cron job via pg_net (see
// supabase/migrations/20260824000800_payment_reconciliation.sql), so it
// verifies a shared secret header instead of a Supabase JWT (deploy with
// --no-verify-jwt, same pattern as send-push/send-email/send-sms).
//
// Finds payments stuck short of a terminal state (Razorpay order created,
// but this project's webhook never recorded a capture/failure for it) and
// asks Razorpay directly what actually happened, using the same secret-key
// auth create-razorpay-order/razorpay-refund already use. Self-heals
// through record_payment_event() -- the exact RPC the webhook itself calls
// -- so a payment that Razorpay says is captured ends up PAID here exactly
// the way it would have if the webhook had never been missed.
//
// Required secrets (set via `supabase secrets set`):
//   RECONCILIATION_DISPATCH_SECRET -- must match the `reconciliation_dispatch_secret` Vault entry
//   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET -- already set for create-razorpay-order
// Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2";
import { jsonResponse } from "../_shared/cors.ts";
import { logServerError } from "../_shared/logServerError.ts";

// A payment that's sat this long without reaching a terminal state is worth
// asking Razorpay about directly -- short enough to catch a missed webhook
// well within a student's patience, long enough that an in-flight checkout
// (still on the Razorpay Checkout screen) is never mistaken for stuck.
const STALE_AFTER_MS = 20 * 60 * 1000;
const BATCH_LIMIT = 100;

const RAZORPAY_STATUS_MAP: Record<string, string> = {
  captured: "captured",
  failed: "failed",
  // 'authorized' is intentionally not mapped to an action below -- an
  // authorized-but-not-yet-captured payment isn't something this project's
  // flow expects to sit in for long (Razorpay auto-captures by default),
  // and there's nothing safe to self-heal into from it.
};

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ code: "METHOD_NOT_ALLOWED", message: "POST only" }, 405);
  }

  const dispatchSecret = Deno.env.get("RECONCILIATION_DISPATCH_SECRET");
  const provided = req.headers.get("x-reconciliation-secret");
  if (!dispatchSecret || provided !== dispatchSecret) {
    return jsonResponse({ code: "UNAUTHORIZED" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const keyId = Deno.env.get("RAZORPAY_KEY_ID");
  const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
  if (!keyId || !keySecret) {
    await logServerError(serviceClient, "payment-reconciliation: Razorpay keys not configured", { category: "payment", severity: "fatal" });
    return jsonResponse({ code: "GATEWAY_NOT_CONFIGURED" }, 503);
  }
  const authHeader = "Basic " + btoa(`${keyId}:${keySecret}`);

  const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();
  const { data: stuck, error: queryError } = await serviceClient
    .from("payments")
    .select("id, gateway_order_id, gateway_payment_id, amount, status")
    .in("status", ["created", "authorized"])
    .not("gateway_order_id", "is", null)
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (queryError) {
    await logServerError(serviceClient, `payment-reconciliation: could not query stuck payments: ${queryError.message}`, { category: "payment", severity: "error" });
    return jsonResponse({ code: "QUERY_FAILED", message: queryError.message }, 500);
  }

  const summary = { checked: stuck?.length ?? 0, healed: 0, stillPending: 0, apiErrors: 0 };

  for (const payment of stuck ?? []) {
    try {
      const res = await fetch(`https://api.razorpay.com/v1/orders/${payment.gateway_order_id}/payments`, {
        headers: { Authorization: authHeader },
      });
      if (!res.ok) {
        summary.apiErrors += 1;
        continue;
      }
      const body = await res.json();
      const items: Array<{ id: string; status: string }> = body?.items ?? [];
      if (items.length === 0) {
        summary.stillPending += 1;
        continue;
      }

      // Prefer the item matching a gateway_payment_id we already recorded
      // (an 'authorized' payment that was later captured keeps the same
      // payment id); otherwise take whichever item actually reached a
      // terminal state, preferring captured over failed if somehow both
      // are present (a failed attempt followed by a successful retry).
      const matched =
        (payment.gateway_payment_id && items.find((i) => i.id === payment.gateway_payment_id)) ||
        items.find((i) => i.status === "captured") ||
        items.find((i) => i.status === "failed") ||
        items[0];

      const mappedStatus = RAZORPAY_STATUS_MAP[matched.status];
      if (!mappedStatus) {
        summary.stillPending += 1;
        continue;
      }

      const { error: rpcError } = await serviceClient.rpc("record_payment_event", {
        p_gateway_order_id: payment.gateway_order_id,
        p_gateway_payment_id: matched.id,
        p_status: mappedStatus,
        p_signature_verified: true,
        p_raw_payload: { event: `reconciliation.${matched.status}`, payload: { payment: { entity: matched } }, created_at: Math.floor(Date.now() / 1000) },
      });
      if (rpcError) {
        summary.apiErrors += 1;
        await logServerError(serviceClient, `payment-reconciliation: record_payment_event failed: ${rpcError.message}`, { category: "payment", severity: "error", context: { payment_id: payment.id } });
        continue;
      }

      summary.healed += 1;
    } catch (err) {
      summary.apiErrors += 1;
      console.error("payment-reconciliation: error reconciling payment", payment.id, err);
    }
  }

  // Only worth an error-log entry (and therefore the observability error-
  // rate alert) when something actually needed fixing or genuinely failed --
  // a quiet run finding nothing stuck is the expected steady state, not
  // something an admin needs paged for every 15 minutes.
  if (summary.healed > 0 || summary.apiErrors > 0) {
    await logServerError(
      serviceClient,
      `payment-reconciliation: checked ${summary.checked}, healed ${summary.healed}, still pending ${summary.stillPending}, errors ${summary.apiErrors}`,
      { category: "payment", severity: summary.apiErrors > 0 ? "error" : "info", context: summary }
    );
  }

  return jsonResponse({ ok: true, ...summary });
});
