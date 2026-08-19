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
  HiQuestionMarkCircle,
  HiBuildingStorefront,
  HiWrenchScrewdriver,
  HiSignal,
  HiFlag,
  HiArrowsRightLeft,
  HiCheck,
  HiBuildingOffice2,
  HiLifebuoy,
  HiPaperClip,
} from "react-icons/hi2";
import { LoadingState, EmptyState, ErrorState } from "../../components/ui/States";
import { StatTile } from "../../components/ui/Charts";
import * as adminApi from "./api";
import * as opportunitiesApi from "../../services/opportunitiesService";
import * as teamsApi from "../teams/api";
import { deleteMessage } from "../../services/messagingService";
import { getMyPrintShopStatus, setPrintShopStatus } from "../vendor/api";
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
  ["auditlog", "Audit Log"],
  ["moderation", "Moderation"],
  ["requests", "Requests"],
  ["lostfound", "Lost & Found"],
  ["opportunities", "Opportunities & Mentors"],
  ["teams", "Teams"],
  ["ai", "AI Assistant"],
  ["errors", "Errors"],
  ["vendors", "Vendors"],
  ["facilities", "Facilities"],
  ["systemhealth", "System Health"],
  ["campussettings", "Campus Settings"],
  ["featureflags", "Feature Flags"],
  ["emergencydirectory", "Emergency Directory"],
  ["resources", "Resources"],
  ["support", "Support"],
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
      {tab === "auditlog" && <AuditLogTab />}
      {tab === "moderation" && <ModerationTab notify={notify} authUser={authUser} />}
      {tab === "requests" && <RequestsTab notify={notify} campusId={campusId} />}
      {tab === "lostfound" && <LostFoundTab notify={notify} campusId={campusId} authUser={authUser} />}
      {tab === "opportunities" && <OpportunitiesMentorsTab notify={notify} campusId={campusId} />}
      {tab === "teams" && <TeamsAdminTab notify={notify} campusId={campusId} />}
      {tab === "ai" && <AiAssistantTab notify={notify} campusId={campusId} />}
      {tab === "errors" && <ErrorLogsTab notify={notify} />}
      {tab === "vendors" && <VendorManagementTab notify={notify} campusId={campusId} />}
      {tab === "facilities" && <FacilitiesTab notify={notify} campusId={campusId} />}
      {tab === "systemhealth" && <SystemHealthTab notify={notify} />}
      {tab === "campussettings" && <CampusSettingsTab notify={notify} campusId={campusId} />}
      {tab === "featureflags" && <FeatureFlagsTab notify={notify} campusId={campusId} />}
      {tab === "emergencydirectory" && <EmergencyDirectoryTab notify={notify} />}
      {tab === "resources" && <ResourcesTab notify={notify} campusId={campusId} />}
      {tab === "support" && <SupportTicketsTab notify={notify} authUser={authUser} />}
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
  const [openConversationReportId, setOpenConversationReportId] = useState(null);

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

  const canModerateContent = (report) => ["post", "comment", "marketplace_listing"].includes(report.target_type);

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
              {report.target_type === "conversation" && (
                <button
                  disabled={busyId === report.id}
                  onClick={() => setOpenConversationReportId((cur) => (cur === report.id ? null : report.id))}
                >
                  {openConversationReportId === report.id ? "Hide messages" : "View messages"}
                </button>
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
            {report.target_type === "conversation" && openConversationReportId === report.id && (
              <ConversationModerationPanel conversationId={report.target_id} notify={notify} />
            )}
          </article>
        );
      })}

      <SuspensionAppealsPanel notify={notify} />
      <BannedWordsPanel notify={notify} />
      <ProhibitedTermsPanel notify={notify} />
    </div>
  );
}

