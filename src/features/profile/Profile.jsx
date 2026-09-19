import React, { useEffect, useState } from "react";
import campusOSLogoMark from "../../assets/campusos-logo-mark.png";
import { StatTile, TrendChart } from "../../components/ui/Charts";
import { requestContactEmailVerification } from "../../services/contactService";
import { cancelAccountDeletionRequest, connectGithub, connectLinkedin, exportMyData, getMyAccountDeletionRequest, requestAccountDeletion, submitStudentVerification, updateProfile } from "../../services/mvpService";
import { getStudentActivitySummary, getStudentSpendingSeries } from "../../services/studentAnalyticsService";
import { FaGithub, FaLinkedin } from "react-icons/fa6";
import { HiArrowLeftOnRectangle, HiArrowRight, HiArrowUpTray, HiCpuChip, HiPhone, HiPlus, HiShieldCheck, HiTrophy, HiUserPlus } from "react-icons/hi2";
import { ModalShell } from "../../components/ui/Shell";
import { OrgRequestModal } from "../clubs/ClubsBrowse";
import { EmergencyContactsModal } from "../emergency/EmergencyContactsModal";

function ContactRecoveryPanel({ profile, onProfileUpdated, notify }) {
  const [email, setEmail] = useState(profile?.contact_email || "");
  const [phone, setPhone] = useState(profile?.phone || "");
  const [sendingVerify, setSendingVerify] = useState(false);
  const [savingPhone, setSavingPhone] = useState(false);

  useEffect(() => { setEmail(profile?.contact_email || ""); }, [profile?.contact_email]);
  useEffect(() => { setPhone(profile?.phone || ""); }, [profile?.phone]);

  if (!profile) return null;

  const isVerified = !!profile.contact_email_verified_at;
  const isPending = !!profile.contact_email && !isVerified;

  const handleSendVerification = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@")) { notify("Enter a valid email address"); return; }
    try {
      setSendingVerify(true);
      await requestContactEmailVerification(cleanEmail);
      onProfileUpdated({ ...profile, contact_email: cleanEmail, contact_email_verified_at: null });
      notify("Verification email sent -- check your inbox");
    } catch (error) {
      notify(error.message || "Could not send verification email");
    } finally {
      setSendingVerify(false);
    }
  };

  const handleSavePhone = async () => {
    const trimmed = phone.trim();
    if (trimmed === (profile?.phone || "")) return;
    if (trimmed && !/^\+?[0-9\s-]{7,15}$/.test(trimmed)) { notify("Enter a valid phone number"); return; }
    try {
      setSavingPhone(true);
      const next = await updateProfile(profile.id, { phone: trimmed || null });
      onProfileUpdated(next);
    } catch (error) {
      notify(error.message || "Could not save phone number");
    } finally {
      setSavingPhone(false);
    }
  };

  return (
    <div className="profile-box profile-wide-box">
      <span className="section-kicker">CONTACT &amp; RECOVERY</span>
      <p>
        A verified email unlocks password recovery and email notifications;
        a phone number unlocks SMS notifications (and always receives
        emergency alerts, regardless of your SMS setting).
      </p>

      <label>
        Contact email
        <div className="contact-recovery-row">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
          {isVerified && email.trim().toLowerCase() === (profile.contact_email || "").toLowerCase() ? (
            <span className="chip active">Verified</span>
          ) : (
            <button className="ghost" disabled={sendingVerify} onClick={handleSendVerification}>
              {sendingVerify ? "Sending…" : isPending ? "Resend" : "Verify"}
            </button>
          )}
        </div>
        {isPending && email.trim().toLowerCase() === (profile.contact_email || "").toLowerCase() && (
          <small>Check your inbox for a verification link.</small>
        )}
      </label>

      <label>
        Phone number
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onBlur={handleSavePhone}
          placeholder="+91XXXXXXXXXX"
          disabled={savingPhone}
        />
      </label>
    </div>
  );
}

