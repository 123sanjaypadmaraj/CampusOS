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
//
// Hardening review (readiness-audit phase 04): the HMAC check itself was
// already sound. Two gaps closed here --
//   1. no cap on request size before it's read into memory -- a Content-
//      Length guard rejects anything absurdly larger than a real Razorpay
//      payload ever is, before req.text() buffers the whole thing.
//   2. no staleness check -- a signature that leaked (e.g. a webhook secret
//      compromised, used, then rotated) would otherwise stay replayable
//      forever. Payloads older than MAX_EVENT_AGE_MS are rejected even with
//      a valid signature.
// (The amount-integrity gap this review also found lives in
// record_payment_event() itself -- see 20260824000700_payment_webhook_
// hardening.sql -- since that's the single place every caller of this
// function's RPC ultimately funnels through.)

import { createClient } from "npm:@supabase/supabase-js@2";
import { jsonResponse } from "../_shared/cors.ts";
import { logServerError } from "../_shared/logServerError.ts";

const MAX_BODY_BYTES = 64 * 1024; // real Razorpay payloads are a few KB
const MAX_EVENT_AGE_MS = 15 * 60 * 1000;

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

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const serviceClient = createClient(supabaseUrl, serviceKey);

  // Cheap rejection before buffering the body at all. Content-Length can be
  // absent or wrong on a malicious request, so this isn't a hard guarantee
  // on its own -- the actual byte-length check on rawBody below is the real
  // backstop -- but it avoids reading an oversized body into memory when the
  // caller is honest about its size and just wrong about what this endpoint
  // accepts.
  const declaredLength = Number(req.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return jsonResponse({ code: "PAYLOAD_TOO_LARGE" }, 413);
  }

  const secret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");
  const signature = req.headers.get("x-razorpay-signature") || "";
  const rawBody = await req.text();

  if (rawBody.length > MAX_BODY_BYTES) {
    return jsonResponse({ code: "PAYLOAD_TOO_LARGE" }, 413);
  }

  if (!secret) {
    console.error("RAZORPAY_WEBHOOK_SECRET is not configured -- rejecting webhook.");
    await logServerError(serviceClient, "razorpay-webhook: RAZORPAY_WEBHOOK_SECRET not configured", { category: "payment", severity: "fatal" });
    return jsonResponse({ code: "GATEWAY_NOT_CONFIGURED" }, 503);
  }

  const verified = await verifySignature(rawBody, signature, secret);
  if (!verified) {
    // Deliberately vague response; the signature mismatch is logged for
    // investigation but we don't help an attacker iterate.
    console.warn("razorpay-webhook: signature verification failed");
    await logServerError(serviceClient, "razorpay-webhook: signature verification failed", { category: "payment", severity: "warning" });
    return jsonResponse({ code: "INVALID_SIGNATURE" }, 400);
  }

  const payload = JSON.parse(rawBody);

  // Staleness check -- only meaningful once the signature is already known
  // good (an attacker without the secret can't produce a valid signature no
  // matter the timestamp), so this guards against a *leaked* signature
  // being replayed long after the fact, not against forgery.
  const eventAgeMs = Date.now() - Number(payload.created_at || 0) * 1000;
  if (!Number.isFinite(eventAgeMs) || eventAgeMs > MAX_EVENT_AGE_MS || eventAgeMs < -MAX_EVENT_AGE_MS) {
    console.warn("razorpay-webhook: stale or clock-skewed event rejected", payload.created_at);
    await logServerError(serviceClient, "razorpay-webhook: stale/clock-skewed event rejected", { category: "payment", severity: "warning", context: { created_at: payload.created_at } });
    return jsonResponse({ code: "STALE_EVENT" }, 400);
  }

  const event = payload.event as string;
  const entity = payload.payload?.payment?.entity;
  if (!entity) {
    return jsonResponse({ code: "IGNORED", message: "No payment entity in payload" }, 200);
  }

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
    await logServerError(serviceClient, `record_payment_event failed: ${error.message}`, { category: "payment", severity: "error", context: { event, order_id: entity.order_id } });
    return jsonResponse({ code: "RECORD_FAILED", message: error.message }, 500);
  }

  return jsonResponse({ ok: true });
});