// Lets a suspended student ask for a human review instead of the suspension
// being a dead end -- see submit_suspension_appeal()/resolve_suspension_appeal()
// in 20260818000600_community_hardening.sql. Approving reactivates the
// account through the same admin_set_user_status() path a manual
// reactivation would use, so nothing here bypasses that audit trail.
function SuspensionAppealsPanel({ notify }) {
  const [appeals, setAppeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const reload = async () => {
    try {
      setLoading(true);
      setAppeals(await adminApi.listSuspensionAppeals("pending"));
    } catch (err) {
      notify(err.message || "Could not load suspension appeals");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const decide = async (appeal, decision) => {
    const note = decision === "denied" ? window.prompt("Note for this student (optional)?") || "" : "";
    try {
      setBusyId(appeal.id);
      await adminApi.resolveSuspensionAppeal(appeal.id, decision, note);
      notify(decision === "approved" ? `${appeal.appellant_name} reactivated` : "Appeal denied");
      await reload();
    } catch (err) {
      notify(err.message || "Could not resolve this appeal");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ marginTop: 32 }}>
      <span className="section-kicker">SUSPENSION APPEALS</span>
      {loading && <LoadingState label="Loading appeals…" />}
      {!loading && appeals.length === 0 && (
        <EmptyState icon={<HiShieldCheck />} title="No pending appeals" text="No suspended student is waiting on a review." />
      )}
      {!loading && appeals.map((appeal) => (
        <article className="resource-row" key={appeal.id} style={{ alignItems: "flex-start" }}>
          <div>
            <b>{appeal.appellant_name}</b>
            <small>Submitted {new Date(appeal.created_at).toLocaleString()}</small>
            <small>&ldquo;{appeal.reason}&rdquo;</small>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button disabled={busyId === appeal.id} onClick={() => decide(appeal, "approved")}>Approve &amp; reactivate</button>
            <button disabled={busyId === appeal.id} onClick={() => decide(appeal, "denied")}>Deny</button>
          </div>
        </article>
      ))}
    </div>
  );
}

// Admin-editable profanity word list -- posts_reject_profanity()/
// comments_reject_profanity() (same migration) check every new post/comment
// against this table server-side; this panel is the only way to extend it
// beyond the seed list without a direct SQL edit.
function BannedWordsPanel({ notify }) {
  const [words, setWords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newWord, setNewWord] = useState("");
  const [busyWord, setBusyWord] = useState(null);

  const reload = async () => {
    try {
      setLoading(true);
      setWords(await adminApi.listBannedWords());
    } catch (err) {
      notify(err.message || "Could not load the profanity filter list");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async () => {
    if (!newWord.trim()) return;
    try {
      setBusyWord(newWord.trim());
      await adminApi.addBannedWord(newWord.trim());
      setNewWord("");
      await reload();
    } catch (err) {
      notify(err.message || "Could not add this word");
    } finally {
      setBusyWord(null);
    }
  };

  const remove = async (word) => {
    try {
      setBusyWord(word);
      await adminApi.removeBannedWord(word);
      await reload();
    } catch (err) {
      notify(err.message || "Could not remove this word");
    } finally {
      setBusyWord(null);
    }
  };

  return (
    <div style={{ marginTop: 32 }}>
      <span className="section-kicker">PROFANITY FILTER</span>
      <p style={{ fontSize: "0.85rem", opacity: 0.8 }}>
        Posts and comments containing any word below are rejected server-side before they save.
      </p>
      <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        <input
          value={newWord}
          onChange={(e) => setNewWord(e.target.value)}
          placeholder="Add a word…"
          style={{ flex: 1, padding: "6px 12px", borderRadius: "6px" }}
        />
        <button className="primary" disabled={!newWord.trim() || busyWord === newWord.trim()} onClick={add}>Add</button>
      </div>
      {loading && <LoadingState label="Loading…" />}
      {!loading && (
        <div className="chips">
          {words.map((row) => (
            <button key={row.word} className="chip" disabled={busyWord === row.word} onClick={() => remove(row.word)} title="Click to remove">
              {row.word} ×
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Same shape as BannedWordsPanel above, backing a separate admin-managed
// list (supabase/migrations/20260818000700_marketplace_hardening.sql) --
// "profanity" and "prohibited item" are different moderation reasons, kept
// as two independent lists rather than one merged one.
function ProhibitedTermsPanel({ notify }) {
  const [terms, setTerms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newTerm, setNewTerm] = useState("");
  const [busyTerm, setBusyTerm] = useState(null);

  const reload = async () => {
    try {
      setLoading(true);
      setTerms(await adminApi.listProhibitedListingTerms());
    } catch (err) {
      notify(err.message || "Could not load the prohibited-item list");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async () => {
    if (!newTerm.trim()) return;
    try {
      setBusyTerm(newTerm.trim());
      await adminApi.addProhibitedListingTerm(newTerm.trim());
      setNewTerm("");
      await reload();
    } catch (err) {
      notify(err.message || "Could not add this term");
    } finally {
      setBusyTerm(null);
    }
  };

  const remove = async (term) => {
    try {
      setBusyTerm(term);
      await adminApi.removeProhibitedListingTerm(term);
      await reload();
    } catch (err) {
      notify(err.message || "Could not remove this term");
    } finally {
      setBusyTerm(null);
    }
  };

  return (
    <div style={{ marginTop: 32 }}>
      <span className="section-kicker">MARKETPLACE PROHIBITED-ITEM LIST</span>
      <p style={{ fontSize: "0.85rem", opacity: 0.8 }}>
        A new or edited marketplace listing whose title/description contains any word below is rejected server-side before it saves.
      </p>
      <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        <input
          value={newTerm}
          onChange={(e) => setNewTerm(e.target.value)}
          placeholder="Add a term…"
          style={{ flex: 1, padding: "6px 12px", borderRadius: "6px" }}
        />
        <button className="primary" disabled={!newTerm.trim() || busyTerm === newTerm.trim()} onClick={add}>Add</button>
      </div>
      {loading && <LoadingState label="Loading…" />}
      {!loading && (
        <div className="chips">
          {terms.map((row) => (
            <button key={row.term} className="chip" disabled={busyTerm === row.term} onClick={() => remove(row.term)} title="Click to remove">
              {row.term} ×
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Lets a moderator see the actual message history behind a conversation
// report (not just the last-message snippet get_report_context() already
// showed) and remove one specific offending message -- previously the only
// options for a conversation report were Suspend-the-user or Dismiss, with
// no way to touch the message itself. See admin_get_conversation_messages()/
// delete_message() in 20260817001000_message_delete_moderation.sql.
function ConversationModerationPanel({ conversationId, notify }) {
  const [messages, setMessages] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const reload = () => {
    adminApi
      .adminGetConversationMessages(conversationId)
      .then(setMessages)
      .catch((err) => notify(err.message || "Could not load these messages"));
  };

  useEffect(() => { reload(); }, [conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = async (messageId) => {
    try {
      setBusyId(messageId);
      await deleteMessage(messageId);
      notify("Message removed");
      reload();
    } catch (err) {
      notify(err.message || "Could not remove this message");
    } finally {
      setBusyId(null);
    }
  };

  if (messages === null) return <p style={{ fontSize: 12, color: "var(--muted)" }}>Loading messages…</p>;
  if (messages.length === 0) return <p style={{ fontSize: 12, color: "var(--muted)" }}>No messages in this conversation.</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%", marginTop: 8 }}>
      {[...messages].reverse().map((m) => (
        <div key={m.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, borderTop: "1px solid var(--border)", paddingTop: 6 }}>
          <span>
            <b>{m.sender_name}</b>{" "}
            {m.deleted_at
              ? <i style={{ color: "var(--muted)" }}>(deleted)</i>
              : m.body || (m.attachment_path ? "📷 Photo" : "(no text)")}
            {" · "}{new Date(m.created_at).toLocaleString()}
          </span>
          {!m.deleted_at && (
            <button disabled={busyId === m.id} onClick={() => remove(m.id)}>Remove</button>
          )}
        </div>
      ))}
    </div>
  );
}

/* =========================================================
   USERS (doc §54-58)
========================================================= */

const ROLE_OPTIONS = ["student", "club_admin", "vendor", "facilities_staff", "faculty", "college_admin", "super_admin"];

function UsersTab({ notify, campusId, authUser }) {
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [requestsRefreshKey, setRequestsRefreshKey] = useState(0);

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

  // Role-escalation fix: admin_set_user_role() is now super_admin-only
  // (only super_admin holds 'users.roles.manage'). A college_admin can no
  // longer change a role instantly -- they propose it, and a DIFFERENT admin
  // has to approve via the "Pending role requests" list below.
  const isSuperAdmin = authUser?.role === "super_admin";

  const changeRole = async (user, newRole) => {
    if (newRole === user.role) return;
    if (isSuperAdmin) {
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
      return;
    }

    const reason = window.prompt(`Why should ${user.name}'s role change from ${user.role} to ${newRole}? (A different admin must approve this.)`);
    if (reason === null) return;
    try {
      setBusyId(user.id);
      await adminApi.proposeRoleChange(user.id, newRole, reason);
      notify(`Role change submitted for approval (${user.name} → ${newRole})`);
      setRequestsRefreshKey((k) => k + 1);
    } catch (err) {
      notify(err.message || "Could not submit role change");
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

  // AI abuse-prevention kill-switch (doc "AI" checklist) -- independent of
  // account suspension, since a student can otherwise misbehave
  // specifically in the assistant (e.g. sustained prompt-injection probing)
  // without warranting a full account suspension.
  const toggleAiAccess = async (user) => {
    const nextBlocked = !user.ai_blocked;
    let reason;
    if (nextBlocked) {
      reason = window.prompt(`Reason for blocking ${user.name}'s AI access?`);
      if (reason === null) return;
    }
    try {
      setBusyId(user.id);
      await adminApi.setAiAccess(user.id, nextBlocked, reason);
      notify(nextBlocked ? `${user.name}'s AI access blocked` : `${user.name}'s AI access restored`);
      await reload();
    } catch (err) {
      notify(err.message || "Could not change AI access");
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
                {user.ai_blocked && <small>AI access blocked{user.ai_blocked_reason ? `: ${user.ai_blocked_reason}` : ""}</small>}
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
                <button disabled={busyId === user.id} onClick={() => toggleAiAccess(user)}>
                  {user.ai_blocked ? "Unblock AI" : "Block AI"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <PendingRoleChangeRequests notify={notify} authUser={authUser} refreshKey={requestsRefreshKey} onDecided={reload} />
      <PendingAccountDeletionRequests notify={notify} />
    </div>
  );
}

// Role-assignment approval (doc "Admin" checklist item) -- the review queue
// for proposals filed by changeRole() above. A proposer can't approve their
// own request (server-enforced too; the button is just hidden here to match).
function PendingRoleChangeRequests({ notify, authUser, refreshKey, onDecided }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const reload = async () => {
    try {
      setLoading(true);
      setRequests(await adminApi.listRoleChangeRequests("pending"));
    } catch (err) {
      notify(err.message || "Could not load role change requests");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const decide = async (req, approve) => {
    const reason = approve
      ? null
      : window.prompt(`Why reject promoting ${req.target?.name || "this user"} to ${req.requested_role}? (optional)`);
    if (!approve && reason === null) return;
    if (approve && !window.confirm(`Approve promoting ${req.target?.name || "this user"} to ${req.requested_role}?`)) return;
    try {
      setBusyId(req.id);
      await adminApi.decideRoleChange(req.id, approve, reason);
      notify(approve ? "Role change approved" : "Role change rejected");
      await reload();
      await onDecided?.();
    } catch (err) {
      notify(err.message || "Could not decide role change");
    } finally {
      setBusyId(null);
    }
  };

  if (loading || requests.length === 0) return null;

  return (
    <div style={{ marginTop: 24 }}>
      <span className="section-kicker">PENDING ROLE CHANGE REQUESTS</span>
      <div className="resource-list" style={{ marginTop: 8 }}>
        {requests.map((req) => {
          const isOwnProposal = req.requested_by === authUser?.id;
          return (
            <article className="resource-row" key={req.id}>
              <div className="resource-icon"><HiUserGroup /></div>
              <div>
                <b>{req.target?.name || "Unknown user"} → {req.requested_role}</b>
                <small>Proposed by {req.proposer?.name || "an admin"} · currently {req.target?.role}</small>
                {req.reason && <small>Reason: {req.reason}</small>}
                {isOwnProposal && <small>Awaiting approval from a different admin</small>}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button disabled={isOwnProposal || busyId === req.id} onClick={() => decide(req, true)}>Approve</button>
                <button disabled={isOwnProposal || busyId === req.id} onClick={() => decide(req, false)}>Reject</button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

// Account deletion requests (doc "Student" checklist item).
function PendingAccountDeletionRequests({ notify }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const reload = async () => {
    try {
      setLoading(true);
      setRequests(await adminApi.listAccountDeletionRequests("pending"));
    } catch (err) {
      notify(err.message || "Could not load deletion requests");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const process = async (req, action) => {
    const label = action === "complete" ? "delete" : "reject the deletion of";
    const note = window.prompt(`Note for this decision (optional) -- about to ${label} ${req.profiles?.name || "this account"}:`);
    if (note === null && !window.confirm(`Continue without a note?`)) return;
    if (action === "complete" && !window.confirm(`This permanently soft-deletes ${req.profiles?.name || "this account"}. Continue?`)) return;
    try {
      setBusyId(req.id);
      await adminApi.adminProcessAccountDeletion(req.id, action, note || null);
      notify(action === "complete" ? "Account deleted" : "Deletion request rejected");
      await reload();
    } catch (err) {
      notify(err.message || "Could not process deletion request");
    } finally {
      setBusyId(null);
    }
  };

  if (loading || requests.length === 0) return null;

  return (
    <div style={{ marginTop: 24 }}>
      <span className="section-kicker">PENDING ACCOUNT DELETION REQUESTS</span>
      <div className="resource-list" style={{ marginTop: 8 }}>
        {requests.map((req) => (
          <article className="resource-row" key={req.id}>
            <div className="resource-icon"><HiXCircle /></div>
            <div>
              <b>{req.profiles?.name || "Unknown user"}</b>
              <small>{req.profiles?.email || "no email"} · {req.profiles?.usn || "no USN"} · requested {new Date(req.requested_at).toLocaleDateString()}</small>
              {req.reason && <small>Reason: {req.reason}</small>}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button disabled={busyId === req.id} onClick={() => process(req, "complete")}>Delete account</button>
              <button disabled={busyId === req.id} onClick={() => process(req, "reject")}>Reject</button>
            </div>
          </article>
        ))}
      </div>
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

/* =========================================================
   CAMPUS EMERGENCY DIRECTORY MANAGEMENT (doc §113 second half --
   supabase/migrations/20260817000100_emergency_directory.sql). Distinct
   from EmergencyContactsTab above (which verifies next-of-kin submissions)
   -- this manages the campus OFFICE directory (security/medical/facilities/
   transport/hostel/admin numbers) that students read via
   src/features/emergency/EmergencyDirectory.jsx. Exported so
   FacilitiesDashboard.jsx can reuse it, same as EmergencyContactsTab.
========================================================= */

const EMERGENCY_DIRECTORY_CATEGORIES = [
  ["emergency_response", "Emergency Response"], ["security", "Security"], ["medical", "Medical"],
  ["facilities", "Facilities"], ["hostel", "Hostel"], ["transport", "Transport"],
  ["admin", "Administration"], ["campus_management", "Campus Management"],
];

function EmergencyDirectoryModal({ entry, onClose, notify, onSaved }) {
  const isNew = !entry;
  const [form, setForm] = useState({
    category: entry?.category || "security", name: entry?.name || "", designation: entry?.designation || "",
    description: entry?.description || "", phone: entry?.phone || "", altPhone: entry?.alt_phone || "",
    email: entry?.email || "", location: entry?.location || "", priority: entry?.priority || "standard",
    is24x7: entry?.is_24x7 ?? false, hoursNote: entry?.hours_note || "",
  });
  const [saving, setSaving] = useState(false);
  const change = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    try {
      setSaving(true);
      await adminApi.upsertEmergencyDirectoryEntry({
        id: entry?.id || null, category: form.category, name: form.name.trim(),
        designation: form.designation.trim(), description: form.description.trim(),
        phone: form.phone.trim(), altPhone: form.altPhone.trim(), email: form.email.trim(),
        location: form.location.trim(), priority: form.priority, is24x7: form.is24x7,
        hoursNote: form.hoursNote.trim(), campusId: entry?.campus_id ?? null, displayOrder: entry?.display_order ?? 0,
      });
      notify(isNew ? "Directory entry created — pending verification" : "Directory entry updated — verification reset");
      onSaved();
    } catch (err) {
      notify(err.message || "Could not save this directory entry");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal kicker="EMERGENCY DIRECTORY" title={isNew ? "New directory entry" : `Edit ${entry.name}`} onClose={onClose}>
      <label>Category
        <select value={form.category} onChange={(e) => change("category", e.target.value)}>
          {EMERGENCY_DIRECTORY_CATEGORIES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </label>
      <label>Name<input value={form.name} onChange={(e) => change("name", e.target.value)} placeholder="Campus Security Desk" /></label>
      <label>Designation<input value={form.designation} onChange={(e) => change("designation", e.target.value)} placeholder="Chief Security Officer" /></label>
      <label>Description<textarea rows={2} value={form.description} onChange={(e) => change("description", e.target.value)} /></label>
      <label>Phone<input value={form.phone} onChange={(e) => change("phone", e.target.value)} placeholder="+919876543210" /></label>
      <label>Alt phone (optional)<input value={form.altPhone} onChange={(e) => change("altPhone", e.target.value)} /></label>
      <label>Email (optional)<input value={form.email} onChange={(e) => change("email", e.target.value)} /></label>
      <label>Location<input value={form.location} onChange={(e) => change("location", e.target.value)} placeholder="Main Gate, Security Cabin" /></label>
      <label>Priority
        <select value={form.priority} onChange={(e) => change("priority", e.target.value)}>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="standard">Standard</option>
        </select>
      </label>
      <label>
        <input type="checkbox" checked={form.is24x7} onChange={(e) => change("is24x7", e.target.checked)} style={{ width: "auto", marginRight: 8 }} />
        Open 24/7
      </label>
      {!form.is24x7 && (
        <label>Hours note (optional)<input value={form.hoursNote} onChange={(e) => change("hoursNote", e.target.value)} placeholder="Mon–Fri, 9am–5pm" /></label>
      )}
      <button className="primary wide" disabled={saving || !form.name.trim() || !form.phone.trim()} onClick={save}>
        {saving ? "Saving…" : isNew ? "Create entry" : "Save changes"}
      </button>
    </Modal>
  );
}

export function EmergencyDirectoryTab({ notify }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null); // null = closed, {} = new, entry = edit
  const [busyId, setBusyId] = useState(null);

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      setEntries(await adminApi.adminListEmergencyDirectory());
    } catch (err) {
      setError(err.message || "Could not load the emergency directory");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const verify = async (entry, verified) => {
    try {
      setBusyId(entry.id);
      await adminApi.verifyEmergencyDirectoryEntry(entry.id, verified);
      notify(verified ? "Entry verified — visible to students" : "Entry marked unverified");
      await reload();
    } catch (err) {
      notify(err.message || "Could not update verification");
    } finally {
      setBusyId(null);
    }
  };

  const toggleActive = async (entry) => {
    try {
      setBusyId(entry.id);
      await adminApi.setEmergencyDirectoryActive(entry.id, !entry.active);
      notify(entry.active ? "Entry deactivated" : "Entry reactivated");
      await reload();
    } catch (err) {
      notify(err.message || "Could not update this entry");
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <LoadingState label="Loading emergency directory…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Campus Emergency Directory</h2>
          <p>Verified office contacts students see under Services → Emergency Directory. Editing an entry resets its verification.</p>
        </div>
        <button className="primary" onClick={() => setEditing({})}><HiPlus /> New entry</button>
      </div>

      <div className="resource-list">
        {entries.length === 0 && <EmptyState icon={<HiPhone />} title="No entries yet" text="Add your campus's security, medical and facilities contacts." />}
        {entries.map((entry) => (
          <article className="resource-row" key={entry.id}>
            <div className="resource-icon"><HiPhone /></div>
            <div>
              <b>{entry.name} <span className="social-type">{entry.category.replace("_", " ").toUpperCase()}</span>{!entry.active && <span className="social-type"> INACTIVE</span>}</b>
              <small>{entry.phone}{entry.location ? ` · ${entry.location}` : ""} · {entry.priority}</small>
              <small>{entry.verified ? "Verified" : "Not yet verified"}</small>
            </div>
            <div className="chips">
              <button disabled={busyId === entry.id} onClick={() => verify(entry, !entry.verified)} className={entry.verified ? "chip active" : "chip"}>
                <HiShieldCheck /> {entry.verified ? "Verified" : "Verify"}
              </button>
              <button disabled={busyId === entry.id} onClick={() => setEditing(entry)}><HiPencilSquare /></button>
              <button disabled={busyId === entry.id} onClick={() => toggleActive(entry)}>{entry.active ? <HiXCircle /> : <HiCheck />}</button>
            </div>
          </article>
        ))}
      </div>

      {editing && (
        <EmergencyDirectoryModal entry={editing.id ? editing : null} notify={notify}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
      )}
    </div>
  );
}

/* =========================================================
   RESOURCE CATALOG MANAGEMENT (module 08, booking --
   supabase/migrations/20260819000400_resource_management.sql). resources_
   read/bookings already existed since 0007; nothing anywhere ever created
   or edited a `resources` row until this pass -- BookingApprovals
   (FacilitiesDashboard.jsx) only ever approves bookings of resources that
   already exist. This is the missing catalog-management layer.
========================================================= */

const RESOURCE_TYPES = ["room", "hall", "lab", "equipment", "sports facility", "other"];

function ResourceModal({ campusId, resource, onClose, notify, onSaved }) {
  const isNew = !resource;
  const [form, setForm] = useState({
    name: resource?.name || "", resourceType: resource?.resource_type || "room",
    capacity: resource?.capacity ?? "", openTime: resource?.opening_hours?.open || "08:00",
    closeTime: resource?.opening_hours?.close || "20:00", approvalRequired: resource?.approval_required ?? false,
    bufferMinutes: resource?.buffer_minutes ?? 0, available: resource?.available ?? true,
  });
  const [saving, setSaving] = useState(false);
  const change = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    try {
      setSaving(true);
      await adminApi.upsertResourceAdmin({
        id: resource?.id || null, campusId, name: form.name.trim(), resourceType: form.resourceType,
        capacity: form.capacity === "" ? null : Number(form.capacity),
        openingHours: { open: form.openTime, close: form.closeTime },
        approvalRequired: form.approvalRequired, bufferMinutes: Number(form.bufferMinutes) || 0,
        available: form.available,
      });
      notify(isNew ? "Resource created" : "Resource updated");
      onSaved();
    } catch (err) {
      notify(err.message || "Could not save this resource");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal kicker="RESOURCE" title={isNew ? "New bookable resource" : `Edit ${resource.name}`} onClose={onClose}>
      <label>Name<input value={form.name} onChange={(e) => change("name", e.target.value)} placeholder="Seminar Hall A" /></label>
      <label>Type
        <select value={form.resourceType} onChange={(e) => change("resourceType", e.target.value)}>
          {RESOURCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </label>
      <label>Capacity (optional)<input type="number" min={0} value={form.capacity} onChange={(e) => change("capacity", e.target.value)} /></label>
      <div className="form-grid">
        <label>Opens<input type="time" value={form.openTime} onChange={(e) => change("openTime", e.target.value)} /></label>
        <label>Closes<input type="time" value={form.closeTime} onChange={(e) => change("closeTime", e.target.value)} /></label>
      </div>
      <label>Buffer between bookings (minutes)<input type="number" min={0} value={form.bufferMinutes} onChange={(e) => change("bufferMinutes", e.target.value)} /></label>
      <label>
        <input type="checkbox" checked={form.approvalRequired} onChange={(e) => change("approvalRequired", e.target.checked)} style={{ width: "auto", marginRight: 8 }} />
        Bookings need staff approval
      </label>
      <label>
        <input type="checkbox" checked={form.available} onChange={(e) => change("available", e.target.checked)} style={{ width: "auto", marginRight: 8 }} />
        Available for booking
      </label>
      <button className="primary wide" disabled={saving || !form.name.trim()} onClick={save}>
        {saving ? "Saving…" : isNew ? "Create resource" : "Save changes"}
      </button>
    </Modal>
  );
}

export function ResourcesTab({ notify, campusId }) {
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      setResources(await adminApi.listResourcesAdmin(campusId));
    } catch (err) {
      setError(err.message || "Could not load resources");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { reload(); }, [campusId]); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = async (resource) => {
    if (!window.confirm(`Remove "${resource.name}"? If it has booking history it'll be marked unavailable instead of deleted.`)) return;
    try {
      setBusyId(resource.id);
      await adminApi.deleteResourceAdmin(resource.id);
      notify("Resource removed");
      await reload();
    } catch (err) {
      notify(err.message || "Could not remove this resource");
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <LoadingState label="Loading resources…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Bookable Resources</h2>
          <p>Rooms, halls, labs and equipment students can reserve under Services → Resource Booking.</p>
        </div>
        <button className="primary" onClick={() => setEditing({})}><HiPlus /> New resource</button>
      </div>

      <div className="resource-list">
        {resources.length === 0 && <EmptyState icon={<HiBuildingOffice2 />} title="No resources yet" text="Add a room, lab or piece of equipment to make it bookable." />}
        {resources.map((r) => (
          <article className="resource-row" key={r.id}>
            <div className="resource-icon"><HiBuildingOffice2 /></div>
            <div>
              <b>{r.name} <span className="social-type">{r.resource_type?.toUpperCase()}</span>{!r.available && <span className="social-type"> UNAVAILABLE</span>}</b>
              <small>
                {r.capacity ? `Capacity ${r.capacity} · ` : ""}
                {r.opening_hours?.open}–{r.opening_hours?.close}
                {r.approval_required ? " · needs approval" : ""}
              </small>
            </div>
            <div className="chips">
              <button disabled={busyId === r.id} onClick={() => setEditing(r)}><HiPencilSquare /></button>
              <button disabled={busyId === r.id} onClick={() => remove(r)}><HiTrash /></button>
            </div>
          </article>
        ))}
      </div>

      {editing && (
        <ResourceModal campusId={campusId} resource={editing.id ? editing : null} notify={notify}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
      )}
    </div>
  );
}

/* =========================================================
   SUPPORT TICKETS (module 42, new -- supabase/migrations/
   20260819000600_support_tickets.sql). Lightweight triage queue routed to
   college_admin/super_admin per the explicit "no dedicated support-staff
   role" decision made for this pass.
========================================================= */

const SUPPORT_STATUS_LABEL = { open: "Open", in_progress: "In progress", resolved: "Resolved", closed: "Closed" };
const SUPPORT_PRIORITIES = ["low", "normal", "high", "urgent"];
const SUPPORT_PRIORITY_LABEL = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };

function SupportTicketThreadModal({ ticket, authUser, onClose, notify, onChanged }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [priority, setPriority] = useState(ticket.priority || "normal");

  const reload = async () => {
    try {
      setLoading(true);
      const msgs = await adminApi.getSupportTicketMessages(ticket.id);
      const withUrls = await Promise.all(msgs.map(async (m) => (
        m.attachment_url ? { ...m, attachmentSignedUrl: await adminApi.getSupportAttachmentUrl(m.attachment_url).catch(() => null) } : m
      )));
      setMessages(withUrls);
    } catch (err) { notify(err.message || "Could not load the message thread"); }
    finally { setLoading(false); }
  };
  useEffect(() => { reload(); }, [ticket.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    if (!reply.trim() && !file) return;
    try {
      setBusy(true);
      let attachmentUrl = null;
      if (file) attachmentUrl = await adminApi.uploadSupportAttachment(file, authUser.id);
      await adminApi.addSupportTicketMessage(ticket.id, reply.trim(), attachmentUrl);
      setReply("");
      setFile(null);
      await reload();
      onChanged();
    } catch (err) { notify(err.message || "Could not send reply"); }
    finally { setBusy(false); }
  };

  const setStatus = async (status) => {
    try {
      setBusy(true);
      await adminApi.setSupportTicketStatus(ticket.id, status);
      notify(`Ticket marked ${SUPPORT_STATUS_LABEL[status].toLowerCase()}`);
      onChanged();
    } catch (err) { notify(err.message || "Could not update status"); }
    finally { setBusy(false); }
  };

  const changePriority = async (p) => {
    try {
      setBusy(true);
      await adminApi.setSupportTicketPriority(ticket.id, p);
      setPriority(p);
      notify(`Priority set to ${SUPPORT_PRIORITY_LABEL[p].toLowerCase()}`);
    } catch (err) { notify(err.message || "Could not update priority"); }
    finally { setBusy(false); }
  };

  const claim = async () => {
    try {
      setBusy(true);
      await adminApi.assignSupportTicket(ticket.id, authUser.id);
      notify("Ticket assigned to you");
      onChanged();
    } catch (err) { notify(err.message || "Could not assign this ticket"); }
    finally { setBusy(false); }
  };

  return (
    <Modal kicker={`SUPPORT · ${ticket.category.toUpperCase()}`} title={ticket.subject} onClose={onClose}>
      <p style={{ color: "var(--muted)", fontSize: 13 }}>
        From {ticket.reporter?.name || "a student"} ({ticket.reporter?.email}) · Status: {SUPPORT_STATUS_LABEL[ticket.status]}
        {ticket.assignee ? ` · Assigned to ${ticket.assignee.name}` : ""}
      </p>

      <div className="chips" style={{ marginBottom: 12 }}>
        {SUPPORT_PRIORITIES.map((p) => (
          <button key={p} className={priority === p ? "chip active" : "chip"} disabled={busy} onClick={() => changePriority(p)}>
            <span className={`status-pill priority-${p}`} style={{ marginRight: 4 }}>{SUPPORT_PRIORITY_LABEL[p]}</span>
          </button>
        ))}
      </div>

      {loading ? <LoadingState label="Loading thread…" /> : (
        <div className="resource-list" style={{ maxHeight: 320, overflowY: "auto" }}>
          {messages.map((m) => (
            <article className="resource-row" key={m.id} style={{ background: m.is_staff ? "var(--card-alt, #f5f5fa)" : undefined }}>
              <div>
                <b>{m.is_staff ? "Staff" : (m.sender?.name || "Student")}</b>
                {m.body && <small>{m.body}</small>}
                {m.attachmentSignedUrl && (
                  <a href={m.attachmentSignedUrl} target="_blank" rel="noreferrer">
                    <img src={m.attachmentSignedUrl} alt="Attachment" style={{ maxWidth: 160, borderRadius: 8, marginTop: 4, display: "block" }} />
                  </a>
                )}
                <small>{new Date(m.created_at).toLocaleString()}</small>
              </div>
            </article>
          ))}
        </div>
      )}

      <label>Reply<textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Type a reply…" /></label>
      <label>Attach a screenshot (optional)
        <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        {file && <small><HiPaperClip /> {file.name}</small>}
      </label>
      <button className="primary wide" disabled={busy || (!reply.trim() && !file)} onClick={send}>Send reply</button>

      <div className="chips" style={{ marginTop: 12 }}>
        {!ticket.assignee && <button disabled={busy} onClick={claim}>Assign to me</button>}
        {ticket.status !== "resolved" && <button disabled={busy} onClick={() => setStatus("resolved")}><HiShieldCheck /> Resolve</button>}
        {ticket.status !== "closed" && <button disabled={busy} onClick={() => setStatus("closed")}><HiXCircle /> Close</button>}
        {ticket.status !== "open" && <button disabled={busy} onClick={() => setStatus("open")}>Reopen</button>}
      </div>
    </Modal>
  );
}

// FAQ / Help Centre editor, module 42 (20260819001200_support_faq.sql).
// Nested inside the Support tab as a segmented view rather than its own
// top-level AdminCMS tab -- same content pool (support.manage), avoids
// growing the already-long TABS list for what's a sub-concern of Support.
function SupportFaqEditModal({ faq, onClose, notify, onSaved }) {
  const [category, setCategory] = useState(faq?.category || "general");
  const [question, setQuestion] = useState(faq?.question || "");
  const [answer, setAnswer] = useState(faq?.answer || "");
  const [sortOrder, setSortOrder] = useState(faq?.sort_order ?? 0);
  const [isActive, setIsActive] = useState(faq?.is_active ?? true);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!question.trim() || !answer.trim()) { notify("A question and answer are both required"); return; }
    try {
      setSaving(true);
      const row = await adminApi.adminUpsertSupportFaq({
        id: faq?.id || null, campusId: faq?.campus_id ?? null, category, question: question.trim(),
        answer: answer.trim(), sortOrder: Number(sortOrder) || 0, isActive,
      });
      notify(faq ? "FAQ entry updated" : "FAQ entry added");
      onSaved(row);
    } catch (err) { notify(err.message || "Could not save this FAQ entry"); }
    finally { setSaving(false); }
  };

  return (
    <Modal kicker="HELP CENTRE" title={faq ? "Edit FAQ entry" : "New FAQ entry"} onClose={onClose}>
      <label>Category
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {["general", "account", "payment", "technical", "other"].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <label>Question<input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="How do I reset my password?" /></label>
      <label>Answer<textarea rows={5} value={answer} onChange={(e) => setAnswer(e.target.value)} /></label>
      <label>Sort order<input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></label>
      <label className="toggle-row"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Visible to students</label>
      <button className="primary wide" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</button>
    </Modal>
  );
}

function SupportFaqAdmin({ notify }) {
  const [faqs, setFaqs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);

  const reload = async () => {
    try { setLoading(true); setFaqs(await adminApi.adminListSupportFaqs()); }
    catch (err) { notify(err.message || "Could not load FAQ entries"); }
    finally { setLoading(false); }
  };
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = async (id) => {
    try { await adminApi.adminDeleteSupportFaq(id); notify("FAQ entry deleted"); setFaqs((cur) => cur.filter((f) => f.id !== id)); }
    catch (err) { notify(err.message || "Could not delete this entry"); }
  };

  if (loading) return <LoadingState label="Loading FAQ entries…" />;

  return (
    <div>
      <button className="primary" onClick={() => setCreating(true)}><HiPlus /> New FAQ entry</button>
      <div className="resource-list" style={{ marginTop: 12 }}>
        {faqs.length === 0 && <EmptyState icon={<HiQuestionMarkCircle />} title="No FAQ entries yet" text="Add answers to the questions students ask support most." />}
        {faqs.map((f) => (
          <article className="resource-row" key={f.id}>
            <div className="resource-icon"><HiQuestionMarkCircle /></div>
            <div>
              <b>{f.question} {!f.is_active && <span className="status-pill unavailable">Hidden</span>}</b>
              <small>{f.category} · {f.campus_id ? "This campus" : "All campuses"}</small>
            </div>
            <div className="chips">
              <button onClick={() => setEditing(f)}><HiPencilSquare /></button>
              <button onClick={() => remove(f.id)}><HiTrash /></button>
            </div>
          </article>
        ))}
      </div>

      {(creating || editing) && (
        <SupportFaqEditModal faq={editing} notify={notify}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); reload(); }} />
      )}
    </div>
  );
}

export function SupportTicketsTab({ notify, authUser }) {
  const [view, setView] = useState("tickets");
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [openTicket, setOpenTicket] = useState(null);

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      setTickets(await adminApi.listSupportTicketsAdmin({ status: statusFilter || null }));
    } catch (err) {
      setError(err.message || "Could not load support tickets");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { reload(); }, [statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = priorityFilter ? tickets.filter((t) => t.priority === priorityFilter) : tickets;

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Support Tickets</h2>
          <p>Account, payment and technical questions that aren&rsquo;t a facilities issue.</p>
        </div>
      </div>

      <div className="chips" style={{ marginBottom: 16 }}>
        <button className={view === "tickets" ? "chip active" : "chip"} onClick={() => setView("tickets")}><HiLifebuoy /> Tickets</button>
        <button className={view === "faq" ? "chip active" : "chip"} onClick={() => setView("faq")}><HiQuestionMarkCircle /> Help Centre</button>
      </div>

      {view === "faq" ? <SupportFaqAdmin notify={notify} /> : (
        loading ? <LoadingState label="Loading support tickets…" /> : error ? <ErrorState text={error} onRetry={reload} /> : (
          <>
            <div className="chips" style={{ marginBottom: 8 }}>
              {["", "open", "in_progress", "resolved", "closed"].map((s) => (
                <button key={s || "all"} className={statusFilter === s ? "chip active" : "chip"} onClick={() => setStatusFilter(s)}>
                  {s ? SUPPORT_STATUS_LABEL[s] : "All"}
                </button>
              ))}
            </div>
            <div className="chips" style={{ marginBottom: 16 }}>
              {["", ...SUPPORT_PRIORITIES].map((p) => (
                <button key={p || "all-priority"} className={priorityFilter === p ? "chip active" : "chip"} onClick={() => setPriorityFilter(p)}>
                  {p ? SUPPORT_PRIORITY_LABEL[p] : "Any priority"}
                </button>
              ))}
            </div>

            <div className="resource-list">
              {shown.length === 0 && <EmptyState icon={<HiLifebuoy />} title="No tickets" text="Nothing here for this filter." />}
              {shown.map((t) => (
                <article className="resource-row" key={t.id} onClick={() => setOpenTicket(t)} style={{ cursor: "pointer" }}>
                  <div className="resource-icon"><HiLifebuoy /></div>
                  <div>
                    <b>{t.subject} <span className="social-type">{t.category.toUpperCase()}</span> {t.priority !== "normal" && <span className={`status-pill priority-${t.priority}`}>{SUPPORT_PRIORITY_LABEL[t.priority]}</span>}</b>
                    <small>{t.reporter?.name || "Student"} · {new Date(t.created_at).toLocaleString()}</small>
                  </div>
                  <strong>{SUPPORT_STATUS_LABEL[t.status]}</strong>
                </article>
              ))}
            </div>
          </>
        )
      )}

      {openTicket && (
        <SupportTicketThreadModal ticket={openTicket} authUser={authUser} notify={notify}
          onClose={() => setOpenTicket(null)} onChanged={() => { reload(); setOpenTicket(null); }} />
      )}
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

const ANNOUNCEMENT_CATEGORIES = ["Academic", "Exam", "Assignment", "Holiday", "Emergency", "Campus", "Maintenance", "Transport", "General"];

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

const OPPORTUNITY_TYPES = ["Internship", "Research", "Job", "Volunteer", "Competition", "Hackathon"];

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
   TEAMS -- moderation (doc §22 follow-up)
   Team creation/roster/edit stay owner's-own-business (per the
   permission-audit pass); this is the one thing that WAS backend-only --
   delete_project_team() already lets an admin or moderation.act holder
   remove an abusive team, this just gives that a UI. Browse-all, not
   report-driven: unlike posts/comments/conversations there's no
   content_reports flow for teams yet, so this mirrors
   OpportunitiesAdminSection's plain "list everything, act on it" shape
   instead.
========================================================= */

function TeamsAdminTab({ notify, campusId }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      setItems(await teamsApi.listProjectTeamsAdmin(campusId));
    } catch (err) {
      setError(err.message || "Could not load teams");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [campusId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <LoadingState label="Loading teams…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  return (
    <div>
      <div className="section-head">
        <h2>Project / Hackathon Teams</h2>
      </div>

      <div className="resource-list">
        {items.length === 0 && (
          <EmptyState title="No teams yet" text="Students haven't started any project or hackathon teams yet." />
        )}
        {items.map((item) => (
          <article className="resource-row" key={item.id}>
            <div className="resource-icon"><HiUserGroup /></div>
            <div>
              <b>{item.title}</b>
              <small>
                {item.category} · {item.status} · owned by {item.profiles?.name || "Unknown"} ·{" "}
                {item.project_team_members?.length || 0}/{item.max_members} members ·{" "}
                {item.project_team_applications?.length || 0} applicant(s)
              </small>
            </div>
            <button onClick={async () => {
              if (!window.confirm(`Remove the team "${item.title}"? This deletes its roster, applications and invitations.`)) return;
              try { await teamsApi.deleteProjectTeam(item.id); notify("Team removed"); reload(); }
              catch (err) { notify(err.message || "Could not remove this team"); }
            }}>
              <HiTrash />
            </button>
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

/* =========================================================
   AI ASSISTANT (doc "AI" checklist -- trust & quality + feedback loop +
   analytics). The abuse-prevention kill-switch is per-user, so it lives on
   the Users tab instead (see toggleAiAccess above) -- this tab is usage
   analytics, reported answers, and the admin-controlled knowledge base
   (supabase/migrations/20260817001300_ai_hardening.sql).
========================================================= */

function AiAssistantTab({ notify, campusId }) {
  const [summary, setSummary] = useState(null);
  const [reports, setReports] = useState([]);
  const [knowledge, setKnowledge] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ id: null, question: "", answer: "", global: true });
  const [saving, setSaving] = useState(false);

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      const [s, r, k] = await Promise.all([
        adminApi.getAiUsageSummary(30),
        adminApi.listAiReports(20),
        adminApi.listAiKnowledge(),
      ]);
      setSummary(s);
      setReports(r);
      setKnowledge(k);
    } catch (err) {
      setError(err.message || "Could not load AI data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const resetForm = () => setForm({ id: null, question: "", answer: "", global: true });
  const editEntry = (entry) => setForm({ id: entry.id, question: entry.question, answer: entry.answer, global: !entry.campus_id });

  const saveEntry = async () => {
    if (!form.question.trim() || !form.answer.trim()) {
      notify("Question and answer are both required");
      return;
    }
    try {
      setSaving(true);
      await adminApi.upsertAiKnowledge({
        id: form.id,
        question: form.question,
        answer: form.answer,
        campusId: form.global ? null : campusId,
        active: true,
      });
      notify(form.id ? "Knowledge entry updated" : "Knowledge entry added");
      resetForm();
      await reload();
    } catch (err) {
      notify(err.message || "Could not save entry");
    } finally {
      setSaving(false);
    }
  };

  const removeEntry = async (entry) => {
    if (!window.confirm(`Remove "${entry.question}"?`)) return;
    try {
      await adminApi.deleteAiKnowledge(entry.id);
      notify("Knowledge entry removed");
      await reload();
    } catch (err) {
      notify(err.message || "Could not remove entry");
    }
  };

  const toggleActive = async (entry) => {
    try {
      await adminApi.upsertAiKnowledge({ id: entry.id, question: entry.question, answer: entry.answer, campusId: entry.campus_id, active: !entry.active });
      await reload();
    } catch (err) {
      notify(err.message || "Could not update entry");
    }
  };

  if (loading) return <LoadingState label="Loading AI data…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  return (
    <div>
      <span className="section-kicker">USAGE -- LAST 30 DAYS</span>
      {summary && (
        <div className="analytics-grid" style={{ marginBottom: 24 }}>
          <StatTile label="Messages" value={summary.messages} sub={`${summary.unique_users} unique students`} />
          <StatTile label="Total tokens" value={summary.total_tokens} sub={`${summary.avg_tokens_per_message} avg/message`} />
          <StatTile label="Fell back to backup model" value={summary.fallback_count} />
          <StatTile label="Feedback" value={`${summary.feedback_up} 👍 / ${summary.feedback_down} 👎`} sub={`${summary.reports_open} reported`} />
          <StatTile label="AI-blocked users" value={summary.blocked_users} />
        </div>
      )}

      <span className="section-kicker">REPORTED ANSWERS</span>
      <div className="resource-list" style={{ margin: "12px 0 24px" }}>
        {reports.length === 0 && <EmptyState title="No reported answers" />}
        {reports.map((r) => (
          <article className="resource-row" key={r.id}>
            <div>
              <b>{r.user_name || "Unknown student"}</b>
              <small>&ldquo;{r.message_excerpt}&rdquo;</small>
              {r.report_reason && <small>Reason: {r.report_reason}</small>}
              <small>{new Date(r.created_at).toLocaleString()}</small>
            </div>
          </article>
        ))}
      </div>

      <span className="section-kicker">KNOWLEDGE BASE</span>
      <p style={{ fontSize: 12, color: "var(--muted)", margin: "6px 0 12px" }}>
        Campus-specific facts/FAQs the assistant can draw on (wifi password, hostel rules, library hours, and
        similar) -- doesn&rsquo;t touch the model or its tool code.
      </p>

      <div className="feature-modal" style={{ maxWidth: 480, margin: "0 0 16px", padding: 16, position: "static" }}>
        <label>
          Question
          <input value={form.question} onChange={(e) => setForm((f) => ({ ...f, question: e.target.value }))} placeholder="e.g. What's the hostel wifi password?" />
        </label>
        <label style={{ display: "block", marginTop: 10 }}>
          Answer
          <textarea value={form.answer} onChange={(e) => setForm((f) => ({ ...f, answer: e.target.value }))} rows={3} style={{ width: "100%" }} />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10 }}>
          <input type="checkbox" checked={form.global} onChange={(e) => setForm((f) => ({ ...f, global: e.target.checked }))} />
          Global (every campus, not just this one)
        </label>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="primary" disabled={saving} onClick={saveEntry}>{form.id ? "Update" : "Add"} entry</button>
          {form.id && <button className="ghost" onClick={resetForm}>Cancel edit</button>}
        </div>
      </div>

      <div className="resource-list">
        {knowledge.length === 0 && <EmptyState title="No knowledge base entries yet" />}
        {knowledge.map((entry) => (
          <article className="resource-row" key={entry.id}>
            <div className="resource-icon"><HiQuestionMarkCircle /></div>
            <div>
              <b>{entry.question} {!entry.active && <span className="social-type">INACTIVE</span>}</b>
              <small>{entry.answer}</small>
              <small>{entry.campus_id ? "This campus only" : "Global"}</small>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => editEntry(entry)}><HiPencilSquare /></button>
              <button onClick={() => toggleActive(entry)}>{entry.active ? "Deactivate" : "Activate"}</button>
              <button onClick={() => removeEntry(entry)}><HiTrash /></button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

/* =========================================================
   AUDIT LOG (doc "Admin" checklist: "Admin activity audit")
   The logging side (audit_logs table, written to by admin_set_user_role/
   admin_set_user_status/approve_org_request/transition_order_status/etc.)
   has existed since 20260814000200_rbac.sql, and getAuditLogs() has existed
   since the AI-hardening pass -- but no UI ever called it, so the audit
   trail was invisible to every admin. This is that viewer.
========================================================= */

function AuditLogTab() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [limit, setLimit] = useState(50);

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      setLogs(await adminApi.getAuditLogs(limit));
    } catch (err) {
      setError(err.message || "Could not load the audit log");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [limit]); // eslint-disable-line react-hooks/exhaustive-deps

  const actionTypes = [...new Set(logs.map((l) => l.action))].sort();
  const filtered = actionFilter ? logs.filter((l) => l.action === actionFilter) : logs;

  if (loading) return <LoadingState label="Loading audit log…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  return (
    <div>
      <div className="section-head">
        <h2>Admin activity audit</h2>
        <p>Every privileged action (role/status changes, moderation, order/refund overrides, org approvals…) that writes to audit_logs.</p>
      </div>

      {actionTypes.length > 0 && (
        <div className="chips" style={{ marginBottom: 16 }}>
          <button className={actionFilter === "" ? "chip active" : "chip"} onClick={() => setActionFilter("")}>All actions</button>
          {actionTypes.map((action) => (
            <button key={action} className={actionFilter === action ? "chip active" : "chip"} onClick={() => setActionFilter(action)}>
              {action}
            </button>
          ))}
        </div>
      )}

      <div className="resource-list">
        {filtered.length === 0 && <EmptyState title="No audit log entries yet" />}
        {filtered.map((entry) => (
          <article className="resource-row" key={entry.id}>
            <div className="resource-icon"><HiDocumentText /></div>
            <div>
              <b>{entry.action}{entry.entity_type ? ` · ${entry.entity_type}` : ""}</b>
              <small>{new Date(entry.created_at).toLocaleString()} · actor {entry.actor_id || "system"}{entry.actor_role ? ` (${entry.actor_role})` : ""}</small>
              {entry.reason && <small>Reason: {entry.reason}</small>}
              {(entry.old_value || entry.new_value) && (
                <small>
                  {entry.old_value ? `From ${JSON.stringify(entry.old_value)} ` : ""}
                  {entry.new_value ? `To ${JSON.stringify(entry.new_value)}` : ""}
                </small>
              )}
            </div>
          </article>
        ))}
      </div>

      {logs.length >= limit && (
        <button className="ghost" style={{ marginTop: 12 }} onClick={() => setLimit((l) => l + 50)}>
          Load more
        </button>
      )}
    </div>
  );
}

/* =========================================================
   VENDOR MANAGEMENT (2026-08-18 AdminCMS operating-system pass, part 1/5)
   Entity-level oversight of canteens/stores -- create, deactivate/
   reactivate, transfer ownership. NOT menu editing, that's still each
   vendor's own login (VendorDashboard.jsx).
========================================================= */

function AddVendorModal({ campusId, onClose, notify, onSaved }) {
  const [form, setForm] = useState({ type: "canteen", name: "", subtitle: "", category: "General", ownerEmail: "" });
  const [saving, setSaving] = useState(false);
  const change = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    try {
      setSaving(true);
      await adminApi.createVendor(campusId, {
        type: form.type, name: form.name.trim(), ownerEmail: form.ownerEmail.trim(),
        subtitle: form.subtitle.trim(), category: form.type === "store" ? form.category : null,
      });
      notify("Vendor created");
      onSaved();
    } catch (err) {
      notify(err.message || "Could not create vendor");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal kicker="NEW VENDOR" title="Create a vendor" onClose={onClose}>
      <label>Type
        <select value={form.type} onChange={(e) => change("type", e.target.value)}>
          <option value="canteen">Canteen</option>
          <option value="store">Campus Store</option>
        </select>
      </label>
      <label>Name<input value={form.name} onChange={(e) => change("name", e.target.value)} placeholder="Block C Canteen" /></label>
      <label>Subtitle (optional)<input value={form.subtitle} onChange={(e) => change("subtitle", e.target.value)} /></label>
      {form.type === "store" && (
        <label>Category
          <select value={form.category} onChange={(e) => change("category", e.target.value)}>
            {["Stationery", "Books", "Electronics", "Merch", "Printing Supplies", "General"].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
      )}
      <label>Owner&rsquo;s email<input value={form.ownerEmail} onChange={(e) => change("ownerEmail", e.target.value)} placeholder="Must already have a CampusOS account" /></label>
      <button className="primary wide" disabled={saving || !form.name.trim() || !form.ownerEmail.trim()} onClick={save}>
        {saving ? "Creating…" : "Create vendor"}
      </button>
    </Modal>
  );
}

function VendorManagementTab({ notify, campusId }) {
  const [vendors, setVendors] = useState([]);
  const [printShop, setPrintShop] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      const [v, p] = await Promise.all([
        adminApi.listVendorsAdmin(campusId),
        getMyPrintShopStatus(campusId).catch(() => null),
      ]);
      setVendors(v);
      setPrintShop(p);
    } catch (err) {
      setError(err.message || "Could not load vendors");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [campusId]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleActive = async (v) => {
    try {
      setBusyId(v.id);
      await adminApi.setVendorActive(v.type, v.id, !v.active);
      notify(v.active ? `${v.name} deactivated` : `${v.name} reactivated`);
      await reload();
    } catch (err) {
      notify(err.message || "Could not update this vendor");
    } finally {
      setBusyId(null);
    }
  };

  const transferOwnership = async (v) => {
    const email = window.prompt(`Transfer "${v.name}" to which email? (must already have a CampusOS account)`);
    if (!email) return;
    try {
      setBusyId(v.id);
      await adminApi.transferVendorOwnership(v.type, v.id, email.trim());
      notify("Ownership transferred");
      await reload();
    } catch (err) {
      notify(err.message || "Could not transfer ownership");
    } finally {
      setBusyId(null);
    }
  };

  const changePrintShopStatus = async (status) => {
    const message = window.prompt("Status message (optional)", printShop?.message || "");
    try {
      await setPrintShopStatus(status, message || null);
      notify("Print shop status updated");
      await reload();
    } catch (err) {
      notify(err.message || "Could not update print shop status");
    }
  };

  if (loading) return <LoadingState label="Loading vendors…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Vendor Management</h2>
          <p>Create, deactivate or reassign ownership of canteens and stores. Menu editing stays in each vendor&rsquo;s own login.</p>
        </div>
        <button className="primary" onClick={() => setShowAdd(true)}><HiPlus /> New vendor</button>
      </div>

      <article className="resource-row" style={{ marginBottom: 16 }}>
        <div className="resource-icon"><HiWrenchScrewdriver /></div>
        <div>
          <b>Print Shop {printShop && <span className="social-type">{printShop.status?.toUpperCase()}</span>}</b>
          <small>{printShop?.message || "No status message set"}</small>
        </div>
        <div className="chips">
          {["online", "offline", "maintenance"].map((s) => (
            <button key={s} className={printShop?.status === s ? "chip active" : "chip"} onClick={() => changePrintShopStatus(s)}>{s}</button>
          ))}
        </div>
      </article>

      <div className="resource-list">
        {vendors.length === 0 && <EmptyState title="No vendors yet" text="Create the first canteen or store for this campus." />}
        {vendors.map((v) => (
          <article className="resource-row" key={`${v.type}-${v.id}`}>
            <div className="resource-icon"><HiBuildingStorefront /></div>
            <div>
              <b>{v.name} {!v.active && <span className="social-type">INACTIVE</span>}</b>
              <small>
                {v.type === "canteen" ? "Canteen" : `Store · ${v.category}`}
                {v.subtitle ? ` · ${v.subtitle}` : ""} · owner {v.owner?.name || v.owner?.email || "Unassigned"}
              </small>
            </div>
            <div className="chips">
              <button disabled={busyId === v.id} onClick={() => toggleActive(v)}>{v.active ? "Deactivate" : "Reactivate"}</button>
              <button disabled={busyId === v.id} onClick={() => transferOwnership(v)}><HiArrowsRightLeft /> Transfer</button>
            </div>
          </article>
        ))}
      </div>

      {showAdd && (
        <AddVendorModal campusId={campusId} notify={notify} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); reload(); }} />
      )}
    </div>
  );
}

/* =========================================================
   FACILITIES OVERSIGHT (part 2/5). Reads were already reachable via RLS;
   this is the first UI over them, plus the new assign_ticket() write path.
========================================================= */

const TICKET_ACTIVE_STATUSES = ["SUBMITTED", "TRIAGED", "ASSIGNED", "IN_PROGRESS", "WAITING"];
const TICKET_TRANSITIONS = {
  SUBMITTED: ["TRIAGED", "CLOSED"],
  TRIAGED: ["ASSIGNED", "CLOSED"],
  ASSIGNED: ["IN_PROGRESS"],
  IN_PROGRESS: ["WAITING", "RESOLVED"],
  WAITING: ["IN_PROGRESS", "RESOLVED"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"],
};

function FacilitiesTab({ notify, campusId }) {
  const [tickets, setTickets] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [staff, setStaff] = useState([]);
  const [showClosed, setShowClosed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      const [t, b, s] = await Promise.all([
        adminApi.listTicketsAdmin(campusId),
        adminApi.listBookingsAdmin(campusId),
        adminApi.listFacilitiesStaff(campusId),
      ]);
      setTickets(t);
      setBookings(b);
      setStaff(s);
    } catch (err) {
      setError(err.message || "Could not load facilities data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [campusId]); // eslint-disable-line react-hooks/exhaustive-deps

  const assign = async (ticket, staffId) => {
    try {
      setBusyId(ticket.id);
      await adminApi.assignTicket(ticket.id, staffId || null);
      notify(staffId ? "Ticket assigned" : "Assignment cleared");
      await reload();
    } catch (err) {
      notify(err.message || "Could not assign this ticket");
    } finally {
      setBusyId(null);
    }
  };

  const transition = async (ticket, toStatus) => {
    try {
      setBusyId(ticket.id);
      await adminApi.transitionTicketStatus(ticket.id, toStatus);
      notify(`Ticket moved to ${toStatus}`);
      await reload();
    } catch (err) {
      notify(err.message || "Could not update this ticket");
    } finally {
      setBusyId(null);
    }
  };

  const setBooking = async (booking, status) => {
    try {
      setBusyId(booking.id);
      await adminApi.setBookingStatusAdmin(booking.id, status);
      notify(`Booking ${status.toLowerCase()}`);
      await reload();
    } catch (err) {
      notify(err.message || "Could not update this booking");
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <LoadingState label="Loading facilities…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  const visibleTickets = tickets.filter((t) => (showClosed ? true : TICKET_ACTIVE_STATUSES.includes(t.status)));
  const pendingBookings = bookings.filter((b) => b.status === "PENDING");

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Facilities</h2>
          <p>Every open ticket and booking campus-wide, not just your own.</p>
        </div>
      </div>

      <div className="chips" style={{ marginBottom: 16 }}>
        <button className={!showClosed ? "chip active" : "chip"} onClick={() => setShowClosed(false)}>Open ({tickets.filter((t) => TICKET_ACTIVE_STATUSES.includes(t.status)).length})</button>
        <button className={showClosed ? "chip active" : "chip"} onClick={() => setShowClosed(true)}>All ({tickets.length})</button>
      </div>

      <div className="resource-list">
        {visibleTickets.length === 0 && <EmptyState title="No tickets" text="Nothing here right now." />}
        {visibleTickets.map((t) => (
          <article className="resource-row" key={t.id}>
            <div className="resource-icon"><HiWrenchScrewdriver /></div>
            <div>
              <b>{t.title} <span className="social-type">{t.status}</span></b>
              <small>
                {t.category} · {t.priority} · from {t.submitter?.name || t.submitter?.email || "Unknown"} ·{" "}
                {new Date(t.created_at).toLocaleString()}
                {t.assignee ? ` · assigned to ${t.assignee.name || t.assignee.email}` : " · unassigned"}
              </small>
            </div>
            <div className="chips">
              <select
                disabled={busyId === t.id}
                value={t.assigned_to || ""}
                onChange={(e) => assign(t, e.target.value || null)}
              >
                <option value="">Unassigned</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.name || s.email}</option>)}
              </select>
              {(TICKET_TRANSITIONS[t.status] || []).map((next) => (
                <button key={next} disabled={busyId === t.id} onClick={() => transition(t, next)}>{next}</button>
              ))}
            </div>
          </article>
        ))}
      </div>

      <div className="section-head" style={{ marginTop: 32 }}>
        <h3>Resource bookings{pendingBookings.length ? ` — ${pendingBookings.length} pending approval` : ""}</h3>
      </div>
      <div className="resource-list">
        {bookings.length === 0 && <EmptyState title="No bookings yet" />}
        {bookings.slice(0, 50).map((b) => (
          <article className="resource-row" key={b.id}>
            <div className="resource-icon"><HiCalendarDays /></div>
            <div>
              <b>{b.resource?.name || "Resource"} <span className="social-type">{b.status}</span></b>
              <small>
                {b.requester?.name || b.requester?.email || "Unknown"} ·{" "}
                {new Date(b.start_time).toLocaleString()} – {new Date(b.end_time).toLocaleTimeString()}
              </small>
            </div>
            {b.status === "PENDING" && (
              <div className="chips">
                <button disabled={busyId === b.id} onClick={() => setBooking(b, "APPROVED")}>Approve</button>
                <button disabled={busyId === b.id} onClick={() => setBooking(b, "REJECTED")}>Reject</button>
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

/* =========================================================
   SYSTEM HEALTH (part 3/5) -- pg_cron job status + edge-function
   reachability + which secret groups are actually configured on this
   deployment (booleans only, never values).
========================================================= */

const SECRET_GROUP_LABELS = {
  ai_assistant: "AI Assistant",
  email: "Email",
  sms: "SMS",
  push: "Push notifications",
  payments: "Payments (Razorpay)",
};

function SystemHealthTab({ notify }) {
  const [dbHealth, setDbHealth] = useState(null);
  const [fnHealth, setFnHealth] = useState(null);
  const [fnError, setFnError] = useState("");
  const [obs, setObs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checkedAt, setCheckedAt] = useState(null);

  const reload = async () => {
    try {
      setLoading(true);
      setFnError("");
      const [db, fn, observability] = await Promise.allSettled([
        adminApi.getSystemHealth(),
        adminApi.getEdgeFunctionHealth(),
        adminApi.getObservabilitySummary(),
      ]);
      if (db.status === "fulfilled") setDbHealth(db.value);
      else notify(db.reason?.message || "Could not read cron/job health");
      if (fn.status === "fulfilled") setFnHealth(fn.value);
      else setFnError(fn.reason?.message || "Edge function unreachable");
      if (observability.status === "fulfilled") setObs(observability.value);
      else notify(observability.reason?.message || "Could not read observability summary");
      setCheckedAt(new Date());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <LoadingState label="Checking system health…" />;

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>System Health</h2>
          <p>{checkedAt ? `Last checked ${checkedAt.toLocaleTimeString()}` : ""}</p>
        </div>
        <button className="ghost" onClick={reload}>Refresh</button>
      </div>

      <div className="analytics-grid" style={{ marginBottom: 24 }}>
        <StatTile label="Edge functions" value={fnHealth ? "Reachable" : "Unreachable"} sub={fnError || (fnHealth?.deno_deployment_id ? `deployment ${fnHealth.deno_deployment_id}` : "")} />
        <StatTile label="Database (via edge)" value={fnHealth?.db_ok ? "OK" : "—"} sub={fnHealth?.db_latency_ms != null ? `${fnHealth.db_latency_ms}ms` : ""} />
        <StatTile label="Scheduled jobs" value={dbHealth?.jobs?.length ?? 0} sub="pg_cron" />
        <StatTile label="Jobs failing" value={(dbHealth?.jobs || []).filter((j) => j.last_status && j.last_status !== "succeeded").length} />
      </div>

      <h3>Scheduled jobs</h3>
      <div className="resource-list" style={{ marginBottom: 24 }}>
        {(dbHealth?.jobs || []).length === 0 && <EmptyState title="No cron jobs visible" text="Either none are scheduled, or this environment's cron-schema grants don't allow introspection." />}
        {(dbHealth?.jobs || []).map((j) => (
          <article className="resource-row" key={j.jobname}>
            <div className="resource-icon"><HiSignal /></div>
            <div>
              <b>{j.jobname} {!j.active && <span className="social-type">PAUSED</span>}</b>
              <small>
                schedule {j.schedule} · last run {j.last_start ? new Date(j.last_start).toLocaleString() : "never"} ·{" "}
                <span className="social-type">{j.last_status || "no runs yet"}</span>
              </small>
            </div>
          </article>
        ))}
      </div>

      <h3>Configuration (secrets present, values never shown)</h3>
      <div className="chips">
        {Object.entries(SECRET_GROUP_LABELS).map(([key, label]) => (
          <span key={key} className={fnHealth?.secret_groups?.[key] ? "chip active" : "chip"}>
            {label}: {fnHealth?.secret_groups?.[key] ? "configured" : "missing"}
          </span>
        ))}
      </div>

      <h3 style={{ marginTop: 24 }}>Observability (last 24h)</h3>
      <div className="analytics-grid" style={{ marginBottom: 24 }}>
        <StatTile
          label="Errors"
          value={(obs?.errors_by_severity_24h?.error || 0) + (obs?.errors_by_severity_24h?.fatal || 0)}
          sub={`${obs?.errors_by_severity_24h?.fatal || 0} fatal`}
        />
        <StatTile
          label="Payment failures"
          value={obs?.payment_24h?.failed_24h ?? 0}
          sub={`of ${obs?.payment_24h?.total_24h ?? 0} orders`}
        />
        <StatTile
          label="Notification failures"
          value={Object.values(obs?.notifications_24h || {}).reduce((sum, c) => sum + (c.failed || 0), 0)}
          sub={`of ${Object.values(obs?.notifications_24h || {}).reduce((sum, c) => sum + (c.total || 0), 0)} sent`}
        />
        <StatTile label="Cron jobs failing" value={obs?.cron_jobs_failing ?? 0} />
      </div>

      {Object.keys(obs?.errors_by_category_24h || {}).length > 0 && (
        <>
          <h3>Errors by category (24h)</h3>
          <div className="chips" style={{ marginBottom: 24 }}>
            {Object.entries(obs.errors_by_category_24h).map(([cat, count]) => (
              <span key={cat} className="chip">{cat}: {count}</span>
            ))}
          </div>
        </>
      )}

      <h3>Top errors (24h)</h3>
      <div className="resource-list">
        {(obs?.top_error_fingerprints_24h || []).length === 0 && (
          <EmptyState title="No errors logged" text="Nothing in error_logs in the last 24 hours." />
        )}
        {(obs?.top_error_fingerprints_24h || []).map((f) => (
          <article className="resource-row" key={f.fingerprint}>
            <div className="resource-icon"><HiExclamationTriangle /></div>
            <div>
              <b>{f.sample_message}</b>
              <small>
                {f.occurrences}× · <span className="social-type">{f.severity}</span>{f.category ? ` · ${f.category}` : ""} · last seen {new Date(f.last_seen).toLocaleString()}
              </small>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

/* =========================================================
   CAMPUS SETTINGS / CONFIGURATION (part 4/5)
========================================================= */

function CampusSettingsTab({ notify, campusId }) {
  const [campuses, setCampuses] = useState([]);
  const [selectedId, setSelectedId] = useState(campusId);
  const [form, setForm] = useState(null);
  const [settingsText, setSettingsText] = useState("{}");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      const rows = await adminApi.listCampusesAdmin();
      setCampuses(rows);
      const current = rows.find((c) => c.id === selectedId) || rows[0];
      if (current) {
        setSelectedId(current.id);
        setForm(current);
        setSettingsText(JSON.stringify(current.settings || {}, null, 2));
      }
    } catch (err) {
      setError(err.message || "Could not load campuses");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    let settings;
    try {
      settings = JSON.parse(settingsText || "{}");
    } catch {
      notify("Settings must be valid JSON");
      return;
    }
    try {
      setSaving(true);
      await adminApi.updateCampusSettings(selectedId, {
        name: form.name, domain: form.domain, timezone: form.timezone, active: form.active,
        supportEmail: form.support_email || "", supportPhone: form.support_phone || "", settings,
      });
      notify("Campus settings saved");
      await reload();
    } catch (err) {
      notify(err.message || "Could not save campus settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !form) return <LoadingState label="Loading campus settings…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Campus Settings</h2>
          <p>Name, domain, timezone, support contact and free-form per-campus configuration.</p>
        </div>
      </div>

      {campuses.length > 1 && (
        <div className="chips" style={{ marginBottom: 16 }}>
          {campuses.map((c) => (
            <button key={c.id} className={selectedId === c.id ? "chip active" : "chip"}
              onClick={() => { setSelectedId(c.id); setForm(c); setSettingsText(JSON.stringify(c.settings || {}, null, 2)); }}>
              {c.name}
            </button>
          ))}
        </div>
      )}

      <div className="settings-form">
        <label>Name<input value={form.name || ""} onChange={(e) => change("name", e.target.value)} /></label>
        <label>Email domain<input value={form.domain || ""} onChange={(e) => change("domain", e.target.value)} placeholder="nhce.edu.in" /></label>
        <label>Timezone<input value={form.timezone || ""} onChange={(e) => change("timezone", e.target.value)} /></label>
        <label>Support email<input value={form.support_email || ""} onChange={(e) => change("support_email", e.target.value)} /></label>
        <label>Support phone<input value={form.support_phone || ""} onChange={(e) => change("support_phone", e.target.value)} /></label>
        <label className="checkbox-row">
          <input type="checkbox" checked={form.active !== false} onChange={(e) => change("active", e.target.checked)} />
          Campus active
        </label>
        <label>Advanced settings (JSON)
          <textarea rows={5} value={settingsText} onChange={(e) => setSettingsText(e.target.value)} />
        </label>
        <button className="primary wide" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save campus settings"}</button>
      </div>
    </div>
  );
}

/* =========================================================
   FEATURE FLAGS (part 5/5). New capability end to end -- nothing in this
   pass wires an existing feature to a flag yet, this is the infrastructure.
========================================================= */

function FeatureFlagModal({ campusId, flag, onClose, notify, onSaved }) {
  const isNew = !flag;
  const [form, setForm] = useState({
    key: flag?.key || "", scope: flag?.campus_id ? "campus" : "global",
    description: flag?.description || "", enabled: flag?.enabled ?? false, rolloutPercentage: flag?.rollout_percentage ?? 100,
  });
  const [saving, setSaving] = useState(false);
  const change = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    try {
      setSaving(true);
      await adminApi.upsertFeatureFlag({
        key: form.key.trim(), campusId: form.scope === "campus" ? campusId : null,
        description: form.description.trim(), enabled: form.enabled, rolloutPercentage: Number(form.rolloutPercentage),
      });
      notify(isNew ? "Feature flag created" : "Feature flag updated");
      onSaved();
    } catch (err) {
      notify(err.message || "Could not save this feature flag");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal kicker="FEATURE FLAG" title={isNew ? "New feature flag" : `Edit ${flag.key}`} onClose={onClose}>
      <label>Key<input value={form.key} onChange={(e) => change("key", e.target.value)} disabled={!isNew} placeholder="new_checkout_flow" /></label>
      <label>Scope
        <select value={form.scope} onChange={(e) => change("scope", e.target.value)} disabled={!isNew}>
          <option value="global">Global (all campuses)</option>
          <option value="campus">This campus only</option>
        </select>
      </label>
      <label>Description<textarea rows={2} value={form.description} onChange={(e) => change("description", e.target.value)} /></label>
      <label>Rollout percentage<input type="number" min={0} max={100} value={form.rolloutPercentage} onChange={(e) => change("rolloutPercentage", e.target.value)} /></label>
      <label>
        <input type="checkbox" checked={form.enabled} onChange={(e) => change("enabled", e.target.checked)} style={{ width: "auto", marginRight: 8 }} />
        Enabled
      </label>
      <button className="primary wide" disabled={saving || !form.key.trim()} onClick={save}>
        {saving ? "Saving…" : isNew ? "Create flag" : "Save changes"}
      </button>
    </Modal>
  );
}

function FeatureFlagsTab({ notify, campusId }) {
  const [flags, setFlags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null); // null = closed, {} = new, flag = edit
  const [busyKey, setBusyKey] = useState(null);

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      setFlags(await adminApi.listFeatureFlags());
    } catch (err) {
      setError(err.message || "Could not load feature flags");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleEnabled = async (flag) => {
    try {
      setBusyKey(flag.id);
      await adminApi.upsertFeatureFlag({
        key: flag.key, campusId: flag.campus_id, description: flag.description,
        enabled: !flag.enabled, rolloutPercentage: flag.rollout_percentage,
      });
      notify(flag.enabled ? "Flag disabled" : "Flag enabled");
      await reload();
    } catch (err) {
      notify(err.message || "Could not toggle this flag");
    } finally {
      setBusyKey(null);
    }
  };

  const remove = async (flag) => {
    if (!window.confirm(`Delete feature flag "${flag.key}"${flag.campus_id ? " (campus override)" : " (global)"}?`)) return;
    try {
      setBusyKey(flag.id);
      await adminApi.deleteFeatureFlag(flag.key, flag.campus_id);
      notify("Feature flag deleted");
      await reload();
    } catch (err) {
      notify(err.message || "Could not delete this flag");
    } finally {
      setBusyKey(null);
    }
  };

  if (loading) return <LoadingState label="Loading feature flags…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Feature Flags</h2>
          <p>Global defaults with optional per-campus overrides. Nothing in the app reads these yet — this is the control plane.</p>
        </div>
        <button className="primary" onClick={() => setEditing({})}><HiPlus /> New flag</button>
      </div>

      <div className="resource-list">
        {flags.length === 0 && <EmptyState title="No feature flags yet" text="Create one to start gating a feature behind a flag." />}
        {flags.map((f) => (
          <article className="resource-row" key={f.id}>
            <div className="resource-icon"><HiFlag /></div>
            <div>
              <b>{f.key} <span className="social-type">{f.campus_id ? "CAMPUS" : "GLOBAL"}</span></b>
              <small>{f.description || "No description"} · {f.rollout_percentage}% rollout</small>
            </div>
            <div className="chips">
              <button disabled={busyKey === f.id} onClick={() => toggleEnabled(f)} className={f.enabled ? "chip active" : "chip"}>
                {f.enabled ? "Enabled" : "Disabled"}
              </button>
              <button disabled={busyKey === f.id} onClick={() => setEditing(f)}><HiPencilSquare /></button>
              <button disabled={busyKey === f.id} onClick={() => remove(f)}><HiTrash /></button>
            </div>
          </article>
        ))}
      </div>

      {editing && (
        <FeatureFlagModal campusId={campusId} flag={editing.id ? editing : null} notify={notify}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
      )}
    </div>
  );
}
