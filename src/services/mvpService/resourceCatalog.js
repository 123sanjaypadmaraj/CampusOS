/**
 * RESOURCE CATALOG MANAGEMENT (supabase/migrations/20260819000400_resource_management.sql)
 */

import { supabase } from "../../lib/supabase";
import { throwIfError } from "./_shared.js";

export async function listResourcesAdmin(campusId) {
  let query = supabase.from("resources").select("*, locations(name)").order("name");
  if (campusId) query = query.eq("campus_id", campusId);
  const { data, error } = await query;
  throwIfError(error);
  return data || [];
}

export async function upsertResourceAdmin({
  id = null, campusId, name, resourceType, locationId = null, capacity = null,
  openingHours = null, approvalRequired = false, bufferMinutes = 0, available = true,
}) {
  const { data, error } = await supabase.rpc("admin_upsert_resource", {
    p_id: id, p_campus_id: campusId, p_name: name, p_resource_type: resourceType || null,
    p_location_id: locationId, p_capacity: capacity, p_opening_hours: openingHours,
    p_approval_required: !!approvalRequired, p_buffer_minutes: bufferMinutes, p_available: !!available,
  });
  throwIfError(error);
  return data;
}

export async function deleteResourceAdmin(id) {
  const { error } = await supabase.rpc("admin_delete_resource", { p_id: id });
  throwIfError(error);
}

