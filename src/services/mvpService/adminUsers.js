/**
 * ADMIN: USER MANAGEMENT (doc §54-58)
 * Admins can read every profiles row directly (RLS bypass via
 * current_user_is_admin(), see 0011) -- only the two mutating actions need
 * RPCs, since profiles_update_self only allows updating your own row.
 *
 * User list/search, role changes (direct + propose/approve flow), account
 * status (suspend/ban), and the self-service account-deletion and
 * suspension-appeal request lifecycle.
 */

import { supabase } from "../../lib/supabase";
import { throwIfError } from "./_shared.js";

export async function listAllUsers(campusId, { search = "", role = null, limit = 50, cursor = null } = {}) {
  let query = supabase
    .from("profiles")
    .select("id, name, email, usn, course, year, role, status, suspended_reason, ai_blocked, ai_blocked_reason, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (campusId) query = query.eq("campus_id", campusId);
  if (role) query = query.eq("role", role);
  if (search?.trim()) {
    const q = search.trim();
    query = query.or(`name.ilike.%${q}%,email.ilike.%${q}%,usn.ilike.%${q}%`);
  }
  if (cursor) query = query.lt("created_at", cursor);
  const { data, error } = await query;
  throwIfError(error);
  return data || [];
}

export async function setUserRole(userId, newRole, reason) {
  const { error } = await supabase.rpc("admin_set_user_role", {
    p_target_user: userId,
    p_new_role: newRole,
    p_reason: reason || null,
  });
  throwIfError(error);
}

// Role-assignment approval (doc "Admin" checklist item) -- the maker-checker
// path a college_admin now goes through instead of admin_set_user_role()
// directly (that RPC is super_admin-only as of the role-escalation fix).
// listRoleChangeRequests()/decideRoleChange() are also how a super_admin
// approves a college_admin's proposal.
export async function proposeRoleChange(userId, newRole, reason) {
  const { data, error } = await supabase.rpc("propose_role_change", {
    p_target_user: userId,
    p_new_role: newRole,
    p_reason: reason || null,
  });
  throwIfError(error);
  return data;
}

export async function listRoleChangeRequests(status = "pending") {
  let query = supabase
    .from("role_change_requests")
    .select("*, target:profiles!role_change_requests_target_user_fkey(name, email, role), proposer:profiles!role_change_requests_requested_by_fkey(name)")
    .order("requested_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  throwIfError(error);
  return data || [];
}

export async function decideRoleChange(requestId, approve, reason) {
  const { data, error } = await supabase.rpc("decide_role_change", {
    p_request_id: requestId,
    p_approve: approve,
    p_reason: reason || null,
  });
  throwIfError(error);
  return data;
}

// Account deletion request (doc "Student" checklist item) -- self-service
// request, admin-executed soft-delete. request_account_deletion()/
// cancel_account_deletion_request() are self-scoped by auth.uid() server-side
// (no userId param needed); getMyAccountDeletionRequest() still takes one to
// match getMyVerification()'s existing shape used the same way in Profile.
export async function requestAccountDeletion(reason) {
  const { data, error } = await supabase.rpc("request_account_deletion", { p_reason: reason || null });
  throwIfError(error);
  return data;
}

export async function cancelAccountDeletionRequest(requestId) {
  const { error } = await supabase.rpc("cancel_account_deletion_request", { p_request_id: requestId });
  throwIfError(error);
}

// Self-service data export (20260824000100_export_my_data.sql, readiness-audit
// phase 06). Computed on read, nothing stored -- returns everything scoped
// to auth.uid() as one jsonb object; the caller downloads it directly.
export async function exportMyData() {
  const { data, error } = await supabase.rpc("export_my_data");
  throwIfError(error);
  return data;
}

// Suspension appeal (supabase/migrations/20260818000600_community_hardening.sql)
// -- the one path a suspended account has left, since reject_if_suspended()
// blocks nearly everything else. Self-scoped server-side (no userId param).
export async function submitSuspensionAppeal(reason) {
  const { data, error } = await supabase.rpc("submit_suspension_appeal", { p_reason: reason });
  throwIfError(error);
  return data;
}

export async function getMySuspensionAppeal() {
  const { data, error } = await supabase.rpc("get_my_suspension_appeal");
  throwIfError(error);
  return data || null;
}

export async function getMyAccountDeletionRequest(userId) {
  if (!userId) return null;
  const { data, error } = await supabase
    .from("account_deletion_requests")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "pending")
    .maybeSingle();
  throwIfError(error);
  return data;
}

export async function listAccountDeletionRequests(status = "pending") {
  let query = supabase
    .from("account_deletion_requests")
    .select("*, profiles!account_deletion_requests_user_id_fkey(name, email, usn, role)")
    .order("requested_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  throwIfError(error);
  return data || [];
}

export async function adminProcessAccountDeletion(requestId, action, note) {
  const { data, error } = await supabase.rpc("admin_process_account_deletion", {
    p_request_id: requestId,
    p_action: action,
    p_note: note || null,
  });
  throwIfError(error);
  return data;
}

export async function setUserStatus(userId, status, reason) {
  const { data, error } = await supabase.rpc("admin_set_user_status", {
    p_target_user: userId,
    p_status: status,
    p_reason: reason || null,
  });
  throwIfError(error);
  return data;
}

