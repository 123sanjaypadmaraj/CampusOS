// One-off live verification script (not part of the automated suite) --
// exercises the 2026-08-30 WhatsApp-parity messaging pass: group chat
// (create/add/remove/leave/rename, admin auto-promotion, system messages),
// reactions (toggle/replace/remove), reply-to, and the real bug fix in
// send_message() (blocking is pairwise, so it's skipped for group sends --
// see supabase/migrations/20260830000200_messaging_whatsapp_features.sql).
// Runs against a real Supabase project with real signed-in sessions, using
// only the anon key + RLS (no service_role) -- same trust boundary the
// actual client hits. Prints PASS/FAIL per assertion.
//
// Usage: node scripts/live-check-messaging-whatsapp-features.mjs                 (staging)
//        node scripts/live-check-messaging-whatsapp-features.mjs --env=production --yes-production

import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { resolveTarget } from "./env-target.mjs";

const { SUPABASE_URL, ANON_KEY, root, target } = resolveTarget();

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

const stamp = Date.now();

async function main() {
  console.log("=== Messaging: group chat, reactions, replies, read receipts ===");
  const alice = await signIn("e2e.alice@nhce.edu.in", e2ePassword("e2e.alice@nhce.edu.in"));
  const bob = await signIn("e2e.bob@nhce.edu.in", e2ePassword("e2e.bob@nhce.edu.in"));
  const carol = await signIn("e2e.carol@nhce.edu.in", e2ePassword("e2e.carol@nhce.edu.in"));

  // ---------------------------------------------------------------
  // 1. Group creation + participants + system message + notification
  // ---------------------------------------------------------------
  const groupTitle = `Live Check Msg Group ${stamp}`;
  const beforeCreate = new Date().toISOString();
  const { data: groupId, error: createErr } = await alice.sb.rpc("create_group_conversation", {
    p_title: groupTitle,
    p_member_ids: [bob.userId, carol.userId],
  });
  check("create_group_conversation succeeds", !createErr && !!groupId, createErr?.message);

  const { data: aliceConvs } = await alice.sb.rpc("list_conversations");
  const groupRow = aliceConvs?.find((c) => c.conversation_id === groupId);
  check(
    "list_conversations surfaces the new group with is_group/title/member_count",
    groupRow?.is_group === true && groupRow?.title === groupTitle && Number(groupRow?.member_count) === 3,
    groupRow
  );

  const { data: participants, error: partErr } = await alice.sb.rpc("get_conversation_participants", { p_conversation_id: groupId });
  const roleById = Object.fromEntries((participants || []).map((p) => [p.user_id, p.role]));
  check(
    "get_conversation_participants: creator is admin, invited members are plain members",
    !partErr && participants?.length === 3 && roleById[alice.userId] === "admin" && roleById[bob.userId] === "member" && roleById[carol.userId] === "member",
    partErr?.message || roleById
  );

  const { data: lastMsg } = await bob.sb.from("messages").select("message_type, body, sender_id").eq("conversation_id", groupId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  check(
    "group creation posts an inline system message, not a real chat message",
    lastMsg?.message_type === "system" && lastMsg?.body?.includes("created the group") && lastMsg?.sender_id === alice.userId,
    lastMsg
  );

  const { data: createNotifs } = await carol.sb.from("notifications").select("id").eq("user_id", carol.userId).eq("type", "message").gte("created_at", beforeCreate);
  check("added members are notified when a group is created", (createNotifs || []).length > 0, createNotifs);

  // ---------------------------------------------------------------
  // 2. Messaging, reactions, reply-to
  // ---------------------------------------------------------------
  const { data: helloMsg, error: helloErr } = await bob.sb.rpc("send_message", { p_conversation_id: groupId, p_body: "hello group", p_attachment_path: null, p_reply_to_message_id: null });
  check("a plain member can send a text message in the group", !helloErr && helloMsg?.message_type === "text", helloErr?.message);

  const { error: react1Err } = await alice.sb.rpc("toggle_message_reaction", { p_message_id: helloMsg.id, p_emoji: "👍" });
  check("toggle_message_reaction adds a reaction", !react1Err, react1Err?.message);
  let { data: reactions1 } = await carol.sb.from("message_reactions").select("user_id, emoji").eq("message_id", helloMsg.id);
  check("a reaction is visible to any conversation participant, not just the reactor", reactions1?.some((r) => r.user_id === alice.userId && r.emoji === "👍"), reactions1);

  const { error: react2Err } = await alice.sb.rpc("toggle_message_reaction", { p_message_id: helloMsg.id, p_emoji: "👍" });
  check("toggling the same emoji again removes it", !react2Err, react2Err?.message);
  let { data: reactions2 } = await carol.sb.from("message_reactions").select("user_id, emoji").eq("message_id", helloMsg.id);
  check("reaction is actually gone after the toggle-off", !reactions2?.some((r) => r.user_id === alice.userId), reactions2);

  await alice.sb.rpc("toggle_message_reaction", { p_message_id: helloMsg.id, p_emoji: "❤️" });
  const { error: react3Err } = await alice.sb.rpc("toggle_message_reaction", { p_message_id: helloMsg.id, p_emoji: "👍" });
  check("reacting with a different emoji replaces the reactor's previous one", !react3Err, react3Err?.message);
  let { data: reactions3 } = await carol.sb.from("message_reactions").select("emoji").eq("message_id", helloMsg.id).eq("user_id", alice.userId);
  check("one reaction per user -- the replace didn't leave a duplicate row", reactions3?.length === 1 && reactions3[0].emoji === "👍", reactions3);

  const { data: replyMsg, error: replyErr } = await carol.sb.rpc("send_message", { p_conversation_id: groupId, p_body: "totally agree", p_attachment_path: null, p_reply_to_message_id: helloMsg.id });
  check("send_message accepts a reply-to id from the same conversation", !replyErr && replyMsg?.reply_to_message_id === helloMsg.id, replyErr?.message);

  const { error: badReplyErr } = await carol.sb.rpc("send_message", { p_conversation_id: groupId, p_body: "bad reply", p_attachment_path: null, p_reply_to_message_id: crypto.randomUUID() });
  check("send_message rejects a reply-to id that doesn't resolve to a real message", !!badReplyErr, badReplyErr?.message);

  // ---------------------------------------------------------------
  // 3. Membership management: add/remove, self-removal rejection,
  //    non-admin-remove rejection, leave + admin auto-promotion, rename
  // ---------------------------------------------------------------
  const adminGroupTitle = `Live Check Admin Group ${stamp}`;
  const { data: adminGroupId, error: adminGroupErr } = await alice.sb.rpc("create_group_conversation", { p_title: adminGroupTitle, p_member_ids: [bob.userId] });
  check("create_group_conversation (2-person, for membership tests)", !adminGroupErr && !!adminGroupId, adminGroupErr?.message);

  const { error: memberAddErr } = await bob.sb.rpc("add_group_member", { p_conversation_id: adminGroupId, p_user_id: carol.userId });
  check("a plain member (not just an admin) can add someone to the group", !memberAddErr, memberAddErr?.message);

  const { error: nonAdminRemoveErr } = await carol.sb.rpc("remove_group_member", { p_conversation_id: adminGroupId, p_user_id: bob.userId });
  check("a plain member cannot remove another member", !!nonAdminRemoveErr, nonAdminRemoveErr?.message);

  const { error: selfRemoveErr } = await bob.sb.rpc("remove_group_member", { p_conversation_id: adminGroupId, p_user_id: bob.userId });
  check("remove_group_member rejects removing yourself (must use leave instead)", !!selfRemoveErr, selfRemoveErr?.message);

  const { error: adminRemoveErr } = await alice.sb.rpc("remove_group_member", { p_conversation_id: adminGroupId, p_user_id: carol.userId });
  check("the admin can remove a member", !adminRemoveErr, adminRemoveErr?.message);

  const { error: bobLeaveErr } = await bob.sb.rpc("leave_group_conversation", { p_conversation_id: adminGroupId });
  check("a plain member can leave the group", !bobLeaveErr, bobLeaveErr?.message);
  const { error: bobPostLeaveErr } = await bob.sb.rpc("get_conversation_participants", { p_conversation_id: adminGroupId });
  check("after leaving, bob is no longer a participant (RPC rejects him)", !!bobPostLeaveErr, bobPostLeaveErr?.message);

  const { error: reAddCarolErr } = await alice.sb.rpc("add_group_member", { p_conversation_id: adminGroupId, p_user_id: carol.userId });
  check("re-adding carol (setup for the admin-auto-promotion check)", !reAddCarolErr, reAddCarolErr?.message);

  const { error: aliceLeaveErr } = await alice.sb.rpc("leave_group_conversation", { p_conversation_id: adminGroupId });
  check("the sole admin can leave", !aliceLeaveErr, aliceLeaveErr?.message);
  const { data: postLeaveParticipants } = await carol.sb.rpc("get_conversation_participants", { p_conversation_id: adminGroupId });
  const carolIsAdmin = postLeaveParticipants?.find((p) => p.user_id === carol.userId)?.role === "admin";
  check("the last remaining member is auto-promoted to admin when the sole admin leaves", carolIsAdmin, postLeaveParticipants);

  const { error: renameErr } = await carol.sb.rpc("rename_group_conversation", { p_conversation_id: adminGroupId, p_title: `${adminGroupTitle} (renamed)` });
  check("the newly-promoted admin can rename the group", !renameErr, renameErr?.message);

  const { error: reAddBobErr } = await carol.sb.rpc("add_group_member", { p_conversation_id: adminGroupId, p_user_id: bob.userId });
  check("re-adding bob (setup for the non-admin-rename-rejection check)", !reAddBobErr, reAddBobErr?.message);
  const { error: nonAdminRenameErr } = await bob.sb.rpc("rename_group_conversation", { p_conversation_id: adminGroupId, p_title: "should not stick" });
  check("a plain member cannot rename the group", !!nonAdminRenameErr, nonAdminRenameErr?.message);

  // ---------------------------------------------------------------
  // 4. The actual bug fix: blocking is pairwise and must not block a
  //    group send, while still correctly blocking a fresh DM.
  // ---------------------------------------------------------------
  const blockGroupTitle = `Live Check Block Group ${stamp}`;
  const { data: blockGroupId, error: blockGroupErr } = await alice.sb.rpc("create_group_conversation", { p_title: blockGroupTitle, p_member_ids: [bob.userId] });
  check("create_group_conversation (2-person, for the block-skip check)", !blockGroupErr && !!blockGroupId, blockGroupErr?.message);

  // Snapshot + always restore alice's block list exactly as found, whether
  // the checks below pass or fail.
  const { data: existingBlock } = await alice.sb.from("blocked_users").select("blocked_id").eq("blocker_id", alice.userId).eq("blocked_id", bob.userId).maybeSingle();
  try {
    if (!existingBlock) {
      await alice.sb.from("blocked_users").insert({ blocker_id: alice.userId, blocked_id: bob.userId });
    }

    const { error: groupSendWhileBlockedErr } = await bob.sb.rpc("send_message", { p_conversation_id: blockGroupId, p_body: "still works in the group", p_attachment_path: null, p_reply_to_message_id: null });
    check("send_message in a GROUP succeeds even though the sender and a co-member have blocked each other (the real bug fix)", !groupSendWhileBlockedErr, groupSendWhileBlockedErr?.message);

    const { error: dmStartWhileBlockedErr } = await alice.sb.rpc("start_conversation", { p_other_user: bob.userId, p_listing_id: null });
    check("start_conversation for a plain DM is still correctly rejected between blocked users (didn't regress)", !!dmStartWhileBlockedErr, dmStartWhileBlockedErr?.message);
  } finally {
    if (!existingBlock) {
      await alice.sb.from("blocked_users").delete().eq("blocker_id", alice.userId).eq("blocked_id", bob.userId);
    }
  }

  console.log(`\n${passCount} passed, ${failCount} failed`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Live check crashed:", err);
  process.exit(1);
});
