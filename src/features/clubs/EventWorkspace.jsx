import React, { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  HiXMark, HiPlus, HiTrash, HiPencilSquare, HiCheck, HiArrowDownTray, HiArrowUpTray,
  HiArrowPath, HiUserGroup, HiMagnifyingGlass, HiChevronDown, HiChevronUp,
} from "react-icons/hi2";
import { LoadingState, EmptyState, ErrorState } from "../../components/ui/States";
import { StatTile } from "../../components/ui/Charts";
import { useModalA11y } from "../../hooks/useModalA11y";
import { downloadCsv } from "../../utils/csv";
import * as clubApi from "./api";
import {
  IMPORT_FIELDS, parseDelimited, guessColumnMapping, buildImportRows,
  filterParticipants, sortParticipants, collectExtraKeys,
  splitIntoTeams, nextTeamNames, mulberry32,
  summarize, teamStats, buildParticipantsExport, exportFileName,
} from "./eventParticipants";

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_ROWS = 5000;
const PAGE_ROWS = 200;

const SOURCE_LABEL = { app: "CampusOS", import: "Form / CSV", manual: "Manual" };

function describe(err) {
  // PGRST202 = the RPC doesn't exist on this database yet (migration not applied).
  if (err && err.code === "PGRST202") return "Event Manager isn't set up on this database yet -- the 20260919000100 migration hasn't been applied.";
  return clubApi.describeEventManagerError(err);
}

