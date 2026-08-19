// One-off live verification script (not part of the automated suite) --
// exercises the complete Club CMS (doc §39, migration
// 20260815001100_club_cms_complete.sql: treasurer/event_manager roles,
// recruitment modes, applications, documents, gallery, announcements,
// meeting attendance, membership history) directly against a real Supabase
// project using real signed-in sessions. Prints PASS/FAIL per assertion.
//
// Usage: node scripts/live-check-club-cms.mjs                 (staging)
//        node scripts/live-check-club-cms.mjs --env=production --yes-production

import fs from "node:fs";
import path from "node:path";
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

async function main() {
  console.log("=== Complete Club CMS (doc §39) ===");
  const admin = await signIn("1nh25cs265@usn.campusos.internal", "Sanjay@123");
  const alice = await signIn("e2e.alice@nhce.edu.in", e2ePassword("e2e.alice@nhce.edu.in"));
  const bob = await signIn("e2e.bob@nhce.edu.in", e2ePassword("e2e.bob@nhce.edu.in"));
  const carol = await signIn("e2e.carol@nhce.edu.in", e2ePassword("e2e.carol@nhce.edu.in"));

  const { data: profileBefore } = await alice.sb.from("profiles").select("campus_id").eq("id", alice.userId).single();
  const campusId = profileBefore.campus_id;
  const marker = `LiveCheckClub ${Date.now()}`;

  // --- Seed: two clubs, Alice owns club A, Carol owns club B ---
  const { data: clubA, error: clubAErr } = await admin.sb
    .from("clubs")
    .insert({ campus_id: campusId, name: marker + " A", category: "Technology", recruitment_mode: "application" })
    .select().single();
  check("Seed: club A created (application-mode)", !clubAErr && !!clubA?.id, clubAErr);

  const { data: clubB, error: clubBErr } = await admin.sb
    .from("clubs")
    .insert({ campus_id: campusId, name: marker + " B", category: "Cultural" })
    .select().single();
  check("Seed: club B created", !clubBErr && !!clubB?.id, clubBErr);

  // club_members has no admin-bypass INSERT policy (only self-join as
  // 'member' is allowed directly -- see club_members_join_self, 0011) --
  // every other role is granted via set_club_member_role() (SECURITY
  // DEFINER, admin/leader gated), same as a real approval flow would.
  const { data: aliceMemberRow, error: aliceJoinErr } = await alice.sb
    .from("club_members").insert({ club_id: clubA.id, user_id: alice.userId, role: "member" }).select().single();
  check("Seed: Alice self-joins club A as a member", !aliceJoinErr && !!aliceMemberRow?.id, aliceJoinErr);
  const { error: aliceOwnerErr } = await admin.sb.rpc("set_club_member_role", { p_member_id: aliceMemberRow.id, p_role: "owner" });
  check("Seed: admin promotes Alice to owner of club A", !aliceOwnerErr, aliceOwnerErr?.message);

  const { data: carolMemberRow, error: carolJoinErr } = await carol.sb
    .from("club_members").insert({ club_id: clubB.id, user_id: carol.userId, role: "member" }).select().single();
  check("Seed: Carol self-joins club B as a member", !carolJoinErr && !!carolMemberRow?.id, carolJoinErr);
  const { error: carolOwnerErr } = await admin.sb.rpc("set_club_member_role", { p_member_id: carolMemberRow.id, p_role: "owner" });
  check("Seed: admin promotes Carol to owner of club B", !carolOwnerErr, carolOwnerErr?.message);

  // --- Roles: treasurer/event_manager are now valid ---
  const { data: bobMemberRow, error: bobJoinErr } = await bob.sb
    .from("club_members").insert({ club_id: clubA.id, user_id: bob.userId, role: "member" }).select().single();
  check("Seed: Bob self-joins club A as a member", !bobJoinErr && !!bobMemberRow?.id, bobJoinErr);
  const { error: treasurerErr } = await alice.sb.rpc("set_club_member_role", { p_member_id: bobMemberRow.id, p_role: "treasurer" });
  check("Owner can promote a member to treasurer", !treasurerErr, treasurerErr?.message);
  const { error: eventMgrErr } = await alice.sb.rpc("set_club_member_role", { p_member_id: bobMemberRow.id, p_role: "event_manager" });
  check("Owner can change treasurer to event_manager", !eventMgrErr, eventMgrErr?.message);
  // Demote Bob back to plain member for the rest of this run.
  await alice.sb.rpc("set_club_member_role", { p_member_id: bobMemberRow.id, p_role: "member" });
  await admin.sb.from("club_members").delete().eq("id", bobMemberRow.id);

  // --- Applications / recruitment ---
  const { error: appErr } = await bob.sb.rpc("apply_to_club", { p_club_id: clubA.id, p_message: "I would like to join!" });
  check("Bob can apply to an application-mode club", !appErr, appErr?.message);

  const { error: dupErr } = await bob.sb.rpc("apply_to_club", { p_club_id: clubA.id, p_message: "again" });
  check("A second pending application is rejected", !!dupErr, dupErr?.message);

  const { data: dashForAlice } = await alice.sb.rpc("get_club_dashboard", { p_club_id: clubA.id });
  const pendingApp = (dashForAlice?.applications || []).find((a) => a.user_id === bob.userId);
  check("Alice's dashboard shows Bob's pending application", !!pendingApp, dashForAlice?.applications);

  const { error: crossReviewErr } = await carol.sb.rpc("review_club_application", { p_application_id: pendingApp.id, p_decision: "approved" });
  check("A leader of a DIFFERENT club cannot review this application", !!crossReviewErr, crossReviewErr?.message);

  const { error: reviewErr } = await alice.sb.rpc("review_club_application", { p_application_id: pendingApp.id, p_decision: "approved" });
  check("Club A's owner can approve Bob's application", !reviewErr, reviewErr?.message);

  const { data: bobMembership } = await admin.sb.from("club_members").select("*").eq("club_id", clubA.id).eq("user_id", bob.userId).maybeSingle();
  check("Approval actually added Bob to club_members", !!bobMembership, bobMembership);

  // Carol applies then withdraws her own application to club A.
  const { data: carolApp, error: carolAppErr } = await carol.sb.rpc("apply_to_club", { p_club_id: clubA.id });
  check("Carol (unrelated leader) can apply to club A as a student", !carolAppErr, carolAppErr?.message);
  const { error: withdrawErr } = await carol.sb.rpc("cancel_club_application", { p_application_id: carolApp.id });
  check("Carol can withdraw her own pending application", !withdrawErr, withdrawErr?.message);
  const { error: reviewWithdrawnErr } = await alice.sb.rpc("review_club_application", { p_application_id: carolApp.id, p_decision: "approved" });
  check("A withdrawn application can no longer be reviewed", !!reviewWithdrawnErr, reviewWithdrawnErr?.message);

  // Closed recruitment rejects new applications outright.
  await alice.sb.from("clubs").update({ recruitment_mode: "closed" }).eq("id", clubA.id);
  const { error: closedErr } = await carol.sb.rpc("apply_to_club", { p_club_id: clubA.id });
  check("A closed club rejects new applications", !!closedErr, closedErr?.message);
  await alice.sb.from("clubs").update({ recruitment_mode: "open" }).eq("id", clubA.id);

  // --- Documents (RLS write scoped to leaders; read is any authenticated user) ---
  const { error: docWriteByMemberErr } = await bob.sb
    .from("club_documents").insert({ club_id: clubA.id, title: "Not allowed", file_path: `${clubA.id}/x.pdf` });
  check("A plain member cannot insert a club document", !!docWriteByMemberErr, docWriteByMemberErr?.message);

  const { data: doc, error: docErr } = await alice.sb
    .from("club_documents").insert({ club_id: clubA.id, title: "Constitution", file_path: `${clubA.id}/constitution.pdf`, uploaded_by: alice.userId }).select().single();
  check("Club A's owner can insert a club document", !docErr && !!doc?.id, docErr);

  const { data: docReadByBob } = await bob.sb.from("club_documents").select("*").eq("id", doc.id).maybeSingle();
  check("Any authenticated member can read a club document", !!docReadByBob, docReadByBob);

  // --- Gallery ---
  const { data: galleryItem, error: galleryErr } = await alice.sb
    .from("club_gallery").insert({ club_id: clubA.id, image_url: "https://example.com/photo.jpg", caption: "Kickoff", uploaded_by: alice.userId }).select().single();
  check("Club A's owner can add a gallery item", !galleryErr && !!galleryItem?.id, galleryErr);
  const { error: galleryWriteByMemberErr } = await bob.sb
    .from("club_gallery").insert({ club_id: clubA.id, image_url: "https://example.com/x.jpg" });
  check("A plain member cannot add a gallery item", !!galleryWriteByMemberErr, galleryWriteByMemberErr?.message);

  // --- Announcements (RPC insert + fanout notification) ---
  const { error: annByMemberErr } = await bob.sb.rpc("publish_club_announcement", { p_club_id: clubA.id, p_title: "Not allowed", p_body: "x" });
  check("A plain member cannot publish a club announcement", !!annByMemberErr, annByMemberErr?.message);

  const { data: announcement, error: annErr } = await alice.sb.rpc("publish_club_announcement", {
    p_club_id: clubA.id, p_title: marker + " kickoff", p_body: "First meeting Friday.", p_pinned: true,
  });
  check("Club A's owner can publish an announcement", !annErr && !!announcement?.id, annErr);

  // notifications_read_own is self-only, no admin bypass -- read as Bob himself.
  const { data: bobNotif } = await bob.sb
    .from("notifications").select("*").eq("action_id", clubA.id).eq("type", "club").order("created_at", { ascending: false }).limit(1).maybeSingle();
  check("The announcement fanned out a real notification to Bob (a member)", !!bobNotif && bobNotif.title.includes(marker), bobNotif);

  // --- Meetings & attendance ---
  const { data: meeting, error: meetingErr } = await alice.sb
    .from("club_meetings").insert({ club_id: clubA.id, title: "Weekly sync", meeting_date: new Date().toISOString(), created_by: alice.userId }).select().single();
  check("Club A's owner can log a meeting", !meetingErr && !!meeting?.id, meetingErr);

  const { error: meetingByMemberErr } = await bob.sb
    .from("club_meetings").insert({ club_id: clubA.id, title: "Not allowed", meeting_date: new Date().toISOString() });
  check("A plain member cannot log a meeting", !!meetingByMemberErr, meetingByMemberErr?.message);

  const { error: attendanceErr } = await alice.sb.rpc("mark_meeting_attendance", {
    p_meeting_id: meeting.id,
    p_entries: [{ user_id: alice.userId, status: "present" }, { user_id: bob.userId, status: "absent" }],
  });
  check("Owner can bulk-mark attendance", !attendanceErr, attendanceErr?.message);

  const { data: dashAfterAttendance } = await alice.sb.rpc("get_club_dashboard", { p_club_id: clubA.id });
  const meetingSummary = (dashAfterAttendance?.meetings || []).find((m) => m.id === meeting.id);
  check("Dashboard reflects the attendance counts (1 present, 1 absent)", meetingSummary?.present === 1 && meetingSummary?.absent === 1, meetingSummary);

  const { data: bobOwnAttendance } = await bob.sb.from("club_meeting_attendance").select("*").eq("meeting_id", meeting.id).eq("user_id", bob.userId).maybeSingle();
  check("Bob can read his own attendance record", bobOwnAttendance?.status === "absent", bobOwnAttendance);

  const { error: attendanceByMemberErr } = await bob.sb.rpc("mark_meeting_attendance", { p_meeting_id: meeting.id, p_entries: [{ user_id: bob.userId, status: "present" }] });
  check("A plain member cannot mark attendance", !!attendanceByMemberErr, attendanceByMemberErr?.message);

  // --- Membership history (append-only log, survives removal) ---
  const { data: historyAfterJoin } = await admin.sb
    .from("club_membership_history").select("*").eq("club_id", clubA.id).eq("user_id", bob.userId).order("created_at", { ascending: true });
  check("Bob's approval logged a 'joined' history entry", (historyAfterJoin || []).some((h) => h.event_type === "joined"), historyAfterJoin);

  await bob.sb.from("club_members").delete().eq("club_id", clubA.id).eq("user_id", bob.userId);
  const { data: historyAfterLeave } = await admin.sb
    .from("club_membership_history").select("*").eq("club_id", clubA.id).eq("user_id", bob.userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  check("Bob leaving himself logged event_type='left' (not 'removed')", historyAfterLeave?.event_type === "left", historyAfterLeave);

  const { error: historyReadByOutsiderErr } = await carol.sb
    .from("club_membership_history").select("*").eq("club_id", clubA.id);
  // RLS returns an empty array rather than an error for a denied SELECT --
  // check the row count, not an error.
  const { data: historyForOutsider } = await carol.sb.from("club_membership_history").select("*").eq("club_id", clubA.id);
  check("A non-leader of club A cannot read its membership history", !historyReadByOutsiderErr && (historyForOutsider || []).length === 0, historyForOutsider);

  // --- Cleanup (admin bypasses RLS; cascades remove every child row) ---
  const { error: cleanupAErr } = await admin.sb.from("clubs").delete().eq("id", clubA.id);
  check("Cleanup: club A deleted (with members still on it)", !cleanupAErr, cleanupAErr?.message);
  const { error: cleanupBErr } = await admin.sb.from("clubs").delete().eq("id", clubB.id);
  check("Cleanup: club B deleted (with members still on it)", !cleanupBErr, cleanupBErr?.message);

  console.log(`\n${passCount} passed, ${failCount} failed`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Live check crashed:", err);
  process.exit(1);
});
