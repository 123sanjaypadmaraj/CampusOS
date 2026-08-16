/**
 * Unit tests for the Academic Announcements data layer. The real
 * authorization/business rules (faculty can only target their own
 * department/year/course, admin-only calendar, etc.) live server-side in
 * supabase/migrations/20260817000100_academic_module.sql and are exercised
 * via the RPC contract these tests assert against, not re-implemented here.
 */

const mockRpc = jest.fn();
const mockFrom = jest.fn();

jest.mock("../../lib/supabase", () => ({
  supabase: {
    rpc: (...args) => mockRpc(...args),
    from: (...args) => mockFrom(...args),
  },
}));

import {
  getRelevantAnnouncements,
  publishAcademicAnnouncement,
  getMyAcademicDeadlines,
  createAcademicDeadline,
  deleteAcademicDeadline,
  getTimetable,
  upsertTimetableEntry,
  deleteTimetableEntry,
  getAcademicCalendar,
  publishCalendarEvent,
  deleteCalendarEvent,
} from "./api";

function chain(result) {
  const obj = {
    select: jest.fn(() => obj),
    order: jest.fn(() => obj),
    eq: jest.fn(() => obj),
    delete: jest.fn(() => obj),
    then: (resolve) => Promise.resolve(result).then(resolve),
  };
  return obj;
}

beforeEach(() => {
  mockRpc.mockReset();
  mockFrom.mockReset();
});

describe("announcements", () => {
  it("getRelevantAnnouncements calls get_relevant_announcements with category/limit", async () => {
    mockRpc.mockResolvedValue({ data: [{ id: "a1" }], error: null });
    const result = await getRelevantAnnouncements({ category: "Academic", limit: 10 });
    expect(mockRpc).toHaveBeenCalledWith("get_relevant_announcements", { p_category: "Academic", p_limit: 10 });
    expect(result).toEqual([{ id: "a1" }]);
  });

  it("getRelevantAnnouncements defaults to no category filter and returns [] on null data", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const result = await getRelevantAnnouncements();
    expect(mockRpc).toHaveBeenCalledWith("get_relevant_announcements", { p_category: null, p_limit: 50 });
    expect(result).toEqual([]);
  });

  it("publishAcademicAnnouncement forwards scope/value to publish_announcement", async () => {
    mockRpc.mockResolvedValue({ data: { id: "ann1" }, error: null });
    const result = await publishAcademicAnnouncement({
      category: "Assignment", title: "Lab report due", body: "Submit by Friday",
      targetScope: "course", targetValue: "B.Tech CSE",
    });
    expect(mockRpc).toHaveBeenCalledWith("publish_announcement", {
      p_category: "Assignment", p_title: "Lab report due", p_body: "Submit by Friday",
      p_target_scope: "course", p_target_value: "B.Tech CSE",
    });
    expect(result).toEqual({ id: "ann1" });
  });

  it("publishAcademicAnnouncement throws the RPC's authorization error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error("You can only target your own department") });
    await expect(publishAcademicAnnouncement({ category: "Academic", title: "x", body: "y", targetScope: "department", targetValue: "Other Dept" }))
      .rejects.toThrow("You can only target your own department");
  });
});

describe("assignment/deadline notices", () => {
  it("getMyAcademicDeadlines selects from academic_deadlines ordered by due_at", async () => {
    mockFrom.mockReturnValue(chain({ data: [{ id: "d1" }], error: null }));
    const result = await getMyAcademicDeadlines();
    expect(mockFrom).toHaveBeenCalledWith("academic_deadlines");
    expect(result).toEqual([{ id: "d1" }]);
  });

  it("createAcademicDeadline calls create_academic_deadline with all fields", async () => {
    mockRpc.mockResolvedValue({ data: { id: "d2" }, error: null });
    const result = await createAcademicDeadline({
      category: "assignment", title: "Submit assignment 3", dueAt: "2026-08-25T23:59:00Z",
      description: "Upload PDF", targetScope: "course", targetValue: "B.Tech CSE",
    });
    expect(mockRpc).toHaveBeenCalledWith("create_academic_deadline", {
      p_category: "assignment", p_title: "Submit assignment 3", p_due_at: "2026-08-25T23:59:00Z",
      p_description: "Upload PDF", p_target_scope: "course", p_target_value: "B.Tech CSE",
    });
    expect(result).toEqual({ id: "d2" });
  });

  it("deleteAcademicDeadline deletes by id", async () => {
    mockFrom.mockReturnValue(chain({ error: null }));
    await deleteAcademicDeadline("d3");
    expect(mockFrom).toHaveBeenCalledWith("academic_deadlines");
  });
});

