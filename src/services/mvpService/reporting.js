/**
 * REPORTING & AUDIT
 *
 * Content reporting + audit-trail helpers shared by every "Report" flow in
 * the app (posts, listings, messages, etc.).
 */

import { supabase } from "../../lib/supabase";
import { isUuid } from "../../utils/mvpHelpers";
import { throwIfError } from "./_shared.js";
import { getCurrentUser } from "./auth.js";

export async function reportContent(contentType, contentId, reason) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Must be logged in to report content");
  if (!isUuid(contentId)) throw new Error("This content can't be reported.");

  const { data, error } = await supabase
    .from("content_reports")
    .insert([
      {
        reporter_id: user.id,
        target_type: contentType,
        target_id: contentId,
        reason: reason,
      },
    ])
    .select()
    .single();

  throwIfError(error);
  return data;
}

export async function getAuditLogs(limit = 50) {
  const { data, error } = await supabase
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  throwIfError(error);
  return data;
}

