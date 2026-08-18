// Edge Function: print-file-cleanup
//
// "Automatic file expiry" + "Delete collected documents" (Phase 6 printing
// security checklist). A Postgres `delete from storage.objects` only removes
// the metadata row, not the underlying object -- actual deletion has to go
// through the Storage API, which is why this lives in an Edge Function
// rather than a plain SQL trigger/cron job.
//
// Deletes the file for any print_jobs row that's either:
//   - COLLECTED more than an hour ago (the student already has it), or
//   - past its expires_at without ever being collected (default holds:
//     3 days unpaid, 14 days once paid -- see 20260817001200_printing_v2.sql)
// Safe to call repeatedly/concurrently -- list_print_files_due_for_cleanup()
// only ever returns rows with file_deleted_at still null, and each row is
// marked deleted right after its storage object is removed.
//
// Auth: service-role only. This is meant to be invoked by a scheduled job
// (pg_cron + pg_net, or any external scheduler) carrying the project's
// service role key, never by a student/vendor browser session. To wire real
// scheduling via pg_cron, run once (values never belong in a migration file):
//   select vault.create_secret('<project-url>', 'print_cleanup_project_url');
//   select vault.create_secret('<service-role-key>', 'print_cleanup_service_key');
//   select cron.schedule('print-file-cleanup-daily', '0 3 * * *', $$
//     select net.http_post(
//       url := (select decrypted_secret from vault.decrypted_secrets where name = 'print_cleanup_project_url') || '/functions/v1/print-file-cleanup',
//       headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'print_cleanup_service_key'))
//     );
//   $$);
// Until that's set up, `scripts/print-file-cleanup.mjs` invokes this the
// same way and can be run by hand or from any external scheduler.
//
// Auto-provided by the Supabase Edge runtime:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader !== `Bearer ${serviceKey}`) {
    return jsonResponse({ code: "UNAUTHENTICATED", message: "Service role only" }, 401);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceClient = createClient(supabaseUrl, serviceKey);

    const { data: due, error: listError } = await serviceClient.rpc("list_print_files_due_for_cleanup", {
      p_limit: 200,
    });
    if (listError) {
      console.error("list_print_files_due_for_cleanup failed:", listError);
      return jsonResponse({ code: "LIST_FAILED", message: listError.message }, 500);
    }

    let deleted = 0;
    let failed = 0;
    for (const row of due || []) {
      const { error: removeError } = await serviceClient.storage.from("print-files").remove([row.file_url]);
      if (removeError) {
        // Object already gone (e.g. a previous run partially succeeded) is
        // fine to treat as done; anything else, leave file_deleted_at unset
        // so the next run retries it instead of silently losing track.
        console.error(`storage remove failed for print job ${row.id}:`, removeError);
        failed++;
        continue;
      }
      const { error: markError } = await serviceClient.rpc("mark_print_file_deleted", { p_job_id: row.id });
      if (markError) {
        console.error(`mark_print_file_deleted failed for ${row.id}:`, markError);
        failed++;
        continue;
      }
      deleted++;
    }

    return jsonResponse({ ok: true, deleted, failed, checked: (due || []).length });
  } catch (err) {
    console.error("print-file-cleanup error:", err);
    return jsonResponse({ code: "INTERNAL_ERROR", message: "Cleanup run failed." }, 500);
  }
});
