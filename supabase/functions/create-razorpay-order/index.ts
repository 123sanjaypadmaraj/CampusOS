// Edge Function: create-razorpay-order
//
// Called by the authenticated student right before opening Razorpay
// Checkout. It NEVER trusts an amount from the browser -- it re-derives the
// authoritative total by calling the create_payment_order() RPC (which
// itself re-reads the locked order row), then asks Razorpay to create a
// matching order, and only then hands the browser what it needs to open
// checkout (doc §24-25).
//
// Required secrets (set via `supabase secrets set`):
//   RAZORPAY_KEY_ID
//   RAZORPAY_KEY_SECRET
// Auto-provided by the Supabase Edge runtime:
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ code: "UNAUTHENTICATED", message: "Sign in required" }, 401);
    }

    const { order_id } = await req.json();
    if (!order_id) {
      return jsonResponse({ code: "BAD_REQUEST", message: "order_id is required" }, 400);
    }

    // Client scoped to the caller's JWT -- RLS/ownership is enforced by the
    // create_payment_order() RPC itself.
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: payment, error } = await userClient.rpc("create_payment_order", {
      p_order_id: order_id,
    });
    if (error) {
      return jsonResponse({ code: "PAYMENT_ORDER_FAILED", message: error.message }, 400);
    }

    const keyId = Deno.env.get("RAZORPAY_KEY_ID");
    const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
    if (!keyId || !keySecret) {
      return jsonResponse(
        { code: "GATEWAY_NOT_CONFIGURED", message: "Razorpay test keys are not configured on this deployment yet." },
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
        notes: { order_id, payment_id: payment.id },
      }),
    });

    if (!razorpayRes.ok) {
      const errBody = await razorpayRes.text();
      console.error("Razorpay order creation failed:", errBody);
      return jsonResponse({ code: "GATEWAY_ERROR", message: "Payment gateway could not create the order." }, 502);
    }

    const razorpayOrder = await razorpayRes.json();

    // Service-role client to attach the gateway order id -- this table has
    // no client-facing update policy, only the service role may write it.
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const serviceClient = createClient(supabaseUrl, serviceKey);
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
    return jsonResponse({ code: "INTERNAL_ERROR", message: "Unable to start payment." }, 500);
  }
});
