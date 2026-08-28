/**
 * ADMIN: AI ASSISTANT (doc "AI" checklist -- security hardening, trust &
 * quality, feedback/analytics). Access kill-switch reuses profiles.role's
 * own admin-gate pattern (admin_set_ai_access); knowledge base and
 * analytics are new RPC-only surfaces added in
 * 20260817001300_ai_hardening.sql.
 */

import { supabase } from "../../lib/supabase";
import { throwIfError } from "./_shared.js";

export async function setAiAccess(userId, blocked, reason) {
  const { data, error } = await supabase.rpc("admin_set_ai_access", {
    p_target_user: userId,
    p_blocked: blocked,
    p_reason: reason || null,
  });
  throwIfError(error);
  return data;
}

export async function listAiKnowledge() {
  const { data, error } = await supabase.rpc("admin_list_ai_knowledge");
  throwIfError(error);
  return data || [];
}

export async function upsertAiKnowledge({ id, question, answer, campusId, active }) {
  const { data, error } = await supabase.rpc("upsert_ai_knowledge", {
    p_id: id || null,
    p_question: question,
    p_answer: answer,
    p_campus_id: campusId || null,
    p_active: active !== false,
  });
  throwIfError(error);
  return data;
}

export async function deleteAiKnowledge(id) {
  const { error } = await supabase.rpc("delete_ai_knowledge", { p_id: id });
  throwIfError(error);
}

export async function getAiUsageSummary(days = 30) {
  const { data, error } = await supabase.rpc("ai_admin_usage_summary", { p_days: days });
  throwIfError(error);
  return data?.[0] || null;
}

export async function listAiReports(limit = 50) {
  const { data, error } = await supabase.rpc("ai_admin_list_reports", { p_limit: limit });
  throwIfError(error);
  return data || [];
}

