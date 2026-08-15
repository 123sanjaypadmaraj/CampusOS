import React, { useEffect, useState } from "react";
import {
  HiXMark,
  HiPlus,
  HiPencilSquare,
  HiMegaphone,
  HiTrash,
  HiCalendarDays,
  HiUserGroup,
  HiShieldCheck,
  HiXCircle,
  HiDocumentText,
  HiMagnifyingGlassCircle,
  HiExclamationTriangle,
  HiPhone,
} from "react-icons/hi2";
import { LoadingState, EmptyState, ErrorState } from "../../components/ui/States";
import * as adminApi from "./api";
import * as opportunitiesApi from "../../services/opportunitiesService";
import AdminAnalytics from "./Analytics";
import SosAlertsPanel from "../facilities/SosAlerts";

/* =========================================================
   SHARED SHELL (mirrors App.jsx's ModalShell markup/classes so
   the CMS looks native without a fragile cross-file import)
========================================================= */

function Modal({ title, kicker, onClose, children }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="feature-modal" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>
          <HiXMark />
        </button>
        {kicker && <span className="section-kicker">{kicker}</span>}
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

const TABS = [
  ["sos", "SOS Alerts"],
  ["analytics", "Analytics"],
  ["announcements", "Announcements"],
  ["events", "Events & Clubs"],
  ["verifications", "Student Verifications"],
  ["emergencycontacts", "Emergency Contacts"],
  ["users", "Users"],
  ["moderation", "Moderation"],
  ["requests", "Requests"],
  ["lostfound", "Lost & Found"],
  ["opportunities", "Opportunities & Mentors"],
  ["errors", "Errors"],
];

export default function AdminCMS({ notify, campusId, authUser }) {
  const [tab, setTab] = useState("announcements");

  return (
    <section className="page-section admin-cms">
      <div className="section-head">
        <div>
          <span className="section-kicker">CONTROL CENTER</span>
          <h1>Admin CMS</h1>
          <p>Manage announcements, events and clubs for your campus. Canteen menus are managed by each canteen&rsquo;s own vendor login.</p>
        </div>
      </div>

      <div className="chips" style={{ marginBottom: 24 }}>
        {TABS.map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? "chip active" : "chip"}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "sos" && <SosAlertsPanel notify={notify} />}
      {tab === "analytics" && <AdminAnalytics campusId={campusId} />}
      {tab === "announcements" && <AnnouncementsTab notify={notify} campusId={campusId} />}
      {tab === "events" && <EventsClubsTab notify={notify} campusId={campusId} authUser={authUser} />}
      {tab === "verifications" && <VerificationsTab notify={notify} campusId={campusId} authUser={authUser} />}
      {tab === "emergencycontacts" && <EmergencyContactsTab notify={notify} />}
      {tab === "users" && <UsersTab notify={notify} campusId={campusId} authUser={authUser} />}
      {tab === "moderation" && <ModerationTab notify={notify} authUser={authUser} />}
      {tab === "requests" && <RequestsTab notify={notify} campusId={campusId} />}
      {tab === "lostfound" && <LostFoundTab notify={notify} campusId={campusId} authUser={authUser} />}
      {tab === "opportunities" && <OpportunitiesMentorsTab notify={notify} campusId={campusId} />}
      {tab === "errors" && <ErrorLogsTab notify={notify} />}
    </section>
  );
}

/* =========================================================
   CLUB/VENDOR REQUESTS (doc §104)
========================================================= */

