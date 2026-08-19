// One-off live verification script (not part of the automated suite) --
// exercises the 5-part AdminCMS "administrative operating system" pass
// (2026-08-18): vendor management, facilities oversight, system health,
// campus settings/configuration, feature flags. Prints PASS/FAIL per
// assertion, real signed-in sessions against a real Supabase project.
//
// Mutates two shared long-lived test accounts (e2e.bob, e2e.carol) and the
// one shared campus row -- every original value is captured up front and
// restored in a `finally` block regardless of pass/fail, same convention as
// every other live-check script in this directory.
//
// Reads e2e credentials from scripts/.e2e-credentials(.staging).local.json
// (setup-test-users.mjs owns that file) rather than a hardcoded literal --
// those passwords were rotated to random values during the 2026-08-18
// credential-leak remediation, so a hardcoded value here would just be
// wrong from day one.
//
// Usage: node scripts/live-check-admin-cms-operating-system.mjs                 (staging)
//        node scripts/live-check-admin-cms-operating-system.mjs --env=production --yes-production

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resolveTarget } from "./env-target.mjs";

const { SUPABASE_URL, ANON_KEY, target, root } = resolveTarget();

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

function readE2eCredentials() {
  const file = path.join(root, "scripts", target === "production" ? ".e2e-credentials.local.json" : ".e2e-credentials.staging.local.json");
  const rows = JSON.parse(fs.readFileSync(file, "utf8"));
  const byEmail = Object.fromEntries(rows.map((r) => [r.email, r.password]));
  return byEmail;
}

