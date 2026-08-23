// One-off live verification script (not part of the automated suite) --
// exercises the new schema from the AI production-hardening pass
// (supabase/migrations/20260817002100_ai_hardening.sql: admin AI kill-
// switch, action audit log, usage log, feedback + "report wrong answer",
// admin-controlled knowledge base, admin analytics RPCs) directly against a
// real Supabase project using real signed-in sessions. This is the DB/RPC
// layer only -- it does not deploy or exercise the campus-assistant edge
// function itself (prompt-injection guarding, timeout, model fallback,
// sanitization all live in that function's own code, not schema). Prints
// PASS/FAIL per assertion.
//
// Usage: node scripts/live-check-ai-hardening.mjs                 (staging)
//        node scripts/live-check-ai-hardening.mjs --env=production --yes-production

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resolveTarget } from "./env-target.mjs";

const { SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY, root, target } = resolveTarget();

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

function serviceClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
}

async function signIn(email, password) {
  const sb = client();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return { sb, userId: data.user.id };
}

async function main() {
  console.log("=== AI production-hardening pass (schema/RPC layer) ===");
  const admin = await signIn("1nh25cs265@usn.campusos.internal", adminPassword());
  const alice = await signIn("e2e.alice@nhce.edu.in", e2ePassword("e2e.alice@nhce.edu.in"));
  const bob = await signIn("e2e.bob@nhce.edu.in", e2ePassword("e2e.bob@nhce.edu.in"));
  const svc = serviceClient();

  const marker = `LiveCheckAiHardening ${Date.now()}`;
  const createdKnowledgeIds = [];
  const createdFeedbackIds = [];

  try {
    // --- 1. Admin AI access kill-switch (abuse prevention) ---
    console.log("\n-- Admin AI access kill-switch --");
    {
      const { error: nonAdminErr } = await bob.sb.rpc("admin_set_ai_access", {
        p_target_user: alice.userId, p_blocked: true, p_reason: "should be rejected",
      });
      check("non-admin cannot block another student's AI access", !!nonAdminErr, nonAdminErr);

      const { error: blockErr } = await admin.sb.rpc("admin_set_ai_access", {
        p_target_user: bob.userId, p_blocked: true, p_reason: marker,
      });
      check("admin can block a student's AI access", !blockErr, blockErr);

      const { data: blockedProfile } = await svc.from("profiles").select("ai_blocked, ai_blocked_reason").eq("id", bob.userId).single();
      check("ai_blocked + reason landed on the profile row", blockedProfile?.ai_blocked === true && blockedProfile?.ai_blocked_reason === marker, blockedProfile);

      const { error: unblockErr } = await admin.sb.rpc("admin_set_ai_access", {
        p_target_user: bob.userId, p_blocked: false,
      });
      check("admin can restore AI access", !unblockErr, unblockErr);

      const { data: restoredProfile } = await svc.from("profiles").select("ai_blocked, ai_blocked_reason").eq("id", bob.userId).single();
      check("ai_blocked cleared, reason cleared alongside it", restoredProfile?.ai_blocked === false && restoredProfile?.ai_blocked_reason === null, restoredProfile);
    }

    // --- 2. Action audit log (log_ai_action) ---
    console.log("\n-- Action audit log --");
    {
      const { error: invalidStatusErr } = await alice.sb.rpc("log_ai_action", {
        p_action_type: "reminder", p_action_payload: { title: marker }, p_status: "bogus",
      });
      check("invalid status is rejected", !!invalidStatusErr, invalidStatusErr);

      const { error: logErr } = await alice.sb.rpc("log_ai_action", {
        p_action_type: "reminder", p_action_payload: { title: marker }, p_status: "confirmed", p_result_text: "Reminder set",
      });
      check("valid action disposition logs cleanly", !logErr, logErr);

      const { data: ownRead } = await alice.sb.from("audit_logs").select("id, action, entity_type, entity_id, new_value").eq("entity_type", "ai_action").contains("new_value", { payload: { title: marker } });
      check("the actor can read their own ai_action audit row", (ownRead?.length ?? 0) >= 1 && ownRead[0].action === "ai_action_confirmed", ownRead);

      const { data: bobRead } = await bob.sb.from("audit_logs").select("id").eq("entity_type", "ai_action").contains("new_value", { payload: { title: marker } });
      check("a different student cannot read someone else's ai_action audit row", (bobRead?.length ?? 0) === 0, bobRead);

      const { data: adminRead } = await admin.sb.from("audit_logs").select("id").eq("entity_type", "ai_action").contains("new_value", { payload: { title: marker } });
      check("admin can read any student's ai_action audit row", (adminRead?.length ?? 0) >= 1, adminRead);
    }

    // --- 3. Usage log (log_ai_usage) + admin analytics ---
    console.log("\n-- Usage log + admin analytics --");
    {
      const testModel = `test-model-${Date.now()}`;
      const { error: usageErr } = await alice.sb.rpc("log_ai_usage", {
        p_model: testModel, p_prompt_tokens: 120, p_completion_tokens: 45, p_total_tokens: 165, p_tool_rounds: 2, p_fell_back: true,
      });
      check("a signed-in student can log their own turn's usage", !usageErr, usageErr);

      const { data: rawRow } = await svc.from("ai_usage_log").select("user_id, model, total_tokens, fell_back").eq("model", testModel).maybeSingle();
      check("the usage row actually landed with the right values", rawRow?.user_id === alice.userId && rawRow?.total_tokens === 165 && rawRow?.fell_back === true, rawRow);

      const { data: anonRead, error: anonReadErr } = await alice.sb.from("ai_usage_log").select("id").eq("model", testModel);
      check("no direct client read policy on ai_usage_log (RPC-only, like rate_limit_hits)", (anonRead?.length ?? 0) === 0 || !!anonReadErr, { anonRead, anonReadErr });

      const { error: nonAdminSummaryErr } = await bob.sb.rpc("ai_admin_usage_summary", { p_days: 30 });
      check("non-admin cannot read AI usage analytics", !!nonAdminSummaryErr, nonAdminSummaryErr);

      const { data: summary, error: summaryErr } = await admin.sb.rpc("ai_admin_usage_summary", { p_days: 30 });
      const s = summary?.[0];
      check("admin can read AI usage analytics with real numbers", !summaryErr && s && Number(s.messages) >= 1 && Number(s.total_tokens) >= 165, { summaryErr, s });

      await svc.from("ai_usage_log").delete().eq("model", testModel);
    }

    // --- 4. Feedback + "report wrong answer" ---
    console.log("\n-- Feedback + report wrong answer --");
    {
      const { error: badRatingErr } = await alice.sb.rpc("submit_ai_feedback", { p_message_excerpt: marker, p_rating: "sideways" });
      check("invalid rating is rejected", !!badRatingErr, badRatingErr);

      const { data: upRow, error: upErr } = await alice.sb.rpc("submit_ai_feedback", { p_message_excerpt: `${marker} up`, p_rating: "up" });
      check("thumbs-up feedback submits cleanly", !upErr && upRow?.rating === "up", { upErr, upRow });
      if (upRow?.id) createdFeedbackIds.push(upRow.id);

      const { data: downRow, error: downErr } = await alice.sb.rpc("submit_ai_feedback", { p_message_excerpt: `${marker} down`, p_rating: "down", p_report_reason: "wrong price" });
      check("thumbs-down with a report reason submits cleanly", !downErr && downRow?.rating === "down" && downRow?.report_reason === "wrong price", { downErr, downRow });
      if (downRow?.id) createdFeedbackIds.push(downRow.id);

      const { data: ownFeedback } = await alice.sb.from("ai_feedback").select("id").eq("message_excerpt", `${marker} down`);
      check("the student can read their own feedback row", (ownFeedback?.length ?? 0) === 1, ownFeedback);

      const { data: bobFeedback } = await bob.sb.from("ai_feedback").select("id").eq("message_excerpt", `${marker} down`);
      check("a different student cannot read someone else's feedback row", (bobFeedback?.length ?? 0) === 0, bobFeedback);

      const { error: nonAdminReportsErr } = await bob.sb.rpc("ai_admin_list_reports", { p_limit: 10 });
      check("non-admin cannot list reported answers", !!nonAdminReportsErr, nonAdminReportsErr);

      const { data: reports, error: reportsErr } = await admin.sb.rpc("ai_admin_list_reports", { p_limit: 50 });
      const found = (reports || []).find((r) => r.message_excerpt === `${marker} down`);
      check("admin's reported-answers list includes the new down-vote with its reason", !reportsErr && found?.report_reason === "wrong price", { reportsErr, found });
    }

    // --- 5. Admin-controlled knowledge base ---
    console.log("\n-- Admin-controlled knowledge base --");
    {
      const { data: aliceProfile } = await svc.from("profiles").select("campus_id").eq("id", alice.userId).single();
      const aliceCampusId = aliceProfile.campus_id;

      const { error: nonAdminKbErr } = await bob.sb.rpc("upsert_ai_knowledge", { p_id: null, p_question: `${marker} q`, p_answer: "a", p_campus_id: null, p_active: true });
      check("non-admin cannot write to the knowledge base", !!nonAdminKbErr, nonAdminKbErr);

      const { data: globalEntry, error: globalErr } = await admin.sb.rpc("upsert_ai_knowledge", {
        p_id: null, p_question: `${marker} global`, p_answer: "Global answer", p_campus_id: null, p_active: true,
      });
      check("admin can create a global knowledge entry", !globalErr && globalEntry?.id, { globalErr, globalEntry });
      if (globalEntry?.id) createdKnowledgeIds.push(globalEntry.id);

      const { data: campusEntry, error: campusErr } = await admin.sb.rpc("upsert_ai_knowledge", {
        p_id: null, p_question: `${marker} campus`, p_answer: "Campus-only answer", p_campus_id: aliceCampusId, p_active: true,
      });
      check("admin can create a campus-scoped knowledge entry", !campusErr && campusEntry?.id, { campusErr, campusEntry });
      if (campusEntry?.id) createdKnowledgeIds.push(campusEntry.id);

      const { data: inactiveEntry, error: inactiveErr } = await admin.sb.rpc("upsert_ai_knowledge", {
        p_id: null, p_question: `${marker} inactive`, p_answer: "Should not be visible", p_campus_id: null, p_active: false,
      });
      check("admin can create an inactive entry", !inactiveErr && inactiveEntry?.id, { inactiveErr, inactiveEntry });
      if (inactiveEntry?.id) createdKnowledgeIds.push(inactiveEntry.id);

      const { data: aliceReadGlobal } = await alice.sb.from("ai_knowledge").select("id").eq("question", `${marker} global`);
      check("a student can read an active global entry (this is what the assistant's tool call uses)", (aliceReadGlobal?.length ?? 0) === 1, aliceReadGlobal);

      const { data: aliceReadCampus } = await alice.sb.from("ai_knowledge").select("id").eq("question", `${marker} campus`);
      check("a student in the matching campus can read a campus-scoped entry", (aliceReadCampus?.length ?? 0) === 1, aliceReadCampus);

      const { data: aliceReadInactive } = await alice.sb.from("ai_knowledge").select("id").eq("question", `${marker} inactive`);
      check("a student cannot read an inactive entry", (aliceReadInactive?.length ?? 0) === 0, aliceReadInactive);

      const { data: adminList, error: adminListErr } = await admin.sb.rpc("admin_list_ai_knowledge");
      const adminSeesInactive = (adminList || []).some((k) => k.question === `${marker} inactive`);
      check("admin's management list includes inactive entries a student can't see", !adminListErr && adminSeesInactive, { adminListErr, adminSeesInactive });

      const { error: nonAdminListErr } = await bob.sb.rpc("admin_list_ai_knowledge");
      const { data: nonAdminListData } = await bob.sb.rpc("admin_list_ai_knowledge");
      check("non-admin's management list call returns nothing (fails closed, not an error)", !nonAdminListErr && (nonAdminListData?.length ?? 0) === 0, { nonAdminListErr, count: nonAdminListData?.length });

      const { error: nonAdminDeleteErr } = await bob.sb.rpc("delete_ai_knowledge", { p_id: globalEntry.id });
      check("non-admin cannot delete a knowledge entry", !!nonAdminDeleteErr, nonAdminDeleteErr);

      const { error: deleteErr } = await admin.sb.rpc("delete_ai_knowledge", { p_id: globalEntry.id });
      check("admin can delete a knowledge entry", !deleteErr, deleteErr);
      const { data: goneCheck } = await svc.from("ai_knowledge").select("id").eq("id", globalEntry.id);
      check("the deleted entry is actually gone", (goneCheck?.length ?? 0) === 0, goneCheck);
      createdKnowledgeIds.splice(createdKnowledgeIds.indexOf(globalEntry.id), 1);
    }
  } finally {
    // --- Cleanup: never leave test rows behind in shared staging data ---
    if (createdKnowledgeIds.length) await svc.from("ai_knowledge").delete().in("id", createdKnowledgeIds);
    if (createdFeedbackIds.length) await svc.from("ai_feedback").delete().in("id", createdFeedbackIds);
    await svc.from("audit_logs").delete().eq("entity_type", "ai_action").contains("new_value", { payload: { title: marker } });
    await svc.from("profiles").update({ ai_blocked: false, ai_blocked_reason: null }).eq("id", bob.userId);
  }

  console.log(`\n=== ${passCount} passed, ${failCount} failed ===`);
  if (failCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Live check crashed:", err);
  process.exit(1);
});
