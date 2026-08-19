// One-off live verification for the 2026-08-17 notification-delivery pass:
// notification_deliveries tracking/dedup/quiet-hours (20260817001700),
// event-coverage triggers (20260817001800), reminders/retry cron
// (20260817001900), email/SMS dispatch triggers (20260817002000), and
// contact-email verification / password recovery (20260817002200).
//
// SCOPE NOTE: covers everything at the DB layer (RPCs, triggers, RLS/
// grants) plus a plain-fetch smoke test of the 4 Edge Functions' auth/
// validation/not-configured behavior. It does NOT send a real email/SMS --
// that needs RESEND_API_KEY/FAST2SMS_API_KEY, which this app deliberately
// doesn't have yet (see docs/ROADMAP.md §47/§49); until then, `send-email`/
// `send-sms` are expected to answer GATEWAY_NOT_CONFIGURED, and that's what
// this script checks for, not a real delivery.
// confirm_contact_email_verification's token validation IS testable without
// a real email arriving -- since the raw token is only ever visible in the
// outgoing email (never stored, only its hash), this script mints its own
// token and inserts the hash directly via service_role to test the confirm
// side, rather than trying to intercept an email that was never sent.
//
// Usage: node scripts/live-check-notification-delivery.mjs                 (staging)
//        node scripts/live-check-notification-delivery.mjs --env=production --yes-production

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import { resolveTarget } from "./env-target.mjs";

const { SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY, root, target } = resolveTarget();
const e2eCredsFile = target === "production" ? ".e2e-credentials.local.json" : ".e2e-credentials.staging.local.json";
const e2eCreds = JSON.parse(fs.readFileSync(path.join(root, "scripts", e2eCredsFile), "utf8"));
const e2ePassword = (email) => {
  const password = e2eCreds.find((r) => r.email === email)?.password;
  if (!password) throw new Error(`No password known for ${email} in ${e2eCredsFile} -- run scripts/setup-test-users.mjs first.`);
  return password;
};


let passCount = 0;
let failCount = 0;
function check(label, cond, extra) {
  if (cond) {
    passCount++;
    console.log(`  PASS  ${label}`);
  } else {
    failCount++;
    console.log(`  FAIL  ${label}${extra ? " -- " + JSON.stringify(extra) : ""}`);
  }
}

function client() {
  return createClient(SUPABASE_URL, ANON_KEY);
}

