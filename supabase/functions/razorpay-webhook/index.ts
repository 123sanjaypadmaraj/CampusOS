// Edge Function: razorpay-webhook
//
// The ONLY place orders.payment_status is ever allowed to become "paid".
// Verifies the `X-Razorpay-Signature` HMAC-SHA256 header against the raw
// request body using RAZORPAY_WEBHOOK_SECRET before trusting anything in
// the payload (doc §24). Configure this URL in the Razorpay dashboard:
//   Settings -> Webhooks -> https://<project-ref>.functions.supabase.co/razorpay-webhook
// Required secrets:
//   RAZORPAY_WEBHOOK_SECRET
// Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2";
import { jsonResponse } from "../_shared/cors.ts";

async function verifySignature(rawBody: string, signature: string, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const hex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");

  // Constant-time-ish comparison.
  if (hex.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ code: "METHOD_NOT_ALLOWED", message: "POST only" }, 405);
  }

  const secret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");
  const signature = req.headers.get("x-razorpay-signature") || "";
  const rawBody = await req.text();

  if (!secret) {
    console.error("RAZORPAY_WEBHOOK_SECRET is not configured -- rejecting webhook.");
    return jsonResponse({ code: "GATEWAY_NOT_CONFIGURED" }, 503);
  }

  const verified = await verifySignature(rawBody, signature, secret);
  if (!verified) {
    // Deliberately vague response; the signature mismatch is logged for
    // investigation but we don't help an attacker iterate.
    console.warn("razorpay-webhook: signature verification failed");
    return jsonResponse({ code: "INVALID_SIGNATURE" }, 400);
  }

  const payload = JSON.parse(rawBody);
  const event = payload.event as string;
  const entity = payload.payload?.payment?.entity;
  if (!entity) {
    return jsonResponse({ code: "IGNORED", message: "No payment entity in payload" }, 200);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const serviceClient = createClient(supabaseUrl, serviceKey);

  const statusMap: Record<string, string> = {
    "payment.captured": "captured",
    "payment.authorized": "authorized",
    "payment.failed": "failed",
  };
  const status = statusMap[event];
  if (!status) {
    return jsonResponse({ code: "IGNORED", message: `Unhandled event ${event}` }, 200);
  }

  const { error } = await serviceClient.rpc("record_payment_event", {
    p_gateway_order_id: entity.order_id,
    p_gateway_payment_id: entity.id,
    p_status: status,
    p_signature_verified: true,
    p_raw_payload: payload,
  });

  if (error) {
    console.error("record_payment_event failed:", error);
    return jsonResponse({ code: "RECORD_FAILED", message: error.message }, 500);
  }

  return jsonResponse({ ok: true });
});
