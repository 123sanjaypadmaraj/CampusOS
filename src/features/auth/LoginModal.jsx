import React, { useState } from "react";
import { requestPasswordReset } from "../../services/contactService";
import { getMyAccess, sendMagicLink, signInWithPassword, signInWithUsn, signOut, signUpWithUsn } from "../../services/mvpService";
import { HiArrowRight, HiCheckCircle } from "react-icons/hi2";
import { ModalShell } from "../../components/ui/Shell";
import { LegalContent } from "../legal/Legal";

function LoginModal({ onClose, notify }) {
  // 'magic-link' | 'usn' | 'vendor' | 'club' | 'admin' | 'teacher' -- one tab
  // per account type (doc: "separate logins for students, clubs, admin and
  // teachers"). The tab only picks which form/copy is shown; the actual
  // access grant always comes from profiles.role in the database (see
  // AdminPasswordLogin/FacultyPasswordLogin's post-sign-in getMyAccess()
  // check below) -- picking a tab never grants a role by itself.
  const [mode, setMode] = useState("magic-link");

  return (
    <ModalShell
      kicker="COLLEGE ACCOUNT"
      title="Welcome to Campus OS"
      onClose={onClose}
    >
      <div className="chips" style={{ marginBottom: 16 }}>
        <button
          className={mode === "magic-link" ? "chip active" : "chip"}
          onClick={() => setMode("magic-link")}
        >
          Email link
        </button>
        <button
          className={mode === "usn" ? "chip active" : "chip"}
          onClick={() => setMode("usn")}
        >
          USN &amp; password
        </button>
        <button
          className={mode === "vendor" ? "chip active" : "chip"}
          onClick={() => setMode("vendor")}
        >
          Vendor login
        </button>
        <button
          className={mode === "club" ? "chip active" : "chip"}
          onClick={() => setMode("club")}
        >
          Club login
        </button>
        <button
          className={mode === "teacher" ? "chip active" : "chip"}
          onClick={() => setMode("teacher")}
        >
          Teacher login
        </button>
        <button
          className={mode === "admin" ? "chip active" : "chip"}
          onClick={() => setMode("admin")}
        >
          Admin login
        </button>
      </div>

      {mode === "magic-link" && <MagicLinkLogin notify={notify} onClose={onClose} />}
      {mode === "usn" && <UsnPasswordLogin notify={notify} onClose={onClose} />}
      {mode === "vendor" && <VendorPasswordLogin notify={notify} onClose={onClose} />}
      {mode === "club" && <ClubPasswordLogin notify={notify} onClose={onClose} />}
      {mode === "teacher" && <FacultyPasswordLogin notify={notify} onClose={onClose} />}
      {mode === "admin" && <AdminPasswordLogin notify={notify} onClose={onClose} />}
    </ModalShell>
  );
}

async function signInAndVerifyRole({ email, password, allow, mismatchMessage }) {
  await signInWithPassword(email, password);
  const access = await getMyAccess();
  const ok = allow(access);
  if (!ok) {
    await signOut();
    throw new Error(mismatchMessage);
  }
}

function AdminPasswordLogin({ onClose, notify }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) { notify("Enter your admin email"); return; }
    if (!password) { notify("Enter your password"); return; }

    try {
      setLoading(true);
      await signInAndVerifyRole({
        email: cleanEmail,
        password,
        allow: (access) => access.is_admin,
        mismatchMessage: "This account isn't registered as a campus admin.",
      });
      notify("Signed in");
      onClose();
    } catch (error) {
      console.error("Admin login:", error);
      notify(error.message || "Unable to sign in");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <p>For college_admin / super_admin accounts only -- verified against the database after sign-in.</p>
      <label>
        Admin email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="admin@nhce.edu.in"
          autoFocus
        />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        />
      </label>
      <button className="primary wide" disabled={loading} onClick={handleSubmit} data-testid="admin-login-button">
        {loading ? "Signing in…" : "Sign in"}
      </button>
    </>
  );
}

function FacultyPasswordLogin({ onClose, notify }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) { notify("Enter your faculty email"); return; }
    if (!password) { notify("Enter your password"); return; }

    try {
      setLoading(true);
      await signInAndVerifyRole({
        email: cleanEmail,
        password,
        allow: (access) => access.roles.includes("faculty"),
        mismatchMessage: "This account isn't registered as a faculty account.",
      });
      notify("Signed in");
      onClose();
    } catch (error) {
      console.error("Teacher login:", error);
      notify(error.message || "Unable to sign in");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <p>For faculty accounts -- verified against the database after sign-in.</p>
      <label>
        Faculty email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="yourname@nhce.edu.in"
          autoFocus
        />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        />
      </label>
      <button className="primary wide" disabled={loading} onClick={handleSubmit} data-testid="teacher-login-button">
        {loading ? "Signing in…" : "Sign in"}
      </button>
    </>
  );
}