// The club Event Manager: one place to see everyone attached to an event --
// students who registered in CampusOS *and* people imported from a Google
// Form / CSV -- work them in a table, split them into teams, mark attendance
// and export it all. Opened from the club dashboard's Events tab.
export default function EventWorkspace({ event, onClose, notify }) {
  const titleId = useId();
  const dialogRef = useModalA11y(onClose);
  const eventId = event.id;

  const [tab, setTab] = useState("participants");
  const [participants, setParticipants] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async ({ sync = true } = {}) => {
    try {
      setError("");
      if (sync) await clubApi.syncEventParticipants(eventId);
      const [p, t] = await Promise.all([clubApi.listEventParticipants(eventId), clubApi.listEventTeams(eventId)]);
      setParticipants(p);
      setTeams(t);
    } catch (err) {
      setError(describe(err));
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  const teamsById = useMemo(() => Object.fromEntries(teams.map((t) => [t.id, t])), [teams]);
  const extraKeys = useMemo(() => collectExtraKeys(participants), [participants]);
  const summary = useMemo(() => summarize(participants), [participants]);

  // Optimistic update with per-row rollback: door check-in has to feel
  // instant, but a rejected write must not leave the screen lying. Only the
  // touched rows are restored, so quick successive taps can't clobber each other.
  const optimistic = async (ids, makePatch, serverCall) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const before = new Map();
    setParticipants((list) => list.map((p) => {
      if (!idSet.has(p.id)) return p;
      const patch = makePatch(p);
      if (!patch) return p;
      before.set(p.id, Object.fromEntries(Object.keys(patch).map((k) => [k, p[k]])));
      return { ...p, ...patch };
    }));
    try {
      await serverCall();
    } catch (err) {
      setParticipants((list) => list.map((p) => (before.has(p.id) ? { ...p, ...before.get(p.id) } : p)));
      notify(describe(err));
    }
  };

  const setAttendance = (ids, attended) => {
    const now = new Date().toISOString();
    return optimistic(
      ids,
      (p) => (p.status === "cancelled" || p.attended === attended ? null : { attended, attended_at: attended ? p.attended_at || now : null }),
      () => clubApi.setParticipantsAttendance(eventId, ids, attended),
    );
  };

  const assignTeam = (ids, teamId) => optimistic(
    ids,
    () => ({ team_id: teamId || null }),
    () => clubApi.assignParticipantsToTeams(eventId, ids.map((id) => ({ participant_id: id, team_id: teamId || null }))),
  );

  const ws = {
    event, eventId, participants, teams, teamsById, extraKeys, summary, notify,
    reload: load, setAttendance, assignTeam, setTab, setParticipants, setTeams,
  };

  const TABS = [
    ["participants", `Participants (${summary.total})`],
    ["attendance", `Attendance (${summary.present}/${summary.total})`],
    ["teams", `Teams (${teams.length})`],
    ["import", "Import"],
  ];

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="feature-modal evm-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close"><HiXMark /></button>
        <span className="section-kicker">EVENT MANAGER</span>
        <h2 id={titleId}>{event.title}</h2>

        <div className="evm-tabs" role="tablist">
          {TABS.map(([key, label]) => (
            <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "chip active" : "chip"} onClick={() => setTab(key)}>{label}</button>
          ))}
          <button className="evm-btn evm-refresh" onClick={() => { setLoading(true); load(); }} aria-label="Refresh"><HiArrowPath /> Refresh</button>
        </div>

        {loading ? <LoadingState label="Loading participants…" /> : error ? <ErrorState text={error} onRetry={() => { setLoading(true); load(); }} /> : (
          <>
            {tab === "participants" && <ParticipantsTab ws={ws} />}
            {tab === "attendance" && <AttendanceTab ws={ws} />}
            {tab === "teams" && <TeamsTab ws={ws} />}
            {tab === "import" && <ImportTab ws={ws} />}
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   PARTICIPANTS -- the table
--------------------------------------------------------------------------- */
function ParticipantsTab({ ws }) {
  const { participants, teams, teamsById, extraKeys, summary, event, eventId, notify, setAttendance, assignTeam, reload, setTab } = ws;
  const [query, setQuery] = useState("");
  const [teamFilter, setTeamFilter] = useState("all");
  const [attFilter, setAttFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [showCancelled, setShowCancelled] = useState(false);
  const [showAnswers, setShowAnswers] = useState(false);
  const [sort, setSort] = useState({ key: "name", dir: "asc" });
  const [selected, setSelected] = useState(() => new Set());
  const [limit, setLimit] = useState(PAGE_ROWS);
  const [editing, setEditing] = useState(null); // null | {} (new) | participant
  const [bulkTeam, setBulkTeam] = useState("");

  const rows = useMemo(
    () => sortParticipants(
      filterParticipants(participants, { query, team: teamFilter, attendance: attFilter, source: sourceFilter, showCancelled }),
      sort.key, sort.dir, teamsById,
    ),
    [participants, query, teamFilter, attFilter, sourceFilter, showCancelled, sort, teamsById],
  );

  const visible = rows.slice(0, limit);
  const selectedIds = rows.filter((p) => selected.has(p.id)).map((p) => p.id); // only rows still in view
  const allVisibleSelected = visible.length > 0 && visible.every((p) => selected.has(p.id));

  const toggleSort = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  const toggleOne = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAllVisible = () => setSelected((s) => {
    const n = new Set(s);
    if (allVisibleSelected) visible.forEach((p) => n.delete(p.id)); else visible.forEach((p) => n.add(p.id));
    return n;
  });

  const exportCsv = () => {
    if (rows.length === 0) { notify("Nothing to export"); return; }
    const { header, rows: out } = buildParticipantsExport(rows, teamsById, extraKeys);
    downloadCsv(exportFileName(event.title, "participants"), header, out);
  };

  const removeSelected = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`Remove ${selectedIds.length} participant${selectedIds.length === 1 ? "" : "s"} from this event's list? Students who registered in CampusOS can't be removed here -- cancel their registration instead.`)) return;
    try {
      const removed = await clubApi.deleteEventParticipants(eventId, selectedIds);
      const kept = selectedIds.length - removed;
      notify(kept > 0 ? `Removed ${removed}. ${kept} CampusOS registration${kept === 1 ? "" : "s"} can't be removed here.` : `Removed ${removed}`);
      setSelected(new Set());
      await reload({ sync: false });
    } catch (err) {
      notify(describe(err));
    }
  };

  const columns = [
    { key: "name", label: "Name" }, { key: "usn", label: "USN" }, { key: "email", label: "Email" },
    { key: "phone", label: "Phone" }, { key: "department", label: "Dept" }, { key: "year", label: "Year" },
    { key: "team", label: "Team" }, { key: "attended", label: "Attendance" },
    ...(showAnswers ? extraKeys.map((k) => ({ key: `extra:${k}`, label: k })) : []),
  ];

  const cancelledCount = participants.length - summary.total;

  return (
    <div>
      <div className="analytics-grid" style={{ marginBottom: 14 }}>
        <StatTile label="Participants" value={summary.total} />
        <StatTile label="Present" value={summary.present} sub={`${summary.rate}%`} />
        <StatTile label="Teams" value={teams.length} />
        <StatTile label="No team yet" value={summary.unteamed} />
      </div>

      {editing && (
        <ParticipantForm
          ws={ws}
          participant={editing}
          onDone={() => setEditing(null)}
        />
      )}

      <div className="evm-toolbar">
        <div className="evm-search">
          <HiMagnifyingGlass aria-hidden="true" />
          <input placeholder="Search name, USN, email, form answers…" aria-label="Search participants" value={query} onChange={(e) => { setQuery(e.target.value); setLimit(PAGE_ROWS); }} />
        </div>
        <select aria-label="Filter by team" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
          <option value="all">All teams</option>
          <option value="none">No team</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select aria-label="Filter by attendance" value={attFilter} onChange={(e) => setAttFilter(e.target.value)}>
          <option value="all">Any attendance</option>
          <option value="present">Present</option>
          <option value="absent">Not present</option>
        </select>
        <select aria-label="Filter by source" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
          <option value="all">All sources</option>
          <option value="app">CampusOS registrations</option>
          <option value="import">Form / CSV</option>
          <option value="manual">Added manually</option>
        </select>
      </div>

      <div className="evm-toolbar">
        {extraKeys.length > 0 && (
          <label className="evm-check"><input type="checkbox" checked={showAnswers} onChange={(e) => setShowAnswers(e.target.checked)} /> Show form answers ({extraKeys.length})</label>
        )}
        {cancelledCount > 0 && (
          <label className="evm-check"><input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} /> Show cancelled ({cancelledCount})</label>
        )}
        <span className="evm-spacer" />
        <button className="evm-btn" onClick={() => setEditing({})}><HiPlus /> Add person</button>
        <button className="evm-btn" onClick={exportCsv}><HiArrowDownTray /> Export CSV ({rows.length})</button>
      </div>

      {selectedIds.length > 0 && (
        <div className="evm-bulk" role="region" aria-label="Bulk actions">
          <b>{selectedIds.length} selected</b>
          <select aria-label="Assign selected to team" value={bulkTeam} onChange={(e) => setBulkTeam(e.target.value)}>
            <option value="">Choose team…</option>
            <option value="__none">Remove from team</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button className="evm-btn" disabled={!bulkTeam} onClick={() => { assignTeam(selectedIds, bulkTeam === "__none" ? null : bulkTeam); setBulkTeam(""); }}>Apply team</button>
          <button className="evm-btn" onClick={() => setAttendance(selectedIds, true)}><HiCheck /> Mark present</button>
          <button className="evm-btn" onClick={() => setAttendance(selectedIds, false)}>Mark absent</button>
          <button className="evm-btn evm-danger" onClick={removeSelected}><HiTrash /> Remove</button>
          <button className="evm-btn" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      {participants.length === 0 ? (
        <EmptyState
          icon={<HiUserGroup />}
          title="No participants yet"
          text="Import your Google Form responses, or add people by hand. Students who register for this event in CampusOS appear here automatically."
          action={<button className="primary" onClick={() => setTab("import")}><HiArrowUpTray /> Import responses</button>}
        />
      ) : rows.length === 0 ? (
        <EmptyState title="No one matches these filters" />
      ) : (
        <>
          <div className="evm-table-wrap">
            <table className="evm-table">
              <thead>
                <tr>
                  <th className="evm-col-check"><input type="checkbox" aria-label="Select all shown" checked={allVisibleSelected} onChange={toggleAllVisible} /></th>
                  {columns.map((c) => (
                    <th key={c.key} aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                      <button className="evm-th" onClick={() => toggleSort(c.key)}>
                        {c.label}{sort.key === c.key && (sort.dir === "asc" ? <HiChevronUp /> : <HiChevronDown />)}
                      </button>
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => {
                  const cancelled = p.status === "cancelled";
                  return (
                    <tr key={p.id} className={cancelled ? "evm-cancelled" : selected.has(p.id) ? "evm-selected" : ""}>
                      <td className="evm-col-check"><input type="checkbox" aria-label={`Select ${p.name || "participant"}`} checked={selected.has(p.id)} onChange={() => toggleOne(p.id)} /></td>
                      <td>
                        <b>{p.name || "—"}</b>
                        <span className="evm-src">{cancelled ? "Cancelled" : SOURCE_LABEL[p.source]}</span>
                      </td>
                      <td>{p.usn || "—"}</td>
                      <td>{p.email || "—"}</td>
                      <td>{p.phone || "—"}</td>
                      <td>{p.department || "—"}</td>
                      <td>{p.year || "—"}</td>
                      <td>
                        <select aria-label={`Team for ${p.name || "participant"}`} value={p.team_id || ""} onChange={(e) => assignTeam([p.id], e.target.value || null)}>
                          <option value="">No team</option>
                          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      </td>
                      <td>
                        <button
                          className={p.attended ? "evm-att on" : "evm-att"}
                          aria-pressed={p.attended}
                          disabled={cancelled}
                          onClick={() => setAttendance([p.id], !p.attended)}
                          title={p.attended && p.attended_at ? `Marked ${new Date(p.attended_at).toLocaleTimeString()}` : undefined}
                        >
                          {p.attended ? <><HiCheck /> Present</> : "Mark present"}
                        </button>
                      </td>
                      {showAnswers && extraKeys.map((k) => <td key={k} className="evm-answer">{(p.extra || {})[k] || "—"}</td>)}
                      <td><button className="evm-icon" aria-label={`Edit ${p.name || "participant"}`} onClick={() => setEditing(p)}><HiPencilSquare /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length > visible.length && (
            <div className="evm-more">
              Showing {visible.length} of {rows.length}
              <button className="evm-btn" onClick={() => setLimit((l) => l + PAGE_ROWS)}>Show {Math.min(PAGE_ROWS, rows.length - visible.length)} more</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ParticipantForm({ ws, participant, onDone }) {
  const { eventId, teams, notify, setParticipants } = ws;
  const isNew = !participant.id;
  const [form, setForm] = useState({
    name: participant.name || "", usn: participant.usn || "", email: participant.email || "",
    phone: participant.phone || "", department: participant.department || "", year: participant.year || "",
    notes: participant.notes || "", team_id: participant.team_id || "",
  });
  const [saving, setSaving] = useState(false);
  const change = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    try {
      setSaving(true);
      const saved = await clubApi.saveEventParticipant(eventId, participant.id, { ...form, team_id: form.team_id || null });
      setParticipants((list) => (isNew ? [...list, saved] : list.map((p) => (p.id === saved.id ? saved : p))));
      notify(isNew ? "Person added" : "Saved");
      onDone();
    } catch (err) {
      notify(describe(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="evm-panel" role="group" aria-label={isNew ? "Add person" : "Edit person"}>
      <b>{isNew ? "Add a person" : `Edit ${participant.name || "participant"}`}</b>
      <div className="evm-form-grid">
        <label>Name<input value={form.name} onChange={(e) => change("name", e.target.value)} /></label>
        <label>USN / Roll no.<input value={form.usn} onChange={(e) => change("usn", e.target.value)} /></label>
        <label>Email<input type="email" value={form.email} onChange={(e) => change("email", e.target.value)} /></label>
        <label>Phone<input value={form.phone} onChange={(e) => change("phone", e.target.value)} /></label>
        <label>Department<input value={form.department} onChange={(e) => change("department", e.target.value)} /></label>
        <label>Year / Semester<input value={form.year} onChange={(e) => change("year", e.target.value)} /></label>
        <label>Team
          <select value={form.team_id} onChange={(e) => change("team_id", e.target.value)}>
            <option value="">No team</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label>Notes<input value={form.notes} onChange={(e) => change("notes", e.target.value)} /></label>
      </div>
      <div className="evm-actions">
        <button className="primary" disabled={saving || !form.name.trim()} onClick={save}>{saving ? "Saving…" : isNew ? "Add person" : "Save"}</button>
        <button className="evm-btn" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   ATTENDANCE -- big tap targets for use at the door
--------------------------------------------------------------------------- */
function AttendanceTab({ ws }) {
  const { participants, teams, teamsById, extraKeys, summary, event, notify, setAttendance } = ws;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("absent");
  const [teamFilter, setTeamFilter] = useState("all");

  const rows = useMemo(
    () => sortParticipants(
      filterParticipants(participants, { query, team: teamFilter, attendance: filter === "all" ? "all" : filter }),
      "name", "asc", teamsById,
    ),
    [participants, query, teamFilter, filter, teamsById],
  );

  const exportAttendance = () => {
    const all = sortParticipants(filterParticipants(participants, {}), "name", "asc", teamsById);
    if (all.length === 0) { notify("Nothing to export"); return; }
    const { header, rows: out } = buildParticipantsExport(all, teamsById, extraKeys);
    downloadCsv(exportFileName(event.title, "attendance"), header, out);
  };

  const markShown = (attended) => {
    const ids = rows.filter((p) => p.attended !== attended).map((p) => p.id);
    if (ids.length === 0) return;
    if (ids.length > 1 && !window.confirm(`Mark ${ids.length} people as ${attended ? "present" : "not present"}?`)) return;
    setAttendance(ids, attended);
  };

  return (
    <div>
      <div className="evm-progress" aria-label={`${summary.present} of ${summary.total} present`}>
        <div className="evm-progress-bar"><span style={{ width: `${summary.rate}%` }} /></div>
        <b>{summary.present} / {summary.total} present ({summary.rate}%)</b>
      </div>

      <div className="evm-toolbar">
        <div className="evm-search">
          <HiMagnifyingGlass aria-hidden="true" />
          <input placeholder="Find someone…" aria-label="Find a participant" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select aria-label="Filter by team" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
          <option value="all">All teams</option>
          <option value="none">No team</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <div className="evm-seg" role="group" aria-label="Attendance filter">
          {[["absent", "Not yet"], ["present", "Present"], ["all", "Everyone"]].map(([k, label]) => (
            <button key={k} className={filter === k ? "on" : ""} aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>
          ))}
        </div>
      </div>

      <div className="evm-toolbar">
        <button className="evm-btn" disabled={rows.length === 0} onClick={() => markShown(true)}><HiCheck /> Mark shown present</button>
        <button className="evm-btn" disabled={rows.length === 0} onClick={() => markShown(false)}>Mark shown not present</button>
        <span className="evm-spacer" />
        <button className="evm-btn" onClick={exportAttendance}><HiArrowDownTray /> Export attendance CSV</button>
      </div>

      <p className="evm-hint">Students with a CampusOS ticket can also be checked in by QR from the event&rsquo;s <b>Roster &amp; check-in</b> — those check-ins show up here too.</p>

      {participants.length === 0 ? (
        <EmptyState title="No one to mark yet" text="Import responses or add people on the Participants tab first." />
      ) : rows.length === 0 ? (
        <EmptyState title={filter === "absent" ? "Everyone shown is already marked present 🎉" : "No one matches"} />
      ) : (
        <div className="evm-att-list">
          {rows.slice(0, 300).map((p) => (
            <button key={p.id} className={p.attended ? "evm-att-row on" : "evm-att-row"} aria-pressed={p.attended} onClick={() => setAttendance([p.id], !p.attended)}>
              <span className="evm-att-check">{p.attended && <HiCheck />}</span>
              <span className="evm-att-main">
                <b>{p.name || "—"}</b>
                <small>{[p.usn, p.department, teamsById[p.team_id]?.name].filter(Boolean).join(" · ") || "—"}</small>
              </span>
              <span className="evm-att-state">{p.attended ? "Present" : "Tap to mark"}</span>
            </button>
          ))}
          {rows.length > 300 && <p className="evm-hint">Showing the first 300 of {rows.length} — narrow it with search or a team.</p>}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   TEAMS
--------------------------------------------------------------------------- */
function TeamsTab({ ws }) {
  const { participants, teams, teamsById, extraKeys, event, eventId, notify, reload, setAttendance, assignTeam } = ws;
  const [newName, setNewName] = useState("");
  const [expanded, setExpanded] = useState(() => new Set());
  const [renaming, setRenaming] = useState(null); // { id, name, notes }
  const [split, setSplit] = useState({ mode: "count", value: 4, prefix: "Team", balance: false, scope: "unassigned" });
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9));
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  const active = useMemo(() => participants.filter((p) => p.status !== "cancelled"), [participants]);
  const stats = useMemo(() => teamStats(participants, teams), [participants, teams]);
  const pool = split.scope === "all" ? active : active.filter((p) => !p.team_id);

  const makePreview = (nextSeed = seed) => {
    const { teamCount, teams: groups } = splitIntoTeams(pool, {
      mode: split.mode, value: split.value, balanceBy: split.balance ? "department" : null, rng: mulberry32(nextSeed),
    });
    const names = nextTeamNames(teamCount, teams.map((t) => t.name), split.prefix.trim() || "Team");
    setPreview({ names, groups });
  };

  const shuffleAgain = () => { const s = Math.floor(Math.random() * 1e9); setSeed(s); makePreview(s); };

  const applySplit = async () => {
    if (!preview || preview.names.length === 0) return;
    try {
      setBusy(true);
      const created = await clubApi.createEventTeams(eventId, preview.names);
      const idByName = new Map(created.map((t) => [t.name.toLowerCase(), t.id]));
      const assignments = [];
      preview.groups.forEach((ids, i) => {
        const teamId = idByName.get(preview.names[i].toLowerCase());
        ids.forEach((id) => assignments.push({ participant_id: id, team_id: teamId }));
      });
      await clubApi.assignParticipantsToTeams(eventId, assignments);
      notify(`Created ${preview.names.length} teams and placed ${assignments.length} people`);
      setPreview(null);
      await reload({ sync: false });
    } catch (err) {
      notify(describe(err));
    } finally {
      setBusy(false);
    }
  };

  const addTeam = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await clubApi.createEventTeams(eventId, [name]);
      setNewName("");
      await reload({ sync: false });
    } catch (err) {
      notify(describe(err));
    }
  };

  const saveRename = async () => {
    try {
      await clubApi.updateEventTeam(renaming.id, renaming.name, renaming.notes);
      setRenaming(null);
      await reload({ sync: false });
    } catch (err) {
      notify(describe(err));
    }
  };

  const removeTeam = async (t) => {
    if (!window.confirm(`Delete "${t.name}"? Its members stay on the event, just without a team.`)) return;
    try {
      await clubApi.deleteEventTeam(t.id);
      await reload({ sync: false });
    } catch (err) {
      notify(describe(err));
    }
  };

  const exportTeams = (onlyTeamId) => {
    const list = sortParticipants(
      active.filter((p) => (onlyTeamId ? p.team_id === onlyTeamId : true)),
      "team", "asc", teamsById,
    );
    if (list.length === 0) { notify("Nothing to export"); return; }
    const { header, rows } = buildParticipantsExport(list, teamsById, extraKeys);
    downloadCsv(exportFileName(event.title, onlyTeamId ? `team-${teamsById[onlyTeamId]?.name || "team"}` : "teams"), header, rows);
  };

  const toggleExpand = (id) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div>
      <div className="evm-panel">
        <b>Split into teams automatically</b>
        <p className="evm-hint">Deals people into evenly sized teams. Preview it, shuffle until you like it, then apply.</p>
        <div className="evm-form-grid">
          <label>Split by
            <select value={split.mode} onChange={(e) => { setSplit((s) => ({ ...s, mode: e.target.value })); setPreview(null); }}>
              <option value="count">Number of teams</option>
              <option value="size">People per team</option>
            </select>
          </label>
          <label>{split.mode === "count" ? "How many teams" : "People per team"}
            <input type="number" min="1" max="200" value={split.value} onChange={(e) => { setSplit((s) => ({ ...s, value: e.target.value })); setPreview(null); }} />
          </label>
          <label>Team name prefix
            <input value={split.prefix} maxLength={40} onChange={(e) => { setSplit((s) => ({ ...s, prefix: e.target.value })); setPreview(null); }} />
          </label>
          <label>Who to include
            <select value={split.scope} onChange={(e) => { setSplit((s) => ({ ...s, scope: e.target.value })); setPreview(null); }}>
              <option value="unassigned">Only people without a team</option>
              <option value="all">Everyone (re-shuffle all)</option>
            </select>
          </label>
        </div>
        <label className="evm-check"><input type="checkbox" checked={split.balance} onChange={(e) => { setSplit((s) => ({ ...s, balance: e.target.checked })); setPreview(null); }} /> Mix departments — spread each department across teams</label>
        <div className="evm-actions">
          <button className="evm-btn" disabled={pool.length === 0} onClick={() => makePreview()}>Preview split ({pool.length} people)</button>
          {preview && <button className="evm-btn" onClick={shuffleAgain}><HiArrowPath /> Shuffle again</button>}
          {preview && <button className="primary" disabled={busy} onClick={applySplit}>{busy ? "Applying…" : `Create ${preview.names.length} teams`}</button>}
        </div>
        {preview && (
          <div className="evm-preview">
            {preview.names.map((n, i) => <span key={n} className="evm-pill">{n} · {preview.groups[i].length}</span>)}
          </div>
        )}
        {split.scope === "all" && <p className="evm-hint">Existing teams are kept (they may end up empty — delete them below if you don&rsquo;t need them).</p>}
      </div>

      <div className="evm-toolbar">
        <input aria-label="New team name" placeholder="New team name" value={newName} maxLength={80} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addTeam(); }} style={{ maxWidth: 260 }} />
        <button className="evm-btn" disabled={!newName.trim()} onClick={addTeam}><HiPlus /> Add team</button>
        <span className="evm-spacer" />
        <button className="evm-btn" onClick={() => exportTeams(null)}><HiArrowDownTray /> Export all teams CSV</button>
      </div>

      {teams.length === 0 ? (
        <EmptyState icon={<HiUserGroup />} title="No teams yet" text="Add one above, use the auto-split, or include a “Team name” column when you import your form responses." />
      ) : (
        <div className="evm-teams">
          {stats.map(({ team, size, present }) => {
            const members = sortParticipants(active.filter((p) => p.team_id === team.id), "name", "asc");
            const open = expanded.has(team.id);
            const isRenaming = renaming?.id === team.id;
            return (
              <article className="evm-team" key={team.id}>
                {isRenaming ? (
                  <div className="evm-form-grid">
                    <label>Team name<input value={renaming.name} maxLength={80} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} /></label>
                    <label>Notes (project, room…)<input value={renaming.notes} maxLength={500} onChange={(e) => setRenaming({ ...renaming, notes: e.target.value })} /></label>
                    <div className="evm-actions">
                      <button className="primary" disabled={!renaming.name.trim()} onClick={saveRename}>Save</button>
                      <button className="evm-btn" onClick={() => setRenaming(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <header>
                    <div>
                      <b>{team.name}</b>
                      <small>{size} member{size === 1 ? "" : "s"} · {present} present{team.notes ? ` · ${team.notes}` : ""}</small>
                    </div>
                    <div className="evm-actions">
                      <button className="evm-btn" onClick={() => toggleExpand(team.id)} aria-expanded={open}>{open ? "Hide" : "Members"}</button>
                      <button className="evm-btn" disabled={size === 0} onClick={() => setAttendance(members.map((m) => m.id), true)}><HiCheck /> All present</button>
                      <button className="evm-btn" disabled={size === 0} onClick={() => exportTeams(team.id)} aria-label={`Export ${team.name}`}><HiArrowDownTray /></button>
                      <button className="evm-icon" aria-label={`Rename ${team.name}`} onClick={() => setRenaming({ id: team.id, name: team.name, notes: team.notes || "" })}><HiPencilSquare /></button>
                      <button className="evm-icon evm-danger" aria-label={`Delete ${team.name}`} onClick={() => removeTeam(team)}><HiTrash /></button>
                    </div>
                  </header>
                )}
                {open && !isRenaming && (
                  <ul className="evm-members">
                    {members.length === 0 && <li className="evm-hint">No members yet.</li>}
                    {members.map((m) => (
                      <li key={m.id}>
                        <span>{m.attended ? <HiCheck className="evm-ok" aria-label="Present" /> : <span className="evm-dot" aria-label="Not present" />} <b>{m.name || "—"}</b> <small>{[m.usn, m.department].filter(Boolean).join(" · ")}</small></span>
                        <button className="evm-btn" onClick={() => assignTeam([m.id], null)}>Remove</button>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   IMPORT -- Google Forms / spreadsheet CSV
--------------------------------------------------------------------------- */
function ImportTab({ ws }) {
  const { eventId, notify, reload, setTab } = ws;
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [mapping, setMapping] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const table = useMemo(() => parseDelimited(text), [text]);
  const headers = useMemo(() => (table[0] || []).map((h) => String(h).trim()), [table]);
  const headerKey = headers.join("");
  const dataRows = Math.max(0, table.length - 1);

  // Re-guess the column mapping whenever a different sheet is loaded.
  useEffect(() => { setMapping(headers.length ? guessColumnMapping(headers) : null); }, [headerKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) { notify("That file is over 5 MB -- export fewer columns or split it up."); return; }
    try {
      setText(await file.text());
      setFileName(file.name);
      setResult(null);
    } catch {
      notify("Couldn't read that file");
    }
  };

  const preview = useMemo(() => (mapping && dataRows > 0 ? buildImportRows(table.slice(0, 6), mapping) : []), [table, mapping, dataRows]);
  const mappedCount = mapping ? Object.values(mapping).filter((i) => i >= 0).length : 0;
  const extraCount = headers.filter((h, i) => h && !(mapping && Object.values(mapping).includes(i))).length;
  const hasKey = mapping && (mapping.name >= 0 || mapping.email >= 0 || mapping.usn >= 0);
  const tooBig = dataRows > MAX_IMPORT_ROWS;

  const runImport = async () => {
    try {
      setBusy(true);
      const rows = buildImportRows(table, mapping);
      const res = await clubApi.importEventParticipants(eventId, rows);
      setResult(res);
      setText("");
      setFileName("");
      await reload({ sync: false });
    } catch (err) {
      notify(describe(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="evm-panel">
        <b>Bring in your Google Form responses</b>
        <ol className="evm-steps">
          <li>In Google Forms open <b>Responses</b> → <b>Link to Sheets</b> (or the ⋮ menu → <b>Download responses (.csv)</b>).</li>
          <li>In the Sheet choose <b>File → Download → Comma-separated values (.csv)</b> — or just select the cells, copy, and paste below.</li>
          <li>Upload or paste it here. Columns are matched automatically; every other answer is kept too.</li>
          <li>Got more responses later? Import again — new people are added, existing ones updated, nobody is duplicated, and teams you&rsquo;ve arranged are kept.</li>
        </ol>
        <div className="evm-toolbar">
          <label className="evm-btn evm-file">
            <HiArrowUpTray /> Choose CSV file
            <input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" onChange={onFile} />
          </label>
          {fileName && <span className="evm-hint">{fileName}</span>}
        </div>
        <label>…or paste rows here
          <textarea rows={4} value={text} placeholder="Name,Email,USN,Team name…" onChange={(e) => { setText(e.target.value); setFileName(""); setResult(null); }} />
        </label>
      </div>

      {result && (
        <div className="evm-panel evm-result" role="status">
          <b>Import finished</b>
          <p>
            {result.inserted} added · {result.updated} updated
            {result.skipped > 0 && ` · ${result.skipped} blank row${result.skipped === 1 ? "" : "s"} skipped`}
            {result.teams_created > 0 && ` · ${result.teams_created} team${result.teams_created === 1 ? "" : "s"} created`}
          </p>
          <button className="primary" onClick={() => setTab("participants")}>View participants</button>
        </div>
      )}

      {dataRows > 0 && mapping && (
        <div className="evm-panel">
          <b>Check the column matching</b>
          <p className="evm-hint">{dataRows} row{dataRows === 1 ? "" : "s"} found · {mappedCount} column{mappedCount === 1 ? "" : "s"} matched · {extraCount} other column{extraCount === 1 ? "" : "s"} kept as form answers.</p>
          <div className="evm-form-grid">
            {IMPORT_FIELDS.map((f) => (
              <label key={f.key}>{f.label}
                <select value={mapping[f.key]} onChange={(e) => setMapping({ ...mapping, [f.key]: Number(e.target.value) })}>
                  <option value={-1}>— not in this form —</option>
                  {headers.map((h, i) => <option key={i} value={i}>{h || `(column ${i + 1})`}</option>)}
                </select>
              </label>
            ))}
          </div>

          {preview.length > 0 && (
            <div className="evm-table-wrap" style={{ marginTop: 12 }}>
              <table className="evm-table">
                <thead><tr>{IMPORT_FIELDS.filter((f) => mapping[f.key] >= 0).map((f) => <th key={f.key}>{f.label}</th>)}</tr></thead>
                <tbody>
                  {preview.slice(0, 5).map((r, i) => (
                    <tr key={i}>{IMPORT_FIELDS.filter((f) => mapping[f.key] >= 0).map((f) => <td key={f.key}>{r[f.key] || "—"}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!hasKey && <p className="evm-warn">Match at least Name, Email or USN — that&rsquo;s how re-imports recognise the same person.</p>}
          {tooBig && <p className="evm-warn">That&rsquo;s more than {MAX_IMPORT_ROWS} rows — split the sheet and import it in parts.</p>}

          <div className="evm-actions">
            <button className="primary" disabled={busy || !hasKey || tooBig} onClick={runImport}>
              {busy ? "Importing…" : `Import ${dataRows} row${dataRows === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      )}
      {text.trim() && dataRows === 0 && (
        <p className="evm-warn">Only a header row was found — there are no responses to import yet.</p>
      )}
    </div>
  );
}
