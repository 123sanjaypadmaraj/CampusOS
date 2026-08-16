// Academic Announcements + integration (doc §109-112): a student-facing
// feed of what's relevant to them (Academic/Exam/Assignment announcements,
// assignment/deadline notices, class timetable, academic calendar), plus a
// compose surface for faculty (their own department/year/course only) and
// admin (calendar, and anything faculty can do). See
// supabase/migrations/20260817000100_academic_module.sql for the
// authorization rules this UI is just a thin client for -- every write is
// re-validated server-side regardless of what this form lets you pick.
import { useEffect, useState } from "react";
import {
  HiXMark, HiPlus, HiTrash, HiMegaphone, HiClock, HiCalendarDays,
  HiAcademicCap, HiBellAlert,
} from "react-icons/hi2";
import { LoadingState, EmptyState, ErrorState } from "../../components/ui/States";
import { createReminder } from "../../services/remindersService";
import * as academicsApi from "./api";

function Modal({ title, kicker, onClose, children }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="feature-modal" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}><HiXMark /></button>
        {kicker && <span className="section-kicker">{kicker}</span>}
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const CALENDAR_TYPE_LABEL = {
  exam_window: "Exam window", holiday: "Holiday", deadline: "Deadline",
  semester_start: "Semester start", semester_end: "Semester end", other: "Other",
};

function fmtDateTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
function fmtDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" });
}
function fmtTime(value) {
  if (!value) return "";
  const [h, m] = value.split(":");
  const d = new Date();
  d.setHours(Number(h), Number(m));
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

const TABS = [
  ["announcements", "Announcements", <HiMegaphone key="i" />],
  ["deadlines", "Assignments & Deadlines", <HiClock key="i" />],
  ["timetable", "Timetable", <HiAcademicCap key="i" />],
  ["calendar", "Academic Calendar", <HiCalendarDays key="i" />],
];

export default function AcademicHub({ profile, notify }) {
  const [tab, setTab] = useState("announcements");
  const canFacultyCompose = profile?.role === "faculty" || profile?.role === "college_admin" || profile?.role === "super_admin";
  const isAdmin = profile?.role === "college_admin" || profile?.role === "super_admin";

  return (
    <section className="admin-panel">
      <div className="chips" style={{ marginBottom: 24, flexWrap: "wrap" }}>
        {TABS.map(([key, label, icon]) => (
          <button key={key} className={tab === key ? "chip active" : "chip"} onClick={() => setTab(key)}>
            {icon} {label}
          </button>
        ))}
      </div>

      {tab === "announcements" && (
        <AnnouncementsPanel profile={profile} notify={notify} canCompose={profile?.role === "faculty"} />
      )}
      {tab === "deadlines" && (
        <DeadlinesPanel profile={profile} notify={notify} canCompose={canFacultyCompose} />
      )}
      {tab === "timetable" && (
        <TimetablePanel profile={profile} notify={notify} canCompose={canFacultyCompose} />
      )}
      {tab === "calendar" && (
        <CalendarPanel profile={profile} notify={notify} canCompose={isAdmin} />
      )}
    </section>
  );
}

/* ========================================================================
   ANNOUNCEMENTS
======================================================================== */

const ANNOUNCEMENT_CATEGORIES = ["Academic", "Exam", "Assignment"];

function AnnouncementsPanel({ profile, notify, canCompose }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      setItems(await academicsApi.getRelevantAnnouncements());
    } catch (err) {
      setError(err.message || "Could not load announcements");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, []);

  if (loading) return <LoadingState label="Loading announcements…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Announcements</h2>
          <p>Academic, exam and assignment announcements for your department, year and course.</p>
        </div>
        {canCompose && (
          <button className="primary" onClick={() => setCreating(true)}><HiPlus /> New announcement</button>
        )}
      </div>

      <div className="resource-list">
        {items.length === 0 && <EmptyState icon={<HiMegaphone />} title="No announcements yet" text="Nothing relevant to you has been posted." />}
        {items.map((a) => (
          <article className="resource-row" key={a.id}>
            <div className="resource-icon"><HiMegaphone /></div>
            <div>
              <b>{a.title}</b>
              <p>{a.body}</p>
              <small>{a.category} · {a.target_scope === "everyone" ? "Everyone" : `${a.target_scope}: ${a.target_value}`} · {fmtDateTime(a.published_at)}</small>
            </div>
          </article>
        ))}
      </div>

      {creating && (
        <AnnouncementForm
          profile={profile}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); notify("Announcement published"); reload(); }}
          notify={notify}
        />
      )}
    </div>
  );
}

