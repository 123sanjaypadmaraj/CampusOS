import { supabase } from "../lib/supabase";

/*
 * Contact email verification + password recovery for USN+password accounts
 * (see supabase/migrations/20260817002200_contact_recovery.sql). Magic-link/
 * Google/vendor accounts already have a real auth.users.email and never need
 * any of this -- it exists for the accounts whose login email is synthetic
 * (usnToEmail() in mvpService.js) and therefore unreachable.
 */

// Sets profiles.contact_email and emails a verification link. Self-scoped
// (the RPC reads auth.uid() itself), rate-limited 3/hour server-side.
export async function requestContactEmailVerification(email) {
  const { error } = await supabase.rpc("request_contact_email_verification", { p_email: email });
  if (error) throw new Error(error.message || "Could not send verification email");
}

// Public RPC -- called from /verify-email?token=... with no session assumed.
export async function confirmContactEmailVerification(token) {
  const { error } = await supabase.rpc("confirm_contact_email_verification", { p_token: token });
  if (error) throw new Error(error.message || "This verification link is invalid or has expired.");
}

// Public Edge Function -- always resolves even for a USN that doesn't exist
// or has no usable email on file (see the function's own generic-response
// note), so the caller never learns which case it was.
export async function requestPasswordReset(usn) {
  const { data, error } = await supabase.functions.invoke("request-password-reset", {
    body: { usn },
  });
  if (error) {
    const context = /** @type {any} */ (error).context;
    let message = error.message;
    try {
      const body = await context?.json?.();
      if (body?.message) message = body.message;
    } catch {
      /* ignore -- use the generic message */
    }
    throw new Error(message || "Unable to request a password reset");
  }
  return data;
}

export async function confirmPasswordReset(token, newPassword) {
  const { data, error } = await supabase.functions.invoke("confirm-password-reset", {
    body: { token, newPassword },
  });
  if (error) {
    const context = /** @type {any} */ (error).context;
    let message = error.message;
    try {
      const body = await context?.json?.();
      if (body?.message) message = body.message;
    } catch {
      /* ignore -- use the generic message */
    }
    throw new Error(message || "Unable to reset password");
  }
  return data;
}