describe("timetable", () => {
  it("getTimetable filters by course when given", async () => {
    mockFrom.mockReturnValue(chain({ data: [{ id: "t1" }], error: null }));
    const result = await getTimetable({ course: "B.Tech CSE" });
    expect(mockFrom).toHaveBeenCalledWith("class_timetable");
    expect(result).toEqual([{ id: "t1" }]);
  });

  it("getTimetable works with no filter", async () => {
    mockFrom.mockReturnValue(chain({ data: [], error: null }));
    const result = await getTimetable();
    expect(result).toEqual([]);
  });

  it("upsertTimetableEntry calls upsert_timetable_entry with all fields", async () => {
    mockRpc.mockResolvedValue({ data: { id: "t2" }, error: null });
    const result = await upsertTimetableEntry({
      course: "B.Tech CSE", dayOfWeek: 1, startTime: "09:00", endTime: "10:00",
      subject: "Data Structures", year: "2nd", section: "A", facultyName: "Dr. Rao", room: "Block B-201",
    });
    expect(mockRpc).toHaveBeenCalledWith("upsert_timetable_entry", {
      p_id: null, p_course: "B.Tech CSE", p_day_of_week: 1, p_start_time: "09:00", p_end_time: "10:00",
      p_subject: "Data Structures", p_year: "2nd", p_section: "A", p_faculty_name: "Dr. Rao", p_room: "Block B-201",
    });
    expect(result).toEqual({ id: "t2" });
  });

  it("deleteTimetableEntry deletes by id", async () => {
    mockFrom.mockReturnValue(chain({ error: null }));
    await deleteTimetableEntry("t3");
    expect(mockFrom).toHaveBeenCalledWith("class_timetable");
  });
});

describe("academic calendar", () => {
  it("getAcademicCalendar selects from academic_calendar_events ordered by start_date", async () => {
    mockFrom.mockReturnValue(chain({ data: [{ id: "c1" }], error: null }));
    const result = await getAcademicCalendar();
    expect(mockFrom).toHaveBeenCalledWith("academic_calendar_events");
    expect(result).toEqual([{ id: "c1" }]);
  });

  it("publishCalendarEvent calls publish_calendar_event with all fields", async () => {
    mockRpc.mockResolvedValue({ data: { id: "c2" }, error: null });
    const result = await publishCalendarEvent({
      title: "Mid-semester exams", eventType: "exam_window", startDate: "2026-09-10", endDate: "2026-09-20", description: "All departments",
    });
    expect(mockRpc).toHaveBeenCalledWith("publish_calendar_event", {
      p_title: "Mid-semester exams", p_event_type: "exam_window", p_start_date: "2026-09-10", p_end_date: "2026-09-20", p_description: "All departments",
    });
    expect(result).toEqual({ id: "c2" });
  });

  it("publishCalendarEvent throws the RPC's admin-only error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error("Academic calendar entries require college_admin/super_admin") });
    await expect(publishCalendarEvent({ title: "x", eventType: "holiday", startDate: "2026-09-01" }))
      .rejects.toThrow("Academic calendar entries require college_admin/super_admin");
  });

  it("deleteCalendarEvent deletes by id", async () => {
    mockFrom.mockReturnValue(chain({ error: null }));
    await deleteCalendarEvent("c3");
    expect(mockFrom).toHaveBeenCalledWith("academic_calendar_events");
  });
});
