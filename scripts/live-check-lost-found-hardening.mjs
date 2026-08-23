// One-off live verification script (not part of the automated suite) --
// exercises supabase/migrations/20260819001600_lost_found_hardening.sql
// directly against a real Supabase project using real signed-in sessions.
// Prints PASS/FAIL per assertion.
//
// Usage: node scripts/live-check-lost-found-hardening.mjs                 (staging)
//        node scripts/live-check-lost-found-hardening.mjs --env=production --yes-production

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
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

const createdItemIds = [];

async function main() {
  console.log("=== Lost & Found hardening pass ===");
  const admin = await signIn("1nh25cs265@usn.campusos.internal", adminPassword());
  const alice = await signIn("e2e.alice@nhce.edu.in", e2ePassword("e2e.alice@nhce.edu.in"));
  const bob = await signIn("e2e.bob@nhce.edu.in", e2ePassword("e2e.bob@nhce.edu.in"));

  async function insertItem(sb, overrides) {
    return sb.from("lost_found_items").insert({
      user_id: overrides.user_id, item_type: "found", title: `LiveCheck ${randomUUID()}`,
      description: "live-check item", category: "Other", location: "Campus", ...overrides,
    }).select().single();
  }

  // --- 1. Claim fraud prevention: self-claim guard ---
  const { data: ownItem, error: ownItemErr } = await insertItem(alice.sb, { user_id: alice.userId });
  check("setup: alice reports a found item", !ownItemErr && !!ownItem?.id, ownItemErr?.message);
  if (ownItem?.id) createdItemIds.push(ownItem.id);

  const { error: selfClaimErr } = await alice.sb.rpc("claim_lost_found_item", { p_item_id: ownItem?.id, p_proof: "it's mine, I just posted it" });
  check("a reporter cannot claim their own report", !!selfClaimErr && /reported this item yourself/.test(selfClaimErr.message), selfClaimErr?.message);

  // --- 2. Claim + ownership proof (existing behaviour, still verified) ---
  const { error: emptyProofErr } = await bob.sb.rpc("claim_lost_found_item", { p_item_id: ownItem?.id, p_proof: "   " });
  check("claiming with blank proof is rejected", !!emptyProofErr, emptyProofErr?.message);

  const { data: claimed, error: claimErr } = await bob.sb.rpc("claim_lost_found_item", { p_item_id: ownItem?.id, p_proof: "it has a scratch on the back, mine" });
  check("a genuine claim with proof succeeds and moves the item to claim_pending", !claimErr && claimed?.status === "claim_pending" && claimed?.claimed_by === bob.userId, claimErr?.message || claimed);

  const { error: doubleClaimErr } = await admin.sb.rpc("claim_lost_found_item", { p_item_id: ownItem?.id, p_proof: "also mine" });
  check("a second claim on an already-pending item is rejected", !!doubleClaimErr, doubleClaimErr?.message);

  // --- 3. Admin verification + handover record (audit_logs) ---
  const { error: nonAdminVerifyErr } = await bob.sb.rpc("verify_lost_found_handover", { p_item_id: ownItem?.id, p_approve: true });
  check("a plain student cannot verify a handover", !!nonAdminVerifyErr, nonAdminVerifyErr?.message);

  const { data: verified, error: verifyErr } = await admin.sb.rpc("verify_lost_found_handover", { p_item_id: ownItem?.id, p_approve: true });
  check("an admin can approve a pending claim, resolving the item", !verifyErr && verified?.status === "resolved" && verified?.claimed_by === bob.userId, verifyErr?.message || verified);

  const { data: auditRows, error: auditErr } = await admin.sb
    .from("audit_logs").select("action, entity_id, reason").eq("entity_type", "lost_found_item").eq("entity_id", ownItem?.id).order("created_at", { ascending: false }).limit(1);
  check("the approved handover is written to audit_logs (handover record)", !auditErr && auditRows?.[0]?.action === "lost_found.handover_approved", auditErr?.message || auditRows);

  // --- 4. Claim rejection ---
  const { data: rejectItem, error: rejectItemErr } = await insertItem(alice.sb, { user_id: alice.userId });
  check("setup: alice reports a second item to test rejection", !rejectItemErr && !!rejectItem?.id, rejectItemErr?.message);
  if (rejectItem?.id) createdItemIds.push(rejectItem.id);

  await bob.sb.rpc("claim_lost_found_item", { p_item_id: rejectItem?.id, p_proof: "bogus claim for live-check" });
  const { data: rejected, error: rejectErr } = await admin.sb.rpc("verify_lost_found_handover", { p_item_id: rejectItem?.id, p_approve: false });
  check("an admin can reject a claim, reopening the item with claimant cleared", !rejectErr && rejected?.status === "open" && rejected?.claimed_by === null, rejectErr?.message || rejected);

  const { data: rejectAuditRows } = await admin.sb
    .from("audit_logs").select("action").eq("entity_type", "lost_found_item").eq("entity_id", rejectItem?.id).order("created_at", { ascending: false }).limit(1);
  check("the rejected claim is also written to audit_logs", rejectAuditRows?.[0]?.action === "lost_found.claim_rejected", rejectAuditRows);

  // --- 5. Item expiry / archive ---
  const { data: expiring, error: expiringErr } = await insertItem(alice.sb, { user_id: alice.userId });
  check("setup: create an item to expire", !expiringErr && !!expiring?.id, expiringErr?.message);
  if (expiring?.id) createdItemIds.push(expiring.id);

  await admin.sb.from("lost_found_items").update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", expiring?.id);
  const { data: expiredCount, error: expireRpcErr } = await alice.sb.rpc("expire_stale_lost_found_items");
  check("expire_stale_lost_found_items() runs for a plain authenticated user and returns a count", !expireRpcErr && typeof expiredCount === "number", expireRpcErr?.message || expiredCount);

  const { data: afterExpire } = await admin.sb.from("lost_found_items").select("status").eq("id", expiring?.id).single();
  check("an item past its expires_at is archived", afterExpire?.status === "archived", afterExpire);

  const { data: archivedInvisible } = await alice.sb.from("lost_found_items").select("id").eq("id", expiring?.id).eq("status", "open");
  check("an archived item no longer shows up in the open-only student feed query", (archivedInvisible?.length ?? 0) === 0, archivedInvisible);

  // --- 6. Report + moderate a bogus report ---
  const { data: reportable, error: reportableErr } = await insertItem(alice.sb, { user_id: alice.userId, title: `LiveCheck reportable ${randomUUID()}` });
  check("setup: create an item to report", !reportableErr && !!reportable?.id, reportableErr?.message);
  if (reportable?.id) createdItemIds.push(reportable.id);

  const { data: reportRow, error: reportErr } = await bob.sb
    .from("content_reports").insert({ reporter_id: bob.userId, target_type: "lost_found_item", target_id: reportable?.id, reason: "live-check test report" }).select().single();
  check("reportContent()'s insert path accepts target_type='lost_found_item'", !reportErr && !!reportRow?.id, reportErr?.message);

  const { data: ctx, error: ctxErr } = await admin.sb.rpc("get_report_context", { p_target_type: "lost_found_item", p_target_id: reportable?.id });
  const ctxRow = ctx?.[0];
  check("get_report_context resolves the reporter as the report's owner", !ctxErr && ctxRow?.owner_id === alice.userId, ctxErr?.message || ctxRow);

  const { error: nonAdminModerateErr } = await bob.sb.rpc("moderate_content", { p_target_type: "lost_found_item", p_target_id: reportable?.id, p_action: "remove", p_reason: "x" });
  check("moderate_content is rejected for a plain student", !!nonAdminModerateErr, nonAdminModerateErr?.message);

  const { error: removeErr } = await admin.sb.rpc("moderate_content", { p_target_type: "lost_found_item", p_target_id: reportable?.id, p_action: "remove", p_reason: "test removal" });
  check("an admin can moderate_content('remove') a reported item", !removeErr, removeErr?.message);

  const { data: afterRemoveStatus } = await admin.sb.from("lost_found_items").select("status").eq("id", reportable?.id).single();
  check("the item is archived after a 'remove' moderation action", afterRemoveStatus?.status === "archived", afterRemoveStatus);

  const { error: approveErr } = await admin.sb.rpc("moderate_content", { p_target_type: "lost_found_item", p_target_id: reportable?.id, p_action: "approve", p_reason: null });
  check("an admin can moderate_content('approve') to restore a wrongly-archived item", !approveErr, approveErr?.message);

  const { data: afterApprove } = await admin.sb.from("lost_found_items").select("status, expires_at").eq("id", reportable?.id).single();
  check("the item's status is back to 'open' with a fresh expiry after an approve action", afterApprove?.status === "open" && new Date(afterApprove?.expires_at) > new Date(), afterApprove);

  await admin.sb.from("content_reports").update({ status: "resolved", reviewed_by: admin.userId, reviewed_at: new Date().toISOString() }).eq("id", reportRow?.id);

  // --- cleanup ---
  for (const id of createdItemIds) {
    await admin.sb.from("lost_found_items").delete().eq("id", id);
  }

  console.log(`\n${passCount} passed, ${failCount} failed`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Live check crashed:", err);
  process.exit(1);
});