async function main() {
  console.log(`=== AdminCMS operating-system pass (vendor mgmt / facilities / system health / campus settings / feature flags) [${target}] ===`);

  const creds = readE2eCredentials();
  const admin = await signIn("1nh25cs265@usn.campusos.internal", "Sanjay@123");
  const bob = await signIn("e2e.bob@nhce.edu.in", creds["e2e.bob@nhce.edu.in"]);
  const carol = await signIn("e2e.carol@nhce.edu.in", creds["e2e.carol@nhce.edu.in"]);

  const { data: bobBefore } = await admin.sb.from("profiles").select("role").eq("id", bob.userId).single();
  const { data: carolBefore } = await admin.sb.from("profiles").select("role,campus_id").eq("id", carol.userId).single();
  const campusId = carolBefore.campus_id;
  const { data: campusBefore } = await admin.sb.from("campuses").select("*").eq("id", campusId).single();

  const marker = `LiveCheckAdminCMS ${Date.now()}`;
  let canteenId = null;
  const flagKeys = [];

  try {
    // ================= 1. VENDOR MANAGEMENT =================
    console.log("\n-- Vendor management --");

    const { error: nonAdminCreateErr } = await bob.sb.rpc("admin_create_vendor", {
      p_type: "canteen", p_campus_id: campusId, p_name: `${marker} canteen`, p_owner_email: "e2e.carol@nhce.edu.in",
    });
    check("non-admin cannot create a vendor", !!nonAdminCreateErr);

    const { data: created, error: createErr } = await admin.sb.rpc("admin_create_vendor", {
      p_type: "canteen", p_campus_id: campusId, p_name: `${marker} canteen`, p_owner_email: "e2e.carol@nhce.edu.in", p_subtitle: "Test canteen",
    });
    check("admin creates a canteen owned by carol", !createErr && !!created?.id, createErr);
    canteenId = created?.id;

    const { data: carolAfterCreate } = await admin.sb.from("profiles").select("role").eq("id", carol.userId).single();
    check("carol promoted to vendor role", carolAfterCreate?.role === "vendor", carolAfterCreate);

    const { data: canteenRow } = await admin.sb.from("canteens").select("*").eq("id", canteenId).single();
    check("canteen row has correct owner/campus/active", canteenRow?.owner_id === carol.userId && canteenRow?.campus_id === campusId && canteenRow?.active === true);

    const { error: deactivateErr } = await admin.sb.rpc("admin_set_vendor_active", { p_type: "canteen", p_id: canteenId, p_active: false });
    check("admin deactivates the vendor", !deactivateErr, deactivateErr);

    const { data: publicReadInactive } = await client().from("canteens").select("id").eq("id", canteenId).maybeSingle();
    check("deactivated vendor is invisible to the public read policy", publicReadInactive === null);

    const { data: adminReadInactive } = await admin.sb.from("canteens").select("id,active").eq("id", canteenId).maybeSingle();
    check("deactivated vendor is still visible to admin via canteens_admin_read", adminReadInactive?.active === false, adminReadInactive);

    const { error: reactivateErr } = await admin.sb.rpc("admin_set_vendor_active", { p_type: "canteen", p_id: canteenId, p_active: true });
    check("admin reactivates the vendor", !reactivateErr, reactivateErr);

    const { error: transferErr } = await admin.sb.rpc("admin_transfer_vendor_ownership", { p_type: "canteen", p_id: canteenId, p_new_owner_email: "e2e.bob@nhce.edu.in" });
    check("admin transfers ownership to bob", !transferErr, transferErr);

    const { data: bobAfterTransfer } = await admin.sb.from("profiles").select("role").eq("id", bob.userId).single();
    check("bob promoted to vendor role by the transfer", bobAfterTransfer?.role === "vendor", bobAfterTransfer);

    const { data: canteenAfterTransfer } = await admin.sb.from("canteens").select("owner_id").eq("id", canteenId).single();
    check("canteen owner_id updated to bob", canteenAfterTransfer?.owner_id === bob.userId);

    // Real-bug-fix check: stores_admin_read. Create+immediately-deactivate
    // a throwaway store to confirm an admin can see an inactive store at
    // all (this was impossible before this pass -- stores_read is
    // `using (active)` with no admin-read counterpart until now).
    const { data: storeCreated, error: storeCreateErr } = await admin.sb.rpc("admin_create_vendor", {
      p_type: "store", p_campus_id: campusId, p_name: `${marker} store`, p_owner_email: "e2e.carol@nhce.edu.in", p_category: "General",
    });
    check("admin creates a store", !storeCreateErr && !!storeCreated?.id, storeCreateErr);
    if (storeCreated?.id) {
      await admin.sb.rpc("admin_set_vendor_active", { p_type: "store", p_id: storeCreated.id, p_active: false });
      const { data: adminReadStore } = await admin.sb.from("stores").select("id,active").eq("id", storeCreated.id).maybeSingle();
      check("stores_admin_read: admin sees the deactivated store", adminReadStore?.active === false, adminReadStore);
      const { data: publicReadStore } = await client().from("stores").select("id").eq("id", storeCreated.id).maybeSingle();
      check("deactivated store still invisible to the public", publicReadStore === null);
      await admin.sb.from("stores").delete().eq("id", storeCreated.id); // admin write RLS covers this directly, no RPC needed for cleanup
    }

    // ================= 2. FACILITIES OVERSIGHT =================
    console.log("\n-- Facilities oversight --");

    const { data: staffProfile } = await admin.sb.from("profiles").select("id").eq("email", "facilities.staff@nhce.edu.in").single();
    check("facilities_staff test account exists", !!staffProfile?.id);

    const { data: ticket, error: ticketInsertErr } = await carol.sb.from("service_requests").insert({
      user_id: carol.userId, campus_id: campusId, title: `${marker} ticket`, category: "Other", details: {},
    }).select().single();
    check("carol submits a ticket", !ticketInsertErr && !!ticket?.id, ticketInsertErr);

    const { error: nonAuthAssignErr } = await carol.sb.rpc("assign_ticket", { p_request_id: ticket?.id, p_staff_id: staffProfile?.id });
    check("a plain student cannot assign a ticket", !!nonAuthAssignErr);

    const { data: assigned, error: assignErr } = await admin.sb.rpc("assign_ticket", { p_request_id: ticket?.id, p_staff_id: staffProfile?.id });
    check("admin assigns the ticket to facilities staff", !assignErr && assigned?.assigned_to === staffProfile?.id, assignErr);

    const { error: badRoleAssignErr } = await admin.sb.rpc("assign_ticket", { p_request_id: ticket?.id, p_staff_id: carol.userId });
    check("cannot assign a ticket to a non-facilities account", !!badRoleAssignErr);

    const { error: unassignErr } = await admin.sb.rpc("assign_ticket", { p_request_id: ticket?.id, p_staff_id: null });
    check("admin can clear an assignment (null staff)", !unassignErr, unassignErr);

    // service_requests has no DELETE RLS policy for anyone, admin included
    // (writes are RPC-gated everywhere on this table) -- close it via the
    // real transition RPC instead of trying to delete, same lifecycle a
    // real resolved ticket goes through.
    if (ticket?.id) await admin.sb.rpc("transition_ticket_status", { p_request_id: ticket.id, p_to_status: "CLOSED", p_notes: "live-check cleanup" });

    // ================= 3. SYSTEM HEALTH =================
    console.log("\n-- System health --");

    const { error: healthAuthErr } = await bob.sb.rpc("admin_system_health");
    check("non-admin cannot read system health", !!healthAuthErr);

    const { data: health, error: healthErr } = await admin.sb.rpc("admin_system_health");
    check("admin_system_health returns jobs array", !healthErr && Array.isArray(health?.jobs), healthErr);
    check("at least one scheduled cron job is visible", (health?.jobs?.length ?? 0) > 0, health?.jobs);

    const { data: fnHealth, error: fnErr } = await admin.sb.functions.invoke("system-health", { method: "GET" });
    check("system-health edge function reachable and reports db_ok", !fnErr && fnHealth?.db_ok === true, fnErr || fnHealth);
    check("system-health edge function reports secret group booleans", fnHealth?.secret_groups && typeof fnHealth.secret_groups.ai_assistant === "boolean", fnHealth?.secret_groups);

    const { error: fnAuthErr } = await client().functions.invoke("system-health", { method: "GET" });
    check("system-health edge function rejects unauthenticated calls", !!fnAuthErr);

    // ================= 4. CAMPUS SETTINGS / CONFIGURATION =================
    console.log("\n-- Campus settings --");

    const { error: nonAdminCampusErr } = await bob.sb.rpc("admin_update_campus", { p_campus_id: campusId, p_support_email: "hacker@example.com" });
    check("non-admin cannot edit campus settings", !!nonAdminCampusErr);

    const { data: updatedCampus, error: campusErr } = await admin.sb.rpc("admin_update_campus", {
      p_campus_id: campusId, p_support_email: "support+livecheck@nhce.edu.in", p_support_phone: "+911234567890",
      p_settings: { livecheck: marker },
    });
    check("admin updates campus settings", !campusErr && updatedCampus?.support_email === "support+livecheck@nhce.edu.in", campusErr);
    check("campus settings jsonb round-trips", updatedCampus?.settings?.livecheck === marker, updatedCampus?.settings);
    check("untouched fields (name) preserved by partial update", updatedCampus?.name === campusBefore.name);

    // ================= 5. FEATURE FLAGS =================
    console.log("\n-- Feature flags --");

    const globalKey = `livecheck_global_${Date.now()}`;
    const campusKey = `livecheck_campus_${Date.now()}`;
    flagKeys.push([globalKey, null], [campusKey, campusId]);

    const { error: nonAdminFlagErr } = await bob.sb.rpc("admin_upsert_feature_flag", { p_key: globalKey, p_campus_id: null, p_description: "x", p_enabled: true, p_rollout_percentage: 100 });
    check("non-admin cannot create a feature flag", !!nonAdminFlagErr);

    const { data: globalFlag, error: globalFlagErr } = await admin.sb.rpc("admin_upsert_feature_flag", {
      p_key: globalKey, p_campus_id: null, p_description: "global test flag", p_enabled: true, p_rollout_percentage: 50,
    });
    check("admin creates a global flag", !globalFlagErr && globalFlag?.enabled === true, globalFlagErr);

    const { data: campusFlag, error: campusFlagErr } = await admin.sb.rpc("admin_upsert_feature_flag", {
      p_key: campusKey, p_campus_id: campusId, p_description: "campus-scoped test flag", p_enabled: false, p_rollout_percentage: 100,
    });
    check("admin creates a campus-scoped flag with the SAME-shaped key as a different global flag doesn't collide", !campusFlagErr && campusFlag?.enabled === false, campusFlagErr);

    const { data: publicReadFlags } = await client().from("feature_flags").select("key,enabled").in("key", [globalKey, campusKey]);
    check("flags are readable by an anonymous client (config, not secret)", (publicReadFlags?.length ?? 0) === 2, publicReadFlags);

    const { data: reUpserted, error: reUpsertErr } = await admin.sb.rpc("admin_upsert_feature_flag", {
      p_key: globalKey, p_campus_id: null, p_description: "updated", p_enabled: false, p_rollout_percentage: 10,
    });
    check("re-upserting the same (key, campus) updates in place, no duplicate row", !reUpsertErr && reUpserted?.id === globalFlag?.id && reUpserted?.enabled === false, reUpsertErr);

    const { error: badPctErr } = await admin.sb.rpc("admin_upsert_feature_flag", { p_key: globalKey, p_campus_id: null, p_description: "x", p_enabled: true, p_rollout_percentage: 150 });
    check("rollout_percentage out of range is rejected", !!badPctErr);

    const { error: deleteErr } = await admin.sb.rpc("admin_delete_feature_flag", { p_key: globalKey, p_campus_id: null });
    check("admin deletes the global flag", !deleteErr, deleteErr);
    const { data: afterDelete } = await client().from("feature_flags").select("id").eq("key", globalKey).is("campus_id", null).maybeSingle();
    check("deleted flag no longer readable", afterDelete === null);
    flagKeys.shift(); // already cleaned up
  } finally {
    console.log("\n-- Cleanup / restore --");
    if (canteenId) {
      await admin.sb.from("canteens").delete().eq("id", canteenId);
      console.log("  cleaned up test canteen");
    }
    // feature_flags has no DELETE RLS policy at all (writes are RPC-only
    // by design) -- a raw `.from().delete()` here would silently no-op
    // under RLS rather than error, which is exactly how the first version
    // of this script leaked two leftover rows on staging.
    for (const [key, cId] of flagKeys) {
      const { error } = await admin.sb.rpc("admin_delete_feature_flag", { p_key: key, p_campus_id: cId });
      if (error) console.log(`  WARNING: could not clean up flag ${key}`, error.message);
    }
    if (flagKeys.length) console.log(`  cleaned up ${flagKeys.length} leftover flag(s)`);

    await admin.sb.rpc("admin_update_campus", {
      p_campus_id: campusId, p_name: campusBefore.name, p_domain: campusBefore.domain, p_timezone: campusBefore.timezone,
      p_active: campusBefore.active, p_support_email: campusBefore.support_email ?? "", p_support_phone: campusBefore.support_phone ?? "",
      p_settings: campusBefore.settings,
    });
    console.log("  restored campus settings");

    // admin_set_user_role is super_admin-only (20260818000400) -- this
    // admin test account IS super_admin so it should succeed; try/catch is
    // a defensive fallback only, logged rather than swallowed.
    if (bobBefore?.role && bobBefore.role !== "vendor") {
      const { error } = await admin.sb.rpc("admin_set_user_role", { p_target_user: bob.userId, p_new_role: bobBefore.role, p_reason: "live-check cleanup" });
      if (error) console.log("  WARNING: could not restore bob's role via admin_set_user_role", error.message);
    }
    if (carolBefore?.role && carolBefore.role !== "vendor") {
      const { error } = await admin.sb.rpc("admin_set_user_role", { p_target_user: carol.userId, p_new_role: carolBefore.role, p_reason: "live-check cleanup" });
      if (error) console.log("  WARNING: could not restore carol's role via admin_set_user_role", error.message);
    }
    const { data: bobFinal } = await admin.sb.from("profiles").select("role").eq("id", bob.userId).single();
    const { data: carolFinal } = await admin.sb.from("profiles").select("role").eq("id", carol.userId).single();
    console.log(`  bob role: ${bobBefore?.role} -> ${bobFinal?.role} (restored: ${bobFinal?.role === bobBefore?.role})`);
    console.log(`  carol role: ${carolBefore?.role} -> ${carolFinal?.role} (restored: ${carolFinal?.role === carolBefore?.role})`);
  }

  console.log(`\n=== ${passCount} passed, ${failCount} failed ===`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
