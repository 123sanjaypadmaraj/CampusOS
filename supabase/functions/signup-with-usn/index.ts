// Edge Function: signup-with-usn
//
// Creates a new student account from Name + USN + Password. Supabase Auth
// is still email-based internally, so this mints a synthetic, never-shown
// email deterministically from the USN (see usnToEmail below) and creates
// the account server-side with email_confirm: true -- no real inbox is
// needed, and no project-wide "confirm email" setting has to change.
//
// The frontend calls this once to create the account, then signs in
// normally with supabase.auth.signInWithPassword() using the same
// deterministic email (src/features/auth/usn.ts derives it identically).
//
// Auto-provided by the Supabase Edge runtime: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

// Must stay in exact sync with src/features/auth/usn.ts's USN_PATTERN.
const USN_RE = /^\dNH\d{2}[A-Za-z]{2}\d{3}$/i;

function usnToEmail(usn: string): string {
  return `${usn.trim().toLowerCase()}@usn.campusos.internal`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ code: "METHOD_NOT_ALLOWED", message: "POST only" }, 405);
  }

  try {
    const { name, usn, password } = await req.json();

    if (!name?.trim()) {
      return jsonResponse({ code: "NAME_REQUIRED", message: "Enter your full name." }, 400);
    }
    if (!usn || !USN_RE.test(usn.trim())) {
      return jsonResponse({ code: "USN_INVALID", message: "Enter a valid NHCE USN, e.g. 1NH22CS201." }, 400);
    }
    if (!password || password.length < 8) {
      return jsonResponse({ code: "PASSWORD_TOO_SHORT", message: "Password must be at least 8 characters." }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const usnUpper = usn.trim().toUpperCase();
    const email = usnToEmail(usnUpper);

    // Friendly duplicate check up front (the DB unique index on
    // upper(usn) is still the authoritative guard against a race).
    const { data: existing } = await admin
      .from("profiles")
      .select("id")
      .ilike("usn", usnUpper)
      .maybeSingle();
    if (existing) {
      return jsonResponse({ code: "USN_TAKEN", message: "An account with this USN already exists." }, 409);
    }

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: name.trim(), usn: usnUpper },
    });

    if (error) {
      const isDuplicate = error.message?.toLowerCase().includes("already");
      return jsonResponse(
        { code: isDuplicate ? "USN_TAKEN" : "SIGNUP_FAILED", message: isDuplicate ? "An account with this USN already exists." : error.message },
        isDuplicate ? 409 : 400
      );
    }

    return jsonResponse({ ok: true, userId: data.user?.id });
  } catch (err) {
    console.error("signup-with-usn error:", err);
    return jsonResponse({ code: "INTERNAL_ERROR", message: "Unable to create account." }, 500);
  }
});
