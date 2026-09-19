import React, { useEffect, useState } from "react";
import { LoadingState } from "../../components/ui/States";
import { getMySuspensionAppeal, submitSuspensionAppeal } from "../../services/mvpService";

function SuspendedAccountScreen({ profile, notify }) {
  const [appeal, setAppeal] = useState(undefined); // undefined = loading, null = none yet
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getMySuspensionAppeal()
      .then(setAppeal)
      .catch(() => setAppeal(null));
  }, []);

  const submit = async () => {
    if (!reason.trim()) return;
    try {
      setSubmitting(true);
      const created = await submitSuspensionAppeal(reason.trim());
      setAppeal(created);
      notify("Appeal submitted — a campus admin will review it");
    } catch (err) {
      notify(err.message || "Could not submit your appeal");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="page-section">
      <div className="section-head large">
        <div>
          <span className="section-kicker">ACCOUNT SUSPENDED</span>
          <h1>Your account has been suspended</h1>
          <p>
            {profile?.suspended_reason
              ? `Reason given: "${profile.suspended_reason}"`
              : "Contact a campus admin for details."}
          </p>
        </div>
      </div>

      {appeal === undefined && <LoadingState label="Checking appeal status…" />}

      {appeal === null && (
        <div className="side-card" style={{ maxWidth: 480 }}>
          <span className="section-kicker">SUBMIT AN APPEAL</span>
          <p>Explain why you believe this suspension should be reviewed.</p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Your explanation..."
            aria-label="Appeal explanation"
            rows={5}
            style={{ width: "100%", marginBottom: 12 }}
          />
          <button className="primary wide" disabled={!reason.trim() || submitting} onClick={submit}>
            {submitting ? "Submitting…" : "Submit appeal"}
          </button>
        </div>
      )}

      {appeal && appeal.status === "pending" && (
        <div className="side-card" style={{ maxWidth: 480 }}>
          <span className="section-kicker">APPEAL UNDER REVIEW</span>
          <p>&ldquo;{appeal.reason}&rdquo;</p>
          <small>Submitted {new Date(appeal.created_at).toLocaleString()} — a campus admin will review it.</small>
        </div>
      )}

      {appeal && appeal.status === "denied" && (
        <div className="side-card" style={{ maxWidth: 480 }}>
          <span className="section-kicker">APPEAL DENIED</span>
          {appeal.admin_note && <p>{appeal.admin_note}</p>}
          <p>You can submit another appeal below if you have new information.</p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Your explanation..."
            aria-label="Appeal explanation"
            rows={5}
            style={{ width: "100%", marginBottom: 12 }}
          />
          <button className="primary wide" disabled={!reason.trim() || submitting} onClick={submit}>
            {submitting ? "Submitting…" : "Submit another appeal"}
          </button>
        </div>
      )}
    </section>
  );
}

export { SuspendedAccountScreen };