function AnnouncementForm({ profile, onClose, onSaved, notify }) {
  const [category, setCategory] = useState("Academic");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [scope, setScope] = useState("department");
  const [saving, setSaving] = useState(false);

  const scopeValue = { department: profile?.department, year: profile?.year, course: profile?.course }[scope];

  return (
    <Modal kicker="ANNOUNCEMENTS" title="New academic announcement" onClose={onClose}>
      <label>Category
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {ANNOUNCEMENT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </label>
      <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Assignment 3 released" /></label>
      <label>Details<textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} /></label>
      <label>Audience
        <select value={scope} onChange={(e) => setScope(e.target.value)}>
          {profile?.department && <option value="department">My department ({profile.department})</option>}
          {profile?.year && <option value="year">My year ({profile.year})</option>}
          {profile?.course && <option value="course">My course ({profile.course})</option>}
        </select>
      </label>
      <small>You can only post to your own department, year or course.</small>
      <button
        className="primary wide"
        disabled={saving || !title.trim() || !body.trim() || !scopeValue}
        onClick={async () => {
          setSaving(true);
          try {
            await academicsApi.publishAcademicAnnouncement({ category, title, body, targetScope: scope, targetValue: scopeValue });
            onSaved();
          } catch (err) { notify(err.message || "Could not publish announcement"); }
          setSaving(false);
        }}
      >
        {saving ? "Publishing…" : "Publish announcement"}
      </button>
    </Modal>
  );
}

/* ========================================================================
   ASSIGNMENTS & DEADLINES
======================================================================== */

const DEADLINE_CATEGORIES = ["assignment", "exam", "deadline", "other"];

function DeadlinesPanel({ profile, notify, canCompose }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      setItems(await academicsApi.getMyAcademicDeadlines());
    } catch (err) {
      setError(err.message || "Could not load deadlines");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, []);

  if (loading) return <LoadingState label="Loading deadlines…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Assignments &amp; Deadlines</h2>
          <p>Assignments, exams and other deadlines for your department, year and course.</p>
        </div>
        {canCompose && (
          <button className="primary" onClick={() => setCreating(true)}><HiPlus /> New notice</button>
        )}
      </div>

      <div className="resource-list">
        {items.length === 0 && <EmptyState icon={<HiClock />} title="Nothing due" text="No upcoming assignments or deadlines." />}
        {items.map((d) => (
          <article className="resource-row" key={d.id}>
            <div className="resource-icon"><HiClock /></div>
            <div>
              <b>{d.title}</b>
              {d.description && <p>{d.description}</p>}
              <small>{d.category} · Due {fmtDateTime(d.due_at)}</small>
            </div>
            <button
              onClick={async () => {
                try {
                  await createReminder({ title: `Due: ${d.title}`, remindAt: d.due_at, notes: d.description || "" });
                  notify("Reminder set");
                } catch (err) { notify(err.message || "Could not set reminder"); }
              }}
            >
              <HiBellAlert /> Remind me
            </button>
            {(d.author_id === profile?.id || canCompose) && (
              <button
                onClick={async () => {
                  if (!window.confirm(`Delete "${d.title}"?`)) return;
                  try { await academicsApi.deleteAcademicDeadline(d.id); notify("Deleted"); reload(); }
                  catch (err) { notify(err.message || "Could not delete"); }
                }}
              >
                <HiTrash /> Delete
              </button>
            )}
          </article>
        ))}
      </div>

      {creating && (
        <DeadlineForm
          profile={profile}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); notify("Notice posted"); reload(); }}
          notify={notify}
        />
      )}
    </div>
  );
}

