// One-off (re-runnable) live verification for the native push notifications
// pass (20260831001200 migration + send-push's FCM/APNs routing, see
// docs/PLATFORM_ADAPTIVE_LAYOUT.md's "Native push notifications" section).
//
// SCOPE NOTE: FCM_SERVICE_ACCOUNT_JSON / APNS_* secrets aren't set yet (no
// Firebase project, no Mac-built iOS app -- see that doc), so this can't
// test a real FCM/APNs delivery. What it verifies instead: the schema
// change is live (platform column + constraint, nullable keys), and
// send-push correctly recognizes android/ios subscriptions and reports
// GATEWAY_NOT_CONFIGURED for them rather than crashing or silently
// dropping them -- the exact "graceful until credentials exist" behavior
// the pass was built around. Re-run this again once FCM/APNs secrets are
// set; the "not configured" checks should start failing (a good sign --
// update them to expect real delivery at that point).
//
// Usage: node scripts/live-check-native-push.mjs                 (staging)
//        node scripts/live-check-native-push.mjs --env=production --yes-production

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { resolveTarget } from "./env-target.mjs";

const { SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY, root, projectRef, target } = resolveTarget();
const e2eCredsFile = target === "production" ? ".e2e-credentials.local.json" : ".e2e-credentials.staging.local.json";
const e2eCreds = JSON.parse(fs.readFileSync(path.join(root, "scripts", e2eCredsFile), "utf8"));
const alicePassword = e2eCreds.find((r) => r.email === "e2e.alice@nhce.edu.in")?.password;

let passCount = 0;
let failCount = 0;
function check(label, cond, extra) {
  if (cond) {
    passCount++;
    console.log(`  PASS  ${label}`);
  } else {
    failCount++;
    console.log(`  FAIL  ${label}${extra !== undefined ? " -- " + JSON.stringify(extra) : ""}`);
  }
}

// vault.decrypted_secrets (and, generically, anything not exposed over
// PostgREST) is only reachable from a script via a direct SQL call through
// the CLI -- re-links immediately before every call for the same reason
// env-target.mjs's runProjectSql does (the CLI's linked-project state is
// shared, mutable, unversioned local state a concurrent session/command
// can repoint). Returns parsed rows rather than printing, unlike
// runProjectSql, so callers can assert on the result. Goes through
// --file (a temp file, same as runProjectSql) rather than passing SQL as
// a positional CLI arg -- on Windows, execFileSync's shell:true re-quotes
// through cmd.exe, which mangles a multi-word argument containing quotes/
// parens/newlines.
function queryJson(sql) {
  const sqlPath = path.join(root, `_tmp_livecheck_${Date.now()}.sql`);
  fs.writeFileSync(sqlPath, sql);
  try {
    execFileSync("npx", ["supabase", "link", "--project-ref", projectRef], { cwd: root, stdio: "pipe", shell: true });
    const out = execFileSync("npx", ["supabase", "db", "query", "--linked", "--output-format", "json", "--file", sqlPath], { cwd: root, shell: true }).toString();
    return JSON.parse(out).rows || [];
  } finally {
    fs.unlinkSync(sqlPath);
  }
}

