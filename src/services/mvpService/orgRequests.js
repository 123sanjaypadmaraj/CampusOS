/**
 * CLUB/VENDOR REQUESTS (doc §104)
 *
 * A member proposes a new club or vendor org account; an admin
 * approves/rejects it.
 */

import { supabase } from "../../lib/supabase";
import { throwIfError } from "./_shared.js";

export async function submitOrgRequest({ userId, campusId, requestType, name, description, category, contactPhone }) {
  if (!userId) throw new Error("Please sign in first.");
  if (!name?.trim() || !description?.trim()) throw new Error("Add a name and description.");
  const { data, error } = await supabase
    .from("org_requests")
    .insert({
      requester_id: userId,
      campus_id: campusId,
      request_type: requestType,
      name: name.trim(),
      description: description.trim(),
      category: category?.trim() || null,
      contact_phone: contactPhone?.trim() || null,
    })
    .select()
    .single();
  throwIfError(error);
  return data;
}

export async function getMyOrgRequests(userId) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from("org_requests")
    .select("*")
    .eq("requester_id", userId)
    .order("created_at", { ascending: false });
  throwIfError(error);
  return data || [];
}

export async function listPendingOrgRequests(campusId) {
  let query = supabase
    .from("org_requests")
    .select("*, profiles!org_requests_requester_id_fkey(name, course, year)")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (campusId) query = query.eq("campus_id", campusId);
  const { data, error } = await query;
  throwIfError(error);
  return data || [];
}

export async function approveOrgRequest(requestId, reason) {
  const { data, error } = await supabase.rpc("approve_org_request", { p_request_id: requestId, p_reason: reason || null });
  throwIfError(error);
  return data;
}

export async function rejectOrgRequest(requestId, reason) {
  const { data, error } = await supabase.rpc("reject_org_request", { p_request_id: requestId, p_reason: reason || null });
  throwIfError(error);
  return data;
}

