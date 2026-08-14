import React, { useEffect, useState } from "react";
import {
  HiXMark,
  HiPlus,
  HiPencilSquare,
  HiArchiveBoxArrowDown,
  HiMegaphone,
  HiTrash,
  HiCalendarDays,
  HiUserGroup,
} from "react-icons/hi2";
import { LoadingState, EmptyState, ErrorState } from "../../components/ui/States";
import * as adminApi from "./api";

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
  ["food", "Food & Canteens"],
  ["announcements", "Announcements"],
  ["events", "Events & Clubs"],
];

export default function AdminCMS({ notify, campusId, authUser }) {
  const [tab, setTab] = useState("food");

  return (
    <section className="page-section admin-cms">
      <div className="section-head">
        <div>
          <span className="section-kicker">CONTROL CENTER</span>
          <h1>Admin CMS</h1>
          <p>Manage the food menu, announcements, events and clubs for your campus.</p>
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

      {tab === "food" && <FoodTab notify={notify} campusId={campusId} />}
      {tab === "announcements" && <AnnouncementsTab notify={notify} campusId={campusId} />}
      {tab === "events" && <EventsClubsTab notify={notify} campusId={campusId} authUser={authUser} />}
    </section>
  );
}

/* =========================================================
   FOOD & CANTEENS
========================================================= */

function FoodTab({ notify, campusId }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [canteens, setCanteens] = useState([]);
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [canteenModal, setCanteenModal] = useState(null); // {} for new, {...canteen} to edit
  const [itemModal, setItemModal] = useState(null);
  const [selectedCanteen, setSelectedCanteen] = useState("all");

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      const [c, i, cat] = await Promise.all([
        adminApi.listCanteensAdmin(campusId),
        adminApi.listFoodItemsAdmin(),
        adminApi.listFoodCategories(),
      ]);
      setCanteens(c);
      setItems(i);
      setCategories(cat);
    } catch (err) {
      setError(err.message || "Could not load food data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [campusId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <LoadingState label="Loading food menu…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  const visibleItems = selectedCanteen === "all" ? items : items.filter((i) => i.canteen_id === selectedCanteen);

  return (
    <div className="admin-panel">
      <div className="section-head">
        <h2>Canteens</h2>
        <button className="primary" onClick={() => setCanteenModal({})}>
          <HiPlus /> New canteen
        </button>
      </div>

      <div className="resource-list">
        {canteens.length === 0 && <EmptyState title="No canteens yet" />}
        {canteens.map((c) => (
          <article className="resource-row" key={c.id}>
            <div>
              <b>{c.name}</b>
              <small>{c.subtitle} · {c.status} · {c.active ? "Active" : "Archived"}</small>
            </div>
            <button onClick={() => setCanteenModal(c)}><HiPencilSquare /> Edit</button>
          </article>
        ))}
      </div>

      <div className="section-head" style={{ marginTop: 32 }}>
        <h2>Menu items</h2>
        <div style={{ display: "flex", gap: 10 }}>
          <select value={selectedCanteen} onChange={(e) => setSelectedCanteen(e.target.value)}>
            <option value="all">All canteens</option>
            {canteens.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button className="primary" onClick={() => setItemModal({ canteen_id: canteens[0]?.id })} disabled={!canteens.length}>
            <HiPlus /> New item
          </button>
        </div>
      </div>

      <div className="resource-list">
        {visibleItems.length === 0 && <EmptyState title="No items" text="Add a canteen first, then add menu items to it." />}
        {visibleItems.map((item) => (
          <article className="resource-row" key={item.id}>
            <div>
              <b>{item.name}</b>
              <small>
                ₹{item.price} · {item.food_categories?.name || "Uncategorised"} ·{" "}
                {item.is_vegetarian ? "Veg" : "Non-veg"} ·{" "}
                {item.active ? (item.available ? "Available" : "Unavailable") : "Archived"}
              </small>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setItemModal(item)}><HiPencilSquare /> Edit</button>
              {item.active && (
                <button onClick={async () => {
                  try { await adminApi.archiveFoodItem(item.id); notify("Item archived"); reload(); }
                  catch (err) { notify(err.message || "Could not archive item"); }
                }}>
                  <HiArchiveBoxArrowDown /> Archive
                </button>
              )}
            </div>
          </article>
        ))}
      </div>

      {canteenModal && (
        <CanteenForm
          canteen={canteenModal}
          onClose={() => setCanteenModal(null)}
          onSaved={() => { setCanteenModal(null); reload(); }}
          notify={notify}
          campusId={campusId}
        />
      )}

      {itemModal && (
        <FoodItemForm
          item={itemModal}
          canteens={canteens}
          categories={categories}
          onClose={() => setItemModal(null)}
          onSaved={() => { setItemModal(null); reload(); }}
          notify={notify}
        />
      )}
    </div>
  );
}

function CanteenForm({ canteen, campusId, onClose, onSaved, notify }) {
  const [form, setForm] = useState({
    name: canteen.name || "", subtitle: canteen.subtitle || "",
    status: canteen.status || "Open", eta_min: canteen.eta_min || 8, eta_max: canteen.eta_max || 15,
    color: canteen.color || "green", active: canteen.active !== false,
  });
  const [saving, setSaving] = useState(false);
  const change = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal kicker="FOOD" title={canteen.id ? "Edit canteen" : "New canteen"} onClose={onClose}>
      <label>Name<input value={form.name} onChange={(e) => change("name", e.target.value)} /></label>
      <label>Subtitle<input value={form.subtitle} onChange={(e) => change("subtitle", e.target.value)} /></label>
      <div className="form-grid">
        <label>Status
          <select value={form.status} onChange={(e) => change("status", e.target.value)}>
            <option>Open</option><option>Busy</option><option>Closed</option>
          </select>
        </label>
        <label>Queue color
          <select value={form.color} onChange={(e) => change("color", e.target.value)}>
            <option value="green">Quiet (green)</option>
            <option value="moderate">Moderate</option>
            <option value="busy">Busy</option>
          </select>
        </label>
        <label>ETA min<input type="number" min="1" value={form.eta_min} onChange={(e) => change("eta_min", e.target.value)} /></label>
        <label>ETA max<input type="number" min="1" value={form.eta_max} onChange={(e) => change("eta_max", e.target.value)} /></label>
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="checkbox" checked={form.active} onChange={(e) => change("active", e.target.checked)} /> Active
      </label>
      <button className="primary wide" disabled={saving || !form.name.trim()} onClick={async () => {
        try { setSaving(true); await adminApi.upsertCanteen(campusId, { ...canteen, ...form }); notify("Canteen saved"); onSaved(); }
        catch (err) { notify(err.message || "Could not save canteen"); } finally { setSaving(false); }
      }}>
        {saving ? "Saving…" : "Save canteen"}
      </button>
    </Modal>
  );
}