function RequestsTab({ notify, campusId }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      setRequests(await adminApi.listPendingOrgRequests(campusId));
    } catch (err) {
      setError(err.message || "Could not load requests");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [campusId]); // eslint-disable-line react-hooks/exhaustive-deps

  const approve = async (request) => {
    try {
      setBusyId(request.id);
      await adminApi.approveOrgRequest(request.id);
      notify(
        request.request_type === "club"
          ? `${request.name} club created`
          : `${request.name} approved — set up their vendor account with scripts/setup-vendor-accounts.mjs`
      );
      await reload();
    } catch (err) {
      notify(err.message || "Could not approve this request");
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (request) => {
    const reason = window.prompt(`Reason for rejecting "${request.name}"?`);
    if (reason === null) return;
    try {
      setBusyId(request.id);
      await adminApi.rejectOrgRequest(request.id, reason);
      notify("Request rejected");
      await reload();
    } catch (err) {
      notify(err.message || "Could not reject this request");
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <LoadingState label="Loading requests…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  return (
    <div className="resource-list">
      {requests.length === 0 && <EmptyState title="No pending requests" text="Club and vendor applications will show up here." />}
      {requests.map((request) => (
        <article className="resource-row" key={request.id}>
          <div>
            <b>{request.request_type === "club" ? "Club" : "Vendor"} · {request.name}</b>
            <small>
              From {request.profiles?.name || "a student"} · {request.category || "uncategorised"}
              {request.contact_phone ? ` · ${request.contact_phone}` : ""}
            </small>
            <small>{request.description}</small>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="primary" disabled={busyId === request.id} onClick={() => approve(request)}>Approve</button>
            <button disabled={busyId === request.id} onClick={() => reject(request)}>Reject</button>
          </div>
        </article>
      ))}
    </div>
  );
}

/* =========================================================
   MODERATION (doc §40-41, §58)
========================================================= */

function ModerationTab({ notify, authUser }) {
  const [reports, setReports] = useState([]);
  const [context, setContext] = useState({}); // reportId -> { owner_id, owner_name, snippet } | 'loading' | 'none'
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      const list = await adminApi.listOpenReports();
      setReports(list);
      list.forEach((report) => {
        setContext((current) => ({ ...current, [report.id]: "loading" }));
        adminApi
          .getReportContext(report.target_type, report.target_id, report.reporter_id)
          .then((ctx) => setContext((current) => ({ ...current, [report.id]: ctx || "none" })))
          .catch(() => setContext((current) => ({ ...current, [report.id]: "none" })));
      });
    } catch (err) {
      setError(err.message || "Could not load reports");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const canModerateContent = (report) => ["post", "comment"].includes(report.target_type);

  const act = async (report, action) => {
    try {
      setBusyId(report.id);
      if (action === "hide" || action === "remove") {
        await adminApi.moderateContent(report.target_type, report.target_id, action);
      }
      await adminApi.resolveReport(report.id, authUser?.id, action === "dismiss" ? "dismissed" : "resolved");
      notify(action === "dismiss" ? "Report dismissed" : action === "hide" ? "Content hidden" : "Content removed");
      await reload();
    } catch (err) {
      notify(err.message || "Could not action this report");
    } finally {
      setBusyId(null);
    }
  };

  const suspendReportedUser = async (report, ownerId, ownerName) => {
    const reason = window.prompt(`Reason for suspending ${ownerName}?`, report.reason);
    if (reason === null) return;
    try {
      setBusyId(report.id);
      await adminApi.setUserStatus(ownerId, "suspended", reason);
      notify(`${ownerName} suspended`);
    } catch (err) {
      notify(err.message || "Could not suspend this user");
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <LoadingState label="Loading reports…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  return (
    <div className="resource-list">
      {reports.length === 0 && (
        <EmptyState icon={<HiShieldCheck />} title="No open reports" text="Everything students have flagged has been handled." />
      )}
      {reports.map((report) => {
        const ctx = context[report.id];
        return (
          <article className="resource-row" key={report.id} style={{ alignItems: "flex-start" }}>
            <div>
              <b>{report.target_type} · {report.reason}</b>
              <small>
                Reported by {report.profiles?.name || "a student"} · {new Date(report.created_at).toLocaleString()}
              </small>
              {report.details && <small>&ldquo;{report.details}&rdquo;</small>}
              {ctx === "loading" && <small>Loading content…</small>}
              {ctx === "none" && <small>Original content/profile no longer exists.</small>}
              {ctx && typeof ctx === "object" && (
                <small>
                  By <b>{ctx.owner_name}</b>: {ctx.snippet || "(no text)"}
                </small>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {canModerateContent(report) && (
                <>
                  <button disabled={busyId === report.id} onClick={() => act(report, "hide")}>Hide</button>
                  <button disabled={busyId === report.id} onClick={() => act(report, "remove")}>Remove</button>
                </>
              )}
              {ctx && typeof ctx === "object" && (
                <button
                  disabled={busyId === report.id}
                  onClick={() => suspendReportedUser(report, ctx.owner_id, ctx.owner_name)}
                >
                  Suspend {ctx.owner_name}
                </button>
              )}
              <button disabled={busyId === report.id} onClick={() => act(report, "dismiss")}>Dismiss</button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

/* =========================================================
   USERS (doc §54-58)
========================================================= */

const ROLE_OPTIONS = ["student", "club_admin", "vendor", "facilities_staff", "college_admin", "super_admin"];

function UsersTab({ notify, campusId, authUser }) {
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      setUsers(await adminApi.listAllUsers(campusId, { search: q, role: roleFilter || null, limit: 100 }));
    } catch (err) {
      setError(err.message || "Could not load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [campusId, roleFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeRole = async (user, newRole) => {
    if (newRole === user.role) return;
    if (!window.confirm(`Change ${user.name}'s role from ${user.role} to ${newRole}?`)) return;
    try {
      setBusyId(user.id);
      await adminApi.setUserRole(user.id, newRole);
      notify(`${user.name} is now ${newRole}`);
      await reload();
    } catch (err) {
      notify(err.message || "Could not change role");
    } finally {
      setBusyId(null);
    }
  };

  const toggleStatus = async (user) => {
    const nextStatus = user.status === "suspended" ? "active" : "suspended";
    let reason;
    if (nextStatus === "suspended") {
      reason = window.prompt(`Reason for suspending ${user.name}?`);
      if (reason === null) return;
    }
    try {
      setBusyId(user.id);
      await adminApi.setUserStatus(user.id, nextStatus, reason);
      notify(nextStatus === "suspended" ? `${user.name} suspended` : `${user.name} reactivated`);
      await reload();
    } catch (err) {
      notify(err.message || "Could not change account status");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="searchbar compact wide-search" style={{ marginBottom: 12 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && reload()}
          placeholder="Search name, email or USN…"
        />
        <button onClick={reload}>Search</button>
      </div>

      <div className="chips" style={{ marginBottom: 16 }}>
        <button className={roleFilter === "" ? "chip active" : "chip"} onClick={() => setRoleFilter("")}>All roles</button>
        {ROLE_OPTIONS.map((role) => (
          <button key={role} className={roleFilter === role ? "chip active" : "chip"} onClick={() => setRoleFilter(role)}>
            {role}
          </button>
        ))}
      </div>

      {loading && <LoadingState label="Loading users…" />}
      {error && <ErrorState text={error} onRetry={reload} />}

      {!loading && !error && (
        <div className="resource-list">
          {users.length === 0 && <EmptyState title="No users match" />}
          {users.map((user) => (
            <article className="resource-row" key={user.id}>
              <div>
                <b>{user.name} {user.status === "suspended" && <span className="social-type">SUSPENDED</span>}</b>
                <small>
                  {user.email || "no email"} · {user.usn || "no USN"} · {user.course} · {user.year}
                </small>
                {user.status === "suspended" && user.suspended_reason && (
                  <small>Reason: {user.suspended_reason}</small>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <select
                  value={user.role}
                  disabled={busyId === user.id || user.id === authUser?.id}
                  onChange={(e) => changeRole(user, e.target.value)}
                >
                  {ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
                <button
                  disabled={busyId === user.id || user.id === authUser?.id || ["college_admin", "super_admin"].includes(user.role)}
                  onClick={() => toggleStatus(user)}
                >
                  {user.status === "suspended" ? "Reactivate" : "Suspend"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

/* =========================================================
   STUDENT VERIFICATIONS (doc §7)
========================================================= */

function VerificationsTab({ notify, campusId, authUser }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      setRequests(await adminApi.listPendingVerifications(campusId));
    } catch (err) {
      setError(err.message || "Could not load verification requests");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [campusId]); // eslint-disable-line react-hooks/exhaustive-deps

  const review = async (request, status) => {
    let reason;
    if (status === "rejected") {
      reason = window.prompt("Reason for rejecting this ID? (shown to the student)");
      if (reason === null) return;
    }
    try {
      setBusyId(request.id);
      await adminApi.reviewStudentVerification(request.id, status, reason, authUser?.id);
      notify(status === "verified" ? "Student verified" : "Verification rejected");
      await reload();
    } catch (err) {
      notify(err.message || "Could not review this request");
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <LoadingState label="Loading verification requests…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  return (
    <div className="resource-list">
      {requests.length === 0 && (
        <EmptyState icon={<HiShieldCheck />} title="No pending requests" text="New student ID submissions will show up here." />
      )}
      {requests.map((request) => (
        <article className="resource-row" key={request.id}>
          <div>
            <b>{request.profiles?.name || "Unknown student"}</b>
            <small>
              {request.profiles?.course} · {request.profiles?.year} · USN {request.profiles?.usn || request.usn || "—"}
            </small>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {request.document_path && (
              <button
                onClick={async () => {
                  try {
                    const url = await adminApi.getVerificationDocumentUrl(request.document_path);
                    window.open(url, "_blank", "noopener,noreferrer");
                  } catch (err) {
                    notify(err.message || "Could not open document");
                  }
                }}
              >
                <HiDocumentText /> View ID
              </button>
            )}
            <button className="primary" disabled={busyId === request.id} onClick={() => review(request, "verified")}>
              <HiShieldCheck /> Approve
            </button>
            <button disabled={busyId === request.id} onClick={() => review(request, "rejected")}>
              <HiXCircle /> Reject
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

/* =========================================================
   EMERGENCY CONTACTS -- verification queue (doc §113)
   A student self-reports next-of-kin contacts (Profile page); this queue
   is where facilities/admin confirm a number is real before it's trusted
   by a responder mid-SOS (see SosAlertsPanel's "View emergency contacts").
========================================================= */

const RELATIONSHIP_LABEL = {
  parent: "Parent", guardian: "Guardian", sibling: "Sibling",
  spouse: "Spouse", relative: "Relative", friend: "Friend", other: "Other",
};

// Exported (not just used locally) -- facilities_staff holds
// emergency_contacts.verify too (same set as sos.respond) but has no Admin
// CMS nav access, so FacilitiesDashboard.jsx imports and renders this same
// tab from its own dashboard instead of duplicating it.
export function EmergencyContactsTab({ notify }) {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      setContacts(await adminApi.listPendingEmergencyContacts());
    } catch (err) {
      setError(err.message || "Could not load emergency contacts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const review = async (contact, verified) => {
    let notes;
    if (!verified) {
      notes = window.prompt("Why is this contact being rejected? (optional, shown internally)");
      if (notes === null) return;
    }
    try {
      setBusyId(contact.id);
      await adminApi.verifyEmergencyContact(contact.id, verified, notes || null);
      notify(verified ? "Emergency contact verified" : "Emergency contact marked unverified");
      await reload();
    } catch (err) {
      notify(err.message || "Could not review this contact");
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <LoadingState label="Loading emergency contacts…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  return (
    <div className="resource-list">
      {contacts.length === 0 && (
        <EmptyState icon={<HiPhone />} title="No pending emergency contacts" text="New next-of-kin submissions will show up here for verification." />
      )}
      {contacts.map((contact) => (
        <article className="resource-row" key={contact.id}>
          <div>
            <b>{contact.contact_name} <small>({RELATIONSHIP_LABEL[contact.relationship] || contact.relationship})</small></b>
            <small>
              <HiPhone /> {contact.phone}{contact.alt_phone ? ` · alt ${contact.alt_phone}` : ""}
              {contact.email ? ` · ${contact.email}` : ""}
            </small>
            <small>
              For {contact.student_name || "Unknown student"} · {contact.student_course} · {contact.student_year} · USN {contact.student_usn || "—"}
              {contact.is_primary ? " · Primary contact" : ""}
            </small>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="primary" disabled={busyId === contact.id} onClick={() => review(contact, true)}>
              <HiShieldCheck /> Verify
            </button>
            <button disabled={busyId === contact.id} onClick={() => review(contact, false)}>
              <HiXCircle /> Reject
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

// Food & Canteens management used to live here as its own admin tab, gated
// only by 'food.menu.write' back when only admins held that permission. Now
// every canteen has its own vendor login (VendorDashboard.jsx) with real
// bulk menu tools, scoped by canteens.owner_id RLS -- see
// supabase/migrations/20260814002200_vendor_dashboard.sql. Keeping a second,
// parallel "edit any canteen" surface here was redundant once real
// per-canteen accounts existed, so it was removed; canteen menu editing now
// only happens via that canteen's own vendor account.

/* =========================================================
   ANNOUNCEMENTS
========================================================= */

const ANNOUNCEMENT_CATEGORIES = ["Academic", "Exam", "Holiday", "Emergency", "Campus", "Maintenance", "Transport", "General"];

function AnnouncementsTab({ notify, campusId }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [announcements, setAnnouncements] = useState([]);
  const [creating, setCreating] = useState(false);

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      setAnnouncements(await adminApi.listAnnouncementsAdmin(campusId));
    } catch (err) {
      setError(err.message || "Could not load announcements");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [campusId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <LoadingState label="Loading announcements…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  return (
    <div className="admin-panel">
      <div className="section-head">
        <h2>Announcements</h2>
        <button className="primary" onClick={() => setCreating(true)}><HiPlus /> New announcement</button>
      </div>

      <div className="resource-list">
        {announcements.length === 0 && <EmptyState icon={<HiMegaphone />} title="No announcements yet" />}
        {announcements.map((a) => (
          <article className="resource-row" key={a.id}>
            <div>
              <b>{a.title}</b>
              <small>{a.category} · {a.target_scope} · {new Date(a.created_at).toLocaleString()}</small>
            </div>
            <button onClick={async () => {
              if (!window.confirm(`Delete "${a.title}"?`)) return;
              try { await adminApi.deleteAnnouncement(a.id); notify("Announcement deleted"); reload(); }
              catch (err) { notify(err.message || "Could not delete announcement"); }
            }}>
              <HiTrash /> Delete
            </button>
          </article>
        ))}
      </div>

      {creating && (
        <AnnouncementForm
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); reload(); }}
          notify={notify}
        />
      )}
    </div>
  );
}

function AnnouncementForm({ onClose, onSaved, notify }) {
  const [category, setCategory] = useState("General");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [targetScope, setTargetScope] = useState("everyone");
  const [saving, setSaving] = useState(false);

  return (
    <Modal kicker="ANNOUNCEMENTS" title="New announcement" onClose={onClose}>
      <label>Category
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {ANNOUNCEMENT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </label>
      <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label>Message<textarea value={body} onChange={(e) => setBody(e.target.value)} /></label>
      <label>Audience
        <select value={targetScope} onChange={(e) => setTargetScope(e.target.value)}>
          <option value="everyone">Everyone</option>
          <option value="department">By department</option>
          <option value="year">By year</option>
          <option value="course">By course</option>
        </select>
      </label>
      {category === "Emergency" && (
        <p style={{ color: "#c23a3a", fontWeight: 700, fontSize: 12 }}>
          Emergency alerts cannot be muted by students and are heavily audited (doc §53). Use only for genuine emergencies.
        </p>
      )}
      <button className="primary wide" disabled={saving || !title.trim() || !body.trim()} onClick={async () => {
        try {
          setSaving(true);
          await adminApi.createAnnouncement({ category, title, body, targetScope });
          notify("Announcement published");
          onSaved();
        } catch (err) { notify(err.message || "Could not publish announcement"); }
        finally { setSaving(false); }
      }}>
        {saving ? "Publishing…" : "Publish announcement"}
      </button>
    </Modal>
  );
}

/* =========================================================
   EVENTS & CLUBS
========================================================= */

function EventsClubsTab({ notify, campusId }) {
  const [section, setSection] = useState("events");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [events, setEvents] = useState([]);
  const [clubs, setClubs] = useState([]);
  const [eventModal, setEventModal] = useState(null);
  const [clubModal, setClubModal] = useState(null);
  const [membersModal, setMembersModal] = useState(null);

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      const [e, c] = await Promise.all([adminApi.listEventsAdmin(campusId), adminApi.listClubsAdmin(campusId)]);
      setEvents(e);
      setClubs(c);
    } catch (err) {
      setError(err.message || "Could not load events/clubs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [campusId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <LoadingState label="Loading events & clubs…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  return (
    <div className="admin-panel">
      <div className="chips" style={{ marginBottom: 16 }}>
        <button className={section === "events" ? "chip active" : "chip"} onClick={() => setSection("events")}>Events</button>
        <button className={section === "clubs" ? "chip active" : "chip"} onClick={() => setSection("clubs")}>Clubs</button>
      </div>

      {section === "events" ? (
        <>
          <div className="section-head">
            <h2>Events</h2>
            <button className="primary" onClick={() => setEventModal({})}><HiPlus /> New event</button>
          </div>
          <div className="resource-list">
            {events.length === 0 && <EmptyState icon={<HiCalendarDays />} title="No events yet" />}
            {events.map((ev) => (
              <article className="resource-row" key={ev.id}>
                <div>
                  <b>{ev.title}</b>
                  <small>
                    {new Date(ev.event_date).toLocaleString()} · {ev.place} ·{" "}
                    {ev.attendees}{ev.capacity ? `/${ev.capacity}` : ""} registered ·{" "}
                    {ev.published ? "Published" : "Draft"}
                  </small>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setEventModal(ev)}><HiPencilSquare /> Edit</button>
                  <button onClick={async () => {
                    try { await adminApi.setEventPublished(ev.id, !ev.published); notify(ev.published ? "Unpublished" : "Published"); reload(); }
                    catch (err) { notify(err.message || "Could not update event"); }
                  }}>
                    {ev.published ? "Unpublish" : "Publish"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="section-head">
            <h2>Clubs</h2>
            <button className="primary" onClick={() => setClubModal({})}><HiPlus /> New club</button>
          </div>
          <div className="resource-list">
            {clubs.length === 0 && <EmptyState icon={<HiUserGroup />} title="No clubs yet" />}
            {clubs.map((club) => (
              <article className="resource-row" key={club.id}>
                <div>
                  <b>{club.name}</b>
                  <small>{club.category} · {club.members} members · {club.active ? "Active" : "Archived"}</small>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setMembersModal(club)}><HiUserGroup /> Members</button>
                  <button onClick={() => setClubModal(club)}><HiPencilSquare /> Edit</button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      {eventModal && (
        <EventForm
          event={eventModal} clubs={clubs} campusId={campusId}
          onClose={() => setEventModal(null)}
          onSaved={() => { setEventModal(null); reload(); }}
          notify={notify}
        />
      )}
      {clubModal && (
        <ClubForm
          club={clubModal} campusId={campusId}
          onClose={() => setClubModal(null)}
          onSaved={() => { setClubModal(null); reload(); }}
          notify={notify}
        />
      )}
      {membersModal && (
        <ClubMembersModal club={membersModal} onClose={() => setMembersModal(null)} notify={notify} />
      )}
    </div>
  );
}

function EventForm({ event, clubs, campusId, onClose, onSaved, notify }) {
  const toLocalInput = (iso) => (iso ? new Date(iso).toISOString().slice(0, 16) : "");
  const [form, setForm] = useState({
    title: event.title || "", category: event.category || "Workshop",
    description: event.description || "", place: event.place || "",
    club_id: event.club_id || "", capacity: event.capacity || "",
    event_date: toLocalInput(event.event_date), published: event.published !== false,
  });
  const [saving, setSaving] = useState(false);
  const change = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal kicker="EVENTS" title={event.id ? "Edit event" : "New event"} onClose={onClose}>
      <label>Title<input value={form.title} onChange={(e) => change("title", e.target.value)} /></label>
      <div className="form-grid">
        <label>Category<input value={form.category} onChange={(e) => change("category", e.target.value)} /></label>
        <label>Club (optional)
          <select value={form.club_id} onChange={(e) => change("club_id", e.target.value)}>
            <option value="">None</option>
            {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label>Date &amp; time<input type="datetime-local" value={form.event_date} onChange={(e) => change("event_date", e.target.value)} /></label>
        <label>Capacity (blank = unlimited)<input type="number" min="1" value={form.capacity} onChange={(e) => change("capacity", e.target.value)} /></label>
      </div>
      <label>Place<input value={form.place} onChange={(e) => change("place", e.target.value)} /></label>
      <label>Description<textarea value={form.description} onChange={(e) => change("description", e.target.value)} /></label>
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="checkbox" checked={form.published} onChange={(e) => change("published", e.target.checked)} /> Published
      </label>
      <button className="primary wide" disabled={saving || !form.title.trim() || !form.event_date} onClick={async () => {
        try {
          setSaving(true);
          await adminApi.upsertEvent(campusId, {
            ...event, ...form,
            event_date: new Date(form.event_date).toISOString(),
            capacity: form.capacity || null,
            club_id: form.club_id || null,
          });
          notify("Event saved");
          onSaved();
        } catch (err) { notify(err.message || "Could not save event"); }
        finally { setSaving(false); }
      }}>
        {saving ? "Saving…" : "Save event"}
      </button>
    </Modal>
  );
}

function ClubForm({ club, campusId, onClose, onSaved, notify }) {
  const [form, setForm] = useState({
    name: club.name || "", category: club.category || "", description: club.description || "",
    active: club.active !== false,
  });
  const [saving, setSaving] = useState(false);
  const change = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal kicker="CLUBS" title={club.id ? "Edit club" : "New club"} onClose={onClose}>
      <label>Name<input value={form.name} onChange={(e) => change("name", e.target.value)} /></label>
      <label>Category<input value={form.category} onChange={(e) => change("category", e.target.value)} /></label>
      <label>Description<textarea value={form.description} onChange={(e) => change("description", e.target.value)} /></label>
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="checkbox" checked={form.active} onChange={(e) => change("active", e.target.checked)} /> Active
      </label>
      <button className="primary wide" disabled={saving || !form.name.trim()} onClick={async () => {
        try { setSaving(true); await adminApi.upsertClub(campusId, { ...club, ...form }); notify("Club saved"); onSaved(); }
        catch (err) { notify(err.message || "Could not save club"); } finally { setSaving(false); }
      }}>
        {saving ? "Saving…" : "Save club"}
      </button>
    </Modal>
  );
}

function ClubMembersModal({ club, onClose, notify }) {
  const [members, setMembers] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    adminApi.listClubMembers(club.id).then(setMembers).catch((err) => setError(err.message || "Could not load members"));
  }, [club.id]);

  const roles = ["member", "coordinator", "secretary", "treasurer", "event_manager", "vice_president", "president", "owner"];

  return (
    <Modal kicker="CLUB MEMBERS" title={club.name} onClose={onClose}>
      {error && <ErrorState text={error} />}
      {!error && !members && <LoadingState label="Loading members…" />}
      {members && members.length === 0 && <EmptyState title="No members yet" />}
      {members && members.map((m) => (
        <div key={m.id} className="resource-row">
          <div>
            <b>{m.profiles?.name || "Unknown"}</b>
            <small>{m.profiles?.usn} · {m.profiles?.course}</small>
          </div>
          <select
            value={m.role}
            onChange={async (e) => {
              const role = e.target.value;
              try {
                await adminApi.setClubMemberRole(m.id, role);
                setMembers((current) => current.map((x) => (x.id === m.id ? { ...x, role } : x)));
                notify("Member role updated");
              } catch (err) { notify(err.message || "Could not update role"); }
            }}
          >
            {roles.map((r) => <option key={r} value={r}>{r.replace("_", " ")}</option>)}
          </select>
        </div>
      ))}
    </Modal>
  );
}

/* =========================================================
   LOST & FOUND (doc §44)
   The student-facing list (LostService in App.jsx) used to fall back to
   3 hardcoded fake items whenever the real table was empty for a campus --
   looked like real reports, "Claim" on one just showed an error toast.
   Removed there; this tab is the admin side of the same fix -- staff can
   post an item on the college's behalf (e.g. something handed in to
   security) instead of the feature only working via student self-report,
   and can verify/reject a pending claim or resolve/delete a report by hand.
========================================================= */

const LOST_FOUND_CATEGORIES = ["Electronics", "ID card", "Bag", "Documents", "Keys", "Clothing", "Other"];

function LostFoundTab({ notify, campusId, authUser }) {
  const [statusFilter, setStatusFilter] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [creating, setCreating] = useState(false);

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      setItems(await adminApi.listLostFoundItemsAdmin(campusId, { status: statusFilter || null }));
    } catch (err) {
      setError(err.message || "Could not load lost & found reports");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [campusId, statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const verify = async (item, approve) => {
    try {
      setBusyId(item.id);
      await adminApi.verifyLostFoundHandover(item.id, approve);
      notify(approve ? "Handover verified — item marked resolved" : "Claim rejected — item reopened");
      await reload();
    } catch (err) {
      notify(err.message || "Could not verify this claim");
    } finally {
      setBusyId(null);
    }
  };

  const markResolved = async (item) => {
    if (!window.confirm(`Mark "${item.title}" resolved without a claim?`)) return;
    try {
      setBusyId(item.id);
      await adminApi.setLostFoundItemStatusAdmin(item.id, "resolved");
      notify("Marked resolved");
      await reload();
    } catch (err) {
      notify(err.message || "Could not update this report");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (item) => {
    if (!window.confirm(`Delete "${item.title}"? This can't be undone.`)) return;
    try {
      setBusyId(item.id);
      await adminApi.deleteLostFoundItemAdmin(item.id);
      notify("Report deleted");
      await reload();
    } catch (err) {
      notify(err.message || "Could not delete this report");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="admin-panel">
      <div className="section-head">
        <h2>Lost &amp; Found</h2>
        <button className="primary" onClick={() => setCreating(true)}><HiPlus /> Post an item</button>
      </div>

      <div className="chips" style={{ marginBottom: 16 }}>
        <button className={statusFilter === "" ? "chip active" : "chip"} onClick={() => setStatusFilter("")}>All</button>
        <button className={statusFilter === "open" ? "chip active" : "chip"} onClick={() => setStatusFilter("open")}>Open</button>
        <button className={statusFilter === "claim_pending" ? "chip active" : "chip"} onClick={() => setStatusFilter("claim_pending")}>Pending verification</button>
        <button className={statusFilter === "resolved" ? "chip active" : "chip"} onClick={() => setStatusFilter("resolved")}>Resolved</button>
      </div>

      {loading && <LoadingState label="Loading lost & found reports…" />}
      {error && <ErrorState text={error} onRetry={reload} />}

      {!loading && !error && (
        <div className="resource-list">
          {items.length === 0 && <EmptyState icon={<HiMagnifyingGlassCircle />} title="No reports" text="Nothing matches this filter." />}
          {items.map((item) => (
            <article className="resource-row" key={item.id} style={{ alignItems: "flex-start" }}>
              <div>
                <b>{item.item_type === "found" ? "Found" : "Lost"} · {item.title}</b>
                <small>
                  {item.category} · {item.location} · Reported by {item.reporter?.name || "unknown"} · {new Date(item.created_at).toLocaleString()}
                </small>
                {item.status === "claim_pending" && (
                  <small>Claimed by <b>{item.claimant?.name || "unknown"}</b>: &ldquo;{item.claim_proof}&rdquo;</small>
                )}
                {item.status === "resolved" && <small>Resolved</small>}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {item.status === "claim_pending" && (
                  <>
                    <button className="primary" disabled={busyId === item.id} onClick={() => verify(item, true)}>Verify &amp; release</button>
                    <button disabled={busyId === item.id} onClick={() => verify(item, false)}>Reject claim</button>
                  </>
                )}
                {item.status === "open" && (
                  <button disabled={busyId === item.id} onClick={() => markResolved(item)}>Mark resolved</button>
                )}
                <button disabled={busyId === item.id} onClick={() => remove(item)}><HiTrash /> Delete</button>
              </div>
            </article>
          ))}
        </div>
      )}

      {creating && (
        <LostFoundItemForm
          campusId={campusId}
          authUser={authUser}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); reload(); }}
          notify={notify}
        />
      )}
    </div>
  );
}

function LostFoundItemForm({ campusId, authUser, onClose, onSaved, notify }) {
  const [itemType, setItemType] = useState("found");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Other");
  const [location, setLocation] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <Modal kicker="LOST & FOUND" title="Post an item on the college's behalf" onClose={onClose}>
      <label>Type
        <select value={itemType} onChange={(e) => setItemType(e.target.value)}>
          <option value="found">Found (e.g. handed in to security)</option>
          <option value="lost">Lost (reported to staff in person)</option>
        </select>
      </label>
      <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Black backpack" /></label>
      <div className="form-grid">
        <label>Category
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {LOST_FOUND_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label>Location<input value={location} onChange={(e) => setLocation(e.target.value)} /></label>
      </div>
      <label>Description<textarea value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <button className="primary wide" disabled={saving || !title.trim() || !location.trim()} onClick={async () => {
        try {
          setSaving(true);
          await adminApi.createLostFoundItem({ userId: authUser?.id, campusId, itemType, title, description, category, location });
          notify("Report posted");
          onSaved();
        } catch (err) { notify(err.message || "Could not post this report"); }
        finally { setSaving(false); }
      }}>
        {saving ? "Posting…" : "Post report"}
      </button>
    </Modal>
  );
}

/* =========================================================
   OPPORTUNITIES & MENTORS (doc §109)
========================================================= */

const OPPORTUNITY_TYPES = ["Internship", "Research", "Job", "Volunteer", "Competition"];

function OpportunitiesMentorsTab({ notify, campusId }) {
  const [section, setSection] = useState("opportunities");

  return (
    <div className="admin-panel">
      <div className="socialize-filter-row" style={{ marginBottom: 16 }}>
        <button className={section === "opportunities" ? "chip active" : "chip"} onClick={() => setSection("opportunities")}>Opportunities</button>
        <button className={section === "mentors" ? "chip active" : "chip"} onClick={() => setSection("mentors")}>Mentors</button>
        <button className={section === "requests" ? "chip active" : "chip"} onClick={() => setSection("requests")}>Mentor requests</button>
      </div>

      {section === "opportunities" && <OpportunitiesAdminSection notify={notify} campusId={campusId} />}
      {section === "mentors" && <MentorsAdminSection notify={notify} campusId={campusId} />}
      {section === "requests" && <MentorRequestsAdminSection notify={notify} />}
    </div>
  );
}

function OpportunitiesAdminSection({ notify, campusId }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState([]);
  const [formOpen, setFormOpen] = useState(null); // {} for new, {...opportunity} to edit
  const [applicantsFor, setApplicantsFor] = useState(null);

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      setItems(await opportunitiesApi.listOpportunitiesAdmin(campusId));
    } catch (err) {
      setError(err.message || "Could not load opportunities");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [campusId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <LoadingState label="Loading opportunities…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  return (
    <div>
      <div className="section-head">
        <h2>Opportunities</h2>
        <button className="primary" onClick={() => setFormOpen({})}><HiPlus /> Post opportunity</button>
      </div>

      <div className="resource-list">
        {items.length === 0 && <EmptyState title="No opportunities posted yet" />}
        {items.map((item) => (
          <article className="resource-row" key={item.id}>
            <div>
              <b>{item.role} · {item.company}</b>
              <small>{item.type} · {item.opportunity_applications?.length || 0} applicant(s) · {item.active ? "Active" : "Closed"}</small>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setApplicantsFor(item)}>Applicants</button>
              <button onClick={() => setFormOpen(item)}><HiPencilSquare /></button>
              <button onClick={async () => {
                try { await opportunitiesApi.updateOpportunity(item.id, { active: !item.active }); reload(); }
                catch (err) { notify(err.message || "Could not update opportunity"); }
              }}>
                {item.active ? "Close" : "Reopen"}
              </button>
              <button onClick={async () => {
                if (!window.confirm(`Delete "${item.role}"?`)) return;
                try { await opportunitiesApi.deleteOpportunity(item.id); notify("Opportunity deleted"); reload(); }
                catch (err) { notify(err.message || "Could not delete opportunity"); }
              }}>
                <HiTrash />
              </button>
            </div>
          </article>
        ))}
      </div>

      {formOpen && (
        <OpportunityForm
          opportunity={formOpen}
          campusId={campusId}
          onClose={() => setFormOpen(null)}
          onSaved={() => { setFormOpen(null); reload(); }}
          notify={notify}
        />
      )}

      {applicantsFor && (
        <ApplicantsModal opportunity={applicantsFor} onClose={() => setApplicantsFor(null)} notify={notify} />
      )}
    </div>
  );
}

function OpportunityForm({ opportunity, campusId, onClose, onSaved, notify }) {
  const isNew = !opportunity.id;
  const [form, setForm] = useState({
    company: opportunity.company || "",
    role: opportunity.role || "",
    type: opportunity.type || OPPORTUNITY_TYPES[0],
    description: opportunity.description || "",
    tags: (opportunity.tags || []).join(", "),
    deadline: opportunity.deadline || "",
    applyUrl: opportunity.apply_url || "",
  });
  const [saving, setSaving] = useState(false);
  const change = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.company.trim() || !form.role.trim()) return;
    try {
      setSaving(true);
      const payload = {
        company: form.company.trim(),
        role: form.role.trim(),
        type: form.type,
        description: form.description,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        deadline: form.deadline || null,
        applyUrl: form.applyUrl || null,
      };
      if (isNew) {
        await opportunitiesApi.createOpportunity({ campusId, ...payload });
      } else {
        await opportunitiesApi.updateOpportunity(opportunity.id, {
          company: payload.company, role: payload.role, type: payload.type,
          description: payload.description, tags: payload.tags, deadline: payload.deadline, apply_url: payload.applyUrl,
        });
      }
      notify(isNew ? "Opportunity posted" : "Opportunity updated");
      onSaved();
    } catch (err) {
      notify(err.message || "Could not save opportunity");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal kicker="OPPORTUNITY" title={isNew ? "Post opportunity" : "Edit opportunity"} onClose={onClose}>
      <label>Role<input value={form.role} onChange={(e) => change("role", e.target.value)} /></label>
      <label>Company / Lab<input value={form.company} onChange={(e) => change("company", e.target.value)} /></label>
      <label>Type
        <select value={form.type} onChange={(e) => change("type", e.target.value)}>
          {OPPORTUNITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </label>
      <label>Description<textarea rows={3} value={form.description} onChange={(e) => change("description", e.target.value)} /></label>
      <label>Tags (comma separated)<input value={form.tags} onChange={(e) => change("tags", e.target.value)} placeholder="Python, ML" /></label>
      <label>Deadline<input type="date" value={form.deadline} onChange={(e) => change("deadline", e.target.value)} /></label>
      <label>External apply link (optional)<input value={form.applyUrl} onChange={(e) => change("applyUrl", e.target.value)} placeholder="https://…" /></label>
      <button className="primary wide" disabled={saving || !form.company.trim() || !form.role.trim()} onClick={save}>
        {saving ? "Saving…" : isNew ? "Post opportunity" : "Save changes"}
      </button>
    </Modal>
  );
}

function ApplicantsModal({ opportunity, onClose, notify }) {
  const [loading, setLoading] = useState(true);
  const [applicants, setApplicants] = useState([]);

  const reload = async () => {
    try {
      setLoading(true);
      setApplicants(await opportunitiesApi.listOpportunityApplicants(opportunity.id));
    } catch (err) {
      notify(err.message || "Could not load applicants");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [opportunity.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal kicker="APPLICANTS" title={`${opportunity.role} at ${opportunity.company}`} onClose={onClose}>
      {loading ? (
        <LoadingState label="Loading applicants…" />
      ) : applicants.length === 0 ? (
        <EmptyState title="No applications yet" />
      ) : (
        <div className="resource-list">
          {applicants.map((a) => (
            <article className="resource-row" key={a.id}>
              <div>
                <b>{a.profiles?.name || "Student"} · {a.status}</b>
                <small>{a.profiles?.course} · {a.profiles?.email}</small>
                {a.message && <small>&ldquo;{a.message}&rdquo;</small>}
              </div>
              <select value={a.status} onChange={async (e) => {
                try { await opportunitiesApi.setApplicationStatus(a.id, e.target.value); reload(); }
                catch (err) { notify(err.message || "Could not update status"); }
              }}>
                {["submitted", "reviewed", "shortlisted", "rejected"].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </article>
          ))}
        </div>
      )}
    </Modal>
  );
}

function MentorsAdminSection({ notify, campusId }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState([]);
  const [formOpen, setFormOpen] = useState(null);

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      setItems(await opportunitiesApi.listMentorsAdmin(campusId));
    } catch (err) {
      setError(err.message || "Could not load mentors");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [campusId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <LoadingState label="Loading mentors…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  return (
    <div>
      <div className="section-head">
        <h2>Mentors</h2>
        <button className="primary" onClick={() => setFormOpen({})}><HiPlus /> Add mentor</button>
      </div>

      <div className="resource-list">
        {items.length === 0 && <EmptyState title="No mentors listed yet" />}
        {items.map((item) => (
          <article className="resource-row" key={item.id}>
            <div>
              <b>{item.name} · {item.role}</b>
              <small>{(item.skills || []).join(", ")} · {item.active ? "Listed" : "Hidden"}</small>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setFormOpen(item)}><HiPencilSquare /></button>
              <button onClick={async () => {
                try { await opportunitiesApi.updateMentor(item.id, { active: !item.active }); reload(); }
                catch (err) { notify(err.message || "Could not update mentor"); }
              }}>
                {item.active ? "Hide" : "List"}
              </button>
              <button onClick={async () => {
                if (!window.confirm(`Remove "${item.name}" from the mentor directory?`)) return;
                try { await opportunitiesApi.deleteMentor(item.id); notify("Mentor removed"); reload(); }
                catch (err) { notify(err.message || "Could not remove mentor"); }
              }}>
                <HiTrash />
              </button>
            </div>
          </article>
        ))}
      </div>

      {formOpen && (
        <MentorForm
          mentor={formOpen}
          campusId={campusId}
          onClose={() => setFormOpen(null)}
          onSaved={() => { setFormOpen(null); reload(); }}
          notify={notify}
        />
      )}
    </div>
  );
}

function MentorForm({ mentor, campusId, onClose, onSaved, notify }) {
  const isNew = !mentor.id;
  const [form, setForm] = useState({
    name: mentor.name || "",
    role: mentor.role || "",
    skills: (mentor.skills || []).join(", "),
    bio: mentor.bio || "",
    contactEmail: mentor.contact_email || "",
  });
  const [saving, setSaving] = useState(false);
  const change = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name.trim() || !form.role.trim()) return;
    try {
      setSaving(true);
      const skills = form.skills.split(",").map((s) => s.trim()).filter(Boolean);
      if (isNew) {
        await opportunitiesApi.createMentor({ campusId, name: form.name.trim(), role: form.role.trim(), skills, bio: form.bio, contactEmail: form.contactEmail });
      } else {
        await opportunitiesApi.updateMentor(mentor.id, { name: form.name.trim(), role: form.role.trim(), skills, bio: form.bio, contact_email: form.contactEmail || null });
      }
      notify(isNew ? "Mentor added" : "Mentor updated");
      onSaved();
    } catch (err) {
      notify(err.message || "Could not save mentor");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal kicker="MENTOR" title={isNew ? "Add mentor" : "Edit mentor"} onClose={onClose}>
      <label>Name<input value={form.name} onChange={(e) => change("name", e.target.value)} /></label>
      <label>Role / Title<input value={form.role} onChange={(e) => change("role", e.target.value)} placeholder="Robotics & Embedded Systems" /></label>
      <label>Skills (comma separated)<input value={form.skills} onChange={(e) => change("skills", e.target.value)} placeholder="ESP32, ROS, CAD" /></label>
      <label>Bio (optional)<textarea rows={2} value={form.bio} onChange={(e) => change("bio", e.target.value)} /></label>
      <label>Contact email (optional)<input value={form.contactEmail} onChange={(e) => change("contactEmail", e.target.value)} /></label>
      <button className="primary wide" disabled={saving || !form.name.trim() || !form.role.trim()} onClick={save}>
        {saving ? "Saving…" : isNew ? "Add mentor" : "Save changes"}
      </button>
    </Modal>
  );
}

function MentorRequestsAdminSection({ notify }) {
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState([]);

  const reload = async () => {
    try {
      setLoading(true);
      setRequests(await opportunitiesApi.listMentorRequestsAdmin());
    } catch (err) {
      notify(err.message || "Could not load mentor requests");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <LoadingState label="Loading requests…" />;

  return (
    <div>
      <div className="resource-list">
        {requests.length === 0 && <EmptyState title="No mentorship requests yet" />}
        {requests.map((r) => (
          <article className="resource-row" key={r.id}>
            <div>
              <b>{r.profiles?.name || "Student"} → {r.mentors?.name}</b>
              <small>{r.profiles?.course} · {new Date(r.created_at).toLocaleString()} · {r.status}</small>
              {r.message && <small>&ldquo;{r.message}&rdquo;</small>}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

/* =========================================================
   ERRORS (monitoring -- doc §96-98)
   In-house error tracking instead of a third-party account: every
   uncaught client error/rejection (main.jsx), React render crash
   (ErrorBoundary), and a couple of explicitly-instrumented critical flows
   (food order creation/payment) land here via log_client_error(). No
   dedicated account, DSN, or third-party dashboard to sign up for.
========================================================= */

const ERROR_SEVERITIES = ["debug", "info", "warning", "error", "fatal"];

function ErrorLogsTab({ notify }) {
  const [severity, setSeverity] = useState("");
  const [resolvedFilter, setResolvedFilter] = useState(false); // false = show open, true = show resolved
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      setLogs(await adminApi.listErrorLogs({ severity: severity || null, resolved: resolvedFilter }));
    } catch (err) {
      setError(err.message || "Could not load error logs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [severity, resolvedFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleResolved = async (log) => {
    try {
      setBusyId(log.id);
      await adminApi.setErrorLogResolved(log.id, !log.resolved);
      notify(log.resolved ? "Reopened" : "Marked resolved");
      await reload();
    } catch (err) {
      notify(err.message || "Could not update this error");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="admin-panel">
      <div className="section-head">
        <h2>Errors</h2>
      </div>

      <div className="chips" style={{ marginBottom: 12 }}>
        <button className={resolvedFilter === false ? "chip active" : "chip"} onClick={() => setResolvedFilter(false)}>Open</button>
        <button className={resolvedFilter === true ? "chip active" : "chip"} onClick={() => setResolvedFilter(true)}>Resolved</button>
      </div>

      <div className="chips" style={{ marginBottom: 16 }}>
        <button className={severity === "" ? "chip active" : "chip"} onClick={() => setSeverity("")}>All severities</button>
        {ERROR_SEVERITIES.map((s) => (
          <button key={s} className={severity === s ? "chip active" : "chip"} onClick={() => setSeverity(s)}>{s}</button>
        ))}
      </div>

      {loading && <LoadingState label="Loading error logs…" />}
      {error && <ErrorState text={error} onRetry={reload} />}

      {!loading && !error && (
        <div className="resource-list">
          {logs.length === 0 && (
            <EmptyState
              icon={<HiExclamationTriangle />}
              title={resolvedFilter ? "Nothing resolved yet" : "No open errors"}
              text={resolvedFilter ? "" : "Nothing has been reported since you last cleared this list."}
            />
          )}
          {logs.map((log) => (
            <article className="resource-row" key={log.id} style={{ alignItems: "flex-start" }}>
              <div>
                <b>
                  <span className="social-type">{log.severity.toUpperCase()}</span> {log.message}
                </b>
                <small>
                  {log.source} · {log.reporter?.name || "not signed in"} · {new Date(log.created_at).toLocaleString()}
                  {log.url ? ` · ${log.url}` : ""}
                </small>
                {expandedId === log.id && (
                  <>
                    {log.stack && <small style={{ whiteSpace: "pre-wrap", display: "block", marginTop: 6 }}>{log.stack}</small>}
                    {log.context && Object.keys(log.context).length > 0 && (
                      <small style={{ whiteSpace: "pre-wrap", display: "block", marginTop: 6 }}>{JSON.stringify(log.context, null, 2)}</small>
                    )}
                  </>
                )}
                {(log.stack || (log.context && Object.keys(log.context).length > 0)) && (
                  <button className="ghost" style={{ marginTop: 6 }} onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}>
                    {expandedId === log.id ? "Hide details" : "Show details"}
                  </button>
                )}
              </div>
              <button disabled={busyId === log.id} onClick={() => toggleResolved(log)}>
                {log.resolved ? "Reopen" : "Mark resolved"}
              </button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