function DeadlineForm({ profile, onClose, onSaved, notify }) {
  const isAdmin = profile?.role === "college_admin" || profile?.role === "super_admin";
  const [category, setCategory] = useState("assignment");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [scope, setScope] = useState(isAdmin ? "everyone" : "department");
  const [saving, setSaving] = useState(false);

  const scopeValue = scope === "everyone" ? null : { department: profile?.department, year: profile?.year, course: profile?.course }[scope];

  return (
    <Modal kicker="ASSIGNMENTS & DEADLINES" title="New assignment/deadline notice" onClose={onClose}>
      <label>Category
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {DEADLINE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </label>
      <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Submit lab report" /></label>
      <label>Details<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} /></label>
      <label>Due<input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} /></label>
      <label>Audience
        <select value={scope} onChange={(e) => setScope(e.target.value)}>
          {isAdmin && <option value="everyone">Everyone</option>}
          {profile?.department && <option value="department">My department ({profile.department})</option>}
          {profile?.year && <option value="year">My year ({profile.year})</option>}
          {profile?.course && <option value="course">My course ({profile.course})</option>}
        </select>
      </label>
      <button
        className="primary wide"
        disabled={saving || !title.trim() || !dueAt}
        onClick={async () => {
          setSaving(true);
          try {
            await academicsApi.createAcademicDeadline({
              category, title, dueAt: new Date(dueAt).toISOString(), description, targetScope: scope, targetValue: scopeValue,
            });
            onSaved();
          } catch (err) { notify(err.message || "Could not post notice"); }
          setSaving(false);
        }}
      >
        {saving ? "Posting…" : "Post notice"}
      </button>
    </Modal>
  );
}

/* ========================================================================
   TIMETABLE
======================================================================== */

function TimetablePanel({ profile, notify, canCompose }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [courseFilter, setCourseFilter] = useState(profile?.course || "");

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      setItems(await academicsApi.getTimetable({ course: courseFilter || undefined }));
    } catch (err) {
      setError(err.message || "Could not load the timetable");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, [courseFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <LoadingState label="Loading timetable…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  const byDay = DAY_LABELS.map((label, idx) => ({ label, idx, entries: items.filter((t) => t.day_of_week === idx) }));

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Timetable</h2>
          <label>Course<input value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)} placeholder="e.g. B.Tech CSE" /></label>
        </div>
        {canCompose && (
          <button className="primary" onClick={() => setCreating(true)}><HiPlus /> New class</button>
        )}
      </div>

      <div className="resource-list">
        {items.length === 0 && <EmptyState icon={<HiAcademicCap />} title="No timetable entries" text="Nothing scheduled for this course yet." />}
        {byDay.filter((d) => d.entries.length > 0).map((d) => (
          <div key={d.idx}>
            <span className="section-kicker">{d.label.toUpperCase()}</span>
            {d.entries.map((t) => (
              <article className="resource-row" key={t.id}>
                <div className="resource-icon"><HiAcademicCap /></div>
                <div>
                  <b>{t.subject}</b>
                  <small>{fmtTime(t.start_time)}–{fmtTime(t.end_time)} · {t.course}{t.section ? ` (${t.section})` : ""}{t.room ? ` · ${t.room}` : ""}{t.faculty_name ? ` · ${t.faculty_name}` : ""}</small>
                </div>
                {(t.author_id === profile?.id || canCompose) && (
                  <button
                    onClick={async () => {
                      if (!window.confirm(`Remove "${t.subject}"?`)) return;
                      try { await academicsApi.deleteTimetableEntry(t.id); notify("Removed"); reload(); }
                      catch (err) { notify(err.message || "Could not remove"); }
                    }}
                  >
                    <HiTrash /> Remove
                  </button>
                )}
              </article>
            ))}
          </div>
        ))}
      </div>

      {creating && (
        <TimetableForm
          profile={profile}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); notify("Class added"); reload(); }}
          notify={notify}
        />
      )}
    </div>
  );
}

