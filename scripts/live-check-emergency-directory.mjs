// One-off live verification script (not part of the automated suite) --
// exercises the Campus Emergency Directory (doc §113 second half:
// supabase/migrations/20260817000100_emergency_directory.sql) directly
// against a real Supabase project using real signed-in sessions. No
// frontend consumes this yet (found while reviewing this migration before
// pushing it) -- this is the only verification surface for it right now.
// Prints PASS/FAIL per assertion.
//
// Usage: node scripts/live-check-emergency-directory.mjs                 (staging)
//        node scripts/live-check-emergency-directory.mjs --env=production --yes-production

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

function client() {
  return createClient(SUPABASE_URL, ANON_KEY);
}

async function signIn(email, password) {
  const sb = client();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return { sb, userId: data.user.id };
}

async function main() {
  console.log("=== Campus Emergency Directory (doc §113) ===");
  const admin = await signIn("1nh25cs265@usn.campusos.internal", "Sanjay@123");
  const bob = await signIn("e2e.bob@nhce.edu.in", "TestPass!2026Bob");
  const marker = `LiveCheckDirectory ${Date.now()}`;

  const anon = client();
  const { error: anonErr } = await anon.rpc("list_emergency_directory");
  check("An unauthenticated caller is rejected by list_emergency_directory", !!anonErr, anonErr?.message);

  const { error: bobCreateErr } = await bob.sb.rpc("upsert_emergency_directory_entry", {
    p_category: "security", p_name: `${marker} by-bob`, p_phone: "+911234567890",
  });
  check("A plain student CANNOT create a directory entry", !!bobCreateErr, bobCreateErr?.message);

  const { data: entry, error: createErr } = await admin.sb.rpc("upsert_emergency_directory_entry", {
    p_category: "security", p_name: marker, p_designation: "Chief Security Officer",
    p_phone: "+911234567890", p_location: "Main Gate", p_priority: "critical", p_is_24x7: true,
  });
  check("Admin can create a directory entry", !createErr && !!entry?.id, createErr?.message);

  const { error: badPhoneErr } = await admin.sb.rpc("upsert_emergency_directory_entry", {
    p_category: "security", p_name: `${marker} bad-phone`, p_phone: "not-a-phone",
  });
  check("An invalid phone number is rejected", !!badPhoneErr, badPhoneErr?.message);

  const { error: badCategoryErr } = await admin.sb.rpc("upsert_emergency_directory_entry", {
    p_category: "not-a-category", p_name: `${marker} bad-cat`, p_phone: "+911234567890",
  });
  check("An invalid category is rejected", !!badCategoryErr, badCategoryErr?.message);

  const { data: publicList, error: listErr } = await bob.sb.rpc("list_emergency_directory");
  check("A student sees the new entry via list_emergency_directory", !listErr && (publicList || []).some((e) => e.id === entry.id), listErr?.message);

  const { error: verifyByBobErr } = await bob.sb.rpc("verify_emergency_directory_entry", { p_id: entry.id, p_verified: true });
  check("A plain student CANNOT verify a directory entry", !!verifyByBobErr, verifyByBobErr?.message);

  const { data: verified, error: verifyErr } = await admin.sb.rpc("verify_emergency_directory_entry", { p_id: entry.id, p_verified: true });
  check("Admin can verify a directory entry", !verifyErr && verified?.verified === true, verifyErr?.message);

  const { data: reEdited, error: editErr } = await admin.sb.rpc("upsert_emergency_directory_entry", {
    p_id: entry.id, p_category: "security", p_name: marker, p_phone: "+911234567890", p_priority: "high",
  });
  check("Editing a verified entry resets verified back to false", !editErr && reEdited?.verified === false, { editErr: editErr?.message, verified: reEdited?.verified });

  const { data: deactivated, error: deactivateErr } = await admin.sb.rpc("set_emergency_directory_active", { p_id: entry.id, p_active: false });
  check("Admin can deactivate a directory entry", !deactivateErr && deactivated?.active === false, deactivateErr?.message);

  const { data: listAfterDeactivate } = await bob.sb.rpc("list_emergency_directory");
  check("A deactivated entry no longer shows in the student-facing list", !(listAfterDeactivate || []).some((e) => e.id === entry.id), listAfterDeactivate?.map((e) => e.id));

  const { data: adminList, error: adminListErr } = await admin.sb.rpc("admin_list_emergency_directory");
  check("Admin's management view still shows the deactivated entry", !adminListErr && (adminList || []).some((e) => e.id === entry.id && e.active === false), adminListErr?.message);

  const { error: adminListByBobErr } = await bob.sb.rpc("admin_list_emergency_directory");
  check("A plain student CANNOT call the management view", !!adminListByBobErr, adminListByBobErr?.message);

  // Cleanup: there's no delete RPC by design (this table only ever soft-deletes via
  // set_active in the product, and RLS has no write policy at all) -- a real hard
  // delete here needs the service-role connection, same as this repo's other
  // live-check scripts' cleanup steps.
  const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  await svc.from("campus_emergency_directory").delete().eq("id", entry.id);

  console.log(`\n${passCount} passed, ${failCount} failed`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Live check crashed:", err);
  process.exit(1);
});
