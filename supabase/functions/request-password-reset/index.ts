// Edge Function: request-password-reset
//
// Password recovery for USN+password accounts. Supabase's own native
// "reset password by email" can't be used for them -- their
// auth.users.email is a synthetic, never-shown address minted by
// signup-with-usn (usnToEmail()), not a real inbox. This looks the account
// up by USN, resolves a real destination (a verified profiles.contact_email,
// or auth.users.email itself when it's not the synthetic USN domain -- e.g.
// a vendor account that also happens to use USN-style login), mints a
// short-lived reset token, and emails it via send-email.
//
// Public, no session required (--no-verify-jwt) -- this is the "I'm locked
// out" entry point. Always returns the same generic response regardless of
// whether the account exists or has a usable email, to avoid account
// enumeration (a P0001-style "no such account" response would let an
// attacker probe USNs).
//
// Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Required secrets: EMAIL_DISPATCH_SECRET (same value as send-email's)

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

// Deliberately loose (10 alphanumeric characters), NOT the strict NHCE
// USN_PATTERN signup-with-usn now validates against -- this is a lookup
// against an ALREADY-EXISTING account, not a new signup, so tightening it
// here risks locking a real pre-existing account (created before the
// stricter format was enforced) out of password reset entirely. Only
// signup-with-usn gates on the strict pattern.
const USN_RE = /^[A-Za-z0-9]{10}$/;
const SYNTHETIC_EMAIL_SUFFIX = "@usn.campusos.internal";

function isRealEmail(email: string | null | undefined): boolean {
  return !!email && !email.toLowerCase().endsWith(SYNTHETIC_EMAIL_SUFFIX);
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const GENERIC_RESPONSE = { ok: true, message: "If an account with this USN can receive a reset link, we've sent one." };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ code: "METHOD_NOT_ALLOWED", message: "POST only" }, 405);
  }

  try {
    const { usn } = await req.json();
    if (!usn || !USN_RE.test(String(usn).trim())) {
      return jsonResponse({ code: "USN_INVALID", message: "USN must be exactly 10 letters/numbers." }, 400);
    }
    const usnUpper = String(usn).trim().toUpperCase();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: profile } = await admin
      .from("profiles")
      .select("id, contact_email, contact_email_verified_at")
      .ilike("usn", usnUpper)
      .maybeSingle();

    // Always the same shape from here on, win or lose -- an attacker
    // probing USNs can't distinguish "no such account" from "account has no
    // usable email on file" from "email sent".
    if (!profile) {
      return jsonResponse(GENERIC_RESPONSE, 200);
    }

    // A per-account rate limit still applies even though the response never
    // reveals whether it fired -- otherwise an attacker who already knows a
    // real USN could spam its owner with reset emails.
    const { data: allowed } = await admin.rpc("check_rate_limit", {
      p_user: profile.id, p_bucket: "password_reset_request", p_max_hits: 3, p_window_seconds: 3600,
    });
    if (allowed === false) {
      return jsonResponse(GENERIC_RESPONSE, 200);
    }

    let recipient: string | null = null;
    if (profile.contact_email && profile.contact_email_verified_at) {
      recipient = profile.contact_email;
    } else {
      const { data: authUser } = await admin.auth.admin.getUserById(profile.id);
      if (isRealEmail(authUser?.user?.email)) {
        recipient = authUser!.user!.email as string;
      }
    }
    if (!recipient) {
      return jsonResponse(GENERIC_RESPONSE, 200);
    }

    const rawToken = randomToken();
    const tokenHash = await sha256Hex(rawToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    await admin.from("password_reset_tokens").insert({ user_id: profile.id, token_hash: tokenHash, expires_at: expiresAt });

    const emailSecret = Deno.env.get("EMAIL_DISPATCH_SECRET");
    if (emailSecret) {
      const resetLink = `https://campusos-amber.vercel.app/reset-password?token=${rawToken}`;
      await fetch(`${supabaseUrl}/functions/v1/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Email-Secret": emailSecret },
        body: JSON.stringify({
          to: recipient,
          subject: "Reset your CampusOS password",
          html: `<p>Someone (hopefully you) requested a password reset for USN ${usnUpper}.</p><p><a href="${resetLink}">Reset your password</a></p><p>This link expires in 1 hour. If you didn't request this, ignore it -- your password won't change.</p>`,
        }),
      }).catch(() => {}); // best-effort -- token row still exists either way
    }

    return jsonResponse(GENERIC_RESPONSE, 200);
  } catch (err) {
    console.error("request-password-reset error:", err);
    // Even an unexpected internal error stays generic -- no leak either way.
    return jsonResponse(GENERIC_RESPONSE, 200);
  }
});
