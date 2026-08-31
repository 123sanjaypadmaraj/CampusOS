// One-off live verification script (not part of the automated suite) --
// exercises the new club/vendor broadcast feature (migration
// 20260831000300_club_vendor_broadcasts.sql) directly against a real
// Supabase project using real signed-in sessions. Prints PASS/FAIL per
// assertion. Seeds a disposable throwaway club (deleted at the end,
// cascading to its members/channel/messages) rather than touching the real
// club catalog; the vendor half runs against a real staging canteen account
// (staging has no real students, same convention as the vendor order-queue
// live checks already in this directory) and only ever reads/asserts, never
// deletes anything vendor-side.
//
// Usage: node scripts/live-check-broadcasts.mjs                 (staging)
//        node scripts/live-check-broadcasts.mjs --env=production --yes-production

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resolveTarget } from "./env-target.mjs";

const { SUPABASE_URL, ANON_KEY, root, target } = resolveTarget();

const adminCredsFile = target === "production" ? ".admin-credentials.local.json" : ".admin-credentials.staging.local.json";
function adminPassword() {
  const p = path.join(root, "scripts", adminCredsFile);
  if (!fs.existsSync(p)) throw new Error(`No admin credentials known in ${adminCredsFile} -- run "node scripts/setup-admin-account.mjs --rotate" first.`);
  return JSON.parse(fs.readFileSync(p, "utf8")).password;
}
const adminEmailFile = path.join(root, "scripts", target === "production" ? ".admin-credentials.local.json" : ".admin-credentials.staging.local.json");
const adminEmail = JSON.parse(fs.readFileSync(adminEmailFile, "utf8")).email;

const e2eCredsFile = target === "production" ? ".e2e-credentials.local.json" : ".e2e-credentials.staging.local.json";
const e2eCreds = JSON.parse(fs.readFileSync(path.join(root, "scripts", e2eCredsFile), "utf8"));
const e2ePassword = (email) => {
  const password = e2eCreds.find((r) => r.email === email)?.password;
  if (!password) throw new Error(`No password known for ${email} in ${e2eCredsFile} -- run scripts/setup-test-users.mjs first.`);
  return password;
};

