// Edge Function: razorpay-refund
//
// Called by a vendor/admin right after request_refund() (RPC, see
// 20260815000900_vendor_order_ops.sql) has inserted a 'pending' refunds row
// and moved the order to REFUND_PENDING. This function makes the actual
// gateway call -- request_refund() itself only records intent, it can't call
// out to Razorpay (that needs RAZORPAY_KEY_SECRET, never exposed to the
// browser) -- then calls mark_refund_completed() to close the loop, mirroring
// exactly how razorpay-webhook is the only caller of record_payment_event().
//
// Required secrets (already set for create-razorpay-order):
//   RAZORPAY_KEY_ID
//   RAZORPAY_KEY_SECRET
// Auto-provided: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { logServerError } from "../_shared/logServerError.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Constructed up front (needs no external call) so it's available to log
  // an error from any failure branch below, including the outer catch.
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const serviceClient = createClient(supabaseUrl, serviceKey);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ code: "UNAUTHENTICATED", message: "Sign in required" }, 401);
    }

    const { refund_id } = await req.json();
    if (!refund_id) {
      return jsonResponse({ code: "BAD_REQUEST", message: "refund_id is required" }, 400);
    }

    // Scoped to the caller's own JWT -- refunds_read RLS (fixed in the same
    // migration as request_refund()) is what actually proves this caller is
    // allowed to see (and therefore drive) this refund. A row coming back
    // here IS the authorization check; nothing else re-derives it.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: refund, error: refundError } = await userClient
      .from("refunds")
      .select("*")
      .eq("id", refund_id)
      .maybeSingle();
    if (refundError || !refund) {
      return jsonResponse({ code: "NOT_FOUND", message: "Refund not found or not authorized" }, 404);
    }

    if (refund.status === "completed") {
      return jsonResponse({ ok: true, refund });
    }
    if (refund.status !== "pending" && refund.status !== "failed") {
      return jsonResponse({ code: "REFUND_NOT_PENDING", message: `Refund is already ${refund.status}` }, 409);
    }

    const { data: payment, error: paymentError } = await serviceClient
      .from("payments")
      .select("*")
      .eq("id", refund.payment_id)
      .maybeSingle();
    if (paymentError || !payment?.gateway_payment_id) {
      return jsonResponse({ code: "NO_GATEWAY_PAYMENT", message: "No captured gateway payment to refund" }, 400);
    }

    const keyId = Deno.env.get("RAZORPAY_KEY_ID");
    const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
    if (!keyId || !keySecret) {
      await logServerError(serviceClient, "razorpay-refund: Razorpay keys not configured", { category: "payment", severity: "fatal" });
      return jsonResponse(
        { code: "GATEWAY_NOT_CONFIGURED", message: "Razorpay test keys are not configured on this deployment yet." },
        503
      );
    }

    const razorpayRes = await fetch(
      `https://api.razorpay.com/v1/payments/${payment.gateway_payment_id}/refund`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Basic " + btoa(`${keyId}:${keySecret}`),
        },
        body: JSON.stringify({
          amount: Math.round(Number(refund.amount) * 100), // paise
          speed: "normal",
          notes: { order_id: refund.order_id, refund_id: refund.id },
        }),
      }
    );

    if (!razorpayRes.ok) {
      const errBody = await razorpayRes.text();
      console.error("Razorpay refund failed:", errBody);
      await logServerError(serviceClient, `Razorpay refund failed: ${errBody.slice(0, 500)}`, { category: "payment", severity: "error", context: { refund_id } });
      await serviceClient.from("refunds").update({ status: "failed" }).eq("id", refund_id);
      return jsonResponse({ code: "GATEWAY_ERROR", message: "Payment gateway could not process the refund." }, 502);
    }

    const razorpayRefund = await razorpayRes.json();

    const { data: completed, error: completeError } = await serviceClient.rpc("mark_refund_completed", {
      p_refund_id: refund_id,
      p_gateway_refund_id: razorpayRefund.id,
    });
    if (completeError) {
      console.error("mark_refund_completed failed:", completeError);
      await logServerError(serviceClient, `mark_refund_completed failed: ${completeError.message}`, { category: "payment", severity: "error", context: { refund_id } });
      return jsonResponse({ code: "RECORD_FAILED", message: completeError.message }, 500);
    }

    return jsonResponse({ ok: true, refund: completed });
  } catch (err) {
    console.error("razorpay-refund error:", err);
    await logServerError(serviceClient, `razorpay-refund error: ${err instanceof Error ? err.message : String(err)}`, {
      stack: err instanceof Error ? err.stack : undefined,
      category: "payment",
      severity: "error",
    });
    return jsonResponse({ code: "INTERNAL_ERROR", message: "Unable to process refund." }, 500);
  }
});
