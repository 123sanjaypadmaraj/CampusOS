// One-off live verification script (not part of the automated suite) --
// exercises the Opportunities board (opportunities/mentors + real apply/
// request flow) directly against the production Supabase project using
// real signed-in sessions. Prints PASS/FAIL per assertion.
//
// Usage: node scripts/live-check-opportunities.mjs --env=production --yes-production

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resolveTarget } from "./env-target.mjs";

const { SUPABASE_URL, ANON_KEY, root, target } = resolveTarget();

// Admin's password isn't a fixed constant either -- see setup-admin-account.mjs's
// header for why (an earlier version hardcoded adminPassword() here; compromised).
const adminCredsFile = target === "production" ? ".admin-credentials.local.json" : ".admin-credentials.staging.local.json";
function adminPassword() {
  const p = path.join(root, "scripts", adminCredsFile);
  if (!fs.existsSync(p)) throw new Error(`No admin credentials known in ${adminCredsFile} -- run "node scripts/setup-admin-account.mjs --rotate" first (the account already exists, so a plain run won't write this file).`);
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

async function main() {
  console.log("=== Opportunities board ===");
  const admin = await signIn("1nh25cs265@usn.campusos.internal", adminPassword());
  const alice = await signIn("e2e.alice@nhce.edu.in", e2ePassword("e2e.alice@nhce.edu.in"));
  const bob = await signIn("e2e.bob@nhce.edu.in", e2ePassword("e2e.bob@nhce.edu.in"));

  const marker = `Live Check Intern ${Date.now()}`;

  // A plain student cannot post an opportunity or a mentor listing (RLS).
  const { error: studentPostErr } = await alice.sb.from("opportunities").insert({ company: "Acme", role: marker, type: "Internship" });
  check("A student cannot post an opportunity directly (RLS)", !!studentPostErr, studentPostErr?.message);

  const { data: opp, error: adminPostErr } = await admin.sb
    .from("opportunities")
    .insert({ company: "Live Check Labs", role: marker, type: "Research", description: "Testing the real apply flow.", tags: ["Test"], posted_by: admin.userId })
    .select()
    .single();
  check("Admin can post a real opportunity", !adminPostErr && !!opp?.id, adminPostErr);

  const { data: readBack, error: readErr } = await alice.sb.from("opportunities").select("*").eq("id", opp.id).single();
  check("Anyone can read the posted opportunity", !readErr && readBack?.role === marker, readErr);

  const { data: app1, error: applyErr } = await alice.sb.rpc("apply_to_opportunity", { p_opportunity_id: opp.id, p_message: "First note" });
  check("apply_to_opportunity succeeds", !applyErr && app1?.status === "submitted", applyErr);

  const { data: app1Again, error: applyAgainErr } = await alice.sb.rpc("apply_to_opportunity", { p_opportunity_id: opp.id, p_message: "Updated note" });
  check("Re-applying edits the existing application instead of erroring", !applyAgainErr && app1Again?.id === app1?.id && app1Again?.message === "Updated note", { applyAgainErr, app1Again });

  const { data: aliceApps } = await alice.sb.from("opportunity_applications").select("*").eq("user_id", alice.userId).eq("opportunity_id", opp.id);
  check("Exactly one application row exists after re-applying (unique constraint)", aliceApps?.length === 1, aliceApps);

  const { data: adminNotif } = await admin.sb.from("notifications").select("*").eq("action_type", "opportunity_application").eq("action_id", app1.id).limit(1);
  check("The poster (admin) got a real application notification", adminNotif?.length > 0, adminNotif);

  await admin.sb.from("opportunities").update({ active: false }).eq("id", opp.id);
  const { error: closedApplyErr } = await bob.sb.rpc("apply_to_opportunity", { p_opportunity_id: opp.id });
  check("Applying to a closed opportunity is rejected", !!closedApplyErr && /no longer accepting/i.test(closedApplyErr.message), closedApplyErr?.message);

  const { error: bobReadOthersAppErr } = await bob.sb.from("opportunity_applications").select("*").eq("id", app1.id).single();
  check("A different student cannot read someone else's application (RLS)", !!bobReadOthersAppErr, bobReadOthersAppErr?.message);

  console.log("\n=== Mentors ===");
  const mentorName = `Live Check Mentor ${Date.now()}`;
  const { data: mentor, error: mentorPostErr } = await admin.sb
    .from("mentors")
    .insert({ name: mentorName, role: "Testing", skills: ["QA"], profile_id: bob.userId })
    .select()
    .single();
  check("Admin can add a mentor, optionally linked to a real account", !mentorPostErr && !!mentor?.id, mentorPostErr);

  const { data: reqRow, error: reqErr } = await alice.sb.rpc("request_mentor", { p_mentor_id: mentor.id, p_message: "Can you help with QA?" });
  const request = Array.isArray(reqRow) ? reqRow[0] : reqRow;
  check("request_mentor succeeds and returns the linked profile id", !reqErr && request?.mentor_profile_id === bob.userId, { reqErr, request });

  const { data: bobNotif } = await bob.sb.from("notifications").select("*").eq("action_type", "mentor_request").eq("action_id", request?.request_id).limit(1);
  check("The linked mentor account got a real request notification", bobNotif?.length > 0, bobNotif);

  const { data: adminMentorNotif } = await admin.sb.from("notifications").select("*").eq("action_type", "mentor_request").eq("action_id", request?.request_id).limit(1);
  check("Admins (human-in-the-loop fallback) also got notified", adminMentorNotif?.length > 0, adminMentorNotif);

  // A blocked RLS update matches zero rows rather than erroring, so the
  // real assertion is "did the value actually change," not "was there an
  // error" (a bare no-error check would pass even when RLS silently
  // no-ops the write).
  await alice.sb.from("mentors").update({ role: "hacked" }).eq("id", mentor.id);
  const { data: mentorAfter } = await admin.sb.from("mentors").select("role").eq("id", mentor.id).single();
  check("A student's write to the mentor directory is silently blocked by RLS (role unchanged)", mentorAfter?.role === "Testing", mentorAfter);

  const { error: inactiveMentorErr } = await admin.sb.from("mentors").update({ active: false }).eq("id", mentor.id);
  check("Admin can deactivate a mentor listing", !inactiveMentorErr, inactiveMentorErr);
  const { error: requestInactiveErr } = await bob.sb.rpc("request_mentor", { p_mentor_id: mentor.id });
  check("Requesting an inactive mentor is rejected", !!requestInactiveErr && /not currently available/i.test(requestInactiveErr.message), requestInactiveErr?.message);

  // Cleanup -- this test data has no value once verified.
  await admin.sb.from("opportunities").delete().eq("id", opp.id);
  await admin.sb.from("mentors").delete().eq("id", mentor.id);

  console.log(`\n${passCount} passed, ${failCount} failed`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Live check crashed:", err);
  process.exit(1);
});