const vendorCredsFile = target === "production" ? ".vendor-credentials.local.json" : ".vendor-credentials.staging.local.json";
const vendorCreds = JSON.parse(fs.readFileSync(path.join(root, "scripts", vendorCredsFile), "utf8"));
const udupi = vendorCreds.find((r) => r.vendor === "Udupi Canteen");

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
  console.log(`=== Club + vendor broadcasts (target: ${target}) ===`);

  const admin = await signIn(adminEmail, adminPassword());
  const alice = await signIn("e2e.alice@nhce.edu.in", e2ePassword("e2e.alice@nhce.edu.in"));
  const bob = await signIn("e2e.bob@nhce.edu.in", e2ePassword("e2e.bob@nhce.edu.in"));
  const carol = await signIn("e2e.carol@nhce.edu.in", e2ePassword("e2e.carol@nhce.edu.in"));

  const { data: profileBefore } = await alice.sb.from("profiles").select("campus_id").eq("id", alice.userId).single();
  const campusId = profileBefore.campus_id;
  const marker = `LiveCheckBroadcast ${Date.now()}`;

  /* ================= CLUB BROADCAST ================= */

  const { data: club, error: clubErr } = await admin.sb
    .from("clubs").insert({ campus_id: campusId, name: marker, category: "Technology" }).select().single();
  check("Seed: throwaway club created", !clubErr && !!club?.id, clubErr);

  const { data: aliceMemberRow, error: aliceJoinErr } = await alice.sb
    .from("club_members").insert({ club_id: club.id, user_id: alice.userId, role: "member" }).select().single();
  check("Seed: Alice self-joins as a member", !aliceJoinErr && !!aliceMemberRow?.id, aliceJoinErr);
  const { error: aliceOwnerErr } = await admin.sb.rpc("set_club_member_role", { p_member_id: aliceMemberRow.id, p_role: "owner" });
  check("Seed: admin promotes Alice to owner", !aliceOwnerErr, aliceOwnerErr?.message);

  const { data: bobMemberRow, error: bobJoinErr } = await bob.sb
    .from("club_members").insert({ club_id: club.id, user_id: bob.userId, role: "member" }).select().single();
  check("Seed: Bob self-joins as a plain member", !bobJoinErr && !!bobMemberRow?.id, bobJoinErr);

  // Non-leader can't broadcast at all.
  const { error: bobBroadcastErr } = await bob.sb.rpc("publish_club_announcement", {
    p_club_id: club.id, p_title: "Should fail", p_body: null, p_pinned: false, p_audience: "members",
  });
  check("Guard: a plain member cannot post a club announcement", !!bobBroadcastErr, bobBroadcastErr);

  // Alice (owner) broadcasts to members only.
  const { data: ann1, error: ann1Err } = await alice.sb.rpc("publish_club_announcement", {
    p_club_id: club.id, p_title: "Members-only broadcast", p_body: "First one", p_pinned: false, p_audience: "members",
  });
  check("Members-only broadcast: RPC succeeds", !ann1Err && !!ann1?.id, ann1Err);

  const { data: aliceConvs } = await alice.sb.rpc("list_conversations");
  const aliceChannel = (aliceConvs || []).find((c) => c.title === marker);
  check("Owner's Messages list includes the new club channel", !!aliceChannel, { aliceConvs });
  check("Channel is flagged is_channel:true", aliceChannel?.is_channel === true);
  check("Owner (channel admin) has can_post:true", aliceChannel?.can_post === true);
  check("Channel member_count is 2 (Alice + Bob)", Number(aliceChannel?.member_count) === 2, aliceChannel);

  const { data: aliceMsgs } = await alice.sb.from("messages").select("body").eq("conversation_id", aliceChannel.conversation_id).order("created_at");
  check("Channel got the broadcast as a real message", (aliceMsgs || []).some((m) => m.body.includes("Members-only broadcast")), aliceMsgs);

  const { data: bobConvs } = await bob.sb.rpc("list_conversations");
  const bobChannel = (bobConvs || []).find((c) => c.title === marker);
  check("Plain member also sees the channel in their Messages", !!bobChannel);
  check("Plain member has can_post:false (read-only)", bobChannel?.can_post === false, bobChannel);

  // Read-only enforcement: Bob (a real participant, but role 'member') must
  // not be able to post into the channel.
  const { error: bobPostErr } = await bob.sb.rpc("send_message", { p_conversation_id: aliceChannel.conversation_id, p_body: "sneaky" });
  check("Guard: a plain member cannot post into the broadcast channel", !!bobPostErr && /broadcast channel/i.test(bobPostErr.message || ""), bobPostErr);

  // Carol is on the same campus but NOT a club member -- members-only
  // broadcast must not have notified her, and she must not see the channel.
  const { data: carolConvsBefore } = await carol.sb.rpc("list_conversations");
  check("Non-member does NOT see the members-only channel", !(carolConvsBefore || []).some((c) => c.title === marker));

  const { data: carolNotifsBefore } = await carol.sb.from("notifications").select("id").ilike("title", `%${marker}%`);
  check("Non-member got no notification from the members-only broadcast", (carolNotifsBefore || []).length === 0, carolNotifsBefore);

  // Alice broadcasts again with audience = all_students -- Carol (same
  // campus, a student, not a member) should now get a notification, but
  // still shouldn't be added to the members-only channel thread.
  const { error: ann2Err } = await alice.sb.rpc("publish_club_announcement", {
    p_club_id: club.id, p_title: "All-students broadcast", p_body: "Recruiting!", p_pinned: false, p_audience: "all_students",
  });
  check("All-students broadcast: RPC succeeds", !ann2Err, ann2Err);

  const { data: carolNotifsAfter } = await carol.sb.from("notifications").select("id, title").ilike("title", `%${marker}%`);
  check("Non-member DID get notified by the all-students broadcast", (carolNotifsAfter || []).length >= 1, carolNotifsAfter);

  const { data: carolConvsAfter } = await carol.sb.rpc("list_conversations");
  check("Non-member still doesn't get the channel thread itself", !(carolConvsAfter || []).some((c) => c.title === marker));

  // --- Cleanup: cascades to club_members, club_announcements, the channel
  // conversation (club_id FK), its messages, and its notifications' action_id
  // reference (notifications themselves are untouched, harmless test rows).
  const { error: cleanupErr } = await admin.sb.from("clubs").delete().eq("id", club.id);
  check("Cleanup: throwaway club deleted (cascades to channel + members)", !cleanupErr, cleanupErr?.message);

  /* ================= VENDOR BROADCAST ================= */

  if (!udupi || udupi.password?.startsWith("(pre-existing")) {
    console.log("  SKIP  Vendor broadcast checks -- no usable password for Udupi Canteen in " + vendorCredsFile);
  } else {
    const vendor = await signIn(udupi.email, udupi.password);

    const { data: canteenRow } = await vendor.sb.from("canteens").select("id, name").eq("owner_id", vendor.userId).maybeSingle();
    check("Precondition: vendor account owns a canteen", !!canteenRow?.id, canteenRow);

    const { error: bobVendorErr } = await bob.sb.rpc("broadcast_vendor_message", {
      p_canteen_id: canteenRow.id, p_title: "Should fail", p_body: null,
    });
    check("Guard: a non-owner cannot broadcast for someone else's canteen", !!bobVendorErr, bobVendorErr);

    const vendorMarker = `${marker} VENDOR`;
    const { data: vb, error: vbErr } = await vendor.sb.rpc("broadcast_vendor_message", {
      p_canteen_id: canteenRow.id, p_title: vendorMarker, p_body: "Live-check broadcast",
    });
    check("Vendor broadcast RPC succeeds", !vbErr && !!vb?.id, vbErr);
    check("Vendor broadcast returns a recipient_count", typeof vb?.recipient_count === "number", vb);

    const { data: readBack } = await vendor.sb.from("vendor_broadcasts").select("*").eq("id", vb.id).maybeSingle();
    check("vendor_broadcasts row is readable back", readBack?.title === vendorMarker, readBack);

    const { data: vendorConvs } = await vendor.sb.rpc("list_conversations");
    const vendorChannel = (vendorConvs || []).find((c) => c.title === canteenRow.name);
    check("Vendor's Messages list includes their channel", !!vendorChannel);
    check("Vendor channel can_post:true for the owner", vendorChannel?.can_post === true, vendorChannel);
  }

  console.log(`\n${passCount} passed, ${failCount} failed`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