function TimetableForm({ profile, onClose, onSaved, notify }) {
  const isAdmin = profile?.role === "college_admin" || profile?.role === "super_admin";
  const [course, setCourse] = useState(isAdmin ? "" : (profile?.course || ""));
  const [year, setYear] = useState(profile?.year || "");
  const [section, setSection] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [subject, setSubject] = useState("");
  const [room, setRoom] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <Modal kicker="TIMETABLE" title="New class" onClose={onClose}>
      <label>Course<input value={course} onChange={(e) => setCourse(e.target.value)} placeholder="e.g. B.Tech CSE" disabled={!isAdmin} /></label>
      <label>Subject<input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Data Structures" /></label>
      <label>Day
        <select value={dayOfWeek} onChange={(e) => setDayOfWeek(Number(e.target.value))}>
          {DAY_LABELS.map((d, idx) => <option key={d} value={idx}>{d}</option>)}
        </select>
      </label>
      <label>Start<input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></label>
      <label>End<input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></label>
      <label>Year (optional)<input value={year} onChange={(e) => setYear(e.target.value)} /></label>
      <label>Section (optional)<input value={section} onChange={(e) => setSection(e.target.value)} /></label>
      <label>Room (optional)<input value={room} onChange={(e) => setRoom(e.target.value)} /></label>
      <button
        className="primary wide"
        disabled={saving || !course.trim() || !subject.trim()}
        onClick={async () => {
          setSaving(true);
          try {
            await academicsApi.upsertTimetableEntry({
              course, dayOfWeek, startTime, endTime, subject,
              year: year || null, section: section || null, facultyName: profile?.name || null, room: room || null,
            });
            onSaved();
          } catch (err) { notify(err.message || "Could not add class"); }
          setSaving(false);
        }}
      >
        {saving ? "Saving…" : "Add class"}
      </button>
    </Modal>
  );
}

/* ========================================================================
   ACADEMIC CALENDAR
======================================================================== */

const CALENDAR_TYPES = ["exam_window", "holiday", "deadline", "semester_start", "semester_end", "other"];

function CalendarPanel({ notify, canCompose }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      setItems(await academicsApi.getAcademicCalendar());
    } catch (err) {
      setError(err.message || "Could not load the academic calendar");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, []);

  if (loading) return <LoadingState label="Loading the academic calendar…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Academic Calendar</h2>
          <p>Exam windows, holidays and semester dates for the whole campus.</p>
        </div>
        {canCompose && (
          <button className="primary" onClick={() => setCreating(true)}><HiPlus /> New entry</button>
        )}
      </div>

      <div className="resource-list">
        {items.length === 0 && <EmptyState icon={<HiCalendarDays />} title="Nothing on the calendar yet" />}
        {items.map((c) => (
          <article className="resource-row" key={c.id}>
            <div className="resource-icon"><HiCalendarDays /></div>
            <div>
              <b>{c.title}</b>
              {c.description && <p>{c.description}</p>}
              <small>{CALENDAR_TYPE_LABEL[c.event_type] || c.event_type} · {fmtDate(c.start_date)}{c.end_date ? ` – ${fmtDate(c.end_date)}` : ""}</small>
            </div>
            {canCompose && (
              <button
                onClick={async () => {
                  if (!window.confirm(`Remove "${c.title}"?`)) return;
                  try { await academicsApi.deleteCalendarEvent(c.id); notify("Removed"); reload(); }
                  catch (err) { notify(err.message || "Could not remove"); }
                }}
              >
                <HiTrash /> Remove
              </button>
            )}
          </article>
        ))}
      </div>

      {creating && (
        <CalendarForm
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); notify("Added to the academic calendar"); reload(); }}
          notify={notify}
        />
      )}
    </div>
  );
}

function CalendarForm({ onClose, onSaved, notify }) {
  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState("exam_window");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <Modal kicker="ACADEMIC CALENDAR" title="New calendar entry" onClose={onClose}>
      <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Mid-semester exams" /></label>
      <label>Type
        <select value={eventType} onChange={(e) => setEventType(e.target.value)}>
          {CALENDAR_TYPES.map((t) => <option key={t} value={t}>{CALENDAR_TYPE_LABEL[t]}</option>)}
        </select>
      </label>
      <label>Start date<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
      <label>End date (optional)<input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
      <label>Details (optional)<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} /></label>
      <button
        className="primary wide"
        disabled={saving || !title.trim() || !startDate}
        onClick={async () => {
          setSaving(true);
          try {
            await academicsApi.publishCalendarEvent({ title, eventType, startDate, endDate: endDate || null, description });
            onSaved();
          } catch (err) { notify(err.message || "Could not add entry"); }
          setSaving(false);
        }}
      >
        {saving ? "Saving…" : "Add to calendar"}
      </button>
    </Modal>
  );
}
