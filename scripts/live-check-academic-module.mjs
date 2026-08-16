// One-off live verification script (not part of the automated suite) --
// exercises the Academic Announcements module (doc §109-112, migration
// supabase/migrations/20260817000300_academic_module.sql: faculty role,
// student-facing announcement feed, assignment/deadline notices, timetable,
// academic calendar) directly against a real Supabase project using real
// signed-in sessions. Prints PASS/FAIL per assertion.
//
// Temporarily promotes e2e.alice to 'faculty' and edits her/bob/carol's
// department/course/year to deterministic values for the duration of the
// run -- these are shared long-lived test accounts other live-check scripts
// also use, so every mutated field is captured up front and restored in a
// `finally` block regardless of pass/fail.
//
// Usage: node scripts/live-check-academic-module.mjs                 (staging)
//        node scripts/live-check-academic-module.mjs --env=production --yes-production

import { createClient } from "@supabase/supabase-js";
import { resolveTarget } from "./env-target.mjs";

const { SUPABASE_URL, ANON_KEY } = resolveTarget();

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
  console.log("=== Academic Announcements (doc §109-112) ===");
  const admin = await signIn("1nh25cs265@usn.campusos.internal", "Sanjay@123");
  const alice = await signIn("e2e.alice@nhce.edu.in", "TestPass!2026Alice");
  const bob = await signIn("e2e.bob@nhce.edu.in", "TestPass!2026Bob");
  const carol = await signIn("e2e.carol@nhce.edu.in", "TestPass!2026Carol");

  const marker = `LiveCheckAcademic ${Date.now()}`;
  const DEPT = "Computer Science";
  const COURSE = "B.Tech CSE";
  const YEAR = "2nd Year";
  const OTHER_DEPT = "Mechanical Engineering";

  // --- Capture original state for full restoration in `finally` ---
  const { data: aliceBefore } = await admin.sb.from("profiles").select("role,department,course,year,campus_id").eq("id", alice.userId).single();
  const { data: bobBefore } = await admin.sb.from("profiles").select("department,course,year").eq("id", bob.userId).single();
  const { data: carolBefore } = await admin.sb.from("profiles").select("department,course,year").eq("id", carol.userId).single();
  const campusId = aliceBefore.campus_id;

  const createdAnnouncementIds = [];
  const createdDeadlineIds = [];
  const createdTimetableIds = [];
  const createdCalendarIds = [];

  try {
    // --- Set deterministic department/course/year: Alice+Bob same, Carol different ---
    await alice.sb.from("profiles").update({ department: DEPT, course: COURSE, year: YEAR }).eq("id", alice.userId);
    await bob.sb.from("profiles").update({ department: DEPT, course: COURSE, year: YEAR }).eq("id", bob.userId);
    await carol.sb.from("profiles").update({ department: OTHER_DEPT, course: "B.Tech Mech", year: "3rd Year" }).eq("id", carol.userId);

    // --- Promote Alice to faculty ---
    const { error: promoteErr } = await admin.sb.rpc("admin_set_user_role", { p_target_user: alice.userId, p_new_role: "faculty", p_reason: "live-check" });
    check("Admin can promote Alice to faculty", !promoteErr, promoteErr?.message);
    const { data: aliceAfterPromote } = await admin.sb.from("profiles").select("role").eq("id", alice.userId).single();
    check("Alice's role is now 'faculty'", aliceAfterPromote?.role === "faculty", aliceAfterPromote);

    // =====================================================================
    // ANNOUNCEMENTS
    // =====================================================================
    const { data: ann1, error: ann1Err } = await alice.sb.rpc("publish_announcement", {
      p_category: "Academic", p_title: `${marker} dept`, p_body: "Body", p_target_scope: "department", p_target_value: DEPT,
    });
    check("Faculty can publish an Academic announcement to her own department", !ann1Err && !!ann1?.id, ann1Err?.message);
    if (ann1?.id) createdAnnouncementIds.push(ann1.id);

    const { error: annOtherDeptErr } = await alice.sb.rpc("publish_announcement", {
      p_category: "Academic", p_title: `${marker} other-dept`, p_body: "Body", p_target_scope: "department", p_target_value: OTHER_DEPT,
    });
    check("Faculty CANNOT target another department", !!annOtherDeptErr, annOtherDeptErr?.message);

    const { error: annEveryoneErr } = await alice.sb.rpc("publish_announcement", {
      p_category: "Academic", p_title: `${marker} everyone`, p_body: "Body", p_target_scope: "everyone",
    });
    check("Faculty CANNOT publish a campus-wide ('everyone') announcement", !!annEveryoneErr, annEveryoneErr?.message);

    const { error: annHolidayErr } = await alice.sb.rpc("publish_announcement", {
      p_category: "Holiday", p_title: `${marker} holiday`, p_body: "Body", p_target_scope: "department", p_target_value: DEPT,
    });
    check("Faculty CANNOT publish a non-Academic/Exam/Assignment category", !!annHolidayErr, annHolidayErr?.message);

    const { error: annByBobErr } = await bob.sb.rpc("publish_announcement", {
      p_category: "Academic", p_title: `${marker} by-bob`, p_body: "Body", p_target_scope: "department", p_target_value: DEPT,
    });
    check("A plain student CANNOT publish an announcement", !!annByBobErr, annByBobErr?.message);

    const { data: bobFeed, error: bobFeedErr } = await bob.sb.rpc("get_relevant_announcements", { p_category: null, p_limit: 50 });
    check("Bob (same department) sees Alice's announcement in his relevant feed", !bobFeedErr && (bobFeed || []).some((a) => a.id === ann1.id), bobFeedErr?.message);

    const { data: carolFeed, error: carolFeedErr } = await carol.sb.rpc("get_relevant_announcements", { p_category: null, p_limit: 50 });
    check("Carol (different department) does NOT see Alice's announcement", !carolFeedErr && !(carolFeed || []).some((a) => a.id === ann1.id), carolFeedErr?.message);

    // =====================================================================
    // ASSIGNMENT / DEADLINE NOTICES
    // =====================================================================
    const dueAt = new Date(Date.now() + 7 * 86400000).toISOString();
    const { data: deadline1, error: deadline1Err } = await alice.sb.rpc("create_academic_deadline", {
      p_category: "assignment", p_title: `${marker} assignment`, p_due_at: dueAt, p_description: "Submit online",
      p_target_scope: "course", p_target_value: COURSE,
    });
    check("Faculty can post an assignment notice to her own course", !deadline1Err && !!deadline1?.id, deadline1Err?.message);
    if (deadline1?.id) createdDeadlineIds.push(deadline1.id);

    const { error: deadlineOtherCourseErr } = await alice.sb.rpc("create_academic_deadline", {
      p_category: "assignment", p_title: `${marker} other-course`, p_due_at: dueAt, p_target_scope: "course", p_target_value: "B.Tech Mech",
    });
    check("Faculty CANNOT target a deadline notice at another course", !!deadlineOtherCourseErr, deadlineOtherCourseErr?.message);

    const { error: deadlineByBobErr } = await bob.sb.rpc("create_academic_deadline", {
      p_category: "assignment", p_title: `${marker} by-bob`, p_due_at: dueAt, p_target_scope: "course", p_target_value: COURSE,
    });
    check("A plain student CANNOT post an assignment/deadline notice", !!deadlineByBobErr, deadlineByBobErr?.message);

    const { data: bobDeadlines } = await bob.sb.from("academic_deadlines").select("*").eq("id", deadline1.id);
    check("Bob (same course) can read the deadline via plain RLS-scoped select", (bobDeadlines || []).length === 1, bobDeadlines);

    const { data: carolDeadlines } = await carol.sb.from("academic_deadlines").select("*").eq("id", deadline1.id);
    check("Carol (different course) CANNOT read the deadline", (carolDeadlines || []).length === 0, carolDeadlines);

    const { data: bobDeleteAttempt } = await bob.sb.from("academic_deadlines").delete().eq("id", deadline1.id).select();
    check("Bob (not the author) cannot delete Alice's deadline notice", (bobDeleteAttempt || []).length === 0, bobDeleteAttempt);

    // =====================================================================
    // TIMETABLE
    // =====================================================================
    const { data: tt1, error: tt1Err } = await alice.sb.rpc("upsert_timetable_entry", {
      p_id: null, p_course: COURSE, p_day_of_week: 1, p_start_time: "09:00", p_end_time: "10:00", p_subject: `${marker} Data Structures`,
      p_year: YEAR, p_section: null, p_faculty_name: "Alice", p_room: "B-201",
    });
    check("Faculty can add a timetable entry for her own course", !tt1Err && !!tt1?.id, tt1Err?.message);
    if (tt1?.id) createdTimetableIds.push(tt1.id);

    const { error: ttOtherCourseErr } = await alice.sb.rpc("upsert_timetable_entry", {
      p_id: null, p_course: "B.Tech Mech", p_day_of_week: 1, p_start_time: "09:00", p_end_time: "10:00", p_subject: "x",
    });
    check("Faculty CANNOT add a timetable entry for another course", !!ttOtherCourseErr, ttOtherCourseErr?.message);

    const { error: ttByBobErr } = await bob.sb.rpc("upsert_timetable_entry", {
      p_id: null, p_course: COURSE, p_day_of_week: 1, p_start_time: "09:00", p_end_time: "10:00", p_subject: "x",
    });
    check("A plain student CANNOT edit the timetable", !!ttByBobErr, ttByBobErr?.message);

    const { data: carolTimetableRead } = await carol.sb.from("class_timetable").select("*").eq("id", tt1.id);
    check("Timetable read is campus-wide -- Carol (different course) can still see it", (carolTimetableRead || []).length === 1, carolTimetableRead);

    // =====================================================================
    // ACADEMIC CALENDAR (admin-only write, campus-wide read)
    // =====================================================================
    const { error: calByFacultyErr } = await alice.sb.rpc("publish_calendar_event", {
      p_title: `${marker} exams`, p_event_type: "exam_window", p_start_date: "2026-09-10",
    });
    check("Faculty (non-admin) CANNOT publish an academic calendar entry", !!calByFacultyErr, calByFacultyErr?.message);

    const { data: cal1, error: cal1Err } = await admin.sb.rpc("publish_calendar_event", {
      p_title: `${marker} exams`, p_event_type: "exam_window", p_start_date: "2026-09-10", p_end_date: "2026-09-20",
    });
    check("Admin can publish an academic calendar entry", !cal1Err && !!cal1?.id, cal1Err?.message);
    if (cal1?.id) createdCalendarIds.push(cal1.id);

    const { data: bobCalendarRead } = await bob.sb.from("academic_calendar_events").select("*").eq("id", cal1.id);
    check("Any student can read the academic calendar", (bobCalendarRead || []).length === 1, bobCalendarRead);
  } finally {
    // --- Cleanup: created rows first (admin bypasses RLS) ---
    for (const id of createdAnnouncementIds) await admin.sb.from("announcements").delete().eq("id", id);
    for (const id of createdDeadlineIds) await admin.sb.from("academic_deadlines").delete().eq("id", id);
    for (const id of createdTimetableIds) await admin.sb.from("class_timetable").delete().eq("id", id);
    for (const id of createdCalendarIds) await admin.sb.from("academic_calendar_events").delete().eq("id", id);

    // --- Restore shared test accounts to their original state. Admin has no
    // general profile-UPDATE RLS bypass (only profiles_update_self exists),
    // so department/course/year must be restored via each account's own
    // session -- only the role change goes through admin (it's RPC-gated,
    // not RLS-gated, and self-role-change is intentionally never allowed).
    await admin.sb.rpc("admin_set_user_role", { p_target_user: alice.userId, p_new_role: aliceBefore.role, p_reason: "live-check cleanup" });
    await alice.sb.from("profiles").update({ department: aliceBefore.department, course: aliceBefore.course, year: aliceBefore.year }).eq("id", alice.userId);
    await bob.sb.from("profiles").update({ department: bobBefore.department, course: bobBefore.course, year: bobBefore.year }).eq("id", bob.userId);
    await carol.sb.from("profiles").update({ department: carolBefore.department, course: carolBefore.course, year: carolBefore.year }).eq("id", carol.userId);
    console.log("[cleanup] created rows removed, Alice/Bob/Carol restored to their original role/department/course/year");
  }

  console.log(`\n${passCount} passed, ${failCount} failed`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Live check crashed:", err);
  process.exit(1);
});
