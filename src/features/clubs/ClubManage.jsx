import React, { useEffect, useState } from "react";
import {
  HiXMark,
  HiPencilSquare,
  HiPlus,
  HiTrash,
  HiUserGroup,
  HiCalendarDays,
  HiArrowLeft,
  HiDocumentText,
  HiPhoto,
  HiMegaphone,
  HiClipboardDocumentCheck,
  HiClock,
  HiCheck,
  HiXCircle,
  HiArrowDownTray,
  HiQrCode,
  HiCamera,
  HiStar,
} from "react-icons/hi2";
import { LoadingState, EmptyState, ErrorState } from "../../components/ui/States";
import { TrendChart, StatTile } from "../../components/ui/Charts";
import * as clubApi from "./api";
import { getEventRoster, checkinEventTicket, uploadEventCoverImage } from "../../services/mvpService";

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

const LEADER_ROLES = ["owner", "president", "vice_president", "secretary", "coordinator", "treasurer", "event_manager"];
const ALL_ROLES = [...LEADER_ROLES, "member"];
const ROLE_LABEL = {
  owner: "Owner", president: "President", vice_president: "Vice President",
  secretary: "Secretary", coordinator: "Coordinator", treasurer: "Treasurer",
  event_manager: "Event Manager", member: "Member",
};
const RECRUITMENT_LABEL = {
  open: "Open — instant join", application: "Application required", closed: "Closed — not recruiting",
};

