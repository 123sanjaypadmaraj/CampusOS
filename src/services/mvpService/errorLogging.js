/**
 * ERROR LOGGING (monitoring -- see supabase/migrations/20260814005200_error_logs.sql)
 * Fire-and-forget by design: a broken error-reporting call must never itself
 * throw and cascade into a second failure on top of whatever it was trying
 * to report. Callable while signed out too (log_client_error() is granted
 * to `anon`) -- most of what matters here is exactly the crash that happens
 * before/during sign-in.
 */

import { supabase } from "../../lib/supabase";
import { throwIfError } from "./_shared.js";

// De-dupes identical errors within one tab session so a render loop or a
// polling failure doesn't flood error_logs with hundreds of copies of the
// same message before rl_error_logs (60/hour) even kicks in.
const _loggedErrorFingerprints = new Set();

export async function logClientError(message, { stack, severity = "error", context = {}, category = null } = {}) {
  try {
    if (!message) return;
    const fingerprint = `${severity}:${category || ""}:${String(message).slice(0, 200)}`;
    if (_loggedErrorFingerprints.has(fingerprint)) return;
    _loggedErrorFingerprints.add(fingerprint);

    await supabase.rpc("log_client_error", {
      p_message: String(message).slice(0, 2000),
      p_stack: stack ? String(stack).slice(0, 8000) : null,
      p_url: typeof window !== "undefined" ? window.location.href : null,
      p_user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      p_severity: severity,
      p_context: context || {},
      p_source: "client",
      p_category: category,
    });
  } catch {
    // Never let error logging itself throw -- there is nowhere further to
    // report that failure to.
  }
}

// Shared by every supabase.storage upload call site in this app (here and
// in the other services that upload media): logs a failed upload to
// error_logs (category 'storage') before the caller's own throwIfError()
// raises it. No-ops silently when there's no error.
export function logStorageErrorIfAny(bucket, error) {
  if (error) {
    logClientError(`Storage upload failed: ${bucket}`, {
      severity: "error",
      category: "storage",
      context: { bucket, error: error.message },
    });
  }
}

// Admin CMS "Errors" tab. RLS (error_logs_read_admin/_update_admin) already
// restricts this to system.errors.read/admin -- a non-admin caller just
// gets an empty list / a blocked update, not a 403 thrown here.
export async function listErrorLogs({ severity = null, source = null, resolved = null, limit = 100 } = {}) {
  let query = supabase
    .from("error_logs")
    .select("*, reporter:profiles!error_logs_user_id_fkey(name)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (severity) query = query.eq("severity", severity);
  if (source) query = query.eq("source", source);
  if (resolved !== null) query = query.eq("resolved", resolved);
  const { data, error } = await query;
  throwIfError(error);
  return data || [];
}

export async function setErrorLogResolved(id, resolved) {
  // resolved_by/resolved_at are set server-side by a trigger regardless of
  // what's sent here -- see set_error_log_resolution_meta() in the migration.
  const { data, error } = await supabase.from("error_logs").update({ resolved }).eq("id", id).select().single();
  throwIfError(error);
  return data;
}