function Profile({ user, onLogin, onLogout, notify, openModal, profile, onProfileUpdated, stats = {}, verification, onVerificationChanged, campusId, go }) {
  const [verifyModalOpen, setVerifyModalOpen] = useState(false);
  const [vendorModalOpen, setVendorModalOpen] = useState(false);
  const [emergencyContactsModalOpen, setEmergencyContactsModalOpen] = useState(false);
  // My Activity (doc §14 student analytics) -- real data via
  // student_activity_summary()/student_spending_series(), replacing the
  // permanently-hardcoded `clubs: 0` this page shipped with. Declared above
  // the early `if (!user)` return since hooks can't be conditional; the
  // effect itself no-ops when signed out.
  const [activitySummary, setActivitySummary] = useState(null);
  const [spendingSeries, setSpendingSeries] = useState([]);
  useEffect(() => {
    if (!user) { setActivitySummary(null); setSpendingSeries([]); return; }
    let cancelled = false;
    Promise.all([getStudentActivitySummary(), getStudentSpendingSeries(30)])
      .then(([summary, series]) => {
        if (cancelled) return;
        setActivitySummary(summary);
        setSpendingSeries(series);
      })
      .catch((error) => console.error("My Activity loading failed:", error));
    return () => { cancelled = true; };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Account deletion request (doc "Student" checklist item) -- a real
  // request/review flow, not an immediate delete (see the migration's own
  // comment for why: almost every table in this schema references
  // profiles.id, several with on delete cascade, so an admin reviews before
  // anything actually happens).
  const [deletionRequest, setDeletionRequest] = useState(null);
  const reloadDeletionRequest = () => {
    if (!profile?.id) { setDeletionRequest(null); return; }
    getMyAccountDeletionRequest(profile.id).then(setDeletionRequest).catch((error) => console.error("Deletion request status loading failed", error));
  };
  useEffect(() => { reloadDeletionRequest(); }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRequestDeletion = async () => {
    const reason = window.prompt("Why do you want to delete your account? (optional)");
    if (reason === null) return;
    if (!window.confirm("This submits a request for a campus admin to review. Your account stays active until they act on it. Continue?")) return;
    try {
      await requestAccountDeletion(reason);
      notify("Deletion request submitted — an admin will review it");
      reloadDeletionRequest();
    } catch (error) {
      notify(error.message || "Could not submit deletion request");
    }
  };

  const handleCancelDeletion = async () => {
    if (!deletionRequest?.id) return;
    try {
      await cancelAccountDeletionRequest(deletionRequest.id);
      notify("Deletion request cancelled");
      reloadDeletionRequest();
    } catch (error) {
      notify(error.message || "Could not cancel deletion request");
    }
  };

  // Self-service data export (export_my_data() RPC, 20260824000100). Same
  // client-side-download pattern as the CSV exports in VendorDashboard/
  // ClubManage -- nothing is stored server-side, this just downloads the
  // jsonb the RPC computed on the spot.
  const [exportingData, setExportingData] = useState(false);
  const handleExportData = async () => {
    setExportingData(true);
    try {
      const data = await exportMyData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `campusos-my-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify("Your data export has downloaded");
    } catch (error) {
      notify(error.message || "Could not export your data");
    } finally {
      setExportingData(false);
    }
  };

  if (!user) {
    return (
      <section className="page-section profile-page">
        <div className="empty-profile">
          <div className="profile-logo">
            <img src={campusOSLogoMark} alt="" />
          </div>
          <span className="section-kicker">YOUR CAMPUS ID</span>
          <h1>Build your campus identity.</h1>
          <p>
            Sign in to access your profile, skills, clubs, achievements and
            personalized campus activity.
          </p>
          <button className="primary" onClick={onLogin}>
            Sign in with college email
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="page-section profile-page linkedin-profile">
      <div className="linkedin-cover">
        <div className="linkedin-pattern" />
      </div>

      <div className="linkedin-main-card">
        <div className="linkedin-avatar">{user.name[0]}</div>

        <div className="linkedin-intro">
          <div>
            {verification?.status === "verified" ? (
              <span className="verified-pill">
                <HiShieldCheck /> VERIFIED STUDENT
              </span>
            ) : (
              <button className="verified-pill unverified" onClick={() => setVerifyModalOpen(true)}>
                <HiShieldCheck />
                {verification?.status === "pending" ? "VERIFICATION PENDING" : "GET VERIFIED"}
              </button>
            )}
            <h1>{user.name}</h1>
            <p>
              {user.course} · {user.year} · New Horizon College of Engineering
            </p>
            <small>
              Bengaluru, Karnataka · <b>500+ connections</b>
            </small>
          </div>

          <button
            className="ghost"
            onClick={() => openModal("edit-profile")}
          >
            Edit profile
          </button>
        </div>

        {/* Always visible on the profile's landing view, not just inside
            Edit profile -- a connected account is a clickable pill, an
            unconnected one is a one-click "Connect" prompt right here. */}
        <div className="linkedin-social-links">
          {profile?.linkedin_url ? (
            // A pasted link, OAuth-verified or not -- the checkmark just
            // adds "and it's confirmed to really be them" on top of it.
            <a href={profile.linkedin_url} target="_blank" rel="noreferrer">
              <FaLinkedin /> LinkedIn
              {profile?.linkedin_verified_at && <HiShieldCheck title="Verified via LinkedIn sign-in" />}
            </a>
          ) : profile?.linkedin_verified_at ? (
            // Verified via OAuth, but LinkedIn's sign-in doesn't hand back
            // a profile URL -- still need it pasted in to link anywhere.
            <>
              <span className="verified-chip">
                <FaLinkedin /> <HiShieldCheck /> LinkedIn verified
              </span>
              <button className="ghost" onClick={() => openModal("edit-profile")}>
                <HiPlus /> Add profile link
              </button>
            </>
          ) : (
            <button
              className="ghost"
              onClick={async () => {
                try {
                  await connectLinkedin(); // redirects the browser away on success
                } catch (error) {
                  console.error("Connect LinkedIn:", error);
                  notify(error.message || "Unable to connect LinkedIn");
                }
              }}
            >
              <FaLinkedin /> Connect LinkedIn
            </button>
          )}
          {profile?.github_url ? (
            <a href={profile.github_url} target="_blank" rel="noreferrer">
              <FaGithub /> GitHub
            </a>
          ) : (
            <button
              className="ghost"
              onClick={async () => {
                try {
                  await connectGithub(); // redirects the browser away on success
                } catch (error) {
                  console.error("Connect GitHub:", error);
                  notify(error.message || "Unable to connect GitHub");
                }
              }}
            >
              <FaGithub /> Connect GitHub
            </button>
          )}
        </div>

        <div className="linkedin-actions">
          <button className="primary" onClick={() => { navigator.clipboard?.writeText(window.location.href); notify("Profile link copied"); }}>
            <HiArrowUpTray /> Share profile
          </button>
          <button
            className="ghost"
            onClick={async () => {
              try { const next = await updateProfile(profile.id, { ...profile, open_to_projects: !profile.open_to_projects }); onProfileUpdated(next); notify(next.open_to_projects ? "Open to projects" : "Availability hidden"); }
              catch (error) { notify(error.message || "Could not update availability"); }
            }}
          >
            <HiUserPlus /> Open to projects
          </button>
        </div>
        <button className="logout-btn" onClick={onLogout}>
        <HiArrowLeftOnRectangle /> Logout
        </button>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", marginTop: 10 }}>
          {go && (
            <button className="link-btn" onClick={() => go("legal")}>
              Privacy Policy &amp; Terms of Service
            </button>
          )}
          <button className="link-btn" onClick={handleExportData} disabled={exportingData}>
            {exportingData ? "Preparing…" : "Download my data"}
          </button>
          {deletionRequest ? (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "4px 10px" }}>
              <small>Account deletion requested — pending admin review.</small>
              <button className="link-btn" onClick={handleCancelDeletion}>Cancel deletion request</button>
            </div>
          ) : (
            <button className="link-btn" onClick={handleRequestDeletion}>
              Delete my account
            </button>
          )}
        </div>
      </div>

      <div className="profile-grid linkedin-grid">
        <div className="profile-box">
          <span className="section-kicker">ABOUT</span>
          <h3>Student builder focused on AI + hardware.</h3>
          <p>
            {profile?.bio || "Add a short bio so fellow students can understand your interests and project goals."}
          </p>
        </div>

        <div className="profile-box">
          <span className="section-kicker">ACTIVITY</span>
          <h3>Campus contribution</h3>
          <div className="stats">
            <b>{stats.posts || 0}<span>Posts</span></b>
            <b>{stats.events || 0}<span>Events</span></b>
            <b>{activitySummary?.clubs_joined_count ?? 0}<span>Clubs</span></b>
            <b>{profile?.open_to_projects ? "Open" : "Closed"}<span>Projects</span></b>
          </div>
        </div>
      </div>

      <div className="profile-box profile-wide-box">
        <span className="section-kicker">MY ACTIVITY</span>
        <div className="activity-box-head">
          <h3>Spending, orders &amp; campus activity</h3>
          {go && (
            <button className="ghost" onClick={() => go("activity")}>
              View all activity <HiArrowRight />
            </button>
          )}
        </div>
        {activitySummary && (
          <>
            <div className="analytics-grid">
              <StatTile
                label="Total spent"
                value={`₹${Number(activitySummary.total_spent || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                sub={`${activitySummary.food_orders_count || 0} food · ${activitySummary.store_orders_count || 0} store orders`}
              />
              <StatTile
                label="Events"
                value={activitySummary.events_registered_count || 0}
                sub={`${activitySummary.events_attended_count || 0} already happened`}
              />
              <StatTile
                label="Marketplace"
                value={activitySummary.marketplace_listings_count || 0}
                sub={`${activitySummary.marketplace_sold_count || 0} sold`}
              />
              <StatTile
                label="Opportunities"
                value={activitySummary.opportunities_applied_count || 0}
                sub={`${activitySummary.mentor_requests_count || 0} mentor requests`}
              />
            </div>
            <TrendChart
              title="Spending, last 30 days"
              points={spendingSeries.map((d) => ({ x: d.day, y: d.total_spent }))}
              valueFormatter={(v) => `₹${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
              emptyText="No orders in the last 30 days"
            />
          </>
        )}
      </div>

      <div className="profile-box profile-wide-box">
        <span className="section-kicker">STUDENT VERIFICATION</span>
        {verification?.status === "verified" && (
          <p><HiShieldCheck /> Verified — approved {new Date(verification.verified_at).toLocaleDateString()}.</p>
        )}
        {verification?.status === "pending" && (
          <p>Your student ID is under review. This usually takes a day or two.</p>
        )}
        {verification?.status === "rejected" && (
          <>
            <p>Your last submission was rejected{verification.rejection_reason ? `: ${verification.rejection_reason}` : "."}</p>
            <button className="primary" onClick={() => setVerifyModalOpen(true)}>Resubmit ID</button>
          </>
        )}
        {!verification && (
          <>
            <p>Upload a photo of your college ID card so classmates and staff know you&apos;re a real, verified student.</p>
            <button className="primary" onClick={() => setVerifyModalOpen(true)}>Verify my student ID</button>
          </>
        )}
      </div>

      <div className="profile-box profile-wide-box">
        <span className="section-kicker">EMERGENCY CONTACTS</span>
        <p>
          Add next-of-kin or guardian contacts a campus responder can reach
          on your behalf during a real emergency. A campus admin verifies
          each number before responders trust it.
        </p>
        <button className="primary" onClick={() => setEmergencyContactsModalOpen(true)}>
          <HiPhone /> Manage emergency contacts
        </button>
      </div>

      <ContactRecoveryPanel profile={profile} onProfileUpdated={onProfileUpdated} notify={notify} />

      <div className="profile-box profile-wide-box">
        <span className="section-kicker">PERSONALIZATION</span>
        <div className="push-toggle-row">
          <div>
            <b>Recommended for you</b>
            <small>
              {profile?.personalization_enabled !== false
                ? "Food, events, clubs and opportunities are ranked using your skills, clubs and activity. You can dismiss any recommendation with the × on its card."
                : "Off -- your dashboard shows popular campus picks instead of anything based on your activity."}
            </small>
          </div>
          <button
            className={profile?.personalization_enabled !== false ? "chip active" : "chip"}
            onClick={async () => {
              try {
                const next = await updateProfile(profile.id, { personalization_enabled: !(profile?.personalization_enabled !== false) });
                onProfileUpdated(next);
                notify(next.personalization_enabled ? "Personalized recommendations on" : "Personalized recommendations off");
              } catch (error) {
                notify(error.message || "Could not update personalization setting");
              }
            }}
          >
            {profile?.personalization_enabled !== false ? "On" : "Off"}
          </button>
        </div>
      </div>

      <div className="profile-box profile-wide-box">
        <span className="section-kicker">SELLER AVAILABILITY</span>
        <div className="push-toggle-row">
          <div>
            <b>Marketplace availability</b>
            <small>
              {profile?.availability_status === "away"
                ? "Buyers messaging you about a listing will see you're away."
                : "Buyers messaging you about a listing will see you're active and likely to reply soon."}
            </small>
          </div>
          <button
            className={profile?.availability_status === "away" ? "chip" : "chip active"}
            onClick={async () => {
              try {
                const nextStatus = profile?.availability_status === "away" ? "available" : "away";
                const next = await updateProfile(profile.id, { availability_status: nextStatus });
                onProfileUpdated(next);
                notify(nextStatus === "away" ? "Set to Away" : "Set to Active");
              } catch (error) {
                notify(error.message || "Could not update availability");
              }
            }}
          >
            {profile?.availability_status === "away" ? "Away" : "Active"}
          </button>
        </div>
        {profile?.availability_status === "away" && (
          <label style={{ marginTop: 10, display: "block" }}>
            Away message (optional)
            <input
              defaultValue={profile?.availability_message || ""}
              placeholder="e.g. Back on Monday"
              onBlur={async (e) => {
                const value = e.target.value.trim();
                if (value === (profile?.availability_message || "")) return;
                try {
                  const next = await updateProfile(profile.id, { availability_message: value || null });
                  onProfileUpdated(next);
                } catch (error) {
                  notify(error.message || "Could not update away message");
                }
              }}
            />
          </label>
        )}
      </div>

      {profile?.role === "student" && (
        <div className="profile-box profile-wide-box">
          <span className="section-kicker">RUN A CAMPUS BUSINESS</span>
          <p>Run a canteen, print counter or campus store? Apply for a vendor account.</p>
          <button className="primary" onClick={() => setVendorModalOpen(true)}>Apply to become a vendor</button>
        </div>
      )}

      <div className="profile-box profile-wide-box">
        <span className="section-kicker">FEATURED PROJECT</span>
        <div className="featured-project">
          <div className="featured-project-icon">
            <HiCpuChip />
          </div>
          <div>
            <h3>Campus OS</h3>
            <p>
              A unified student ecosystem combining community, services,
              transactions, campus intelligence and future hardware.
            </p>
            <div className="skill-list">
              <span>React</span>
              <span>AI/ML</span>
              <span>IoT</span>
              <span>Product</span>
            </div>
          </div>
        </div>
      </div>

      <div className="profile-grid linkedin-grid">
        <div className="profile-box">
          <span className="section-kicker">EXPERIENCE</span>
          <h3>Campus OS — Product Builder</h3>
          <p>2026 · Present</p>
          <p>
            Designing the digital operating layer for student communities,
            campus commerce and autonomous infrastructure.
          </p>
        </div>

        <div className="profile-box">
          <span className="section-kicker">ACHIEVEMENTS</span>
          <h3>Campus Passport</h3>
          {profile?.achievements?.length > 0 ? (
            profile.achievements.map((achievement) => (
              <p key={achievement}><HiTrophy /> {achievement}</p>
            ))
          ) : (
            <p>
              Add hackathon wins, certifications or other achievements so
              classmates can find and celebrate them on{" "}
              <b>Connect</b>.{" "}
              <button className="link-btn" onClick={() => openModal("edit-profile")}>
                Add one now
              </button>
            </p>
          )}
        </div>
      </div>

      {verifyModalOpen && (
        <VerifyIdModal
          profile={profile}
          campusId={campusId}
          onClose={() => setVerifyModalOpen(false)}
          onSubmitted={() => { setVerifyModalOpen(false); onVerificationChanged(); notify("ID submitted for review"); }}
          notify={notify}
        />
      )}

      {vendorModalOpen && (
        <OrgRequestModal
          requestType="vendor"
          authUser={profile}
          campusId={campusId}
          onClose={() => setVendorModalOpen(false)}
          notify={notify}
        />
      )}

      {emergencyContactsModalOpen && (
        <EmergencyContactsModal
          onClose={() => setEmergencyContactsModalOpen(false)}
          notify={notify}
        />
      )}
    </section>
  );
}

function VerifyIdModal({ profile, campusId, onClose, onSubmitted, notify }) {
  const [file, setFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  return (
    <ModalShell kicker="VERIFICATION" title="Verify your student ID" onClose={onClose}>
      <p>
        Upload a clear photo of your college ID card (front side, USN and name
        visible). A campus admin reviews it — this is never shown publicly.
      </p>
      <label>
        ID card photo
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
      </label>
      <button
        className="primary wide"
        disabled={submitting || !file}
        onClick={async () => {
          try {
            setSubmitting(true);
            await submitStudentVerification({ userId: profile.id, campusId, usn: profile.usn, file });
            onSubmitted();
          } catch (error) {
            notify(error.message || "Could not submit for verification");
          } finally {
            setSubmitting(false);
          }
        }}
      >
        {submitting ? "Uploading…" : "Submit for review"}
      </button>
    </ModalShell>
  );
}

export { ContactRecoveryPanel, Profile, VerifyIdModal };