// The leadership dashboard for a single club. `myLeadership` is the row
// from getMyClubLeadership() ({ club_id, club_name, role }) that got the
// user here; it's re-derived from a fresh dashboard load, not trusted as
// current state.
export default function ClubManage({ clubId, campusId, authUser, notify, onBack }) {
  const [tab, setTab] = useState("overview");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      setData(await clubApi.getClubDashboard(clubId));
    } catch (err) {
      setError(err.message || "Could not load this club's dashboard");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [clubId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <LoadingState label="Loading club dashboard…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;
  if (!data) return null;

  const isAdminRole = data.my_role === "owner" || data.my_role === "president" || data.my_role === "admin";

  return (
    <section className="page-section admin-cms">
      <div className="club-dash-head">
        <div>
          <button className="ghost" onClick={onBack} style={{ marginBottom: 10 }}><HiArrowLeft /> Back to Clubs Hub</button>
          <span className="section-kicker">CLUB DASHBOARD</span>
          <h1>{data.club?.name}</h1>
          <p>You&rsquo;re managing this club as <span className="role-badge">{ROLE_LABEL[data.my_role] || data.my_role}</span></p>
        </div>
      </div>

      <div className="chips" style={{ marginBottom: 24, flexWrap: "wrap" }}>
        <button className={tab === "overview" ? "chip active" : "chip"} onClick={() => setTab("overview")}>Overview</button>
        <button className={tab === "members" ? "chip active" : "chip"} onClick={() => setTab("members")}>Members ({data.members.length})</button>
        <button className={tab === "applications" ? "chip active" : "chip"} onClick={() => setTab("applications")}>Applications {data.applications.length > 0 ? `(${data.applications.length})` : ""}</button>
        <button className={tab === "events" ? "chip active" : "chip"} onClick={() => setTab("events")}>Events ({data.events.length})</button>
        <button className={tab === "meetings" ? "chip active" : "chip"} onClick={() => setTab("meetings")}>Attendance</button>
        <button className={tab === "announcements" ? "chip active" : "chip"} onClick={() => setTab("announcements")}>Announcements</button>
        <button className={tab === "gallery" ? "chip active" : "chip"} onClick={() => setTab("gallery")}>Gallery</button>
        <button className={tab === "documents" ? "chip active" : "chip"} onClick={() => setTab("documents")}>Documents</button>
        <button className={tab === "history" ? "chip active" : "chip"} onClick={() => setTab("history")}>History</button>
        <button className={tab === "analytics" ? "chip active" : "chip"} onClick={() => setTab("analytics")}>Analytics</button>
      </div>

      {tab === "overview" && <OverviewTab club={data.club} canEdit={isAdminRole} notify={notify} onSaved={reload} />}
      {tab === "members" && <MembersTab members={data.members} canManage={isAdminRole} authUser={authUser} notify={notify} onChange={reload} />}
      {tab === "applications" && <ApplicationsTab applications={data.applications} notify={notify} onChange={reload} />}
      {tab === "events" && <EventsTab clubId={clubId} campusId={campusId} events={data.events} authUser={authUser} notify={notify} onChange={reload} />}
      {tab === "meetings" && <MeetingsTab clubId={clubId} meetings={data.meetings} members={data.members} authUser={authUser} notify={notify} onChange={reload} />}
      {tab === "announcements" && <AnnouncementsTab clubId={clubId} announcements={data.announcements} notify={notify} onChange={reload} />}
      {tab === "gallery" && <GalleryTab clubId={clubId} gallery={data.gallery} authUser={authUser} notify={notify} onChange={reload} />}
      {tab === "documents" && <DocumentsTab clubId={clubId} documents={data.documents} authUser={authUser} notify={notify} onChange={reload} />}
      {tab === "history" && <HistoryTab history={data.membership_history} />}
      {tab === "analytics" && <AnalyticsTab club={data.club} events={data.events} growth={data.member_growth} meetings={data.meetings} applications={data.applications} />}
    </section>
  );
}

function OverviewTab({ club, canEdit, notify, onSaved }) {
  const [form, setForm] = useState({
    name: club.name || "", category: club.category || "",
    description: club.description || "", logoUrl: club.logo_url || "",
  });
  const [saving, setSaving] = useState(false);
  const change = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const [recruitForm, setRecruitForm] = useState({
    recruitmentMode: club.recruitment_mode || "open", recruitmentMessage: club.recruitment_message || "",
  });
  const [savingRecruit, setSavingRecruit] = useState(false);

  return (
    <>
      <div className="profile-box" style={{ maxWidth: 560 }}>
        <h3>Club profile</h3>
        {!canEdit && <p style={{ marginBottom: 12 }}>Only the club&rsquo;s owner or president can edit these details. Ask them, or manage members/events from here.</p>}
        <label>Name
          <input value={form.name} onChange={(e) => change("name", e.target.value)} disabled={!canEdit} />
        </label>
        <label>Category
          <input value={form.category} onChange={(e) => change("category", e.target.value)} disabled={!canEdit} placeholder="e.g. Technical, Cultural, Sports" />
        </label>
        <label>Description
          <textarea value={form.description} onChange={(e) => change("description", e.target.value)} disabled={!canEdit} rows={4} />
        </label>
        <label>Logo URL (optional)
          <input value={form.logoUrl} onChange={(e) => change("logoUrl", e.target.value)} disabled={!canEdit} placeholder="https://…" />
        </label>
        {canEdit && (
          <button
            className="primary wide"
            disabled={saving || !form.name.trim()}
            onClick={async () => {
              try {
                setSaving(true);
                await clubApi.updateClubProfile(club.id, form);
                notify("Club profile saved");
                onSaved();
              } catch (err) {
                notify(err.message || "Could not save club profile");
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        )}
      </div>

      <div className="profile-box" style={{ maxWidth: 560, marginTop: 16 }}>
        <h3>Recruitment</h3>
        {!canEdit && <p style={{ marginBottom: 12 }}>Currently: <b>{RECRUITMENT_LABEL[club.recruitment_mode] || club.recruitment_mode}</b></p>}
        {canEdit && (
          <>
            <label>How students join
              <select value={recruitForm.recruitmentMode} onChange={(e) => setRecruitForm((f) => ({ ...f, recruitmentMode: e.target.value }))}>
                <option value="open">Open — instant join</option>
                <option value="application">Application required — a leader reviews each request</option>
                <option value="closed">Closed — not accepting new members</option>
              </select>
            </label>
            <label>Message shown to applicants (optional)
              <textarea
                rows={2}
                value={recruitForm.recruitmentMessage}
                onChange={(e) => setRecruitForm((f) => ({ ...f, recruitmentMessage: e.target.value }))}
                placeholder="e.g. Tell us why you want to join and any relevant experience."
              />
            </label>
            <button
              className="primary wide"
              disabled={savingRecruit}
              onClick={async () => {
                try {
                  setSavingRecruit(true);
                  await clubApi.updateClubRecruitment(club.id, recruitForm);
                  notify("Recruitment settings saved");
                  onSaved();
                } catch (err) {
                  notify(err.message || "Could not save recruitment settings");
                } finally {
                  setSavingRecruit(false);
                }
              }}
            >
              {savingRecruit ? "Saving…" : "Save recruitment settings"}
            </button>
          </>
        )}
      </div>
    </>
  );
}

function MembersTab({ members, canManage, authUser, notify, onChange }) {
  const [busyId, setBusyId] = useState(null);
  const ownerCount = members.filter((m) => m.role === "owner").length;

  const changeRole = async (member, role) => {
    try {
      setBusyId(member.id);
      await clubApi.setClubMemberRole(member.id, role);
      notify(`${member.name || "Member"} is now ${ROLE_LABEL[role]}`);
      onChange();
    } catch (err) {
      notify(err.message || "Could not update role");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (member) => {
    if (!window.confirm(`Remove ${member.name || "this member"} from the club?`)) return;
    try {
      setBusyId(member.id);
      await clubApi.removeClubMember(member.id);
      notify("Member removed");
      onChange();
    } catch (err) {
      notify(err.message || "Could not remove member");
    } finally {
      setBusyId(null);
    }
  };

  if (!members.length) return <EmptyState icon={<HiUserGroup />} title="No members yet" />;

  return (
    <div className="profile-box">
      {members.map((m) => (
        <div className="club-roster-row" key={m.id}>
          <div>
            <b>{m.name || "Unnamed"}</b>
            <small style={{ display: "block", color: "var(--muted)" }}>{m.usn || m.course || "—"}</small>
          </div>
          {canManage ? (
            <select
              value={m.role}
              disabled={busyId === m.id || (m.role === "owner" && ownerCount <= 1)}
              onChange={(e) => changeRole(m, e.target.value)}
            >
              {ALL_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          ) : (
            <span className="role-badge">{ROLE_LABEL[m.role]}</span>
          )}
          {(canManage || m.user_id === authUser?.id) && (
            <button
              className="ghost"
              disabled={busyId === m.id || (m.role === "owner" && ownerCount <= 1)}
              title={m.role === "owner" && ownerCount <= 1 ? "A club needs at least one owner" : "Remove"}
              onClick={() => remove(m)}
            >
              <HiTrash />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function EventsTab({ clubId, campusId, events, authUser, notify, onChange }) {
  const [modal, setModal] = useState(null);
  const [rosterFor, setRosterFor] = useState(null);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
        <button className="primary" onClick={() => setModal({})}><HiPlus /> New event</button>
      </div>
      {events.length === 0 && <EmptyState icon={<HiCalendarDays />} title="No events yet" text="Create your club's first event." />}
      <div className="resource-list">
        {events.map((ev) => (
          <article className="resource-row" key={ev.id}>
            <div className="resource-icon"><HiCalendarDays /></div>
            <div>
              <b>{ev.title}</b>
              <small>
                {new Date(ev.event_date).toLocaleString()} · {ev.attendees}{ev.capacity ? `/${ev.capacity}` : ""} registered
                {" · "}{ev.checked_in_count || 0} checked in
                {" · "}{ev.published ? "Published" : "Draft"} · {ev.registration_status}
                {ev.approval_status === "pending" && " · ⚠ Waiting for admin approval"}
                {ev.approval_status === "rejected" && ` · Rejected by admin${ev.rejection_reason ? `: ${ev.rejection_reason}` : ""}`}
                {ev.avg_rating ? ` · ★ ${ev.avg_rating} (${ev.feedback_count})` : ""}
              </small>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button onClick={() => setRosterFor(ev)}><HiQrCode /> Roster &amp; check-in</button>
              <button onClick={() => setModal(ev)}><HiPencilSquare /> Edit</button>
              <button
                className="ghost"
                onClick={async () => {
                  try { await clubApi.setEventCertificatesEnabled(ev.id, !ev.certificates_enabled); notify(ev.certificates_enabled ? "Certificates turned off" : "Certificates enabled -- checked-in attendees can now download theirs"); onChange(); }
                  catch (err) { notify(err.message || "Could not update certificates"); }
                }}
              >
                {ev.certificates_enabled ? "Disable certificates" : "Enable certificates"}
              </button>
              {ev.registration_status !== "CANCELLED" && (
                <button
                  className="ghost"
                  onClick={async () => {
                    if (!window.confirm(`Cancel "${ev.title}"? Registered students will still see it as cancelled.`)) return;
                    try { await clubApi.cancelClubEvent(ev.id); notify("Event cancelled"); onChange(); }
                    catch (err) { notify(err.message || "Could not cancel event"); }
                  }}
                >
                  <HiTrash /> Cancel
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      {modal && (
        <ClubEventForm
          event={modal}
          clubId={clubId}
          campusId={campusId}
          authUser={authUser}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); onChange(); }}
          notify={notify}
        />
      )}
      {rosterFor && (
        <EventRosterModal event={rosterFor} onClose={() => setRosterFor(null)} notify={notify} />
      )}
    </div>
  );
}

// Roster + check-in + attendance export for one event. Check-in accepts
// either a pasted/typed ticket token or, where the browser supports it, a
// live camera scan via the native BarcodeDetector API -- no QR-decoding
// dependency needed for that, and manual entry always works as a fallback
// (the same posture this app already takes for pickup codes elsewhere).
function EventRosterModal({ event, onClose, notify }) {
  const [roster, setRoster] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tokenInput, setTokenInput] = useState("");
  const [checkingIn, setCheckingIn] = useState(false);
  const [scanning, setScanning] = useState(false);
  const videoRef = React.useRef(null);
  const streamRef = React.useRef(null);
  const scanTimerRef = React.useRef(null);

  const load = async () => {
    try {
      setLoading(true);
      setRoster(await getEventRoster(event.id));
    } catch (err) {
      notify(err.message || "Could not load roster");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [event.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const stopScan = () => {
    if (scanTimerRef.current) clearInterval(scanTimerRef.current);
    scanTimerRef.current = null;
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  };

  useEffect(() => () => stopScan(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const doCheckin = async (token) => {
    try {
      setCheckingIn(true);
      const result = await checkinEventTicket(token);
      notify(`${result.name || "Attendee"} checked in`);
      setTokenInput("");
      await load();
    } catch (err) {
      const msg = err.message || "";
      if (msg.includes("TICKET_ALREADY_USED")) notify("That ticket was already used to check in.");
      else if (msg.includes("TICKET_INVALID")) notify("That ticket code isn't valid for this event.");
      else notify(msg || "Could not check in this ticket");
    } finally {
      setCheckingIn(false);
    }
  };

  const startScan = async () => {
    if (!("BarcodeDetector" in window)) {
      notify("Camera scanning isn't supported in this browser -- type or paste the ticket code instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      setScanning(true);
      scanTimerRef.current = setInterval(async () => {
        if (!videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes.length > 0) {
            stopScan();
            doCheckin(codes[0].rawValue);
          }
        } catch {
          // transient decode failures are expected between frames -- ignore
        }
      }, 400);
    } catch (err) {
      notify("Couldn't access the camera -- type or paste the ticket code instead.");
    }
  };

  const exportCsv = () => {
    if (!roster || roster.length === 0) { notify("Nothing to export yet"); return; }
    const header = ["Name", "USN", "Email", "Phone", "Status", "Checked in at", "Registered at"];
    const rows = roster.map((r) => [
      r.name || "", r.usn || "", r.email || "", r.phone || "", r.status,
      r.checked_in_at ? new Date(r.checked_in_at).toLocaleString() : "",
      r.registered_at ? new Date(r.registered_at).toLocaleString() : "",
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${event.title.replace(/[^a-zA-Z0-9._-]/g, "_")}-attendance.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const confirmed = (roster || []).filter((r) => r.status === "confirmed");
  const waitlisted = (roster || []).filter((r) => r.status === "waitlisted");
  const checkedInCount = confirmed.filter((r) => r.checked_in_at).length;

  return (
    <Modal kicker="EVENT" title={`${event.title} — roster`} onClose={() => { stopScan(); onClose(); }}>
      <div className="analytics-grid" style={{ marginBottom: 16 }}>
        <StatTile label="Registered" value={confirmed.length} />
        <StatTile label="Checked in" value={checkedInCount} />
        <StatTile label="Waitlisted" value={waitlisted.length} />
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input
          placeholder="Paste or type a ticket code"
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && tokenInput.trim()) doCheckin(tokenInput.trim()); }}
          style={{ flex: 1, minWidth: 180 }}
        />
        <button className="primary" disabled={checkingIn || !tokenInput.trim()} onClick={() => doCheckin(tokenInput.trim())}>
          {checkingIn ? "Checking in…" : "Check in"}
        </button>
        {!scanning ? (
          <button onClick={startScan}><HiCamera /> Scan with camera</button>
        ) : (
          <button className="ghost" onClick={stopScan}><HiXCircle /> Stop scanning</button>
        )}
        <button onClick={exportCsv}><HiArrowDownTray /> Export attendance CSV</button>
      </div>

      {scanning && (
        <video ref={videoRef} muted playsInline style={{ width: "100%", maxWidth: 360, borderRadius: 10, marginBottom: 12 }} />
      )}

      {loading ? <LoadingState label="Loading roster…" /> : (
        <div className="profile-box" style={{ maxHeight: 320, overflowY: "auto" }}>
          {(roster || []).length === 0 && <EmptyState title="No registrations yet" />}
          {(roster || []).map((r, i) => (
            <div className="club-roster-row" key={r.registration_id || `wait-${i}`}>
              <div>
                <b>{r.name || "Unnamed"}</b>
                <small style={{ display: "block", color: "var(--muted)" }}>
                  {r.usn || r.phone || "—"} {r.status === "waitlisted" ? `· Waitlist #${r.waitlist_position}` : ""}
                </small>
              </div>
              <span className="role-badge">
                {r.status === "waitlisted" ? "Waitlisted" : r.checked_in_at ? `Checked in ${new Date(r.checked_in_at).toLocaleTimeString()}` : "Not checked in"}
              </span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function ClubEventForm({ event, clubId, campusId, authUser, onClose, onSaved, notify }) {
  const [form, setForm] = useState({
    title: event.title || "", category: event.category || "Club Event",
    description: event.description || "",
    event_date: event.event_date ? new Date(event.event_date).toISOString().slice(0, 16) : "",
    place: event.place || "", capacity: event.capacity || "", published: event.published !== false,
  });
  const [coverFile, setCoverFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const change = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal kicker="CLUB EVENT" title={event.id ? "Edit event" : "New event"} onClose={onClose}>
      {event.approval_status === "pending" && (
        <p style={{ marginBottom: 12 }}>This event is waiting for a campus admin to approve it -- it won&rsquo;t be visible to students until then.</p>
      )}
      {event.approval_status === "rejected" && (
        <p style={{ marginBottom: 12 }}>An admin sent this back{event.rejection_reason ? `: "${event.rejection_reason}"` : "."} Saving changes resubmits it for review.</p>
      )}
      <label>Title<input value={form.title} onChange={(e) => change("title", e.target.value)} /></label>
      <label>Category<input value={form.category} onChange={(e) => change("category", e.target.value)} /></label>
      <label>Description<textarea rows={3} value={form.description} onChange={(e) => change("description", e.target.value)} /></label>
      <label>Date &amp; time<input type="datetime-local" value={form.event_date} onChange={(e) => change("event_date", e.target.value)} /></label>
      <label>Place<input value={form.place} onChange={(e) => change("place", e.target.value)} /></label>
      <label>Capacity (optional)<input type="number" min="1" value={form.capacity} onChange={(e) => change("capacity", e.target.value)} /></label>
      <label>Cover image (optional)
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setCoverFile(e.target.files?.[0] || null)} />
      </label>
      {event.cover_image_url && !coverFile && (
        <img src={event.cover_image_url} alt="" style={{ maxWidth: 160, borderRadius: 8, marginBottom: 12 }} />
      )}
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input type="checkbox" checked={form.published} onChange={(e) => change("published", e.target.checked)} style={{ width: "auto" }} />
        Published (visible to students, once approved)
      </label>
      <button
        className="primary wide"
        disabled={saving || !form.title.trim() || !form.event_date}
        onClick={async () => {
          try {
            setSaving(true);
            const saved = await clubApi.upsertClubEvent(clubId, { ...event, ...form, campus_id: campusId, event_date: new Date(form.event_date).toISOString() }, authUser?.id);
            if (coverFile) await uploadEventCoverImage(saved.id, coverFile);
            notify("Event saved");
            onSaved();
          } catch (err) {
            notify(err.message || "Could not save event");
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? "Saving…" : "Save event"}
      </button>
    </Modal>
  );
}

function AnalyticsTab({ club, events, growth, meetings, applications }) {
  const upcoming = events.filter((e) => new Date(e.event_date) > new Date() && e.registration_status !== "CANCELLED").length;
  const totalAttendance = events.reduce((sum, e) => sum + (e.attendees || 0), 0);
  const avgAttendance = events.length ? Math.round(totalAttendance / events.length) : 0;
  const totalCheckedIn = events.reduce((sum, e) => sum + (e.checked_in_count || 0), 0);
  const showUpRate = totalAttendance ? Math.round((totalCheckedIn / totalAttendance) * 100) : null;
  const ratedEvents = events.filter((e) => e.avg_rating);
  const avgRating = ratedEvents.length
    ? (ratedEvents.reduce((sum, e) => sum + Number(e.avg_rating), 0) / ratedEvents.length).toFixed(1)
    : null;

  const totalMarked = meetings.reduce((sum, m) => sum + (m.marked || 0), 0);
  const totalPresent = meetings.reduce((sum, m) => sum + (m.present || 0), 0);
  const meetingAttendanceRate = totalMarked ? Math.round((totalPresent / totalMarked) * 100) : null;

  return (
    <div>
      <div className="analytics-grid">
        <StatTile label="Members" value={club.members} />
        <StatTile label="Total events" value={club.events} sub={`${upcoming} upcoming`} />
        <StatTile label="Total registrations" value={totalAttendance} />
        <StatTile label="Avg. per event" value={avgAttendance} />
        <StatTile label="Checked in at events" value={totalCheckedIn} sub={showUpRate === null ? undefined : `${showUpRate}% show-up rate`} />
        <StatTile label="Avg. event rating" value={avgRating === null ? "—" : `★ ${avgRating}`} />
        <StatTile label="Meetings logged" value={meetings.length} />
        <StatTile label="Meeting attendance rate" value={meetingAttendanceRate === null ? "—" : `${meetingAttendanceRate}%`} />
        <StatTile label="Pending applications" value={applications.length} />
      </div>
      <TrendChart
        title="New members (last 30 days)"
        points={growth.map((g) => ({ x: g.day, y: g.new_members }))}
        emptyText="No new members in the last 30 days"
      />
    </div>
  );
}

function ApplicationsTab({ applications, notify, onChange }) {
  const [busyId, setBusyId] = useState(null);

  const decide = async (app, decision) => {
    try {
      setBusyId(app.id);
      await clubApi.reviewClubApplication(app.id, decision);
      notify(decision === "approved" ? `${app.name || "Applicant"} approved` : `${app.name || "Applicant"} rejected`);
      onChange();
    } catch (err) {
      notify(err.message || "Could not review this application");
    } finally {
      setBusyId(null);
    }
  };

  if (!applications.length) {
    return <EmptyState icon={<HiClipboardDocumentCheck />} title="No pending applications" text="New requests to join will show up here." />;
  }

  return (
    <div className="resource-list">
      {applications.map((app) => (
        <article className="resource-row" key={app.id}>
          <div className="resource-icon"><HiClipboardDocumentCheck /></div>
          <div>
            <b>{app.name || "Unnamed"}</b>
            <small>
              {app.usn || app.course || "—"}{app.year ? ` · Year ${app.year}` : ""} · Applied {new Date(app.created_at).toLocaleDateString()}
            </small>
            {app.message && <small style={{ display: "block", marginTop: 4 }}>&ldquo;{app.message}&rdquo;</small>}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button disabled={busyId === app.id} onClick={() => decide(app, "approved")}><HiCheck /> Approve</button>
            <button className="ghost" disabled={busyId === app.id} onClick={() => decide(app, "rejected")}><HiXCircle /> Reject</button>
          </div>
        </article>
      ))}
    </div>
  );
}

function AnnouncementsTab({ clubId, announcements, notify, onChange }) {
  const [form, setForm] = useState({ title: "", body: "", pinned: false });
  const [posting, setPosting] = useState(false);

  const post = async () => {
    try {
      setPosting(true);
      await clubApi.publishClubAnnouncement(clubId, form);
      notify("Announcement posted to every member");
      setForm({ title: "", body: "", pinned: false });
      onChange();
    } catch (err) {
      notify(err.message || "Could not post announcement");
    } finally {
      setPosting(false);
    }
  };

  return (
    <div>
      <div className="profile-box" style={{ maxWidth: 560, marginBottom: 20 }}>
        <h3>New announcement</h3>
        <label>Title<input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} /></label>
        <label>Message<textarea rows={3} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} /></label>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={form.pinned} onChange={(e) => setForm((f) => ({ ...f, pinned: e.target.checked }))} style={{ width: "auto" }} />
          Pin to top
        </label>
        <button className="primary wide" disabled={posting || !form.title.trim()} onClick={post}>
          {posting ? "Posting…" : "Post to all members"}
        </button>
      </div>

      {announcements.length === 0 && <EmptyState icon={<HiMegaphone />} title="No announcements yet" />}
      <div className="resource-list">
        {announcements.map((a) => (
          <article className="resource-row" key={a.id}>
            <div className="resource-icon"><HiMegaphone /></div>
            <div>
              <b>{a.pinned ? "📌 " : ""}{a.title}</b>
              <small>{a.author_name || "Club leader"} · {new Date(a.created_at).toLocaleString()}</small>
              {a.body && <small style={{ display: "block", marginTop: 4 }}>{a.body}</small>}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                className="ghost"
                onClick={async () => {
                  try { await clubApi.setClubAnnouncementPinned(a.id, !a.pinned); onChange(); }
                  catch (err) { notify(err.message || "Could not update announcement"); }
                }}
              >
                {a.pinned ? "Unpin" : "Pin"}
              </button>
              <button
                className="ghost"
                onClick={async () => {
                  if (!window.confirm("Delete this announcement?")) return;
                  try { await clubApi.deleteClubAnnouncement(a.id); notify("Announcement deleted"); onChange(); }
                  catch (err) { notify(err.message || "Could not delete announcement"); }
                }}
              >
                <HiTrash />
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function GalleryTab({ clubId, gallery, authUser, notify, onChange }) {
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState(false);

  const onFile = async (file) => {
    if (!file) return;
    try {
      setUploading(true);
      await clubApi.uploadClubGalleryImage(clubId, caption, file, authUser?.id);
      notify("Photo added");
      setCaption("");
      onChange();
    } catch (err) {
      notify(err.message || "Could not upload photo");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <div className="profile-box" style={{ maxWidth: 560, marginBottom: 20 }}>
        <h3>Add a photo</h3>
        <label>Caption (optional)<input value={caption} onChange={(e) => setCaption(e.target.value)} /></label>
        <label className="file-drop">
          <input type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading} onChange={(e) => onFile(e.target.files?.[0])} />
          {uploading ? "Uploading…" : "Choose a photo…"}
        </label>
      </div>

      {gallery.length === 0 && <EmptyState icon={<HiPhoto />} title="No photos yet" />}
      <div className="club-gallery-grid">
        {gallery.map((g) => (
          <figure className="club-gallery-item" key={g.id}>
            <img src={g.image_url} alt={g.caption || "Club photo"} loading="lazy" />
            {g.caption && <figcaption>{g.caption}</figcaption>}
            <button
              className="club-gallery-remove"
              title="Remove photo"
              onClick={async () => {
                if (!window.confirm("Remove this photo?")) return;
                try { await clubApi.deleteClubGalleryItem(g); notify("Photo removed"); onChange(); }
                catch (err) { notify(err.message || "Could not remove photo"); }
              }}
            >
              <HiTrash />
            </button>
          </figure>
        ))}
      </div>
    </div>
  );
}

function DocumentsTab({ clubId, documents, authUser, notify, onChange }) {
  const [form, setForm] = useState({ title: "", description: "", category: "" });
  const [uploading, setUploading] = useState(false);

  const onFile = async (file) => {
    if (!file) return;
    try {
      setUploading(true);
      await clubApi.uploadClubDocument(clubId, form, file, authUser?.id);
      notify("Document uploaded");
      setForm({ title: "", description: "", category: "" });
      onChange();
    } catch (err) {
      notify(err.message || "Could not upload document");
    } finally {
      setUploading(false);
    }
  };

  const view = async (doc) => {
    try {
      const url = await clubApi.getClubDocumentUrl(doc.file_path);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      notify(err.message || "Could not open this document");
    }
  };

  return (
    <div>
      <div className="profile-box" style={{ maxWidth: 560, marginBottom: 20 }}>
        <h3>Upload a document</h3>
        <label>Title<input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} /></label>
        <label>Category (optional)<input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="e.g. Constitution, Minutes, Form" /></label>
        <label>Description (optional)<textarea rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></label>
        <label className="file-drop">
          <input type="file" accept=".pdf,.doc,.docx,image/png,image/jpeg" disabled={uploading} onChange={(e) => onFile(e.target.files?.[0])} />
          {uploading ? "Uploading…" : "Choose a file…"}
        </label>
      </div>

      {documents.length === 0 && <EmptyState icon={<HiDocumentText />} title="No documents yet" />}
      <div className="resource-list">
        {documents.map((d) => (
          <article className="resource-row" key={d.id}>
            <div className="resource-icon"><HiDocumentText /></div>
            <div>
              <b>{d.title}</b>
              <small>{d.category || "Document"} · {d.uploaded_by_name || "Club leader"} · {new Date(d.created_at).toLocaleDateString()}</small>
              {d.description && <small style={{ display: "block", marginTop: 4 }}>{d.description}</small>}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => view(d)}><HiArrowDownTray /> View</button>
              <button
                className="ghost"
                onClick={async () => {
                  if (!window.confirm(`Delete "${d.title}"?`)) return;
                  try { await clubApi.deleteClubDocument(d); notify("Document deleted"); onChange(); }
                  catch (err) { notify(err.message || "Could not delete document"); }
                }}
              >
                <HiTrash />
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function MeetingsTab({ clubId, meetings, members, authUser, notify, onChange }) {
  const [modal, setModal] = useState(null);
  const [attendanceFor, setAttendanceFor] = useState(null);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
        <button className="primary" onClick={() => setModal({})}><HiPlus /> Log a meeting</button>
      </div>
      {meetings.length === 0 && <EmptyState icon={<HiClock />} title="No meetings logged yet" text="Log a meeting to start tracking attendance." />}
      <div className="resource-list">
        {meetings.map((m) => (
          <article className="resource-row" key={m.id}>
            <div className="resource-icon"><HiClock /></div>
            <div>
              <b>{m.title}</b>
              <small>
                {new Date(m.meeting_date).toLocaleString()} · {m.present}/{m.marked} present
                {m.marked > 0 ? "" : " · attendance not marked yet"}
              </small>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setAttendanceFor(m)}><HiClipboardDocumentCheck /> Attendance</button>
              <button
                className="ghost"
                onClick={async () => {
                  if (!window.confirm(`Delete "${m.title}"? This also deletes its attendance record.`)) return;
                  try { await clubApi.deleteClubMeeting(m.id); notify("Meeting deleted"); onChange(); }
                  catch (err) { notify(err.message || "Could not delete meeting"); }
                }}
              >
                <HiTrash />
              </button>
            </div>
          </article>
        ))}
      </div>
      {modal && (
        <ClubMeetingForm
          meeting={modal}
          clubId={clubId}
          authUser={authUser}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); onChange(); }}
          notify={notify}
        />
      )}
      {attendanceFor && (
        <AttendanceModal
          meeting={attendanceFor}
          members={members}
          onClose={() => setAttendanceFor(null)}
          onSaved={() => { setAttendanceFor(null); onChange(); }}
          notify={notify}
        />
      )}
    </div>
  );
}

function ClubMeetingForm({ meeting, clubId, authUser, onClose, onSaved, notify }) {
  const [form, setForm] = useState({
    title: meeting.title || "",
    meeting_date: meeting.meeting_date ? new Date(meeting.meeting_date).toISOString().slice(0, 16) : "",
    notes: meeting.notes || "",
  });
  const [saving, setSaving] = useState(false);

  return (
    <Modal kicker="CLUB MEETING" title={meeting.id ? "Edit meeting" : "Log a meeting"} onClose={onClose}>
      <label>Title<input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} /></label>
      <label>Date &amp; time<input type="datetime-local" value={form.meeting_date} onChange={(e) => setForm((f) => ({ ...f, meeting_date: e.target.value }))} /></label>
      <label>Notes (optional)<textarea rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></label>
      <button
        className="primary wide"
        disabled={saving || !form.title.trim() || !form.meeting_date}
        onClick={async () => {
          try {
            setSaving(true);
            await clubApi.upsertClubMeeting(clubId, { ...meeting, ...form, meeting_date: new Date(form.meeting_date).toISOString() }, authUser?.id);
            notify("Meeting saved");
            onSaved();
          } catch (err) {
            notify(err.message || "Could not save meeting");
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? "Saving…" : "Save meeting"}
      </button>
    </Modal>
  );
}

const ATTENDANCE_STATUSES = ["present", "absent", "excused"];

function AttendanceModal({ meeting, members, onClose, onSaved, notify }) {
  const [statuses, setStatuses] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    clubApi.getMeetingAttendance(meeting.id).then((rows) => {
      const map = {};
      rows.forEach((r) => { map[r.user_id] = r.status; });
      setStatuses(map);
    }).finally(() => setLoading(false));
  }, [meeting.id]);

  const setStatus = (userId, status) => setStatuses((s) => ({ ...s, [userId]: status }));

  return (
    <Modal kicker="ATTENDANCE" title={meeting.title} onClose={onClose}>
      {loading ? <LoadingState label="Loading attendance…" /> : (
        <>
          <div className="resource-list" style={{ maxHeight: 360, overflowY: "auto" }}>
            {members.map((m) => (
              <div className="club-roster-row" key={m.id}>
                <div><b>{m.name || "Unnamed"}</b></div>
                <select value={statuses[m.user_id] || "present"} onChange={(e) => setStatus(m.user_id, e.target.value)}>
                  {ATTENDANCE_STATUSES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
                </select>
              </div>
            ))}
          </div>
          <button
            className="primary wide"
            disabled={saving}
            onClick={async () => {
              try {
                setSaving(true);
                const entries = members.map((m) => ({ user_id: m.user_id, status: statuses[m.user_id] || "present" }));
                await clubApi.markMeetingAttendance(meeting.id, entries);
                notify("Attendance saved");
                onSaved();
              } catch (err) {
                notify(err.message || "Could not save attendance");
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving…" : "Save attendance"}
          </button>
        </>
      )}
    </Modal>
  );
}

const HISTORY_LABEL = {
  joined: "joined the club", left: "left the club", removed: "was removed from the club", role_changed: "role changed",
};

function HistoryTab({ history }) {
  if (!history.length) return <EmptyState icon={<HiClock />} title="No membership history yet" />;
  return (
    <div className="resource-list">
      {history.map((h) => (
        <article className="resource-row" key={h.id}>
          <div className="resource-icon"><HiClock /></div>
          <div>
            <b>{h.name || "A member"}</b>
            <small>
              {HISTORY_LABEL[h.event_type] || h.event_type}
              {h.event_type === "role_changed" && h.role ? ` to ${ROLE_LABEL[h.role] || h.role}${h.previous_role ? ` (from ${ROLE_LABEL[h.previous_role] || h.previous_role})` : ""}` : ""}
              {" · "}{new Date(h.created_at).toLocaleString()}
            </small>
          </div>
        </article>
      ))}
    </div>
  );
}
