// One-off live verification script (not part of the automated suite) --
// exercises the marketplace messaging gap-closing pass (block user, report
// conversation + message moderation, attachments, seller/profile
// availability -- see supabase/migrations/20260815001200_marketplace_
// messaging_gaps.sql) directly against a real Supabase project using real
// signed-in sessions. Prints PASS/FAIL per assertion.
//
// Usage: node scripts/live-check-marketplace-messaging.mjs                 (staging)
//        node scripts/live-check-marketplace-messaging.mjs --env=production --yes-production

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
  console.log("=== Marketplace messaging gap-closing pass ===");
  const admin = await signIn("1nh25cs265@usn.campusos.internal", adminPassword());
  const alice = await signIn("e2e.alice@nhce.edu.in", e2ePassword("e2e.alice@nhce.edu.in"));
  const bob = await signIn("e2e.bob@nhce.edu.in", e2ePassword("e2e.bob@nhce.edu.in"));

  // Clean slate: make sure alice/bob don't already have a block row from a
  // prior run of this script.
  await alice.sb.from("blocked_users").delete().eq("blocker_id", alice.userId).eq("blocked_id", bob.userId);
  await bob.sb.from("blocked_users").delete().eq("blocker_id", bob.userId).eq("blocked_id", alice.userId);

  // --- 1. Conversation + baseline send still works ---
  const { data: convId, error: convErr } = await alice.sb.rpc("start_conversation", { p_other_user: bob.userId, p_listing_id: null });
  check("start_conversation succeeds between two unblocked users", !convErr && !!convId, convErr?.message);

  const { data: msg1, error: msg1Err } = await alice.sb.rpc("send_message", { p_conversation_id: convId, p_body: "hi bob", p_attachment_path: null });
  check("send_message still works with the new 3-arg signature", !msg1Err && msg1?.body === "hi bob", msg1Err?.message);

  // --- 2. Attachments ---
  const { data: photoMsg, error: photoErr } = await alice.sb.rpc("send_message", { p_conversation_id: convId, p_body: "", p_attachment_path: `${convId}/test.png` });
  check("send_message accepts an image-only message (empty body + attachment_path)", !photoErr && photoMsg?.attachment_path === `${convId}/test.png`, photoErr?.message || photoMsg);

  const { error: emptyErr } = await alice.sb.rpc("send_message", { p_conversation_id: convId, p_body: "", p_attachment_path: null });
  check("send_message still rejects a truly empty message (no body, no attachment)", !!emptyErr, emptyErr?.message);

  // Storage RLS: a real participant (bob) can upload into the conversation's
  // folder; a non-participant (carol) is rejected by is_conversation_participant().
  const carol = await signIn("e2e.carol@nhce.edu.in", e2ePassword("e2e.carol@nhce.edu.in"));
  const tinyPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // not a real PNG, just needs bytes to upload
  // upsert: true -- convId is a stable, reused DM thread between alice/bob
  // across runs, so a fixed filename here collided with a leftover object
  // from a previous run ("The resource already exists"), which is a
  // cleanup/idempotency gap in this script, not a real RLS rejection.
  const { error: bobUploadErr } = await bob.sb.storage.from("message-attachments").upload(`${convId}/bob-upload.png`, tinyPng, { contentType: "image/png", upsert: true });
  check("storage RLS: a real conversation participant (bob) CAN upload into the conversation's folder", !bobUploadErr, bobUploadErr?.message);

  const { error: carolUploadErr } = await carol.sb.storage.from("message-attachments").upload(`${convId}/carol-upload.png`, tinyPng, { contentType: "image/png" });
  check("storage RLS: a non-participant (carol) is REJECTED uploading into someone else's conversation folder", !!carolUploadErr, carolUploadErr?.message);

  const { data: bobSigned, error: bobSignedErr } = await bob.sb.storage.from("message-attachments").createSignedUrl(`${convId}/bob-upload.png`, 60);
  check("storage RLS: bob can sign a URL for the file he just uploaded", !bobSignedErr && !!bobSigned?.signedUrl, bobSignedErr?.message);

  // --- 3. Block user ---
  const { error: blockErr } = await bob.sb.from("blocked_users").insert({ blocker_id: bob.userId, blocked_id: alice.userId });
  check("bob can block alice (blocked_users_own RLS)", !blockErr, blockErr?.message);

  const { error: sendAfterBlockErr } = await alice.sb.rpc("send_message", { p_conversation_id: convId, p_body: "are you there?", p_attachment_path: null });
  check("send_message is rejected once the recipient has blocked the sender", !!sendAfterBlockErr, sendAfterBlockErr?.message);

  const { error: startAfterBlockErr } = await alice.sb.rpc("start_conversation", { p_other_user: bob.userId, p_listing_id: null });
  check("start_conversation is rejected for a blocked pair (even though a DM thread already exists)", !!startAfterBlockErr, startAfterBlockErr?.message);

  const { data: freshOtherUser } = await alice.sb.rpc("start_conversation", { p_other_user: carol.userId, p_listing_id: null });
  check("start_conversation still works for an unrelated, unblocked third user", !!freshOtherUser);

  await bob.sb.from("blocked_users").delete().eq("blocker_id", bob.userId).eq("blocked_id", alice.userId);
  const { error: sendAfterUnblockErr } = await alice.sb.rpc("send_message", { p_conversation_id: convId, p_body: "unblocked now", p_attachment_path: null });
  check("send_message works again after unblocking", !sendAfterUnblockErr, sendAfterUnblockErr?.message);

  // --- 4. Report conversation + message moderation context ---
  const { data: reportRow, error: reportErr } = await alice.sb
    .from("content_reports")
    .insert({ reporter_id: alice.userId, target_type: "conversation", target_id: convId, reason: "live-check test report" })
    .select()
    .single();
  check("reportContent()'s insert path accepts target_type='conversation'", !reportErr && !!reportRow?.id, reportErr?.message);

  const { data: ctx, error: ctxErr } = await admin.sb.rpc("get_report_context", { p_target_type: "conversation", p_target_id: convId, p_reporter_id: alice.userId });
  const ctxRow = ctx?.[0];
  check("get_report_context('conversation', ..., reporterId) resolves the OTHER participant (bob), not the reporter", !ctxErr && ctxRow?.owner_id === bob.userId, ctxErr?.message || ctxRow);

  const { error: nonModErr } = await alice.sb.rpc("get_report_context", { p_target_type: "conversation", p_target_id: convId, p_reporter_id: alice.userId });
  check("get_report_context is still admin/moderator-only (a plain student is rejected)", !!nonModErr, nonModErr?.message);

  await admin.sb.from("content_reports").update({ status: "dismissed", reviewed_by: admin.userId, reviewed_at: new Date().toISOString() }).eq("id", reportRow.id);

  // --- 5. Seller / profile availability ---
  const marker = `LiveCheck ${Date.now()}`;
  const { error: availErr } = await alice.sb.from("profiles").update({ availability_status: "away", availability_message: marker }).eq("id", alice.userId);
  check("a student can self-set availability_status/message (profiles_update_self)", !availErr, availErr?.message);

  const { data: snippet } = await bob.sb.rpc("get_profile_snippets", { p_ids: [alice.userId] });
  check("get_profile_snippets() surfaces the new availability fields", snippet?.[0]?.availability_status === "away" && snippet?.[0]?.availability_message === marker, snippet?.[0]);

  const { data: bobConvs } = await bob.sb.rpc("list_conversations");
  const convRow = bobConvs?.find((c) => c.conversation_id === convId);
  check("list_conversations() surfaces the other participant's availability inline (no extra lookup needed)", convRow?.other_user_availability_status === "away" && convRow?.other_user_availability_message === marker, convRow);

  const { error: invalidStatusErr } = await alice.sb.from("profiles").update({ availability_status: "on_a_beach" }).eq("id", alice.userId);
  check("availability_status is constrained to available/away (bad value rejected)", !!invalidStatusErr, invalidStatusErr?.message);

  await alice.sb.from("profiles").update({ availability_status: "available", availability_message: null }).eq("id", alice.userId);

  // --- cleanup ---
  await alice.sb.from("blocked_users").delete().eq("blocker_id", alice.userId).eq("blocked_id", bob.userId);
  await bob.sb.from("blocked_users").delete().eq("blocker_id", bob.userId).eq("blocked_id", alice.userId);

  console.log(`\n${passCount} passed, ${failCount} failed`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Live check crashed:", err);
  process.exit(1);
});