function VendorPasswordLogin({ onClose, notify }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) { notify("Enter your vendor email"); return; }
    if (!password) { notify("Enter your password"); return; }

    try {
      setLoading(true);
      await signInWithPassword(cleanEmail, password);
      notify("Signed in");
      onClose();
    } catch (error) {
      console.error("Vendor login:", error);
      notify(error.message || "Unable to sign in");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <p>For canteen and print shop vendor accounts.</p>
      <label>
        Vendor email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="udupi.canteen@nhce.edu.in"
          autoFocus
        />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        />
      </label>
      <button className="primary wide" disabled={loading} onClick={handleSubmit}>
        {loading ? "Signing in…" : "Sign in"}
      </button>
    </>
  );
}

function ClubPasswordLogin({ onClose, notify }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) { notify("Enter your club email"); return; }
    if (!password) { notify("Enter your password"); return; }

    try {
      setLoading(true);
      await signInWithPassword(cleanEmail, password);
      notify("Signed in");
      onClose();
    } catch (error) {
      console.error("Club login:", error);
      notify(error.message || "Unable to sign in");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <p>For club leadership accounts -- opens straight into Manage Club from the Clubs Hub.</p>
      <label>
        Club email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="foss.club@nhce.edu.in"
          autoFocus
        />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        />
      </label>
      <button className="primary wide" disabled={loading} onClick={handleSubmit}>
        {loading ? "Signing in…" : "Sign in"}
      </button>
    </>
  );
}

function MagicLinkLogin({ onClose, notify }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleLogin = async () => {
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail) {
      notify("Enter your college email");
      return;
    }

    if (!cleanEmail.endsWith("@nhce.edu.in") && !cleanEmail.endsWith("@newhorizonindia.edu") && !cleanEmail.endsWith("@gmail.com")) {
      notify("Please use an allowed email domain (@nhce.edu.in, @gmail.com)");
      return;
    }

    try {
      setLoading(true);

      await sendMagicLink(email.trim());

      setSent(true);

      notify("Magic login link sent to your email");

    } catch (error) {
      console.error("Magic link error:", error);

      notify(
        error.message ||
        "Unable to send login link"
      );
    } finally {
      setLoading(false);
    }
  };

  return !sent ? (
    <>
      <p>
        Sign in using your official NHCE college email.
      </p>

      <label>
        College email

        <input
          type="email"
          value={email}
          onChange={(e) =>
            setEmail(e.target.value)
          }
          placeholder="yourname@gmail.com"
          autoFocus
        />
      </label>

      <button
        className="primary wide"
        disabled={loading}
        onClick={handleLogin}
        data-testid="direct-login-button"
      >
        {loading ? "Processing..." : "Send login link"}

        {!loading && <HiArrowRight />}
      </button>
    </>
  ) : (
    <div className="empty-state">
      <HiCheckCircle />

      <h3>Check your email</h3>

      <p>
        We sent a secure login link to:
      </p>

      <b>{email}</b>

      <button
        className="ghost"
        onClick={onClose}
      >
        Done
      </button>
    </div>
  );
}