function FoodItemForm({ item, canteens, categories, onClose, onSaved, notify }) {
  const [form, setForm] = useState({
    canteen_id: item.canteen_id || canteens[0]?.id || "",
    category_id: item.category_id || "",
    name: item.name || "", description: item.description || "", price: item.price || 0,
    is_vegetarian: item.is_vegetarian !== false, available: item.available !== false,
    active: item.active !== false, featured: Boolean(item.featured),
  });
  const [saving, setSaving] = useState(false);
  const change = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal kicker="FOOD" title={item.id ? "Edit menu item" : "New menu item"} onClose={onClose}>
      <label>Canteen
        <select value={form.canteen_id} onChange={(e) => change("canteen_id", e.target.value)}>
          {canteens.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label>Category
        <select value={form.category_id} onChange={(e) => change("category_id", e.target.value)}>
          <option value="">Uncategorised</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label>Name<input value={form.name} onChange={(e) => change("name", e.target.value)} /></label>
      <label>Description<textarea value={form.description} onChange={(e) => change("description", e.target.value)} /></label>
      <label>Price (₹)<input type="number" min="0" value={form.price} onChange={(e) => change("price", e.target.value)} /></label>
      <div className="form-grid">
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={form.is_vegetarian} onChange={(e) => change("is_vegetarian", e.target.checked)} /> Vegetarian
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={form.available} onChange={(e) => change("available", e.target.checked)} /> Available now
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={form.active} onChange={(e) => change("active", e.target.checked)} /> Active (on menu)
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={form.featured} onChange={(e) => change("featured", e.target.checked)} /> Featured
        </label>
      </div>
      <button className="primary wide" disabled={saving || !form.name.trim() || !form.canteen_id} onClick={async () => {
        try { setSaving(true); await adminApi.upsertFoodItem({ ...item, ...form }); notify("Menu item saved"); onSaved(); }
        catch (err) { notify(err.message || "Could not save item"); } finally { setSaving(false); }
      }}>
        {saving ? "Saving…" : "Save item"}
      </button>
    </Modal>
  );
}

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

  const roles = ["member", "coordinator", "secretary", "vice_president", "president", "owner"];

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
