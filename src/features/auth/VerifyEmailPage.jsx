import React, { useEffect, useState } from "react";
import { EmptyState, LoadingState } from "../../components/ui/States";
import { confirmContactEmailVerification } from "../../services/contactService";
import { HiArrowLeft, HiCheckCircle, HiXMark } from "react-icons/hi2";
import { PageHeader } from "../../components/ui/Shell";

function VerifyEmailPage({ go }) {
  const [status, setStatus] = useState("verifying"); // verifying | done | error
  const [error, setError] = useState("");

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setStatus("error");
      setError("No verification token in this link.");
      return;
    }
    confirmContactEmailVerification(token)
      .then(() => setStatus("done"))
      .catch((err) => {
        setStatus("error");
        setError(err.message || "This verification link is invalid or has expired.");
      });
  }, []);

  return (
    <section className="page-section">
      <PageHeader kicker="ACCOUNT" title="Verify email" text="Confirming your contact email." />
      <div className="profile-box profile-wide-box">
        {status === "verifying" && <LoadingState label="Verifying…" />}
        {status === "done" && (
          <EmptyState icon={<HiCheckCircle />} title="Email verified" text="Password recovery and email notifications are now available on this account." />
        )}
        {status === "error" && (
          <EmptyState icon={<HiXMark />} title="Couldn't verify" text={error} />
        )}
        {go && (
          <button className="ghost" style={{ marginTop: 16 }} onClick={() => go("home")}>
            <HiArrowLeft /> Back to CampusOS
          </button>
        )}
      </div>
    </section>
  );
}

export { VerifyEmailPage };
