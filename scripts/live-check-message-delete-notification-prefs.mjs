// One-off live verification script (not part of the automated suite) --
// exercises the 2026-08-17 messaging-verification-pass gap closes: message
// delete (self + moderator) and per-message moderation on a conversation
// report (see supabase/migrations/20260817001000_message_delete_moderation.sql),
// plus the newly-surfaced per-category notification preferences
// (notification_preferences.messages, wired since 20260814004600 but never
// exposed anywhere until this pass). Runs against a real Supabase project
// with real signed-in sessions. Prints PASS/FAIL per assertion.
//
// Usage: node scripts/live-check-message-delete-notification-prefs.mjs                 (staging)
//        node scripts/live-check-message-delete-notification-prefs.mjs --env=production --yes-production

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
  console.log("=== Message delete/moderation + notification preferences ===");
  const admin = await signIn("1nh25cs265@usn.campusos.internal", adminPassword());
  const alice = await signIn("e2e.alice@nhce.edu.in", e2ePassword("e2e.alice@nhce.edu.in"));
  const bob = await signIn("e2e.bob@nhce.edu.in", e2ePassword("e2e.bob@nhce.edu.in"));
  const carol = await signIn("e2e.carol@nhce.edu.in", e2ePassword("e2e.carol@nhce.edu.in"));

  const { data: convId, error: convErr } = await alice.sb.rpc("start_conversation", { p_other_user: bob.userId, p_listing_id: null });
  check("start_conversation succeeds", !convErr && !!convId, convErr?.message);

  // --- 1. Self-delete ---
  const { data: msg1, error: msg1Err } = await alice.sb.rpc("send_message", { p_conversation_id: convId, p_body: "delete me", p_attachment_path: null });
  check("send_message (baseline)", !msg1Err && !!msg1?.id, msg1Err?.message);

  const { error: nonSenderDeleteErr } = await bob.sb.rpc("delete_message", { p_message_id: msg1.id });
  check("delete_message rejects a non-sender, non-moderator (bob, a real participant but not the sender)", !!nonSenderDeleteErr, nonSenderDeleteErr?.message);

  const { error: selfDeleteErr } = await alice.sb.rpc("delete_message", { p_message_id: msg1.id });
  check("delete_message succeeds for the sender deleting their own message", !selfDeleteErr, selfDeleteErr?.message);

  const { data: afterDelete } = await bob.sb.from("messages").select("body, attachment_path, deleted_at, deleted_by").eq("id", msg1.id).single();
  check(
    "self-deleted message: body/attachment cleared, deleted_at set, deleted_by = sender",
    afterDelete?.body === "" && afterDelete?.attachment_path === null && !!afterDelete?.deleted_at && afterDelete?.deleted_by === alice.userId,
    afterDelete
  );

  const { error: redeleteErr } = await alice.sb.rpc("delete_message", { p_message_id: msg1.id });
  check("delete_message on an already-deleted message is a no-op, not an error", !redeleteErr, redeleteErr?.message);

  // --- 2. Moderator delete ---
  const { data: msg2, error: msg2Err } = await bob.sb.rpc("send_message", { p_conversation_id: convId, p_body: "offensive test content", p_attachment_path: null });
  check("send_message (bob, baseline for moderator-delete test)", !msg2Err && !!msg2?.id, msg2Err?.message);

  const { error: carolDeleteErr } = await carol.sb.rpc("delete_message", { p_message_id: msg2.id });
  check("delete_message rejects a random non-participant, non-moderator (carol)", !!carolDeleteErr, carolDeleteErr?.message);

  const { error: modDeleteErr } = await admin.sb.rpc("delete_message", { p_message_id: msg2.id });
  check("delete_message succeeds for a moderator/admin removing someone else's message", !modDeleteErr, modDeleteErr?.message);

  const { data: afterModDelete } = await bob.sb.from("messages").select("deleted_at, deleted_by").eq("id", msg2.id).single();
  check("moderator-deleted message: deleted_by = the moderator, not the original sender", afterModDelete?.deleted_by === admin.userId, afterModDelete);

  const { data: modAction } = await admin.sb
    .from("moderation_actions")
    .select("*")
    .eq("target_type", "message")
    .eq("target_id", msg2.id)
    .maybeSingle();
  check("a moderator-driven delete is audited in moderation_actions", !!modAction && modAction.action === "remove", modAction);

  // --- 3. admin_get_conversation_messages ---
  const { error: nonModListErr } = await bob.sb.rpc("admin_get_conversation_messages", { p_conversation_id: convId, p_limit: 50 });
  check("admin_get_conversation_messages rejects a plain participant (bob is not a moderator)", !!nonModListErr, nonModListErr?.message);

  const { data: modList, error: modListErr } = await admin.sb.rpc("admin_get_conversation_messages", { p_conversation_id: convId, p_limit: 50 });
  const modListMsg2 = modList?.find((m) => m.id === msg2.id);
  check(
    "admin_get_conversation_messages lets a moderator see a reported conversation's messages, deleted-state included",
    !modListErr && !!modListMsg2 && !!modListMsg2.deleted_at && modListMsg2.sender_name,
    modListErr?.message || modListMsg2
  );

  // --- 4. Notification preferences (messages category) ---
  // Snapshot alice's current preference row so this run leaves it exactly as
  // it found it, regardless of pass/fail.
  const { data: originalPref } = await alice.sb.from("notification_preferences").select("messages").eq("user_id", alice.userId).maybeSingle();

  try {
    await alice.sb.from("notification_preferences").upsert({ user_id: alice.userId, messages: false }, { onConflict: "user_id" });

    const before = new Date().toISOString();
    const { error: msgWhileOffErr } = await bob.sb.rpc("send_message", { p_conversation_id: convId, p_body: "should not notify", p_attachment_path: null });
    check("send_message still succeeds even when the recipient has messages notifications off", !msgWhileOffErr, msgWhileOffErr?.message);

    const { data: notifsWhileOff } = await alice.sb
      .from("notifications")
      .select("id")
      .eq("user_id", alice.userId)
      .eq("type", "message")
      .gte("created_at", before);
    check("create_notification() suppresses a 'message' notification when notification_preferences.messages = false", (notifsWhileOff || []).length === 0, notifsWhileOff);

    await alice.sb.from("notification_preferences").upsert({ user_id: alice.userId, messages: true }, { onConflict: "user_id" });

    const before2 = new Date().toISOString();
    const { error: msgWhileOnErr } = await bob.sb.rpc("send_message", { p_conversation_id: convId, p_body: "should notify again", p_attachment_path: null });
    check("send_message succeeds with messages notifications back on", !msgWhileOnErr, msgWhileOnErr?.message);

    const { data: notifsWhileOn } = await alice.sb
      .from("notifications")
      .select("id")
      .eq("user_id", alice.userId)
      .eq("type", "message")
      .gte("created_at", before2);
    check("create_notification() delivers a 'message' notification again once re-enabled", (notifsWhileOn || []).length === 1, notifsWhileOn);
  } finally {
    // Restore alice's exact original preference state (a real row's real
    // value if one already existed, or delete the row this run created).
    if (originalPref) {
      await alice.sb.from("notification_preferences").upsert({ user_id: alice.userId, messages: originalPref.messages }, { onConflict: "user_id" });
    } else {
      await alice.sb.from("notification_preferences").delete().eq("user_id", alice.userId);
    }
  }

  const { data: restoredPref } = await alice.sb.from("notification_preferences").select("messages").eq("user_id", alice.userId).maybeSingle();
  check(
    "cleanup: alice's notification_preferences row restored to its exact pre-run state",
    JSON.stringify(restoredPref?.messages ?? null) === JSON.stringify(originalPref?.messages ?? null),
    { before: originalPref, after: restoredPref }
  );

  console.log(`\n${passCount} passed, ${failCount} failed`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Live check crashed:", err);
  process.exit(1);
});
