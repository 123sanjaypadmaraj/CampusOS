// One-off live verification script (not part of the automated suite) --
// exercises supabase/migrations/20260819001400_observability.sql directly
// against a real Supabase project using real signed-in sessions. Same shape
// as scripts/live-check-support-hardening.mjs.
//
// Only the error_spike alert threshold is actually crossed here (seeded via
// log_server_error, which this migration adds) -- the payment_failure_spike/
// notification_failure_spike/cron_job_failure branches share the exact same
// COUNT+threshold+create_notification shape in run_observability_alerts(),
// so they're checked structurally (the function's return JSON has the right
// keys/types) rather than by fabricating fake orders/notification_deliveries/
// cron rows, which would risk tripping real business-logic triggers.
//
// Usage: node scripts/live-check-observability.mjs                 (staging)
//        node scripts/live-check-observability.mjs --env=production --yes-production

import { createClient } from "@supabase/supabase-js";
import { resolveTarget } from "./env-target.mjs";

const { SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY, target } = resolveTarget();

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

function client(key = ANON_KEY) {
  return createClient(SUPABASE_URL, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function signIn(email, password) {
  const sb = client();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return { sb, userId: data.user.id };
}

const svc = client(SERVICE_ROLE_KEY);
const marker = `LiveCheckObservability ${Date.now()}`;
const seededErrorIds = [];

async function main() {
  console.log(`=== Observability pass (doc #97) [${target}] ===`);
  const admin = await signIn("1nh25cs265@usn.campusos.internal", "Sanjay@123");

  try {
    // =========================================================
    // Write paths: log_client_error (category) + log_server_error
    // =========================================================
    console.log("\n--- Write paths ---");

    const { data: clientLogId, error: clientLogErr } = await admin.sb.rpc("log_client_error", {
      p_message: `${marker} client`,
      p_severity: "warning",
      p_source: "client",
      p_category: "storage",
    });
    check("log_client_error accepts p_category", !clientLogErr && !!clientLogId, clientLogErr?.message);
    if (clientLogId) seededErrorIds.push(clientLogId);

    const { data: serverLogId, error: serverLogErr } = await svc.rpc("log_server_error", {
      p_message: `${marker} server`,
      p_category: "payment",
      p_severity: "error",
    });
    check("log_server_error (service_role) inserts a source='server' row", !serverLogErr && !!serverLogId, serverLogErr?.message);
    if (serverLogId) seededErrorIds.push(serverLogId);

    const { error: anonServerLogErr } = await client().rpc("log_server_error", { p_message: "should be blocked" });
    check("log_server_error is NOT callable with the anon key", !!anonServerLogErr);

    const { data: row } = await svc.from("error_logs").select("fingerprint, category, source").eq("id", serverLogId).single();
    check("fingerprint is generated and includes category", row?.fingerprint?.length === 32 && row?.category === "payment");

    // =========================================================
    // Read path: admin_observability_summary()
    // =========================================================
    console.log("\n--- Read path ---");

    const { data: summary, error: summaryErr } = await admin.sb.rpc("admin_observability_summary");
    check("admin can call admin_observability_summary", !summaryErr, summaryErr?.message);
    check("summary has errors_by_severity_24h/errors_by_category_24h/top_error_fingerprints_24h/payment_24h/notifications_24h/cron_jobs_failing",
      summary && "errors_by_severity_24h" in summary && "errors_by_category_24h" in summary &&
      "top_error_fingerprints_24h" in summary && "payment_24h" in summary &&
      "notifications_24h" in summary && "cron_jobs_failing" in summary);
    check("errors_by_category_24h reflects the seeded storage/payment rows",
      (summary?.errors_by_category_24h?.storage || 0) >= 1 && (summary?.errors_by_category_24h?.payment || 0) >= 1);
    check("top_error_fingerprints_24h contains our marker",
      (summary?.top_error_fingerprints_24h || []).some((f) => f.sample_message?.includes(marker)));

    const anon = client();
    const { error: anonSummaryErr } = await anon.rpc("admin_observability_summary");
    check("admin_observability_summary rejects an unauthenticated caller", !!anonSummaryErr);

    // =========================================================
    // Alerting: run_observability_alerts() -- cross the error_spike
    // threshold (>=10 error/fatal rows in 15 minutes) with our own
    // marker-tagged rows, confirm a notification lands for the admin,
    // then confirm structural shape for the other 3 alert types.
    // =========================================================
    console.log("\n--- Alerting ---");

    for (let i = 0; i < 10; i++) {
      const { data: id } = await svc.rpc("log_server_error", {
        p_message: `${marker} spike ${i}`,
        p_category: "test_alert_spike",
        p_severity: "error",
      });
      if (id) seededErrorIds.push(id);
    }

    const { data: alertResult, error: alertErr } = await svc.rpc("run_observability_alerts");
    check("run_observability_alerts executes via service_role", !alertErr, alertErr?.message);
    check("run_observability_alerts return shape has all 4 counters + alerts_fired",
      alertResult && "error_count_15m" in alertResult && "payment_fail_count_15m" in alertResult &&
      "notif_fail_count_15m" in alertResult && "cron_fail_count" in alertResult && Array.isArray(alertResult?.alerts_fired));
    check("error_spike alert fired (>=10 error/fatal rows seeded)", alertResult?.alerts_fired?.includes("error_spike"), alertResult);

    const hourBucket = new Date().toISOString().slice(0, 13).replace(/[-T]/g, "");
    const { data: notif } = await svc
      .from("notifications")
      .select("id, title, action_id")
      .eq("user_id", admin.userId)
      .eq("action_id", "error_spike")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    check("admin received an in-app error_spike alert notification", !!notif, { hourBucket });
    if (notif) {
      await svc.from("notifications").delete().eq("id", notif.id);
    }

    const { error: anonAlertErr } = await anon.rpc("run_observability_alerts");
    check("run_observability_alerts is NOT callable with the anon key", !!anonAlertErr);
  } finally {
    // =========================================================
    // Cleanup
    // =========================================================
    if (seededErrorIds.length) {
      await svc.from("error_logs").delete().in("id", seededErrorIds);
    }
    console.log(`\nCleaned up ${seededErrorIds.length} seeded error_logs rows.`);
  }

  console.log(`\n=== ${passCount} passed, ${failCount} failed ===`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
