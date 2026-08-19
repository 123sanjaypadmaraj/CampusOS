// Edge Function: send-sms
//
// The real delivery channel behind notification_preferences.channel_sms
// (existed since 0010, nothing ever sent through it). Called by the
// `notifications_dispatch_sms` DB trigger
// (supabase/migrations/20260817002000_notification_email_sms_dispatch.sql)
// via pg_net, same shared-secret pattern as send-push/send-email.
// Notification-driven only -- there is no direct-send mode (SMS is never
// used for verification/password-reset in this app; see the "not building"
// note in the notification-delivery-infra migration's own header comment).
//
// Provider: Fast2SMS "Quick SMS" route (https://www.fast2sms.com) -- chosen
// because it needs no DLT registration (India's mandatory SMS-compliance
// process for every other route, ~Rs 5,900 + paperwork) and gives a
// starter free credit, so it's realistically usable without a registered
// business entity. Real SMS delivery is never free indefinitely with any
// provider past a small trial credit -- this is documented in the
// Notifications settings UI copy rather than oversold.
//
// Required secrets (set via `supabase secrets set`):
//   SMS_DISPATCH_SECRET  -- must match the `sms_dispatch_secret` Vault entry
//   FAST2SMS_API_KEY
// Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { logServerError } from "../_shared/logServerError.ts";

async function sendViaFast2Sms(apiKey: string, phone: string, message: string): Promise<{ ok: boolean; error?: string }> {
  // Quick SMS route: numeric_only route="q", no DLT template/sender-id
  // needed. Indian 10-digit numbers only -- strip a +91/91 prefix if present.
  const digits = phone.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
  if (digits.length !== 10) {
    return { ok: false, error: `Not a valid 10-digit Indian mobile number: ${phone}` };
  }
  const res = await fetch("https://www.fast2sms.com/dev/bulkV2", {
    method: "POST",
    headers: { authorization: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ route: "q", message, language: "english", flash: 0, numbers: digits }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data?.return === true) return { ok: true };
  return { ok: false, error: `Fast2SMS ${res.status}: ${JSON.stringify(data).slice(0, 300)}` };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ code: "METHOD_NOT_ALLOWED", message: "POST only" }, 405);
  }

  const dispatchSecret = Deno.env.get("SMS_DISPATCH_SECRET");
  const provided = req.headers.get("x-sms-secret");
  if (!dispatchSecret || provided !== dispatchSecret) {
    return jsonResponse({ code: "UNAUTHORIZED" }, 401);
  }

  let notificationId: string | undefined;
  let deliveryId: string | undefined;
  try {
    const body = await req.json();
    notificationId = body?.notification_id;
    deliveryId = body?.delivery_id;
  } catch {
    return jsonResponse({ code: "BAD_REQUEST", message: "Invalid JSON body" }, 400);
  }
  if (!notificationId) {
    return jsonResponse({ code: "BAD_REQUEST", message: "notification_id is required" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  const reportResult = async (status: "sent" | "failed" | "skipped", error?: string) => {
    if (!deliveryId) return;
    await admin.rpc("mark_delivery_result", { p_delivery_id: deliveryId, p_status: status, p_error: error ?? null }).catch(() => {});
  };

  const { data: notif, error: notifError } = await admin
    .from("notifications")
    .select("id, user_id, type, title, body")
    .eq("id", notificationId)
    .single();

  if (notifError || !notif) {
    await reportResult("failed", "Notification not found");
    return jsonResponse({ code: "NOT_FOUND", message: "Notification not found" }, 404);
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("phone")
    .eq("id", notif.user_id)
    .maybeSingle();

  if (!profile?.phone) {
    await reportResult("skipped", "no phone number on file");
    return jsonResponse({ code: "SKIPPED_NO_PHONE" }, 200);
  }

  const apiKey = Deno.env.get("FAST2SMS_API_KEY");
  if (!apiKey) {
    // Deliberately NOT logged to error_logs -- FAST2SMS_API_KEY is unset by
    // design (SMS is plumbing-only, always reports 'skipped'; see this
    // repo's notification-dispatch migration header comment), not an outage.
    console.error("FAST2SMS_API_KEY is not configured -- SMS cannot be delivered.");
    await reportResult("failed", "FAST2SMS_API_KEY not configured");
    return jsonResponse({ code: "GATEWAY_NOT_CONFIGURED" }, 503);
  }

  const message = `CampusOS: ${notif.title}${notif.body ? " - " + notif.body : ""}`.slice(0, 300);
  const result = await sendViaFast2Sms(apiKey, profile.phone, message);

  if (!result.ok) {
    console.error("send-sms: delivery failed", result.error);
    await reportResult("failed", result.error);
    await logServerError(admin, `send-sms delivery failed: ${result.error}`, { category: "notification", severity: "error", context: { notification_id: notificationId } });
    return jsonResponse({ code: "SEND_FAILED", message: result.error }, 502);
  }

  await reportResult("sent");
  return jsonResponse({ code: "OK" }, 200);
});
