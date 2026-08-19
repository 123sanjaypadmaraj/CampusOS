// Shared helper: writes to error_logs (source='server') via the
// log_server_error() RPC (20260819001100_observability.sql), service_role
// only. Fire-and-forget from the caller's point of view -- this function
// swallows its own failures so a logging problem never masks or replaces
// the real error a caller was already handling.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export async function logServerError(
  serviceClient: SupabaseClient,
  message: string,
  opts: { stack?: string; category?: string; severity?: string; context?: Record<string, unknown> } = {},
): Promise<void> {
  try {
    await serviceClient.rpc("log_server_error", {
      p_message: message.slice(0, 2000),
      p_stack: opts.stack?.slice(0, 8000) ?? null,
      p_category: opts.category ?? null,
      p_severity: opts.severity ?? "error",
      p_context: opts.context ?? {},
    });
  } catch (err) {
    // Never let logging itself throw -- the caller is already mid-handling
    // a real failure and this must not replace or mask it.
    console.error("logServerError itself failed:", err);
  }
}
