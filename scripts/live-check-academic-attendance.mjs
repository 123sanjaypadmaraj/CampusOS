// One-off live verification script (not part of the automated suite) --
// exercises the attendance-tracking module added in
// supabase/migrations/20260831000700_academic_attendance.sql (roster
// lookup, marking, session history, and the student-facing summary/record
// reads) directly against a real Supabase project using real signed-in
// sessions. Prints PASS/FAIL per assertion. Mirrors
// scripts/live-check-academic-module.mjs's structure and its
// capture-then-restore approach to the shared e2e test accounts.
//
// Usage: node scripts/live-check-academic-attendance.mjs                 (staging)
//        node scripts/live-check-academic-attendance.mjs --env=production --yes-production

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
  console.log("=== Attendance tracking (20260831000700_academic_attendance.sql) ===");
  const admin = await signIn("1nh25cs265@usn.campusos.internal", adminPassword());
  const alice = await signIn("e2e.alice@nhce.edu.in", e2ePassword("e2e.alice@nhce.edu.in"));
  const bob = await signIn("e2e.bob@nhce.edu.in", e2ePassword("e2e.bob@nhce.edu.in"));
  const carol = await signIn("e2e.carol@nhce.edu.in", e2ePassword("e2e.carol@nhce.edu.in"));

  const marker = `LiveCheckAttendance ${Date.now()}`;
  const COURSE = "B.Tech CSE";
  const YEAR = "2nd Year";
  // Yesterday, not today -- avoids colliding with any other concurrent
  // session's own run of this same script hitting the same unique
  // (course, year, section, subject, class_date) key on the same day.
  const CLASS_DATE = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const SUBJECT = marker;

  const { data: aliceBefore } = await admin.sb.from("profiles").select("role,department,course,year,campus_id").eq("id", alice.userId).single();
  const { data: bobBefore } = await admin.sb.from("profiles").select("department,course,year").eq("id", bob.userId).single();
  const { data: carolBefore } = await admin.sb.from("profiles").select("department,course,year").eq("id", carol.userId).single();

  const createdSessionIds = [];

  try {
    await alice.sb.from("profiles").update({ course: COURSE, year: YEAR }).eq("id", alice.userId);
    await bob.sb.from("profiles").update({ course: COURSE, year: YEAR }).eq("id", bob.userId);
    await carol.sb.from("profiles").update({ course: "B.Tech Mech", year: "3rd Year" }).eq("id", carol.userId);

    const { error: promoteErr } = await admin.sb.rpc("admin_set_user_role", { p_target_user: alice.userId, p_new_role: "faculty", p_reason: "live-check" });
    check("Admin can promote Alice to faculty", !promoteErr, promoteErr?.message);

    // =====================================================================
    // ROSTER
    // =====================================================================
    const { data: roster, error: rosterErr } = await alice.sb.rpc("get_class_roster", { p_course: COURSE, p_year: YEAR });
    check("Faculty can fetch her own course's roster", !rosterErr, rosterErr?.message);
    check("Roster includes Bob (same course/year)", (roster || []).some((r) => r.student_id === bob.userId), roster);
    check("Roster excludes Carol (different course)", !(roster || []).some((r) => r.student_id === carol.userId), roster);

    const { error: rosterOtherCourseErr } = await alice.sb.rpc("get_class_roster", { p_course: "B.Tech Mech" });
    check("Faculty CANNOT fetch another course's roster", !!rosterOtherCourseErr, rosterOtherCourseErr?.message);

    const { error: rosterByBobErr } = await bob.sb.rpc("get_class_roster", { p_course: COURSE });
    check("A plain student CANNOT fetch a class roster", !!rosterByBobErr, rosterByBobErr?.message);

    // =====================================================================
    // MARKING
    // =====================================================================
    const { error: markOutsideRosterErr } = await alice.sb.rpc("mark_attendance", {
      p_course: COURSE, p_subject: SUBJECT, p_class_date: CLASS_DATE, p_year: YEAR,
      p_records: [{ student_id: carol.userId, status: "present" }],
    });
    check("Faculty CANNOT mark attendance for a student outside her course's roster", !!markOutsideRosterErr, markOutsideRosterErr?.message);

    const { data: session1, error: mark1Err } = await alice.sb.rpc("mark_attendance", {
      p_course: COURSE, p_subject: SUBJECT, p_class_date: CLASS_DATE, p_year: YEAR,
      p_records: [{ student_id: bob.userId, status: "absent" }],
    });
    check("Faculty can mark attendance for her own course's roster", !mark1Err && !!session1?.id, mark1Err?.message);
    if (session1?.id) createdSessionIds.push(session1.id);

    // Re-marking the same session/date/subject should update Bob's status in
    // place, not create a second session (the unique constraint's job).
    const { data: session2, error: mark2Err } = await alice.sb.rpc("mark_attendance", {
      p_course: COURSE, p_subject: SUBJECT, p_class_date: CLASS_DATE, p_year: YEAR,
      p_records: [{ student_id: bob.userId, status: "present" }],
    });
    check("Re-marking the same class/date/subject reuses the same session (idempotent)", !mark2Err && session2?.id === session1?.id, { mark2Err: mark2Err?.message, session1: session1?.id, session2: session2?.id });

    const { error: markOtherCourseErr } = await alice.sb.rpc("mark_attendance", {
      p_course: "B.Tech Mech", p_subject: SUBJECT, p_class_date: CLASS_DATE,
      p_records: [{ student_id: carol.userId, status: "present" }],
    });
    check("Faculty CANNOT mark attendance for another course", !!markOtherCourseErr, markOtherCourseErr?.message);

    const { error: markByBobErr } = await bob.sb.rpc("mark_attendance", {
      p_course: COURSE, p_subject: SUBJECT, p_class_date: CLASS_DATE,
      p_records: [{ student_id: bob.userId, status: "present" }],
    });
    check("A plain student CANNOT mark attendance", !!markByBobErr, markByBobErr?.message);

    const { error: markFutureErr } = await alice.sb.rpc("mark_attendance", {
      p_course: COURSE, p_subject: SUBJECT, p_class_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      p_records: [{ student_id: bob.userId, status: "present" }],
    });
    check("Faculty CANNOT mark attendance for a future date", !!markFutureErr, markFutureErr?.message);

    // =====================================================================
    // SESSION HISTORY / DETAIL (faculty + admin only)
    // =====================================================================
    const { data: sessions, error: sessionsErr } = await alice.sb.rpc("list_attendance_sessions", { p_course: COURSE });
    check("Faculty sees her session in list_attendance_sessions", !sessionsErr && (sessions || []).some((s) => s.id === session1.id), sessionsErr?.message);
    const listed = (sessions || []).find((s) => s.id === session1.id);
    check("Session correctly rolls up Bob's status as present, total 1", listed?.present_count === 1 && listed?.total_count === 1, listed);

    const { data: detail, error: detailErr } = await alice.sb.rpc("get_attendance_session", { p_session_id: session1.id });
    check("Faculty can open the session's per-student detail", !detailErr && detail?.records?.length === 1 && detail.records[0].student_id === bob.userId && detail.records[0].status === "present", { detailErr: detailErr?.message, detail });

    const { error: detailByCarolErr } = await carol.sb.rpc("get_attendance_session", { p_session_id: session1.id });
    check("A faculty who didn't author the session CANNOT open its detail (Carol has no academics.publish anyway, but confirm)", !!detailByCarolErr, detailByCarolErr?.message);

    const { data: bobSessionRead } = await bob.sb.from("attendance_sessions").select("*").eq("id", session1.id);
    check("A student cannot read the session row directly (table-level RLS is author/admin-only)", (bobSessionRead || []).length === 0, bobSessionRead);

    // =====================================================================
    // STUDENT-FACING SUMMARY / RECORDS
    // =====================================================================
    const { data: bobSummary, error: bobSummaryErr } = await bob.sb.rpc("get_my_attendance_summary");
    check("Bob sees his own attendance summary", !bobSummaryErr, bobSummaryErr?.message);
    const bobRow = (bobSummary || []).find((r) => r.subject === SUBJECT);
    check("Bob's summary shows 1/1 present (100%) for this subject", bobRow?.total_sessions === 1 && bobRow?.present_count === 1 && Number(bobRow?.percentage) === 100, bobRow);

    const { data: bobRecords, error: bobRecordsErr } = await bob.sb.rpc("get_my_attendance_records", { p_subject: SUBJECT });
    check("Bob sees the individual record behind the summary", !bobRecordsErr && (bobRecords || []).length === 1 && bobRecords[0].status === "present", { bobRecordsErr: bobRecordsErr?.message, bobRecords });

    const { data: carolSummary } = await carol.sb.rpc("get_my_attendance_summary");
    check("Carol (not in this session) sees nothing for this subject", !(carolSummary || []).some((r) => r.subject === SUBJECT), carolSummary);

    const { data: carolRecordsDirect } = await carol.sb.from("attendance_records").select("*").eq("session_id", session1.id);
    check("Carol cannot read Bob's attendance_records row directly either", (carolRecordsDirect || []).length === 0, carolRecordsDirect);
  } finally {
    for (const id of createdSessionIds) await admin.sb.from("attendance_sessions").delete().eq("id", id);
    await admin.sb.rpc("admin_set_user_role", { p_target_user: alice.userId, p_new_role: aliceBefore.role, p_reason: "live-check cleanup" });
    await alice.sb.from("profiles").update({ department: aliceBefore.department, course: aliceBefore.course, year: aliceBefore.year }).eq("id", alice.userId);
    await bob.sb.from("profiles").update({ department: bobBefore.department, course: bobBefore.course, year: bobBefore.year }).eq("id", bob.userId);
    await carol.sb.from("profiles").update({ department: carolBefore.department, course: carolBefore.course, year: carolBefore.year }).eq("id", carol.userId);
    console.log("[cleanup] created session(s) removed (records cascade), Alice/Bob/Carol restored");
  }

  console.log(`\n${passCount} passed, ${failCount} failed`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Live check crashed:", err);
  process.exit(1);
});
