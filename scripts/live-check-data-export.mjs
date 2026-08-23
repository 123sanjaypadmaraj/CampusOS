// One-off live verification for export_my_data()
// (supabase/migrations/20260824000100_export_my_data.sql, readiness-audit
// phase 06: legal/DPDP). Deliberately standalone rather than folded into
// live-check-auth-identity-hardening.mjs's main() -- that script signs in
// as the real super_admin account up front (needed for its role-escalation
// tests) and currently can't run at all until that account's credentials
// are rotated (see SECURITY.md / campusos-security-audit-pass), which is a
// user-only action still pending. This script only needs the service-role
// key to create/delete one throwaway account, so it can verify the export
// RPC independently of that blocker. The equivalent assertions were also
// added to live-check-auth-identity-hardening.mjs's "Account deletion"
// section for when the full suite can run again -- this file exists so the
// feature has real live coverage today, not just at a future date.
//
// Usage: node scripts/live-check-data-export.mjs                 (staging)
//        node scripts/live-check-data-export.mjs --env=production --yes-production

import { createClient } from "@supabase/supabase-js";
import { resolveTarget } from "./env-target.mjs";

const { SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY } = resolveTarget();

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

function anonClient() {
  return createClient(SUPABASE_URL, ANON_KEY);
}

function serviceClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function main() {
  console.log("=== Self-service data export (export_my_data) ===");
  const svc = serviceClient();
  const ts = Date.now();
  const email = `livecheck.export.${ts}@nhce.edu.in`;
  const PASSWORD = "LiveCheck!2026Pass";
  let userId = null;

  try {
    const { data: created, error: createErr } = await svc.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (createErr) throw new Error(`Could not create throwaway account: ${createErr.message}`);
    userId = created.user.id;
    check("throwaway account created", !!userId, created);

    const sb = anonClient();
    const { error: signInErr } = await sb.auth.signInWithPassword({ email, password: PASSWORD });
    check("throwaway account can sign in", !signInErr, signInErr);

    const { data: exportData, error: exportErr } = await sb.rpc("export_my_data");
    check("signed-in user can export their own data", !exportErr, exportErr);
    check("export includes exported_at + own profile", !!exportData?.exported_at && exportData?.profile?.id === userId, exportData);
    check(
      "export's per-table fields are arrays (even when empty)",
      Array.isArray(exportData?.orders) &&
        Array.isArray(exportData?.event_registrations) &&
        Array.isArray(exportData?.club_memberships) &&
        Array.isArray(exportData?.marketplace_listings) &&
        Array.isArray(exportData?.lost_found_items) &&
        Array.isArray(exportData?.support_tickets) &&
        Array.isArray(exportData?.service_requests) &&
        Array.isArray(exportData?.bookings) &&
        Array.isArray(exportData?.print_jobs) &&
        Array.isArray(exportData?.emergency_contacts) &&
        Array.isArray(exportData?.posts) &&
        Array.isArray(exportData?.comments) &&
        Array.isArray(exportData?.sos_alerts) &&
        Array.isArray(exportData?.student_verification) &&
        Array.isArray(exportData?.account_deletion_requests),
      exportData
    );

    const { error: anonExportErr } = await anonClient().rpc("export_my_data");
    check("an unauthenticated caller cannot export data", !!anonExportErr, anonExportErr);

    const { data: auditRows, error: auditErr } = await svc
      .from("audit_logs")
      .select("id, action, actor_id")
      .eq("actor_id", userId)
      .eq("action", "account.export_data")
      .order("created_at", { ascending: false })
      .limit(1);
    check("the export call was recorded in audit_logs", !auditErr && (auditRows?.length || 0) > 0, auditErr || auditRows);
  } finally {
    if (userId) {
      const { error } = await svc.auth.admin.deleteUser(userId);
      if (error) console.error(`  Could not delete throwaway user ${userId}: ${error.message}`);
      else console.log("  Deleted throwaway account");
    }
  }

  console.log(`\n=== ${passCount} passed, ${failCount} failed ===`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
