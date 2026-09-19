import React, { useState } from "react";
import { EmptyState } from "../../components/ui/States";
import { confirmPasswordReset } from "../../services/contactService";
import { HiArrowLeft, HiCheckCircle, HiXMark } from "react-icons/hi2";
import { PageHeader } from "../../components/ui/Shell";

function ResetPasswordPage({ go, notify }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const token = new URLSearchParams(window.location.search).get("token");

  const handleSubmit = async () => {
    if (!token) { notify("This reset link is missing its token."); return; }
    if (!password || password.length < 8) { notify("Password must be at least 8 characters"); return; }
    if (password !== confirmPassword) { notify("Passwords don't match"); return; }
    try {
      setLoading(true);
      await confirmPasswordReset(token, password);
      setDone(true);
      notify("Password reset -- sign in with your new password");
    } catch (error) {
      notify(error.message || "Unable to reset password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="page-section">
      <PageHeader kicker="ACCOUNT" title="Reset password" text="Choose a new password for your account." />
      <div className="profile-box profile-wide-box">
        {!token && <EmptyState icon={<HiXMark />} title="Invalid link" text="This reset link is missing its token." />}
        {token && done && (
          <EmptyState icon={<HiCheckCircle />} title="Password reset" text="Sign in with your new password." />
        )}
        {token && !done && (
          <>
            <label>
              New password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoFocus />
            </label>
            <label>
              Confirm password
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" />
            </label>
            <button className="primary wide" disabled={loading} onClick={handleSubmit}>
              {loading ? "Resetting…" : "Reset password"}
            </button>
          </>
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

export { ResetPasswordPage };
