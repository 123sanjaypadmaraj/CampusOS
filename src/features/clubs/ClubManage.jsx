import React, { useEffect, useState } from "react";
import {
  HiXMark,
  HiPencilSquare,
  HiPlus,
  HiTrash,
  HiUserGroup,
  HiCalendarDays,
  HiArrowLeft,
} from "react-icons/hi2";
import { LoadingState, EmptyState, ErrorState } from "../../components/ui/States";
import { TrendChart, StatTile } from "../../components/ui/Charts";
import * as clubApi from "./api";

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

const LEADER_ROLES = ["owner", "president", "vice_president", "secretary", "coordinator"];
const ALL_ROLES = [...LEADER_ROLES, "member"];
const ROLE_LABEL = {
  owner: "Owner", president: "President", vice_president: "Vice President",
  secretary: "Secretary", coordinator: "Coordinator", member: "Member",
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

      <div className="chips" style={{ marginBottom: 24 }}>
        <button className={tab === "overview" ? "chip active" : "chip"} onClick={() => setTab("overview")}>Overview</button>
        <button className={tab === "members" ? "chip active" : "chip"} onClick={() => setTab("members")}>Members ({data.members.length})</button>
        <button className={tab === "events" ? "chip active" : "chip"} onClick={() => setTab("events")}>Events ({data.events.length})</button>
        <button className={tab === "analytics" ? "chip active" : "chip"} onClick={() => setTab("analytics")}>Analytics</button>
      </div>

      {tab === "overview" && <OverviewTab club={data.club} canEdit={isAdminRole} notify={notify} onSaved={reload} />}
      {tab === "members" && <MembersTab members={data.members} canManage={isAdminRole} authUser={authUser} notify={notify} onChange={reload} />}
      {tab === "events" && <EventsTab clubId={clubId} campusId={campusId} events={data.events} authUser={authUser} notify={notify} onChange={reload} />}
      {tab === "analytics" && <AnalyticsTab club={data.club} events={data.events} growth={data.member_growth} />}
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

  return (
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
                {" · "}{ev.published ? "Published" : "Draft"} · {ev.registration_status}
              </small>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setModal(ev)}><HiPencilSquare /> Edit</button>
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
    </div>
  );
}

function ClubEventForm({ event, clubId, campusId, authUser, onClose, onSaved, notify }) {
  const [form, setForm] = useState({
    title: event.title || "", category: event.category || "Club Event",
    description: event.description || "",
    event_date: event.event_date ? new Date(event.event_date).toISOString().slice(0, 16) : "",
    place: event.place || "", capacity: event.capacity || "", published: event.published !== false,
  });
  const [saving, setSaving] = useState(false);
  const change = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal kicker="CLUB EVENT" title={event.id ? "Edit event" : "New event"} onClose={onClose}>
      <label>Title<input value={form.title} onChange={(e) => change("title", e.target.value)} /></label>
      <label>Category<input value={form.category} onChange={(e) => change("category", e.target.value)} /></label>
      <label>Description<textarea rows={3} value={form.description} onChange={(e) => change("description", e.target.value)} /></label>
      <label>Date &amp; time<input type="datetime-local" value={form.event_date} onChange={(e) => change("event_date", e.target.value)} /></label>
      <label>Place<input value={form.place} onChange={(e) => change("place", e.target.value)} /></label>
      <label>Capacity (optional)<input type="number" min="1" value={form.capacity} onChange={(e) => change("capacity", e.target.value)} /></label>
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input type="checkbox" checked={form.published} onChange={(e) => change("published", e.target.checked)} style={{ width: "auto" }} />
        Published (visible to students)
      </label>
      <button
        className="primary wide"
        disabled={saving || !form.title.trim() || !form.event_date}
        onClick={async () => {
          try {
            setSaving(true);
            await clubApi.upsertClubEvent(clubId, { ...event, ...form, campus_id: campusId, event_date: new Date(form.event_date).toISOString() }, authUser?.id);
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

function AnalyticsTab({ club, events, growth }) {
  const upcoming = events.filter((e) => new Date(e.event_date) > new Date() && e.registration_status !== "CANCELLED").length;
  const totalAttendance = events.reduce((sum, e) => sum + (e.attendees || 0), 0);
  const avgAttendance = events.length ? Math.round(totalAttendance / events.length) : 0;

  return (
    <div>
      <div className="analytics-grid">
        <StatTile label="Members" value={club.members} />
        <StatTile label="Total events" value={club.events} sub={`${upcoming} upcoming`} />
        <StatTile label="Total registrations" value={totalAttendance} />
        <StatTile label="Avg. per event" value={avgAttendance} />
      </div>
      <TrendChart
        title="New members (last 30 days)"
        points={growth.map((g) => ({ x: g.day, y: g.new_members }))}
        emptyText="No new members in the last 30 days"
      />
    </div>
  );
}
