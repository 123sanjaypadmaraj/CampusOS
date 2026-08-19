// Edge Function: system-health
//
// AdminCMS "System health" tab, part 3/5 of the admin-operating-system pass.
// Two things a DB-only view can't tell an admin: whether the edge runtime
// itself is actually reachable (a hung/undeployed function looks identical
// to "everything's fine" from the RPC layer alone), and whether the secrets
// every other function depends on are actually SET on this deployment --
// without ever returning a secret's value, only whether Deno.env.get()
// found something. Admin-only, same auth pattern as campus-assistant
// (userClient built from the caller's own JWT, role checked before doing
// anything).
//
// Required secrets: none of its own. Auto-provided: SUPABASE_URL,
// SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

// Secrets other functions in this repo depend on -- checked for presence
// only, never logged/returned. Grouped by the feature they back so a gap
// reads as "AI assistant not configured" rather than a bare env var name.
const SECRET_GROUPS: Record<string, string[]> = {
  ai_assistant: ["GROQ_API_KEY"],
  email: ["RESEND_API_KEY"],
  sms: ["FAST2SMS_API_KEY", "SMS_DISPATCH_SECRET"],
  push: ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"],
  payments: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"],
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse({ code: "METHOD_NOT_ALLOWED", message: "GET or POST only" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ code: "UNAUTHENTICATED", message: "Sign in required" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user) {
    return jsonResponse({ code: "UNAUTHENTICATED", message: "Sign in required" }, 401);
  }

  const { data: profile } = await userClient.from("profiles").select("role").eq("id", userData.user.id).maybeSingle();
  if (profile?.role !== "college_admin" && profile?.role !== "super_admin") {
    return jsonResponse({ code: "FORBIDDEN", message: "Admin access required" }, 403);
  }

  const secretGroups: Record<string, boolean> = {};
  for (const [group, keys] of Object.entries(SECRET_GROUPS)) {
    secretGroups[group] = keys.every((k) => !!Deno.env.get(k));
  }

  // DB round trip via the service-role client, timed separately from the
  // browser's own RPC latency (admin_system_health, called alongside this)
  // -- this one reflects the edge runtime's own reachability to Postgres,
  // not the browser's.
  let dbOk = false;
  let dbLatencyMs: number | null = null;
  try {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const serviceClient = createClient(supabaseUrl, serviceKey);
    const start = Date.now();
    const { error } = await serviceClient.from("campuses").select("id").limit(1);
    dbLatencyMs = Date.now() - start;
    dbOk = !error;
  } catch {
    dbOk = false;
  }

  return jsonResponse({
    ok: true,
    checked_at: new Date().toISOString(),
    db_ok: dbOk,
    db_latency_ms: dbLatencyMs,
    secret_groups: secretGroups,
    deno_deployment_id: Deno.env.get("DENO_DEPLOYMENT_ID") ?? null,
  });
});
