// One-off live verification script (not part of the automated suite) --
// exercises the verified emergency-contacts directory (doc §113,
// supabase/migrations/20260815000700_emergency_contacts.sql) directly
// against a real Supabase project using real signed-in sessions: student
// self-service CRUD, RLS isolation between students, the facilities/admin
// verification queue, and the SOS-alert integration point
// (get_emergency_contacts_for_alert). Prints PASS/FAIL per assertion.
//
// Usage: node scripts/live-check-emergency-contacts.mjs
//        node scripts/live-check-emergency-contacts.mjs --env=production --yes-production

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import { resolveTarget } from "./env-target.mjs";

const { SUPABASE_URL, ANON_KEY, target } = resolveTarget();

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

const facilitiesCreds = JSON.parse(
  fs.readFileSync(`scripts/.facilities-credentials.${target === "production" ? "local" : "staging.local"}.json`, "utf8")
);

async function main() {
  console.log("=== Emergency contacts directory (doc §113) ===");
  const alice = await signIn("e2e.alice@nhce.edu.in", "TestPass!2026Alice");
  const bob = await signIn("e2e.bob@nhce.edu.in", "TestPass!2026Bob");
  const facilities = await signIn(facilitiesCreds.email, facilitiesCreds.password);

  // Clean slate: remove any contacts left over from a previous run.
  const { data: preExisting } = await alice.sb.from("emergency_contacts").select("id");
  for (const row of preExisting || []) {
    await alice.sb.rpc("delete_emergency_contact", { p_id: row.id });
  }

  console.log("\n--- Student self-service ---");
  const { error: badPhoneErr } = await alice.sb.rpc("upsert_emergency_contact", {
    p_contact_name: "Mom", p_relationship: "parent", p_phone: "notaphone",
  });
  check("Rejects an invalid phone", !!badPhoneErr && /valid phone/i.test(badPhoneErr.message), badPhoneErr?.message);

  const { error: badRelErr } = await alice.sb.rpc("upsert_emergency_contact", {
    p_contact_name: "Mom", p_relationship: "not-a-real-relationship", p_phone: "9876543210",
  });
  check("Rejects an invalid relationship", !!badRelErr, badRelErr?.message);

  const { data: mom, error: momErr } = await alice.sb.rpc("upsert_emergency_contact", {
    p_contact_name: "Alice's Mom", p_relationship: "parent", p_phone: "9876543210", p_is_primary: true,
  });
  check("Alice can add a primary emergency contact", !momErr && mom?.verified === false && mom?.is_primary === true, { momErr, mom });

  const { data: dad, error: dadErr } = await alice.sb.rpc("upsert_emergency_contact", {
    p_contact_name: "Alice's Dad", p_relationship: "parent", p_phone: "9876543211", p_is_primary: true,
  });
  check("Adding a second primary contact succeeds", !dadErr && dad?.is_primary === true, dadErr);

  const { data: momAfter } = await alice.sb.from("emergency_contacts").select("is_primary").eq("id", mom.id).single();
  check("...and silently demotes the first contact from primary (only one primary at a time)", momAfter?.is_primary === false, momAfter);

  const { data: myList, error: myListErr } = await alice.sb.from("emergency_contacts").select("*").order("is_primary", { ascending: false });
  check("Alice can list her own contacts, primary first", !myListErr && myList?.[0]?.id === dad.id, { myListErr, myList });

  console.log("\n--- RLS isolation ---");
  const { data: bobSeesAlice } = await bob.sb.from("emergency_contacts").select("*").eq("user_id", alice.userId);
  check("A different student cannot read Alice's contacts directly (RLS)", (bobSeesAlice || []).length === 0, bobSeesAlice);

  const { error: bobDeletesAliceErr } = await bob.sb.rpc("delete_emergency_contact", { p_id: mom.id });
  check("A different student cannot delete Alice's contact", !!bobDeletesAliceErr, bobDeletesAliceErr?.message);

  const { error: bobQueueErr } = await bob.sb.rpc("admin_list_pending_emergency_contacts");
  check("A plain student cannot open the verification queue", !!bobQueueErr, bobQueueErr?.message);

  console.log("\n--- Verification queue (facilities) ---");
  const { data: queue, error: queueErr } = await facilities.sb.rpc("admin_list_pending_emergency_contacts");
  const momInQueue = (queue || []).find((c) => c.id === mom.id);
  check("Facilities staff sees Alice's pending contact with her real name attached", !queueErr && momInQueue?.student_name, { queueErr, momInQueue });

  const { data: verified, error: verifyErr } = await facilities.sb.rpc("verify_emergency_contact", {
    p_id: mom.id, p_verified: true, p_notes: "Called and confirmed.",
  });
  check("Facilities can verify a contact", !verifyErr && verified?.verified === true && verified?.verified_by === facilities.userId, { verifyErr, verified });

  const { data: reQueue } = await facilities.sb.rpc("admin_list_pending_emergency_contacts");
  check("...and it drops out of the pending queue", !(reQueue || []).some((c) => c.id === mom.id), reQueue);

  const { data: editedMom, error: editErr } = await alice.sb.rpc("upsert_emergency_contact", {
    p_id: mom.id, p_contact_name: "Alice's Mom", p_relationship: "parent", p_phone: "9876543299",
  });
  check("Editing a verified contact resets it to unverified", !editErr && editedMom?.verified === false, { editErr, editedMom });

  console.log("\n--- Max-5-contacts cap ---");
  for (let i = 0; i < 3; i++) {
    await alice.sb.rpc("upsert_emergency_contact", { p_contact_name: `Extra ${i}`, p_relationship: "friend", p_phone: `98765432${20 + i}` });
  }
  const { error: capErr } = await alice.sb.rpc("upsert_emergency_contact", { p_contact_name: "One too many", p_relationship: "friend", p_phone: "9876543299" });
  check("A 6th contact is rejected (max 5 per student)", !!capErr && /at most 5/i.test(capErr.message), capErr?.message);

  console.log("\n--- SOS integration ---");
  const { data: sosResult, error: sosErr } = await alice.sb.rpc("trigger_sos_alert", { p_alert_type: "medical" });
  check("Alice can trigger a real SOS alert", !sosErr && sosResult?.id, { sosErr, sosResult });

  const { data: contactsForAlert, error: contactsForAlertErr } = await facilities.sb.rpc("get_emergency_contacts_for_alert", { p_alert_id: sosResult?.id });
  check(
    "A facilities responder can pull Alice's contacts scoped to this real active alert",
    !contactsForAlertErr && (contactsForAlert || []).length >= 1 && contactsForAlert.some((c) => c.id === dad.id),
    { contactsForAlertErr, contactsForAlert }
  );

  const { error: bobPullErr } = await bob.sb.rpc("get_emergency_contacts_for_alert", { p_alert_id: sosResult?.id });
  check("A student without sos.respond cannot pull another student's contacts via this RPC", !!bobPullErr, bobPullErr?.message);

  await facilities.sb.rpc("resolve_sos_alert", { p_alert_id: sosResult.id, p_notes: "Live check cleanup." });
  const { error: afterResolveErr } = await facilities.sb.rpc("get_emergency_contacts_for_alert", { p_alert_id: sosResult.id });
  check("Once the alert is resolved, the contacts RPC stops working for it", !!afterResolveErr && /no longer active/i.test(afterResolveErr.message), afterResolveErr?.message);

  const { data: auditRows } = await facilities.sb
    .from("audit_logs")
    .select("*")
    .eq("action", "sos.view_emergency_contacts")
    .eq("entity_id", sosResult.id)
    .eq("actor_id", facilities.userId);
  check("The contact lookup during a real alert is audit-logged", (auditRows || []).length >= 1, auditRows);

  console.log("\n--- Cleanup ---");
  const { data: finalList } = await alice.sb.from("emergency_contacts").select("id");
  for (const row of finalList || []) {
    await alice.sb.rpc("delete_emergency_contact", { p_id: row.id });
  }
  const { data: afterCleanup } = await alice.sb.from("emergency_contacts").select("id");
  check("All test contacts cleaned up", (afterCleanup || []).length === 0, afterCleanup);

  console.log(`\n${passCount} passed, ${failCount} failed`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Live check crashed:", err);
  process.exit(1);
});
