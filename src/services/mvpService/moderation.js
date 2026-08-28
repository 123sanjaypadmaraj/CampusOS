/**
 * ADMIN: MODERATION CONSOLE (doc §40-41, §58)
 * moderate_content() (community.sql) already exists and handles hide/
 * remove/approve for posts/comments; content_reports RLS already lets a
 * moderator read/update any report directly. Only reading "what/who a
 * report is actually about" needed an RPC (target_id is polymorphic).
 *
 * Open reports, content moderation actions, and conversation audit reads,
 * plus the banned-word / prohibited-listing-term lists this moderation
 * relies on, and the suspension-appeal review queue.
 */

import { supabase } from "../../lib/supabase";
import { throwIfError } from "./_shared.js";

export async function listOpenReports(limit = 50) {
  const { data, error } = await supabase
    .from("content_reports")
    .select("*, profiles!content_reports_reporter_id_fkey(name)")
    .eq("status", "open")
    .order("created_at", { ascending: true })
    .limit(limit);
  throwIfError(error);
  return data || [];
}

export async function getReportContext(targetType, targetId, reporterId = null) {
  const { data, error } = await supabase.rpc("get_report_context", {
    p_target_type: targetType,
    p_target_id: targetId,
    p_reporter_id: reporterId,
  });
  throwIfError(error);
  return data?.[0] || null;
}

export async function moderateContent(targetType, targetId, action, reason) {
  const { error } = await supabase.rpc("moderate_content", {
    p_target_type: targetType,
    p_target_id: targetId,
    p_action: action,
    p_reason: reason || null,
  });
  throwIfError(error);
}

// Conversation reports only ever showed the last message's snippet -- a
// moderator reviewing one has no way to see (or remove) the actual
// offending message otherwise, since they aren't a participant and plain
// RLS blocks them. See 20260817001000_message_delete_moderation.sql;
// deleteMessage() (messagingService.js) is the same RPC-backed removal
// used here, sender-side and moderator-side both go through delete_message().
export async function adminGetConversationMessages(conversationId, limit = 50) {
  const { data, error } = await supabase.rpc("admin_get_conversation_messages", {
    p_conversation_id: conversationId,
    p_limit: limit,
  });
  throwIfError(error);
  return data || [];
}

export async function resolveReport(reportId, reviewerId, status = "resolved") {
  const { error } = await supabase
    .from("content_reports")
    .update({ status, reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
    .eq("id", reportId);
  throwIfError(error);
}

/* =========================================================================
   PROFANITY FILTER WORD LIST + SUSPENSION APPEALS
   (supabase/migrations/20260818000600_community_hardening.sql)
========================================================================= */

export async function listBannedWords() {
  const { data, error } = await supabase.from("banned_words").select("word, added_by, created_at").order("word");
  throwIfError(error);
  return data || [];
}

export async function addBannedWord(word) {
  const { error } = await supabase.rpc("admin_add_banned_word", { p_word: word });
  throwIfError(error);
}

export async function removeBannedWord(word) {
  const { error } = await supabase.rpc("admin_remove_banned_word", { p_word: word });
  throwIfError(error);
}

// Marketplace prohibited-item term list (supabase/migrations/
// 20260818000700_marketplace_hardening.sql) -- separate list from
// banned_words above since "profanity" and "prohibited item" are different
// moderation reasons, same admin-managed-list shape either way.
export async function listProhibitedListingTerms() {
  const { data, error } = await supabase.from("prohibited_listing_terms").select("term, added_by, created_at").order("term");
  throwIfError(error);
  return data || [];
}

export async function addProhibitedListingTerm(term) {
  const { error } = await supabase.rpc("admin_add_prohibited_term", { p_term: term });
  throwIfError(error);
}

export async function removeProhibitedListingTerm(term) {
  const { error } = await supabase.rpc("admin_remove_prohibited_term", { p_term: term });
  throwIfError(error);
}

export async function listSuspensionAppeals(status = "pending") {
  const { data, error } = await supabase.rpc("admin_list_suspension_appeals", { p_status: status });
  throwIfError(error);
  return data || [];
}

export async function resolveSuspensionAppeal(appealId, decision, adminNote) {
  const { data, error } = await supabase.rpc("resolve_suspension_appeal", {
    p_appeal_id: appealId,
    p_decision: decision,
    p_admin_note: adminNote || null,
  });
  throwIfError(error);
  return data;
}

