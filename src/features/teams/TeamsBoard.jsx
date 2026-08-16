import React, { useEffect, useState } from "react";
import {
  HiXMark,
  HiPlus,
  HiUserGroup,
  HiUserPlus,
  HiUserCircle,
  HiCheck,
  HiXCircle,
  HiArrowLeft,
  HiPaperAirplane,
  HiTrash,
  HiSparkles,
  HiClock,
  HiLink,
  HiMagnifyingGlass,
} from "react-icons/hi2";
import { LoadingState, EmptyState, ErrorState } from "../../components/ui/States";
import * as teamsApi from "./api";

// Project / Team Matching (doc §22): browse/find teammates, start a team
// (a team doubles as its own recruitment post -- see the migration
// header), applications, invitations, skill-matched candidates, and team
// management. Mounted as a "Teams" tab from the People page in App.jsx.

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

const CATEGORY_OPTIONS = ["Project", "Hackathon", "Academic Project", "Startup", "Research", "Open Source", "Competition", "Other"];
const STATUS_FILTERS = ["recruiting", "full", "closed", "completed"];

function parseSkills(text) {
  return Array.from(new Set((text || "").split(",").map((s) => s.trim()).filter(Boolean)));
}

export default function TeamsBoard({ campusId, authUser, notify, openLogin }) {
  const [tab, setTab] = useState("browse"); // 'browse' | 'mine'
  const [teams, setTeams] = useState([]);
  const [myTeams, setMyTeams] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("recruiting");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [openTeamId, setOpenTeamId] = useState(null);

  const reloadBrowse = async () => {
    if (!campusId) return;
    try {
      setLoading(true);
      setError("");
      setTeams(await teamsApi.listProjectTeams(campusId, { status: statusFilter || null, search: search || null }));
    } catch (err) {
      setError(err.message || "Could not load teams");
    } finally {
      setLoading(false);
    }
  };

  const reloadMine = async () => {
    try {
      setLoading(true);
      setError("");
      const [t, inv] = await Promise.all([teamsApi.getMyTeams(), teamsApi.getMyTeamInvitations()]);
      setMyTeams(t);
      setInvitations(inv);
    } catch (err) {
      setError(err.message || "Could not load your teams");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authUser) return;
    if (tab === "browse") reloadBrowse();
    else reloadMine();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, campusId, authUser?.id, statusFilter]);

  if (!authUser) {
    return (
      <EmptyState
        icon={<HiUserGroup />}
        title="Sign in to find or start a team"
        text="Team matching -- skills, project posts, invitations and applications -- is available to signed-in students."
        action={<button className="primary" onClick={openLogin}>Sign in</button>}
      />
    );
  }

  if (openTeamId) {
    return (
      <TeamDetail
        teamId={openTeamId}
        authUser={authUser}
        notify={notify}
        onBack={() => {
          setOpenTeamId(null);
          if (tab === "browse") reloadBrowse();
          else reloadMine();
        }}
      />
    );
  }

  return (
    <>
      <div className="chips" style={{ margin: "4px 0 18px", justifyContent: "flex-start" }}>
        <button className={tab === "browse" ? "chip active" : "chip"} onClick={() => setTab("browse")}>Browse teams</button>
        <button className={tab === "mine" ? "chip active" : "chip"} onClick={() => setTab("mine")}>
          My teams{invitations.length > 0 ? ` · ${invitations.length} invite${invitations.length === 1 ? "" : "s"}` : ""}
        </button>
        <button className="chip" onClick={() => setShowCreate(true)} style={{ marginLeft: "auto" }}>
          <HiPlus /> Start a team
        </button>
      </div>

      {tab === "browse" && (
        <>
          <div className="searchbar compact wide-search">
            <HiMagnifyingGlass />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") reloadBrowse(); }}
              onBlur={reloadBrowse}
              placeholder="Search teams or skills needed…"
            />
          </div>
          <div className="chips" style={{ margin: "10px 0 18px", justifyContent: "flex-start" }}>
            {STATUS_FILTERS.map((s) => (
              <button key={s} className={statusFilter === s ? "chip active" : "chip"} onClick={() => setStatusFilter(s)}>
                {s[0].toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>

          {loading && <LoadingState label="Loading teams…" />}
          {!loading && error && <ErrorState text={error} onRetry={reloadBrowse} />}
          {!loading && !error && teams.length === 0 && (
            <EmptyState
              icon={<HiUserGroup />}
              title="No teams found"
              text="Be the first to start one, or try a different filter."
              action={<button className="primary" onClick={() => setShowCreate(true)}><HiPlus /> Start a team</button>}
            />
          )}
          {!loading && !error && teams.length > 0 && (
            <div className="people-grid">
              {teams.map((t) => <TeamCard key={t.id} team={t} onOpen={() => setOpenTeamId(t.id)} />)}
            </div>
          )}
        </>
      )}

      {tab === "mine" && (
        <>
          {invitations.length > 0 && (
            <div className="profile-box" style={{ marginBottom: 18 }}>
              <h3>Invitations waiting for you</h3>
              <div className="resource-list">
                {invitations.map((inv) => (
                  <InvitationRow key={inv.id} invitation={inv} notify={notify} onChange={reloadMine} onOpen={() => setOpenTeamId(inv.team_id)} />
                ))}
              </div>
            </div>
          )}

          {loading && <LoadingState label="Loading your teams…" />}
          {!loading && error && <ErrorState text={error} onRetry={reloadMine} />}
          {!loading && !error && myTeams.length === 0 && (
            <EmptyState
              icon={<HiUserGroup />}
              title="You're not on a team yet"
              text="Start one, or browse teams that need your skills."
              action={<button className="primary" onClick={() => setShowCreate(true)}><HiPlus /> Start a team</button>}
            />
          )}
          {!loading && !error && myTeams.length > 0 && (
            <div className="resource-list">
              {myTeams.map((t) => (
                <article className="resource-row team-row" key={t.id} onClick={() => setOpenTeamId(t.id)}>
                  <div className="resource-icon"><HiUserGroup /></div>
                  <div>
                    <b>{t.title}</b>
                    <small>
                      {t.category} · {t.member_count}/{t.max_members} members · {t.role === "owner" ? "You own this" : "Member"}
                      {t.pending_applications > 0 ? ` · ${t.pending_applications} pending application${t.pending_applications === 1 ? "" : "s"}` : ""}
                    </small>
                  </div>
                  <span className={`team-status team-status-${t.status}`}>{t.status}</span>
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {showCreate && (
        <CreateTeamModal
          notify={notify}
          onClose={() => setShowCreate(false)}
          onCreated={(team) => { setShowCreate(false); notify("Team created"); setOpenTeamId(team.id); }}
        />
      )}
    </>
  );
}

function TeamCard({ team, onOpen }) {
  return (
    <article className="person-card">
      <div className="person-top">
        <div className="big-avatar small"><HiUserGroup /></div>
        <div>
          <h3>{team.title}</h3>
          <p>{team.category} · {team.owner_name}</p>
        </div>
        {team.match_score > 0 && <span className="match">{team.match_score} match{team.match_score === 1 ? "" : "es"}</span>}
      </div>

      {team.description && (
        <p style={{ color: "var(--muted)", fontSize: 12, margin: "8px 0", lineHeight: 1.5 }}>{team.description}</p>
      )}

      {team.skills_needed?.length > 0 && (
        <div className="skill-list">
          {team.skills_needed.map((s) => <span key={s}>{s}</span>)}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
        <small style={{ color: "var(--muted)" }}>{team.member_count}/{team.max_members} members</small>
        <button className="ghost" onClick={onOpen}>View team</button>
      </div>
    </article>
  );
}

function InvitationRow({ invitation, notify, onChange, onOpen }) {
  const [busy, setBusy] = useState(false);

  const respond = async (decision) => {
    try {
      setBusy(true);
      await teamsApi.respondToTeamInvitation(invitation.id, decision);
      notify(decision === "accepted" ? `You joined "${invitation.team_title}"` : "Invitation declined");
      onChange();
    } catch (err) {
      notify(err.message || "Could not respond to invitation");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="resource-row">
      <div className="resource-icon"><HiUserPlus /></div>
      <div className="team-row-clickable" onClick={onOpen}>
        <b>{invitation.team_title}</b>
        <small>Invited by {invitation.inviter_name}{invitation.message ? ` — "${invitation.message}"` : ""}</small>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button disabled={busy} onClick={() => respond("accepted")}><HiCheck /> Accept</button>
        <button className="ghost" disabled={busy} onClick={() => respond("declined")}><HiXCircle /> Decline</button>
      </div>
    </article>
  );
}

function TeamForm({ initial, onChange }) {
  return (
    <>
      <label>Team / project title
        <input value={initial.title} onChange={(e) => onChange("title", e.target.value)} placeholder="e.g. Smart India Hackathon squad" />
      </label>
      <label>Category
        <select value={initial.category} onChange={(e) => onChange("category", e.target.value)}>
          {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <label>Context (optional)
        <input value={initial.context} onChange={(e) => onChange("context", e.target.value)} placeholder="e.g. Smart India Hackathon 2026" />
      </label>
      <label>Description
        <textarea rows={3} value={initial.description} onChange={(e) => onChange("description", e.target.value)} placeholder="What are you building?" />
      </label>
      <label>Skills the team already has (comma separated)
        <input value={initial.skillsHave} onChange={(e) => onChange("skillsHave", e.target.value)} placeholder="e.g. Machine Learning, Backend" />
      </label>
      <label>Skills you need (comma separated)
        <input value={initial.skillsNeeded} onChange={(e) => onChange("skillsNeeded", e.target.value)} placeholder="e.g. React, Embedded Systems" />
      </label>
      <label>Max team size
        <input type="number" min={1} max={20} value={initial.maxMembers} onChange={(e) => onChange("maxMembers", e.target.value)} />
      </label>
      <label>Deadline (optional)
        <input type="date" value={initial.deadline} onChange={(e) => onChange("deadline", e.target.value)} />
      </label>
      <label>Project / event link (optional)
        <input value={initial.externalLink} onChange={(e) => onChange("externalLink", e.target.value)} placeholder="https://…" />
      </label>
    </>
  );
}

function CreateTeamModal({ onClose, onCreated, notify }) {
  const [form, setForm] = useState({
    title: "", category: "Project", context: "", description: "",
    skillsHave: "", skillsNeeded: "", maxMembers: 4, deadline: "", externalLink: "",
  });
  const [saving, setSaving] = useState(false);
  const change = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.title.trim()) { notify("Give your team a title"); return; }
    try {
      setSaving(true);
      const team = await teamsApi.createProjectTeam({
        title: form.title,
        category: form.category,
        context: form.context.trim() || null,
        description: form.description,
        skillsHave: parseSkills(form.skillsHave),
        skillsNeeded: parseSkills(form.skillsNeeded),
        maxMembers: Number(form.maxMembers) || 4,
        deadline: form.deadline || null,
        externalLink: form.externalLink.trim() || null,
      });
      onCreated(team);
    } catch (err) {
      notify(err.message || "Could not create team");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal kicker="TEAM MATCHING" title="Start a team" onClose={onClose}>
      <TeamForm initial={form} onChange={change} />
      <button className="primary wide" disabled={saving || !form.title.trim()} onClick={submit}>
        {saving ? "Creating…" : "Create team"}
      </button>
    </Modal>
  );
}

function EditTeamModal({ team, onClose, onSaved, notify }) {
  const [form, setForm] = useState({
    title: team.title || "", category: team.category || "Project", context: team.context || "",
    description: team.description || "", skillsHave: (team.skills_have || []).join(", "),
    skillsNeeded: (team.skills_needed || []).join(", "), maxMembers: team.max_members || 4,
    deadline: team.deadline || "", externalLink: team.external_link || "",
  });
  const [saving, setSaving] = useState(false);
  const change = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.title.trim()) { notify("Give your team a title"); return; }
    try {
      setSaving(true);
      await teamsApi.updateProjectTeam(team.id, {
        title: form.title,
        category: form.category,
        context: form.context.trim() || null,
        description: form.description,
        skillsHave: parseSkills(form.skillsHave),
        skillsNeeded: parseSkills(form.skillsNeeded),
        maxMembers: Number(form.maxMembers) || 4,
        deadline: form.deadline || null,
        externalLink: form.externalLink.trim() || null,
      });
      notify("Team updated");
      onSaved();
    } catch (err) {
      notify(err.message || "Could not update team");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal kicker="TEAM MATCHING" title="Edit team" onClose={onClose}>
      <TeamForm initial={form} onChange={change} />
      <button className="primary wide" disabled={saving || !form.title.trim()} onClick={submit}>
        {saving ? "Saving…" : "Save changes"}
      </button>
    </Modal>
  );
}

function CandidatesModal({ teamId, onClose, onInvited, notify }) {
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [invitingId, setInvitingId] = useState(null);

  useEffect(() => {
    teamsApi.getTeamCandidates(teamId)
      .then(setCandidates)
      .catch((err) => setError(err.message || "Could not load matching students"))
      .finally(() => setLoading(false));
  }, [teamId]);

  const invite = async (candidate) => {
    try {
      setInvitingId(candidate.id);
      await teamsApi.inviteToTeam(teamId, candidate.id);
      notify(`Invited ${candidate.name}`);
      setCandidates((cs) => cs.filter((c) => c.id !== candidate.id));
      onInvited();
    } catch (err) {
      notify(err.message || "Could not send invitation");
    } finally {
      setInvitingId(null);
    }
  };

  return (
    <Modal kicker="SKILL MATCHING" title="Matching students" onClose={onClose}>
      <p style={{ color: "var(--muted)", fontSize: 12, marginBottom: 12 }}>
        Ranked by overlap with the skills you&rsquo;re looking for, among students who&rsquo;ve marked themselves open to projects.
      </p>
      {loading && <LoadingState label="Finding matches…" />}
      {!loading && error && <ErrorState text={error} />}
      {!loading && !error && candidates.length === 0 && (
        <EmptyState
          icon={<HiSparkles />}
          title="No matches right now"
          text="Try broadening the skills you're looking for, or check back later -- more students may opt in to project matching over time."
        />
      )}
      {!loading && !error && candidates.length > 0 && (
        <div className="resource-list">
          {candidates.map((c) => (
            <article className="resource-row" key={c.id}>
              <div className="resource-icon"><HiUserCircle /></div>
              <div>
                <b>{c.name}</b>
                <small>{c.course || "—"}{c.year ? ` · Year ${c.year}` : ""}</small>
                {c.skills?.length > 0 && (
                  <div className="skill-list" style={{ marginTop: 4 }}>{c.skills.map((s) => <span key={s}>{s}</span>)}</div>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {c.match_score > 0 && <span className="match">{c.match_score}</span>}
                <button disabled={invitingId === c.id} onClick={() => invite(c)}><HiUserPlus /> Invite</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </Modal>
  );
}

function TeamDetail({ teamId, authUser, notify, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showEdit, setShowEdit] = useState(false);
  const [showCandidates, setShowCandidates] = useState(false);
  const [applyMessage, setApplyMessage] = useState("");
  const [applying, setApplying] = useState(false);

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      setData(await teamsApi.getProjectTeam(teamId));
    } catch (err) {
      setError(err.message || "Could not load this team");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [teamId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <LoadingState label="Loading team…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;
  if (!data) return null;

  const { team, members, applications, invitations, my_application_status: myApplicationStatus, my_invitation_id: myInvitationId } = data;
  const isOwner = team.owner_id === authUser.id;
  const isMember = members.some((m) => m.user_id === authUser.id);

  const apply = async () => {
    try {
      setApplying(true);
      await teamsApi.applyToTeam(teamId, applyMessage.trim() || null);
      notify("Application sent");
      setApplyMessage("");
      reload();
    } catch (err) {
      notify(err.message || "Could not apply to this team");
    } finally {
      setApplying(false);
    }
  };

  const respondInvite = async (decision) => {
    try {
      await teamsApi.respondToTeamInvitation(myInvitationId, decision);
      notify(decision === "accepted" ? "You joined the team" : "Invitation declined");
      reload();
    } catch (err) {
      notify(err.message || "Could not respond to the invitation");
    }
  };

  const leave = async () => {
    if (!window.confirm(`Leave "${team.title}"?`)) return;
    try {
      await teamsApi.leaveTeam(teamId);
      notify("You left the team");
      onBack();
    } catch (err) {
      notify(err.message || "Could not leave this team");
    }
  };

  const removeMember = async (m) => {
    if (!window.confirm(`Remove ${m.name || "this student"} from the team?`)) return;
    try {
      await teamsApi.removeTeamMember(teamId, m.user_id);
      notify("Member removed");
      reload();
    } catch (err) {
      notify(err.message || "Could not remove this member");
    }
  };

  const decideApplication = async (app, decision) => {
    try {
      await teamsApi.reviewTeamApplication(app.id, decision);
      notify(decision === "accepted" ? `${app.name} added to the team` : `${app.name}'s application rejected`);
      reload();
    } catch (err) {
      notify(err.message || "Could not review this application");
    }
  };

  const cancelInvite = async (inv) => {
    try {
      await teamsApi.cancelTeamInvitation(inv.id);
      notify("Invitation cancelled");
      reload();
    } catch (err) {
      notify(err.message || "Could not cancel this invitation");
    }
  };

  const setStatus = async (status) => {
    try {
      await teamsApi.updateProjectTeam(teamId, { status });
      notify(status === "recruiting" ? "Team reopened" : "Team closed to new applications");
      reload();
    } catch (err) {
      notify(err.message || "Could not update this team");
    }
  };

  const deleteTeam = async () => {
    if (!window.confirm(`Delete "${team.title}"? This can't be undone.`)) return;
    try {
      await teamsApi.deleteProjectTeam(teamId);
      notify("Team deleted");
      onBack();
    } catch (err) {
      notify(err.message || "Could not delete this team");
    }
  };

  return (
    <section>
      <button className="ghost" onClick={onBack} style={{ marginBottom: 14 }}><HiArrowLeft /> Back</button>

      <div className="profile-box" style={{ maxWidth: 700 }}>
        <span className="section-kicker">{team.category.toUpperCase()}{team.context ? ` · ${team.context}` : ""}</span>
        <h2 style={{ margin: "6px 0" }}>{team.title}</h2>
        <p style={{ color: "var(--muted)" }}>{team.description || "No description yet."}</p>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", margin: "10px 0" }}>
          <small><b>{members.length}</b>/{team.max_members} members</small>
          <small className={`team-status team-status-${team.status}`}>{team.status}</small>
          {team.deadline && <small><HiClock /> Deadline {new Date(team.deadline).toLocaleDateString()}</small>}
          {team.external_link && (
            <small><a href={team.external_link} target="_blank" rel="noreferrer"><HiLink /> Project link</a></small>
          )}
        </div>

        {team.skills_have?.length > 0 && (
          <>
            <small style={{ fontWeight: 800 }}>Skills the team already has</small>
            <div className="skill-list" style={{ margin: "6px 0 12px" }}>{team.skills_have.map((s) => <span key={s}>{s}</span>)}</div>
          </>
        )}
        {team.skills_needed?.length > 0 && (
          <>
            <small style={{ fontWeight: 800 }}>Looking for</small>
            <div className="skill-list" style={{ margin: "6px 0 12px" }}>{team.skills_needed.map((s) => <span key={s}>{s}</span>)}</div>
          </>
        )}

        {!isOwner && !isMember && myInvitationId && (
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button className="primary" onClick={() => respondInvite("accepted")}><HiCheck /> Accept invitation</button>
            <button className="ghost" onClick={() => respondInvite("declined")}>Decline</button>
          </div>
        )}

        {!isOwner && !isMember && !myInvitationId && (
          myApplicationStatus === "pending" ? (
            <p style={{ marginTop: 10 }}><i>Your application is pending review.</i></p>
          ) : team.status === "recruiting" ? (
            <div style={{ marginTop: 12 }}>
              <label>Message to the team (optional)
                <textarea rows={2} value={applyMessage} onChange={(e) => setApplyMessage(e.target.value)} placeholder="Why you'd be a good fit…" />
              </label>
              <button className="primary" disabled={applying} onClick={apply}><HiPaperAirplane /> Apply to join</button>
              {myApplicationStatus && (
                <small style={{ display: "block", marginTop: 6, color: "var(--muted)" }}>Your last application was {myApplicationStatus}.</small>
              )}
            </div>
          ) : (
            <p style={{ marginTop: 10, color: "var(--muted)" }}>This team isn&rsquo;t recruiting right now.</p>
          )
        )}

        {isMember && !isOwner && (
          <button className="ghost" style={{ marginTop: 10 }} onClick={leave}>Leave team</button>
        )}

        {isOwner && (
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button className="ghost" onClick={() => setShowEdit(true)}>Edit team</button>
            <button className="ghost" onClick={() => setShowCandidates(true)}><HiSparkles /> Find candidates</button>
            {team.status === "recruiting" && <button className="ghost" onClick={() => setStatus("closed")}>Close recruiting</button>}
            {(team.status === "closed" || team.status === "full") && <button className="ghost" onClick={() => setStatus("recruiting")}>Reopen recruiting</button>}
            <button className="ghost" onClick={deleteTeam}><HiTrash /> Delete team</button>
          </div>
        )}
      </div>

      <div className="profile-box" style={{ maxWidth: 700, marginTop: 16 }}>
        <h3>Members</h3>
        <div className="resource-list">
          {members.map((m) => (
            <article className="resource-row" key={m.id}>
              <div className="resource-icon"><HiUserGroup /></div>
              <div>
                <b>{m.name}</b>
                <small>{m.course || "—"}{m.year ? ` · Year ${m.year}` : ""} · <span className="role-badge">{m.role === "owner" ? "Owner" : "Member"}</span></small>
              </div>
              {isOwner && m.role !== "owner" && (
                <button className="ghost" onClick={() => removeMember(m)}><HiXCircle /> Remove</button>
              )}
            </article>
          ))}
        </div>
      </div>

      {isOwner && (
        <div className="profile-box" style={{ maxWidth: 700, marginTop: 16 }}>
          <h3>Applications{applications.length > 0 ? ` (${applications.length})` : ""}</h3>
          {applications.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>No pending applications.</p>
          ) : (
            <div className="resource-list">
              {applications.map((app) => (
                <article className="resource-row" key={app.id}>
                  <div className="resource-icon"><HiUserPlus /></div>
                  <div>
                    <b>{app.name}</b>
                    <small>{app.course || "—"}{app.year ? ` · Year ${app.year}` : ""}{app.skills?.length ? ` · ${app.skills.join(", ")}` : ""}</small>
                    {app.message && <small style={{ display: "block", marginTop: 4 }}>&ldquo;{app.message}&rdquo;</small>}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => decideApplication(app, "accepted")}><HiCheck /> Accept</button>
                    <button className="ghost" onClick={() => decideApplication(app, "rejected")}><HiXCircle /> Reject</button>
                  </div>
                </article>
              ))}
            </div>
          )}

          {invitations.length > 0 && (
            <>
              <h3 style={{ marginTop: 18 }}>Pending invitations sent</h3>
              <div className="resource-list">
                {invitations.map((inv) => (
                  <article className="resource-row" key={inv.id}>
                    <div className="resource-icon"><HiPaperAirplane /></div>
                    <div><b>{inv.name}</b><small>Invited {new Date(inv.created_at).toLocaleDateString()}</small></div>
                    <button className="ghost" onClick={() => cancelInvite(inv)}>Cancel</button>
                  </article>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {showEdit && (
        <EditTeamModal team={team} notify={notify} onClose={() => setShowEdit(false)} onSaved={() => { setShowEdit(false); reload(); }} />
      )}
      {showCandidates && (
        <CandidatesModal teamId={teamId} notify={notify} onClose={() => setShowCandidates(false)} onInvited={reload} />
      )}
    </section>
  );
}
