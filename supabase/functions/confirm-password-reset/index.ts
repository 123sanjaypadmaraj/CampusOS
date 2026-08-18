// Edge Function: confirm-password-reset
//
// The other half of request-password-reset. Public, no session (a signed-
// out browser lands here from the emailed link) -- validates the token
// directly rather than trusting auth.uid(), then sets the new password via
// the auth admin API (the one thing plpgsql genuinely cannot do -- there is
// no admin.updateUserById() equivalent callable from Postgres, which is why
// this whole flow needs an Edge Function rather than a plain RPC).
//
// Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ code: "METHOD_NOT_ALLOWED", message: "POST only" }, 405);
  }

  try {
    const { token, newPassword } = await req.json();
    if (!token || typeof token !== "string") {
      return jsonResponse({ code: "TOKEN_REQUIRED", message: "Reset token is required." }, 400);
    }
    if (!newPassword || newPassword.length < 8) {
      return jsonResponse({ code: "PASSWORD_TOO_SHORT", message: "Password must be at least 8 characters." }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const tokenHash = await sha256Hex(token);
    const { data: row } = await admin
      .from("password_reset_tokens")
      .select("id, user_id, expires_at, used_at")
      .eq("token_hash", tokenHash)
      .is("used_at", null)
      .maybeSingle();

    if (!row || new Date(row.expires_at).getTime() < Date.now()) {
      return jsonResponse({ code: "INVALID_TOKEN", message: "This reset link is invalid or has expired." }, 400);
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(row.user_id, { password: newPassword });
    if (updateError) {
      return jsonResponse({ code: "UPDATE_FAILED", message: updateError.message }, 400);
    }

    // Marked used only after a successful password update -- if the update
    // fails, the token stays valid so the student isn't locked out of their
    // own recovery link by a transient auth-service error.
    await admin.from("password_reset_tokens").update({ used_at: new Date().toISOString() }).eq("id", row.id);

    return jsonResponse({ ok: true }, 200);
  } catch (err) {
    console.error("confirm-password-reset error:", err);
    return jsonResponse({ code: "INTERNAL_ERROR", message: "Unable to reset password." }, 500);
  }
});