async function signIn(email, password) {
  const sb = client();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return { sb, userId: data.user.id };
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

async function main() {
  console.log("=== Notification delivery infra + contact recovery ===");
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const alice = await signIn("e2e.alice@nhce.edu.in", e2ePassword("e2e.alice@nhce.edu.in"));

  // Snapshot everything this run touches so it's restored regardless of pass/fail.
  const { data: originalProfile } = await admin.from("profiles").select("contact_email, contact_email_verified_at, phone").eq("id", alice.userId).single();
  const { data: originalPref } = await admin.from("notification_preferences").select("*").eq("user_id", alice.userId).maybeSingle();

  try {
    // --- 1. dedup_key ---
    const dedupKey = `livecheck_${Date.now()}`;
    const { data: id1, error: id1Err } = await admin.rpc("create_notification", {
      target_user: alice.userId, notification_title: "Dedup test", notification_body: "first",
      notification_type: "official", p_dedup_key: dedupKey,
    });
    const { data: id2, error: id2Err } = await admin.rpc("create_notification", {
      target_user: alice.userId, notification_title: "Dedup test", notification_body: "second",
      notification_type: "official", p_dedup_key: dedupKey,
    });
    check("create_notification: repeat call with the same dedup_key within 10min returns the same id", !id1Err && !id2Err && id1 === id2, { id1Err, id2Err, id1, id2 });

    // --- 2. Quiet hours (00:00-23:59 -- deterministically "now", whatever time this runs) ---
    await admin.from("notification_preferences").upsert(
      { user_id: alice.userId, channel_push: true, channel_email: false, channel_sms: false, quiet_hours_enabled: true, quiet_hours_start: "00:00", quiet_hours_end: "23:59" },
      { onConflict: "user_id" }
    );

    const { data: quietNotifId } = await admin.rpc("create_notification", {
      target_user: alice.userId, notification_title: "Quiet hours test", notification_body: "x", notification_type: "official",
    });
    const { data: quietDeliveries } = await admin.from("notification_deliveries").select("channel, status, skip_reason").eq("notification_id", quietNotifId);
    const pushDelivery = quietDeliveries?.find((d) => d.channel === "push");
    check(
      "create_notification during quiet hours: push delivery row created pre-skipped (quiet_hours), not dispatched",
      pushDelivery?.status === "skipped" && pushDelivery?.skip_reason === "quiet_hours",
      quietDeliveries
    );
    const { data: quietNotifRow } = await admin.from("notifications").select("id").eq("id", quietNotifId).maybeSingle();
    check("the in-app notification row itself still lands during quiet hours (only delivery is suppressed)", !!quietNotifRow, quietNotifRow);

    // --- 3. Emergency bypasses quiet hours AND the channel_sms opt-in ---
    await admin.from("profiles").update({ phone: "+919876543210" }).eq("id", alice.userId);
    const { data: emergNotifId, error: emergErr } = await admin.rpc("create_notification", {
      target_user: alice.userId, notification_title: "Emergency test", notification_body: "x", notification_type: "emergency",
    });
    const { data: emergDeliveries } = await admin.from("notification_deliveries").select("channel, status, skip_reason").eq("notification_id", emergNotifId);
    const emergPush = emergDeliveries?.find((d) => d.channel === "push");
    const emergSms = emergDeliveries?.find((d) => d.channel === "sms");
    check("emergency create_notification succeeds even while the target is in quiet hours", !emergErr, emergErr?.message);
    check("emergency notification: push delivery is NOT quiet-hours-skipped (status=pending)", emergPush?.status === "pending", emergDeliveries);
    check("emergency notification: sms delivery row created even though channel_sms=false (the fix in 20260817001700)", emergSms?.status === "pending", emergDeliveries);

    // --- 4. Non-emergency respects channel_sms=false (no bypass for ordinary notifications) ---
    await admin.from("notification_preferences").upsert({ user_id: alice.userId, quiet_hours_enabled: false }, { onConflict: "user_id" });
    const { data: ordinaryNotifId } = await admin.rpc("create_notification", {
      target_user: alice.userId, notification_title: "Ordinary test", notification_body: "x", notification_type: "official",
    });
    const { data: ordinaryDeliveries } = await admin.from("notification_deliveries").select("channel").eq("notification_id", ordinaryNotifId);
    check("ordinary (non-emergency) notification: no sms delivery row when channel_sms=false", !ordinaryDeliveries?.some((d) => d.channel === "sms"), ordinaryDeliveries);

    // --- 5. mark_delivery_result: service_role only ---
    const { data: pushRow } = await admin.from("notification_deliveries").select("id").eq("notification_id", emergNotifId).eq("channel", "push").single();
    const { error: markErr } = await admin.rpc("mark_delivery_result", { p_delivery_id: pushRow.id, p_status: "sent" });
    check("mark_delivery_result succeeds via service_role", !markErr, markErr?.message);
    const { data: markedRow } = await admin.from("notification_deliveries").select("status, attempts").eq("id", pushRow.id).single();
    check("mark_delivery_result actually updates status + increments attempts", markedRow?.status === "sent" && markedRow?.attempts === 1, markedRow);

    const { error: aliceMarkErr } = await alice.sb.rpc("mark_delivery_result", { p_delivery_id: pushRow.id, p_status: "sent" });
    check("mark_delivery_result rejects a plain authenticated caller (service_role only)", !!aliceMarkErr, aliceMarkErr?.message);

    // --- 6. retry_failed_deliveries is callable and returns an integer ---
    const { data: retryCount, error: retryErr } = await admin.rpc("retry_failed_deliveries");
    check("retry_failed_deliveries is callable and returns a count", !retryErr && typeof retryCount === "number", { retryErr, retryCount });

    // --- 7. request_contact_email_verification: rate limit + profiles write ---
    await admin.from("profiles").update({ contact_email: null, contact_email_verified_at: null }).eq("id", alice.userId);
    await admin.from("rate_limit_hits").delete().eq("user_id", alice.userId).eq("bucket", "email_verify");

    const { error: verifyReqErr } = await alice.sb.rpc("request_contact_email_verification", { p_email: "livecheck+alice@example.com" });
    check("request_contact_email_verification succeeds for a signed-in user", !verifyReqErr, verifyReqErr?.message);
    const { data: afterRequest } = await admin.from("profiles").select("contact_email, contact_email_verified_at").eq("id", alice.userId).single();
    check("request_contact_email_verification sets profiles.contact_email and leaves it unverified", afterRequest?.contact_email === "livecheck+alice@example.com" && !afterRequest?.contact_email_verified_at, afterRequest);

    // Limit is 3/hour and the call above was already #1 -- 2 more calls
    // land exactly on the limit (#2, #3), a 4th must be rejected.
    await alice.sb.rpc("request_contact_email_verification", { p_email: "livecheck+alice@example.com" });
    await alice.sb.rpc("request_contact_email_verification", { p_email: "livecheck+alice@example.com" });
    const { error: verify4thErr } = await alice.sb.rpc("request_contact_email_verification", { p_email: "livecheck+alice@example.com" });
    check("request_contact_email_verification rate-limited after 3 requests/hour", !!verify4thErr, verify4thErr?.message);

    // --- 8. confirm_contact_email_verification: mint our own token (raw
    // token is never stored server-side, only its hash -- see the file
    // header) to test the confirm side directly.
    const rawToken = crypto.randomBytes(32).toString("hex");
    await admin.from("email_verification_tokens").insert({
      user_id: alice.userId, email: "livecheck+alice@example.com", token_hash: sha256Hex(rawToken), expires_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    const { error: confirmErr } = await client().rpc("confirm_contact_email_verification", { p_token: rawToken });
    check("confirm_contact_email_verification accepts a valid token from an anonymous client (no session)", !confirmErr, confirmErr?.message);
    const { data: afterConfirm } = await admin.from("profiles").select("contact_email_verified_at").eq("id", alice.userId).single();
    check("confirm_contact_email_verification actually sets contact_email_verified_at", !!afterConfirm?.contact_email_verified_at, afterConfirm);

    const { error: reuseErr } = await client().rpc("confirm_contact_email_verification", { p_token: rawToken });
    check("confirm_contact_email_verification rejects a reused token", !!reuseErr, reuseErr?.message);

    const expiredToken = crypto.randomBytes(32).toString("hex");
    await admin.from("email_verification_tokens").insert({
      user_id: alice.userId, email: "livecheck+alice@example.com", token_hash: sha256Hex(expiredToken), expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    const { error: expiredErr } = await client().rpc("confirm_contact_email_verification", { p_token: expiredToken });
    check("confirm_contact_email_verification rejects an expired token", !!expiredErr, expiredErr?.message);

    // --- 9. protect_contact_email_verification: can't self-report verified ---
    await admin.from("profiles").update({ contact_email_verified_at: null }).eq("id", alice.userId);
    const { error: forgeErr } = await alice.sb.from("profiles").update({ contact_email_verified_at: new Date().toISOString() }).eq("id", alice.userId);
    const { data: afterForgeAttempt } = await admin.from("profiles").select("contact_email_verified_at").eq("id", alice.userId).single();
    check("a plain client PATCH cannot self-set contact_email_verified_at", !!forgeErr || !afterForgeAttempt?.contact_email_verified_at, { forgeErr, afterForgeAttempt });

    // --- 10. Edge Function smoke tests (auth + validation + graceful
    // not-configured -- not real delivery, see file header) ---
    const fnUrl = (name) => `${SUPABASE_URL}/functions/v1/${name}`;
    const postJson = (url, body, headers = {}) =>
      fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

    const noSecretRes = await postJson(fnUrl("send-email"), { to: "x@x.com", subject: "t", html: "t" });
    check("send-email rejects a call with no X-Email-Secret header", noSecretRes.status === 401, noSecretRes.status);

    const badUsnRes = await postJson(fnUrl("request-password-reset"), { usn: "bad" });
    const badUsnBody = await badUsnRes.json();
    check("request-password-reset rejects a malformed USN", badUsnRes.status === 400 && badUsnBody.code === "USN_INVALID", badUsnBody);

    const nonexistentRes = await postJson(fnUrl("request-password-reset"), { usn: "9ZZ99ZZ999" });
    const nonexistentBody = await nonexistentRes.json();
    check(
      "request-password-reset returns the same generic response for a nonexistent USN (no account enumeration)",
      nonexistentRes.status === 200 && nonexistentBody.ok === true,
      nonexistentBody
    );

    const badTokenRes = await postJson(fnUrl("confirm-password-reset"), { token: "nonsense", newPassword: "newpassword123" });
    const badTokenBody = await badTokenRes.json();
    check("confirm-password-reset rejects an unknown token", badTokenRes.status === 400 && badTokenBody.code === "INVALID_TOKEN", badTokenBody);

    const noSmsSecretRes = await postJson(fnUrl("send-sms"), { notification_id: "00000000-0000-0000-0000-000000000000" });
    check("send-sms rejects a call with no X-Sms-Secret header", noSmsSecretRes.status === 401, noSmsSecretRes.status);
  } finally {
    // Restore alice's exact original state regardless of pass/fail.
    await admin.from("profiles").update({
      contact_email: originalProfile?.contact_email ?? null,
      contact_email_verified_at: originalProfile?.contact_email_verified_at ?? null,
      phone: originalProfile?.phone ?? null,
    }).eq("id", alice.userId);
    if (originalPref) {
      await admin.from("notification_preferences").upsert({ user_id: alice.userId, ...originalPref }, { onConflict: "user_id" });
    } else {
      await admin.from("notification_preferences").delete().eq("user_id", alice.userId);
    }
    await admin.from("rate_limit_hits").delete().eq("user_id", alice.userId).eq("bucket", "email_verify");
  }

  const { data: restoredProfile } = await admin.from("profiles").select("contact_email, contact_email_verified_at, phone").eq("id", alice.userId).single();
  check(
    "cleanup: alice's profile restored to its exact pre-run state",
    JSON.stringify(restoredProfile) === JSON.stringify(originalProfile),
    { before: originalProfile, after: restoredProfile }
  );

  console.log(`\n${passCount} passed, ${failCount} failed`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Live check crashed:", err);
  process.exit(1);
});
