// Edge Function: send-email
//
// The real delivery channel behind notification_preferences.channel_email
// (existed since 0010, nothing ever sent through it) plus the direct-send
// path used by request_contact_email_verification() and
// request-password-reset. Called by the `notifications_dispatch_email` DB
// trigger (supabase/migrations/20260817002000_notification_email_sms_dispatch.sql)
// via pg_net, and directly by other server-side callers -- NOT meant to be
// called from a signed-in browser, so it verifies a shared secret header
// instead of a Supabase JWT (deploy with --no-verify-jwt), same pattern as
// send-push.
//
// Required secrets (set via `supabase secrets set`):
//   EMAIL_DISPATCH_SECRET  -- must match the `email_dispatch_secret` Vault entry
//   RESEND_API_KEY, RESEND_FROM  (e.g. "CampusOS <notifications@yourdomain>")
// Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

// Every real, non-synthetic auth.users.email in this app is a genuine inbox
// (magic-link / Google / vendor accounts). USN+password accounts get one
// minted deterministically by signup-with-usn -- never a real inbox, never
// safe to email. Kept in sync with usnToEmail() there.
const SYNTHETIC_EMAIL_SUFFIX = "@usn.campusos.internal";

function isRealEmail(email: string | null | undefined): boolean {
  return !!email && !email.toLowerCase().endsWith(SYNTHETIC_EMAIL_SUFFIX);
}

function wrapTemplate(title: string, body: string, actionType?: string | null, actionId?: string | null): string {
  const appUrl = "https://campusos-amber.vercel.app";
  const viewLink = actionType && actionId
    ? `<p style="margin-top:20px"><a href="${appUrl}" style="color:#4f46e5">Open CampusOS</a></p>`
    : "";
  return `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1f2937">
      <div style="font-weight:700;font-size:18px;color:#4f46e5;margin-bottom:16px">CampusOS</div>
      <h2 style="font-size:18px;margin:0 0 8px">${title}</h2>
      <p style="font-size:14px;line-height:1.5;color:#374151">${body || ""}</p>
      ${viewLink}
      <hr style="margin-top:28px;border:none;border-top:1px solid #e5e7eb" />
      <p style="font-size:12px;color:#9ca3af">You're receiving this because email notifications are enabled on your CampusOS account. Manage this in Notifications settings.</p>
    </div>`;
}

async function sendViaResend(apiKey: string, from: string, to: string, subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (res.ok) return { ok: true };
  const text = await res.text().catch(() => "");
  return { ok: false, error: `Resend ${res.status}: ${text.slice(0, 300)}` };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ code: "METHOD_NOT_ALLOWED", message: "POST only" }, 405);
  }

  const dispatchSecret = Deno.env.get("EMAIL_DISPATCH_SECRET");
  const provided = req.headers.get("x-email-secret");
  if (!dispatchSecret || provided !== dispatchSecret) {
    return jsonResponse({ code: "UNAUTHORIZED" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ code: "BAD_REQUEST", message: "Invalid JSON body" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const resendFrom = Deno.env.get("RESEND_FROM") || "CampusOS <onboarding@resend.dev>";

  const deliveryId = (body?.delivery_id as string) || undefined;
  const reportResult = async (status: "sent" | "failed" | "skipped", error?: string) => {
    if (!deliveryId) return;
    await admin.rpc("mark_delivery_result", { p_delivery_id: deliveryId, p_status: status, p_error: error ?? null }).catch(() => {});
  };

  // --- Direct mode: a pre-rendered {to, subject, html}, used by
  // request_contact_email_verification() and request-password-reset. No
  // delivery-tracking row involved (those aren't notifications).
  if (body?.to && body?.subject && body?.html) {
    if (!resendKey) {
      return jsonResponse({ code: "GATEWAY_NOT_CONFIGURED" }, 503);
    }
    const result = await sendViaResend(resendKey, resendFrom, body.to as string, body.subject as string, body.html as string);
    if (!result.ok) {
      console.error("send-email: direct send failed", result.error);
      return jsonResponse({ code: "SEND_FAILED", message: result.error }, 502);
    }
    return jsonResponse({ code: "OK" }, 200);
  }

  // --- Notification-driven mode.
  const notificationId = body?.notification_id as string | undefined;
  if (!notificationId) {
    return jsonResponse({ code: "BAD_REQUEST", message: "notification_id or {to,subject,html} is required" }, 400);
  }

  const { data: notif, error: notifError } = await admin
    .from("notifications")
    .select("id, user_id, type, title, body, action_type, action_id")
    .eq("id", notificationId)
    .single();

  if (notifError || !notif) {
    await reportResult("failed", "Notification not found");
    return jsonResponse({ code: "NOT_FOUND", message: "Notification not found" }, 404);
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("contact_email, contact_email_verified_at")
    .eq("id", notif.user_id)
    .maybeSingle();

  let recipient: string | null = null;
  if (profile?.contact_email && profile.contact_email_verified_at) {
    recipient = profile.contact_email;
  } else {
    const { data: authUser } = await admin.auth.admin.getUserById(notif.user_id);
    if (isRealEmail(authUser?.user?.email)) {
      recipient = authUser!.user!.email as string;
    }
  }

  if (!recipient) {
    await reportResult("skipped", "no verified contact email or real account email on file");
    return jsonResponse({ code: "SKIPPED_NO_RECIPIENT" }, 200);
  }

  if (!resendKey) {
    console.error("RESEND_API_KEY is not configured -- email cannot be delivered.");
    await reportResult("failed", "RESEND_API_KEY not configured");
    return jsonResponse({ code: "GATEWAY_NOT_CONFIGURED" }, 503);
  }

  const html = wrapTemplate(notif.title, notif.body || "", notif.action_type, notif.action_id);
  const result = await sendViaResend(resendKey, resendFrom, recipient, notif.title, html);

  if (!result.ok) {
    console.error("send-email: delivery failed", result.error);
    await reportResult("failed", result.error);
    return jsonResponse({ code: "SEND_FAILED", message: result.error }, 502);
  }

  await reportResult("sent");
  return jsonResponse({ code: "OK" }, 200);
});
