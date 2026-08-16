// Academic Announcements data layer (doc §109-112 -- department/faculty
// announcements, exam/assignment notices, timetable, academic calendar,
// deadlines, course/year/department targeting). See
// supabase/migrations/20260817000100_academic_module.sql for the schema/RPCs
// and the "why" behind each read/write path.
//
// Reads: academic_deadlines/class_timetable/academic_calendar_events are
// plain RLS-scoped selects (RLS itself does the relevance filtering, same
// pattern as remindersService.js). announcements' base RLS policy is
// intentionally left wide open (shared with admin CMS/global search), so its
// read goes through get_relevant_announcements() instead -- a real
// server-side "what's relevant to me" filter rather than a client-side one.
//
// Writes: every insert goes through a security-definer RPC so the
// faculty-can-only-target-their-own-department/year/course rule can't be
// bypassed by a raw PostgREST insert.

import { supabase } from "../../lib/supabase";

function throwIfError(error) {
  if (error) throw error;
}

/* ========================================================================
   ANNOUNCEMENTS (student-facing feed)
======================================================================== */

export async function getRelevantAnnouncements({ category = null, limit = 50 } = {}) {
  const { data, error } = await supabase.rpc("get_relevant_announcements", {
    p_category: category,
    p_limit: limit,
  });
  throwIfError(error);
  return data || [];
}

export async function publishAcademicAnnouncement({ category, title, body, targetScope, targetValue }) {
  const { data, error } = await supabase.rpc("publish_announcement", {
    p_category: category,
    p_title: title,
    p_body: body,
    p_target_scope: targetScope,
    p_target_value: targetValue,
  });
  throwIfError(error);
  return data;
}

/* ========================================================================
   ASSIGNMENT / DEADLINE NOTICES
======================================================================== */

export async function getMyAcademicDeadlines() {
  const { data, error } = await supabase
    .from("academic_deadlines")
    .select("*")
    .order("due_at", { ascending: true });
  throwIfError(error);
  return data || [];
}

export async function createAcademicDeadline({ category, title, dueAt, description = null, targetScope = "everyone", targetValue = null }) {
  const { data, error } = await supabase.rpc("create_academic_deadline", {
    p_category: category,
    p_title: title,
    p_due_at: dueAt,
    p_description: description,
    p_target_scope: targetScope,
    p_target_value: targetValue,
  });
  throwIfError(error);
  return data;
}

export async function deleteAcademicDeadline(id) {
  const { error } = await supabase.from("academic_deadlines").delete().eq("id", id);
  throwIfError(error);
}

/* ========================================================================
   CLASS TIMETABLE
======================================================================== */

export async function getTimetable({ course } = {}) {
  let query = supabase.from("class_timetable").select("*").order("day_of_week").order("start_time");
  if (course) query = query.eq("course", course);
  const { data, error } = await query;
  throwIfError(error);
  return data || [];
}

export async function upsertTimetableEntry({ id = null, course, dayOfWeek, startTime, endTime, subject, year = null, section = null, facultyName = null, room = null }) {
  const { data, error } = await supabase.rpc("upsert_timetable_entry", {
    p_id: id,
    p_course: course,
    p_day_of_week: dayOfWeek,
    p_start_time: startTime,
    p_end_time: endTime,
    p_subject: subject,
    p_year: year,
    p_section: section,
    p_faculty_name: facultyName,
    p_room: room,
  });
  throwIfError(error);
  return data;
}

export async function deleteTimetableEntry(id) {
  const { error } = await supabase.from("class_timetable").delete().eq("id", id);
  throwIfError(error);
}

/* ========================================================================
   ACADEMIC CALENDAR
======================================================================== */

export async function getAcademicCalendar() {
  const { data, error } = await supabase
    .from("academic_calendar_events")
    .select("*")
    .order("start_date", { ascending: true });
  throwIfError(error);
  return data || [];
}

export async function publishCalendarEvent({ title, eventType, startDate, endDate = null, description = null }) {
  const { data, error } = await supabase.rpc("publish_calendar_event", {
    p_title: title,
    p_event_type: eventType,
    p_start_date: startDate,
    p_end_date: endDate,
    p_description: description,
  });
  throwIfError(error);
  return data;
}

export async function deleteCalendarEvent(id) {
  const { error } = await supabase.from("academic_calendar_events").delete().eq("id", id);
  throwIfError(error);
}
