/**
 * AUTH
 *
 * Sign-in/sign-up (magic link, USN+password, role-scoped email+password for
 * vendor/club/admin/faculty accounts), session lookup, sign-out, and linking
 * secondary identities (GitHub, LinkedIn).
 */

import { supabase } from "../../lib/supabase";
import { isValidUsn, usnToEmail } from "../../features/auth/usn";
import { throwIfError } from "./_shared.js";

export async function getCurrentUser() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    // supabase-js throws AuthSessionMissingError from getUser() when there's
    // no active session at all -- the normal, expected state for an
    // anonymous visitor -- rather than returning { user: null } the way
    // getSession() does. Treat it as "not signed in", not a real backend
    // failure: without this, every logged-out visit surfaced a scary "Auth
    // session missing! -- some data may be out of date" banner and a console
    // error on first load, App.jsx's initialize() catch block having no way
    // to tell this apart from an actual connectivity problem.
    if (error.name === "AuthSessionMissingError") return null;
    throw error;
  }

  return user || null;
}

export async function getSession() {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error) throw error;

  return session || null;
}

export async function sendMagicLink(email) {
  const clean = email?.trim().toLowerCase();

  if (!clean) {
    throw new Error("Enter your college email.");
  }

  if (
    !clean.endsWith("@nhce.edu.in") &&
    !clean.endsWith("@newhorizonindia.edu") &&
    !clean.endsWith("@gmail.com")
  ) {
    throw new Error(
      "Please use an allowed email domain (@nhce.edu.in, @gmail.com)"
    );
  }

  const redirectUrl =
    `${window.location.origin}/`;

  const { error } =
    await supabase.auth.signInWithOtp({
      email: clean,
      options: {
        emailRedirectTo: redirectUrl,
      },
    });

  throwIfError(error);

  return true;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  throwIfError(error);
}

/*
 * signInWithPassword — plain email+password auth, used by the vendor login
 * tab (vendor accounts have no USN, so the USN&password flow doesn't apply
 * to them).
 */
export async function signInWithPassword(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw error;
  return data;
}

/*
 * connectGithub — links a real GitHub account to the *currently signed-in*
 * user via OAuth (as opposed to signInWithOAuth, which would sign in/up as
 * a new session). Redirects the browser to GitHub's consent screen and
 * back; deriveGithubUrlFromIdentities() then turns the returned identity
 * into a real github.com/<username> link once the user's back. Requires
 * both the 'github' provider to be enabled (real GitHub OAuth app
 * credentials in Supabase) AND "Allow manual linking" turned on in the
 * project's Auth settings -- absent either, this surfaces a clear Supabase
 * error rather than silently doing nothing.
 */
export async function connectGithub() {
  const { error } = await supabase.auth.linkIdentity({
    provider: "github",
    options: { redirectTo: `${window.location.origin}/` },
  });
  if (error) throw error;
}

// GitHub OAuth identities carry the GitHub username as user_name (or,
// depending on API version, preferred_username) in identity_data -- that's
// enough to build a real profile URL. Pure function so it's testable
// without a live Supabase session.
export function deriveGithubUrlFromIdentities(identities) {
  const github = (identities || []).find((identity) => identity.provider === "github");
  const username = github?.identity_data?.user_name || github?.identity_data?.preferred_username;
  return username ? `https://github.com/${username}` : null;
}

/*
 * connectLinkedin — same linkIdentity() pattern as connectGithub(), but
 * LinkedIn's "Sign In using OpenID Connect" product doesn't return a
 * profile URL (only name/email/picture) -- getting that back needs
 * LinkedIn's older, partner-approval-gated Profile API. So this only
 * proves account ownership; call markLinkedinVerified() once linked to
 * record that server-side. The profile URL itself stays a manual field.
 */
export async function connectLinkedin() {
  const { error } = await supabase.auth.linkIdentity({
    provider: "linkedin_oidc",
    options: { redirectTo: `${window.location.origin}/` },
  });
  if (error) throw error;
}

// Server-checks auth.identities for a real linked linkedin_oidc identity
// before recording profiles.linkedin_verified_at -- deliberately not a
// plain client-side profiles.update(), so the verified badge can't be
// self-reported without actually completing LinkedIn OAuth.
export async function markLinkedinVerified() {
  const { data, error } = await supabase.rpc("mark_linkedin_verified");
  throwIfError(error);
  return data;
}

export function hasLinkedinIdentity(identities) {
  return (identities || []).some((identity) => identity.provider === "linkedin_oidc");
}

/*
 * Name + USN + Password login (alongside magic link). Supabase Auth is
 * still email-based internally -- signUpWithUsn() creates the account
 * server-side via the signup-with-usn Edge Function (service_role,
 * email_confirm: true, doc-requested flow), which mints a synthetic email
 * deterministically from the USN. signInWithUsn() derives that same email
 * client-side and signs in with the normal password grant -- no Edge
 * Function needed for login, only for the one-time account creation.
 */
export async function signUpWithUsn({ name, usn, password }) {
  if (!name?.trim()) throw new Error("Enter your full name.");
  if (!isValidUsn(usn || "")) throw new Error("Enter a valid NHCE USN, e.g. 1NH22CS201.");
  if (!password || password.length < 8) throw new Error("Password must be at least 8 characters.");

  const { data, error } = await supabase.functions.invoke("signup-with-usn", {
    body: { name: name.trim(), usn: usn.trim().toUpperCase(), password },
  });
  if (error) {
    // supabase-js only exposes the HTTP error, not the JSON body, on
    // FunctionsHttpError -- fall back to a generic message when that's all
    // we get, otherwise surface the {code, message} the function returned.
    const context = /** @type {any} */ (error).context;
    let message = error.message;
    try {
      const body = await context?.json?.();
      if (body?.message) message = body.message;
    } catch {
      /* ignore -- use the generic message */
    }
    throw new Error(message || "Unable to create account");
  }
  if (data?.code) {
    throw new Error(data.message || "Unable to create account");
  }

  return signInWithUsn({ usn: usn.trim().toUpperCase(), password });
}

export async function signInWithUsn({ usn, password }) {
  // Deliberately NOT isValidUsn() here -- that's the strict NHCE-format
  // check signUpWithUsn() gates new accounts on. This is a LOGIN against an
  // already-existing account, which may predate that stricter format; all
  // this needs is "non-empty enough to derive an email from."
  if (!usn?.trim()) throw new Error("Enter your USN.");
  const { data, error } = await supabase.auth.signInWithPassword({
    email: usnToEmail(usn),
    password,
  });
  if (error) {
    throw new Error(
      error.message?.toLowerCase().includes("invalid")
        ? "Incorrect USN or password."
        : (error.message || "Unable to sign in")
    );
  }
  return data;
}

export function subscribeToAuthChanges(callback) {
  const {
    data: { subscription },
  } =
    supabase.auth.onAuthStateChange(
      (event, session) => {
        callback({
          event,
          session,
          user: session?.user || null,
        });
      }
    );

  return () => {
    subscription?.unsubscribe();
  };
}