function UsnPasswordLogin({ onClose, notify }) {
  const [signingUp, setSigningUp] = useState(false);
  const [forgotPassword, setForgotPassword] = useState(false);
  const [name, setName] = useState("");
  const [usn, setUsn] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [showLegal, setShowLegal] = useState(false);

  const handleSubmit = async () => {
    const cleanUsn = usn.trim().toUpperCase();

    if (signingUp && !name.trim()) {
      notify("Enter your full name");
      return;
    }
    // Real NHCE USN structure (matches src/features/auth/usn.ts's
    // USN_PATTERN, and signup-with-usn's own server-side check) -- only
    // enforced when creating a NEW account. Login stays a loose non-empty
    // check so a pre-existing account whose USN predates this stricter
    // format never gets locked out (signInWithUsn() itself mirrors this).
    if (signingUp && !/^\dNH\d{2}[A-Za-z]{2}\d{3}$/i.test(cleanUsn)) {
      notify("Enter a valid NHCE USN, e.g. 1NH22CS201");
      return;
    }
    if (!signingUp && !cleanUsn) {
      notify("Enter your USN");
      return;
    }
    if (!password) {
      notify("Enter your password");
      return;
    }
    if (signingUp && password !== confirmPassword) {
      notify("Passwords don't match");
      return;
    }
    if (signingUp && !agreedToTerms) {
      notify("Please agree to the Privacy Policy and Terms of Service");
      return;
    }

    try {
      setLoading(true);

      if (signingUp) {
        await signUpWithUsn({ name, usn: cleanUsn, password });
        notify("Account created — welcome to CampusOS");
      } else {
        await signInWithUsn({ usn: cleanUsn, password });
        notify("Signed in");
      }

      onClose();
    } catch (error) {
      console.error("USN login:", error);
      notify(error.message || "Unable to sign in");
    } finally {
      setLoading(false);
    }
  };

  if (forgotPassword) {
    return <ForgotPasswordFlow notify={notify} onBack={() => setForgotPassword(false)} />;
  }

  return (
    <>
      <p>
        {signingUp
          ? "Create your account with your name, USN and a password."
          : "Sign in with your USN and password."}
      </p>

      {signingUp && (
        <label>
          Full name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Sanjay Padmaraj"
            autoFocus={signingUp}
          />
        </label>
      )}

      <label>
        USN
        <input
          value={usn}
          onChange={(e) => setUsn(e.target.value.toUpperCase())}
          placeholder="1NH25CS265"
          maxLength={10}
          autoFocus={!signingUp}
        />
      </label>

      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
        />
      </label>

      {signingUp && (
        <label>
          Confirm password
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="••••••••"
          />
        </label>
      )}

      {signingUp && (
        <>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={agreedToTerms} onChange={(e) => setAgreedToTerms(e.target.checked)} />
            <span>
              I agree to the{" "}
              <button type="button" className="link-btn" onClick={() => setShowLegal((v) => !v)}>
                Privacy Policy &amp; Terms of Service
              </button>
            </span>
          </label>
          {showLegal && (
            <div className="legal-inline-preview">
              <LegalContent />
            </div>
          )}
        </>
      )}

      <button
        className="primary wide"
        disabled={loading || (signingUp && !agreedToTerms)}
        onClick={handleSubmit}
        data-testid="usn-login-button"
      >
        {loading ? "Processing..." : signingUp ? "Create account" : "Sign in"}
        {!loading && <HiArrowRight />}
      </button>

      <button
        className="ghost wide"
        style={{ marginTop: 8 }}
        onClick={() => setSigningUp((current) => !current)}
      >
        {signingUp ? "Already have an account? Sign in" : "New here? Create an account"}
      </button>

      {!signingUp && (
        <button type="button" className="link-btn" style={{ marginTop: 8 }} onClick={() => setForgotPassword(true)}>
          Forgot password?
        </button>
      )}
    </>
  );
}

function ForgotPasswordFlow({ notify, onBack }) {
  const [usn, setUsn] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async () => {
    const cleanUsn = usn.trim().toUpperCase();
    if (!/^[A-Za-z0-9]{10}$/.test(cleanUsn)) {
      notify("USN must be exactly 10 letters/numbers");
      return;
    }
    try {
      setLoading(true);
      await requestPasswordReset(cleanUsn);
      setSent(true);
    } catch (error) {
      notify(error.message || "Unable to request a password reset");
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="empty-state">
        <HiCheckCircle />
        <h3>Check your email</h3>
        <p>
          If that account has a verified email on file, we&apos;ve sent a reset
          link to it. It expires in 1 hour.
        </p>
        <button className="ghost" onClick={onBack}>Back to sign in</button>
      </div>
    );
  }

  return (
    <>
      <p>Enter your USN and we&apos;ll email a reset link if the account has a verified contact email on file.</p>
      <label>
        USN
        <input
          value={usn}
          onChange={(e) => setUsn(e.target.value.toUpperCase())}
          placeholder="1NH25CS265"
          maxLength={10}
          autoFocus
        />
      </label>
      <button className="primary wide" disabled={loading} onClick={handleSubmit}>
        {loading ? "Sending…" : "Send reset link"}
      </button>
      <button type="button" className="ghost wide" style={{ marginTop: 8 }} onClick={onBack}>
        Back to sign in
      </button>
    </>
  );
}

export { AdminPasswordLogin, ClubPasswordLogin, FacultyPasswordLogin, ForgotPasswordFlow, LoginModal, MagicLinkLogin, UsnPasswordLogin, VendorPasswordLogin, signInAndVerifyRole };
