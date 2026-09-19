import React, { Suspense, lazy, useEffect, useState } from "react";
import { EmptyState, LoadingState } from "../../components/ui/States";
import { getMyClubs, joinClub, leaveClub, submitOrgRequest } from "../../services/mvpService";
import * as clubApi from "./api";
import { HiAcademicCap, HiArrowRight, HiPlus } from "react-icons/hi2";
import { ModalShell, PageHeader } from "../../components/ui/Shell";

const ClubManage = lazy(() => import("./ClubManage"));

function Clubs({ notify, clubs: clubList, authUser, setLoginOpen, campusId }) {
  const [selectedClub, setSelectedClub] = useState(null);
  const [joinedClubs, setJoinedClubs] = useState({});
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [leadership, setLeadership] = useState({});
  const [managingClubId, setManagingClubId] = useState(null);
  const [applications, setApplications] = useState({}); // club_id -> latest application row
  const [applyClub, setApplyClub] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState("All");

  // Preserves catalog order (technical clubs before extra-curricular ones)
  // instead of alphabetizing categories, so the filter chips read in the
  // same grouping the club list itself was seeded in.
  const categories = ["All", ...new Set(clubList.map((c) => c.category).filter(Boolean))];
  const filteredClubs = categoryFilter === "All" ? clubList : clubList.filter((c) => c.category === categoryFilter);

  const reloadApplications = () => {
    if (!authUser?.id) { setApplications({}); return; }
    clubApi.getMyClubApplications(authUser.id).then((rows) => {
      const map = {};
      // Latest first (already ordered by created_at desc) -- keep only the
      // newest application per club so a rejected-then-reapplied history
      // doesn't shadow the fresh pending one.
      (rows || []).forEach((row) => { if (!map[row.club_id]) map[row.club_id] = row; });
      setApplications(map);
    }).catch(() => {});
  };

  useEffect(() => {
    if (!authUser?.id) { setLeadership({}); setApplications({}); return; }
    getMyClubs(authUser.id).then((myClubs) => {
      const map = {};
      (myClubs || []).forEach((item) => {
        map[item.club_id] = true;
      });
      setJoinedClubs(map);
    });
    clubApi.getMyClubLeadership().then((rows) => {
      const map = {};
      (rows || []).forEach((row) => { map[row.club_id] = row.role; });
      setLeadership(map);
    }).catch(() => {});
    reloadApplications();
  }, [authUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (managingClubId) {
    return (
      <Suspense fallback={<LoadingState label="Loading club management…" />}>
        <ClubManage
          clubId={managingClubId}
          campusId={campusId}
          authUser={authUser}
          notify={notify}
          onBack={() => setManagingClubId(null)}
        />
      </Suspense>
    );
  }

  const handleToggleJoin = async (club) => {
    if (!authUser) {
      setLoginOpen?.();
      notify("Sign in to join clubs");
      return;
    }

    const isJoined = joinedClubs[club.id];
    try {
      if (isJoined) {
        await leaveClub({ clubId: club.id, userId: authUser.id });
        setJoinedClubs((prev) => ({ ...prev, [club.id]: false }));
        notify(`Left ${club.name}`);
        return;
      }

      if (club.recruitment_mode === "closed") {
        notify(`${club.name} isn't accepting new members right now`);
        return;
      }
      if (club.recruitment_mode === "application") {
        setApplyClub(club);
        return;
      }

      await joinClub({ clubId: club.id, userId: authUser.id });
      setJoinedClubs((prev) => ({ ...prev, [club.id]: true }));
      notify(`Joined ${club.name}!`);
    } catch (err) {
      console.error(err);
      notify(err.message || "Club action failed");
    }
  };

  // For an "application"-mode club: what to show instead of a plain
  // Join/Leave toggle, driven by the latest application row (if any).
  const joinButtonFor = (club) => {
    if (joinedClubs[club.id]) return { label: "Leave", action: () => handleToggleJoin(club), className: "ghost" };
    if (club.recruitment_mode === "closed") return { label: "Recruitment closed", disabled: true, className: "ghost" };
    if (club.recruitment_mode === "application") {
      const app = applications[club.id];
      if (app?.status === "pending") {
        return {
          label: "Application pending", className: "ghost",
          action: async () => {
            if (!window.confirm("Withdraw your pending application?")) return;
            try {
              await clubApi.cancelClubApplication(app.id);
              notify("Application withdrawn");
              reloadApplications();
            } catch (err) {
              notify(err.message || "Could not withdraw application");
            }
          },
        };
      }
      return { label: app?.status === "rejected" ? "Apply again" : "Apply to join", action: () => handleToggleJoin(club), className: "primary" };
    }
    return { label: "Join", action: () => handleToggleJoin(club), className: "primary" };
  };

  return (
    <section className="page-section">
      <PageHeader
        kicker="STUDENT COMMUNITIES"
        title="Clubs Hub"
        text="Discover the communities shaping campus life."
        action={
          <button
            className="primary"
            onClick={() => {
              if (!authUser) { setLoginOpen?.(); notify("Sign in to start a club"); return; }
              setRequestModalOpen(true);
            }}
          >
            <HiPlus /> Start a club
          </button>
        }
      />

      {categories.length > 2 && (
        <div className="chips" style={{ marginBottom: 20, flexWrap: "wrap" }}>
          {categories.map((cat) => (
            <button
              key={cat}
              className={categoryFilter === cat ? "chip active" : "chip"}
              onClick={() => setCategoryFilter(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {filteredClubs.length === 0 && (
        <EmptyState icon={<HiAcademicCap />} title="No clubs in this category yet" />
      )}

      <div className="club-grid">
        {filteredClubs.map((club) => {
          const isMember = Boolean(joinedClubs[club.id]);
          return (
            <article className="club-card" key={club.id}>
              <div className="club-icon">
                <HiAcademicCap />
              </div>
              <h3>{club.name}</h3>
              <p>{club.description}</p>

              <div className="club-stats">
                <span>{club.members + (isMember ? 1 : 0)} members</span>
                <span>{club.events} events</span>
              </div>

              <div style={{ display: "flex", gap: "8px", marginTop: "12px", flexWrap: "wrap" }}>
                <button
                  className="ghost"
                  onClick={() => setSelectedClub(club)}
                >
                  View club <HiArrowRight />
                </button>
                {(() => {
                  const btn = joinButtonFor(club);
                  return (
                    <button className={btn.className} disabled={btn.disabled} onClick={btn.action}>
                      {btn.label}
                    </button>
                  );
                })()}
                {leadership[club.id] && (
                  <button className="primary" onClick={() => setManagingClubId(club.id)}>
                    Manage club
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {selectedClub && (
        <ModalShell
          kicker="CLUB DETAILS"
          title={selectedClub.name}
          onClose={() => setSelectedClub(null)}
        >
          <p>{selectedClub.description}</p>
          <div className="club-stats" style={{ margin: "16px 0" }}>
            <span>Category: {selectedClub.category}</span>
            <span>Members: {selectedClub.members}</span>
          </div>
          {selectedClub.recruitment_mode === "application" && selectedClub.recruitment_message && !joinedClubs[selectedClub.id] && (
            <p style={{ marginBottom: 12 }}>{selectedClub.recruitment_message}</p>
          )}
          {(() => {
            const btn = joinButtonFor(selectedClub);
            return (
              <button
                className="primary wide"
                disabled={btn.disabled}
                onClick={() => {
                  setSelectedClub(null);
                  btn.action();
                }}
              >
                {btn.label}
              </button>
            );
          })()}
        </ModalShell>
      )}

      {applyClub && (
        <ApplyClubModal
          club={applyClub}
          onClose={() => setApplyClub(null)}
          onApplied={() => { setApplyClub(null); reloadApplications(); }}
          notify={notify}
        />
      )}

      {requestModalOpen && (
        <OrgRequestModal
          requestType="club"
          authUser={authUser}
          campusId={campusId}
          onClose={() => setRequestModalOpen(false)}
          notify={notify}
        />
      )}
    </section>
  );
}

function ApplyClubModal({ club, onClose, onApplied, notify }) {
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  return (
    <ModalShell kicker="CLUB APPLICATION" title={`Apply to join ${club.name}`} onClose={onClose}>
      {club.recruitment_message && <p style={{ marginBottom: 12 }}>{club.recruitment_message}</p>}
      <label>Why do you want to join? (optional)
        <textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Tell the club a bit about yourself…" />
      </label>
      <button
        className="primary wide"
        disabled={submitting}
        onClick={async () => {
          try {
            setSubmitting(true);
            await clubApi.applyToClub(club.id, message);
            notify("Application sent — a club leader will review it");
            onApplied();
          } catch (err) {
            notify(err.message || "Could not submit application");
          } finally {
            setSubmitting(false);
          }
        }}
      >
        {submitting ? "Submitting…" : "Submit application"}
      </button>
    </ModalShell>
  );
}

function OrgRequestModal({ requestType, authUser, campusId, onClose, notify }) {
  const [form, setForm] = useState({ name: "", description: "", category: "", contactPhone: "" });
  const [submitting, setSubmitting] = useState(false);
  const change = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const isVendor = requestType === "vendor";

  return (
    <ModalShell
      kicker={isVendor ? "VENDOR APPLICATION" : "NEW CLUB"}
      title={isVendor ? "Apply to become a campus vendor" : "Start a new club"}
      onClose={onClose}
    >
      {isVendor && (
        <p>
          A campus admin reviews every application. Approval means your
          request is accepted — a vendor account still has to be set up for
          you by an admin as a separate step.
        </p>
      )}
      <label>{isVendor ? "Business name" : "Club name"}<input value={form.name} onChange={(e) => change("name", e.target.value)} /></label>
      <label>{isVendor ? "What will you sell?" : "What's this club about?"}<textarea value={form.description} onChange={(e) => change("description", e.target.value)} /></label>
      <label>{isVendor ? "Category (canteen, print, etc.)" : "Category"}<input value={form.category} onChange={(e) => change("category", e.target.value)} /></label>
      {isVendor && <label>Contact phone<input value={form.contactPhone} onChange={(e) => change("contactPhone", e.target.value)} /></label>}
      <button
        className="primary wide"
        disabled={submitting || !form.name.trim() || !form.description.trim()}
        onClick={async () => {
          try {
            setSubmitting(true);
            await submitOrgRequest({
              userId: authUser.id,
              campusId,
              requestType,
              name: form.name,
              description: form.description,
              category: form.category,
              contactPhone: form.contactPhone,
            });
            notify("Request submitted — a campus admin will review it");
            onClose();
          } catch (error) {
            notify(error.message || "Could not submit request");
          } finally {
            setSubmitting(false);
          }
        }}
      >
        {submitting ? "Submitting…" : "Submit request"}
      </button>
    </ModalShell>
  );
}

export { ApplyClubModal, ClubManage, Clubs, OrgRequestModal };