async function main() {
  console.log(`=== Native push (FCM/APNs routing) -- ${target} ===`);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  // --- 1. Schema: platform column + check constraint, keys nullable ---
  const [schemaRow] = queryJson(`
    select
      (select count(*) from information_schema.columns where table_schema='public' and table_name='push_subscriptions' and column_name='platform') as has_platform_col,
      (select is_nullable from information_schema.columns where table_schema='public' and table_name='push_subscriptions' and column_name='keys') as keys_nullable,
      (select count(*) from information_schema.table_constraints where table_schema='public' and table_name='push_subscriptions' and constraint_name='push_subscriptions_platform_check') as has_platform_constraint;
  `);
  check("push_subscriptions.platform column exists", Number(schemaRow?.has_platform_col) === 1, schemaRow);
  check("push_subscriptions.keys is nullable", schemaRow?.keys_nullable === "YES", schemaRow);
  check("push_subscriptions_platform_check constraint exists", Number(schemaRow?.has_platform_constraint) === 1, schemaRow);

  if (!alicePassword) {
    console.log(`  SKIP  e2e.alice not found in ${e2eCredsFile} (run scripts/setup-test-users.mjs first) -- schema-only checks above still ran.`);
    console.log(`\n${passCount} passed, ${failCount} failed`);
    process.exit(failCount > 0 ? 1 : 0);
  }
  const anon = createClient(SUPABASE_URL, ANON_KEY);
  const { data: signInData, error: signInErr } = await anon.auth.signInWithPassword({ email: "e2e.alice@nhce.edu.in", password: alicePassword });
  if (signInErr || !signInData?.user) {
    throw new Error(`Sign-in failed for e2e.alice: ${signInErr?.message}`);
  }
  const aliceId = signInData.user.id;

  // --- 2. Insert a bogus platform value: constraint should reject it ---
  const { error: badPlatformErr } = await admin.from("push_subscriptions").insert({
    user_id: aliceId, endpoint: `livecheck-bad-platform-${Date.now()}`, keys: null, platform: "windows-phone",
  });
  check("push_subscriptions rejects an unrecognized platform value", !!badPlatformErr, badPlatformErr?.message);

  // --- 3. Insert real android+ios rows for alice, isolated from her
  // existing subscriptions (snapshotted and restored in `finally`) ---
  const { data: originalSubs } = await admin.from("push_subscriptions").select("*").eq("user_id", aliceId);
  const { data: originalPref } = await admin.from("notification_preferences").select("channel_push").eq("user_id", aliceId).maybeSingle();

  try {
    await admin.from("push_subscriptions").delete().eq("user_id", aliceId);
    await admin.from("notification_preferences").upsert({ user_id: aliceId, channel_push: true }, { onConflict: "user_id" });

    const androidEndpoint = `livecheck-android-${Date.now()}`;
    const iosEndpoint = `livecheck-ios-${Date.now()}`;
    const { error: insertErr } = await admin.from("push_subscriptions").insert([
      { user_id: aliceId, endpoint: androidEndpoint, keys: null, platform: "android", device_label: "livecheck android" },
      { user_id: aliceId, endpoint: iosEndpoint, keys: null, platform: "ios", device_label: "livecheck ios" },
    ]);
    check("push_subscriptions accepts android/ios rows with keys=null", !insertErr, insertErr?.message);

    // --- 4. Create a real notification, then invoke send-push directly
    // (bypassing pg_net's fire-and-forget trigger so this can assert on
    // the actual HTTP response instead of racing an async dispatch) ---
    const { data: notifId, error: notifErr } = await admin.rpc("create_notification", {
      target_user: aliceId, notification_title: "Native push live-check", notification_body: "x", notification_type: "official",
    });
    check("create_notification succeeds for the android+ios-only subscriber", !notifErr && !!notifId, notifErr?.message);

    const [secretRow] = queryJson(`select decrypted_secret from vault.decrypted_secrets where name = 'push_dispatch_secret';`);
    const dispatchSecret = secretRow?.decrypted_secret;
    check("push_dispatch_secret is readable from vault", !!dispatchSecret);

    if (dispatchSecret) {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Push-Secret": dispatchSecret },
        body: JSON.stringify({ notification_id: notifId }),
      });
      const body = await res.json();
      check("send-push recognizes both subscriptions (total=2)", body.total === 2, body);
      check("send-push sends nothing yet (sent=0 -- no FCM/APNs secrets configured)", body.sent === 0, body);
      check(
        "send-push reports GATEWAY_NOT_CONFIGURED (503) rather than crashing or silently dropping android/ios rows",
        res.status === 503 && body.code === "GATEWAY_NOT_CONFIGURED",
        { status: res.status, body }
      );
      check(
        "send-push's gatewayErrors names both android and ios as not-configured",
        Array.isArray(body.details) && body.details.some((e) => e.startsWith("android:")) && body.details.some((e) => e.startsWith("ios:")),
        body.details
      );
    }
  } finally {
    await admin.from("push_subscriptions").delete().eq("user_id", aliceId);
    if (originalSubs?.length) {
      await admin.from("push_subscriptions").insert(originalSubs);
    }
    if (originalPref) {
      await admin.from("notification_preferences").upsert({ user_id: aliceId, channel_push: originalPref.channel_push }, { onConflict: "user_id" });
    }
  }

  const { data: restoredSubs } = await admin.from("push_subscriptions").select("id").eq("user_id", aliceId);
  check("cleanup: alice's push_subscriptions restored to original count", (restoredSubs?.length || 0) === (originalSubs?.length || 0), {
    before: originalSubs?.length || 0, after: restoredSubs?.length || 0,
  });

  console.log(`\n${passCount} passed, ${failCount} failed`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Live check crashed:", err);
  process.exit(1);
});
