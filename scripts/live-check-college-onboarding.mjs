// One-off live verification script (not part of the automated suite) --
// exercises supabase/migrations/20260824000500_college_roster.sql and the
// signup-with-usn roster-enforcement change directly against a real
// Supabase project using real signed-in sessions. Prints PASS/FAIL per
// assertion. Readiness-audit phase 10 ("college onboarding").
//
// Deliberately does NOT exercise add_canteen_staff_account/
// add_store_staff_account/add_print_staff_account against a REAL vendor on
// staging -- those already have their own coverage (live-check-vendor-
// order-ops.mjs and friends) and this script's e2e accounts aren't a real
// vendor's staff roster to mutate. It only confirms the RPC path used by
// AdminCMS's new Onboarding tab is reachable and errors sanely.
//
// Usage: node scripts/live-check-college-onboarding.mjs                 (staging)
//        node scripts/live-check-college-onboarding.mjs --env=production --yes-production

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resolveTarget } from "./env-target.mjs";

const { SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY, root, target } = resolveTarget();

const adminCredsFile = target === "production" ? ".admin-credentials.local.json" : ".admin-credentials.staging.local.json";
function adminPassword() {
  const p = path.join(root, "scripts", adminCredsFile);
  if (!fs.existsSync(p)) throw new Error(`No admin credentials known in ${adminCredsFile} -- run "node scripts/setup-admin-account.mjs --rotate" first.`);
  return JSON.parse(fs.readFileSync(p, "utf8")).password;
}

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

// Deliberately fake, syntactically-valid NHCE-shaped USNs that don't
// collide with any real batch/branch code (batch "99", branch "ZZ") so
// this script's test rows are unambiguously its own.
const IN_ROSTER_USN = "9NH99ZZ997";
const NOT_IN_ROSTER_USN = "9NH99ZZ998";

const createdBatchIds = [];
let createdSignupUserId = null;

async function main() {
  console.log("=== College onboarding (readiness-audit phase 10) ===");
  const admin = await signIn("1nh25cs265@usn.campusos.internal", adminPassword());
  const alice = await signIn("e2e.alice@nhce.edu.in", e2ePassword("e2e.alice@nhce.edu.in"));

  // --- 1. import_roster_rows: permission gate ---
  const { error: nonAdminImportErr } = await alice.sb.rpc("import_roster_rows", {
    p_rows: [{ usn: IN_ROSTER_USN, name: "Live Check Student" }],
    p_source_label: "live-check (should be rejected)",
  });
  check("a plain student cannot import the roster", !!nonAdminImportErr, nonAdminImportErr?.message);

  // --- 2. import_roster_rows: admin import, valid + invalid rows ---
  const { data: importResult, error: importErr } = await admin.sb.rpc("import_roster_rows", {
    p_rows: [
      { usn: IN_ROSTER_USN, name: "Live Check Student", department: "CSE", course: "B.E", year: "3" },
      { usn: "not-a-usn", name: "Bad Row" },
    ],
    p_source_label: "live-check-college-onboarding.mjs",
  });
  check("admin import succeeds and reports 1 created + 1 invalid", !importErr && importResult?.created === 1 && importResult?.invalid === 1, importErr?.message || importResult);
  if (importResult?.batch_id) createdBatchIds.push(importResult.batch_id);

  const { data: rosterRow } = await admin.sb.from("official_roster").select("id, name").ilike("usn", IN_ROSTER_USN).maybeSingle();
  check("the imported USN is readable back from official_roster", rosterRow?.name === "Live Check Student", rosterRow);

  const { data: batchRow } = await admin.sb.from("roster_import_batches").select("id, created_count, invalid_count").eq("id", importResult?.batch_id).maybeSingle();
  check("a roster_import_batches row was recorded with matching counts", batchRow?.created_count === 1 && batchRow?.invalid_count === 1, batchRow);

  // Re-importing the same USN should update, not duplicate -- this is a
  // second import_roster_rows call, so it mints its own batch row too;
  // both batch ids get cleaned up at the end, not just the first.
  const { data: reimport, error: reimportErr } = await admin.sb.rpc("import_roster_rows", {
    p_rows: [{ usn: IN_ROSTER_USN, name: "Live Check Student Renamed" }],
    p_source_label: "live-check re-import",
  });
  check("re-importing an existing USN updates it instead of duplicating", !reimportErr && reimport?.created === 0 && reimport?.updated === 1, reimportErr?.message || reimport);
  if (reimport?.batch_id) createdBatchIds.push(reimport.batch_id);

  // --- 3. signup-with-usn: roster enforcement now that the roster is non-empty ---
  const anon = client();
  const testPassword = "LiveCheckPass123!";

  const { data: rejectedSignup, error: rejectErr } = await anon.functions.invoke("signup-with-usn", {
    body: { name: "Should Be Rejected", usn: NOT_IN_ROSTER_USN, password: testPassword },
  });
  check(
    "signup with a USN-shaped but non-roster USN is rejected once a roster exists",
    !!rejectErr || rejectedSignup?.code === "USN_NOT_IN_ROSTER",
    rejectErr?.message || rejectedSignup
  );

  const { data: acceptedSignup, error: acceptErr } = await anon.functions.invoke("signup-with-usn", {
    body: { name: "Live Check Student", usn: IN_ROSTER_USN, password: testPassword },
  });
  check("signup with a real roster USN still succeeds", !acceptErr && acceptedSignup?.ok === true, acceptErr?.message || acceptedSignup);
  createdSignupUserId = acceptedSignup?.userId;

  // --- 4. Onboarding tab data layer: lookup + staff-linking RPC reachability ---
  const { data: foundProfile } = await admin.sb.from("profiles").select("id, email, role").ilike("email", "e2e.alice@nhce.edu.in").maybeSingle();
  check("admin can look up an existing profile by email", foundProfile?.id === alice.userId, foundProfile);

  const { data: notFoundProfile } = await admin.sb.from("profiles").select("id").ilike("email", "definitely-nobody@nhce.edu.in").maybeSingle();
  check("looking up an email with no account returns nothing", !notFoundProfile, notFoundProfile);

  const { error: staffLinkErr } = await admin.sb.rpc("add_canteen_staff_account", {
    p_canteen_id: "00000000-0000-0000-0000-000000000000",
    p_email: "definitely-nobody@nhce.edu.in",
  });
  check("add_canteen_staff_account is reachable by an admin and errors cleanly on an unknown email", !!staffLinkErr, staffLinkErr?.message);

  // --- cleanup ---
  // Deleting an auth user needs the service_role key -- admin.sb here is a
  // normal signed-in college_admin/super_admin session, which auth.admin
  // calls reject regardless of DB role.
  if (createdSignupUserId) {
    const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    await serviceClient.auth.admin.deleteUser(createdSignupUserId).catch((err) => {
      console.warn(`  (cleanup) could not delete test signup account ${createdSignupUserId}: ${err.message}`);
    });
  }
  if (rosterRow?.id) {
    await admin.sb.from("official_roster").delete().eq("id", rosterRow.id);
  }
  for (const batchId of createdBatchIds) {
    await admin.sb.from("roster_import_batches").delete().eq("id", batchId);
  }

  console.log(`\n${passCount} passed, ${failCount} failed`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Live check crashed:", err);
  process.exit(1);
});
