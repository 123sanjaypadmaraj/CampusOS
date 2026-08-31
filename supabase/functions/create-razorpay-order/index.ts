// Edge Function: create-razorpay-order
//
// Called by the authenticated student right before opening Razorpay
// Checkout, for a food order, a print job, OR a paid event registration
// (mutually exclusive -- pass exactly one of order_id/print_job_id/
// event_registration_id). It NEVER trusts an amount from the browser -- it
// re-derives the authoritative total by calling create_payment_order()/
// create_print_payment_order()/create_event_payment_order() (which re-reads
// the locked order/print_job/registration row), then asks Razorpay to create
// a matching order, and only then hands the browser what it needs to open
// checkout (doc §24-25, §29; event registrations added in
// 20260831000800_paid_events.sql).
//
// Required secrets (set via `supabase secrets set`):
//   RAZORPAY_KEY_ID
//   RAZORPAY_KEY_SECRET
// Auto-provided by the Supabase Edge runtime:
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

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
  const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ code: "UNAUTHENTICATED", message: "Sign in required" }, 401);
    }

    const { order_id, print_job_id, event_registration_id } = await req.json();
    const targetCount = [order_id, print_job_id, event_registration_id].filter(Boolean).length;
    if (targetCount === 0) {
      return jsonResponse({ code: "BAD_REQUEST", message: "order_id, print_job_id, or event_registration_id is required" }, 400);
    }
    if (targetCount > 1) {
      return jsonResponse({ code: "BAD_REQUEST", message: "Pass only one of order_id / print_job_id / event_registration_id" }, 400);
    }

    // Client scoped to the caller's JWT -- RLS/ownership is enforced by the
    // create_payment_order()/create_print_payment_order() RPC itself.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: payment, error } = order_id
      ? await userClient.rpc("create_payment_order", { p_order_id: order_id })
      : print_job_id
      ? await userClient.rpc("create_print_payment_order", { p_print_job_id: print_job_id })
      : await userClient.rpc("create_event_payment_order", { p_registration_id: event_registration_id });
    if (error) {
      await logServerError(serviceClient, `create_payment_order/create_print_payment_order/create_event_payment_order failed: ${error.message}`, { category: "payment", severity: "error", context: { order_id, print_job_id, event_registration_id } });
      return jsonResponse({ code: "PAYMENT_ORDER_FAILED", message: error.message }, 400);
    }

    const keyId = Deno.env.get("RAZORPAY_KEY_ID");
    const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
    if (!keyId || !keySecret) {
      await logServerError(serviceClient, "create-razorpay-order: Razorpay keys not configured", { category: "payment", severity: "fatal" });
      return jsonResponse(
        { code: "GATEWAY_NOT_CONFIGURED", message: "Razorpay keys are not configured on this deployment yet." },
        503
      );
    }

    // Reuse an existing gateway order if create_payment_order() returned an
    // already-created-but-unpaid payment row (idempotent retries).
    if (payment.gateway_order_id) {
      return jsonResponse({
        key_id: keyId,
        gateway_order_id: payment.gateway_order_id,
        amount: Math.round(Number(payment.amount) * 100),
        currency: payment.currency,
        payment_id: payment.id,
      });
    }

    const razorpayRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + btoa(`${keyId}:${keySecret}`),
      },
      body: JSON.stringify({
        amount: Math.round(Number(payment.amount) * 100), // paise
        currency: payment.currency || "INR",
        receipt: payment.id,
        notes: order_id
          ? { order_id, payment_id: payment.id }
          : print_job_id
          ? { print_job_id, payment_id: payment.id }
          : { event_registration_id, payment_id: payment.id },
      }),
    });

    if (!razorpayRes.ok) {
      const errBody = await razorpayRes.text();
      console.error("Razorpay order creation failed:", errBody);
      await logServerError(serviceClient, `Razorpay order creation failed: ${errBody.slice(0, 500)}`, { category: "payment", severity: "error", context: { order_id, print_job_id, event_registration_id } });
      return jsonResponse({ code: "GATEWAY_ERROR", message: "Payment gateway could not create the order." }, 502);
    }

    const razorpayOrder = await razorpayRes.json();

    // Service-role client (constructed up top) to attach the gateway order
    // id -- this table has no client-facing update policy, only the
    // service role may write it.
    await serviceClient
      .from("payments")
      .update({ gateway_order_id: razorpayOrder.id, gateway: "razorpay" })
      .eq("id", payment.id);

    return jsonResponse({
      key_id: keyId,
      gateway_order_id: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      payment_id: payment.id,
    });
  } catch (err) {
    console.error("create-razorpay-order error:", err);
    await logServerError(serviceClient, `create-razorpay-order error: ${err instanceof Error ? err.message : String(err)}`, {
      stack: err instanceof Error ? err.stack : undefined,
      category: "payment",
      severity: "error",
    });
    return jsonResponse({ code: "INTERNAL_ERROR", message: "Unable to start payment." }, 500);
  }
});
