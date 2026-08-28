/**
 * CAMPUS EMERGENCY DIRECTORY (supabase/migrations/20260817000100_emergency_directory.sql)
 * -- verified campus office contacts (security/medical/facilities/transport/
 * hostel), distinct from the next-of-kin emergency_contacts above. Backend
 * shipped 2026-08-17; this is its first frontend consumer.
 */

import { supabase } from "../../lib/supabase";
import { throwIfError } from "./_shared.js";

export async function listEmergencyDirectory() {
  const { data, error } = await supabase.rpc("list_emergency_directory");
  throwIfError(error);
  return data || [];
}

export async function adminListEmergencyDirectory() {
  const { data, error } = await supabase.rpc("admin_list_emergency_directory");
  throwIfError(error);
  return data || [];
}

export async function upsertEmergencyDirectoryEntry({
  id = null, category, name, designation, description, phone, altPhone, email,
  location, priority = "standard", is24x7 = false, weeklyHours = null, hoursNote,
  campusId = null, displayOrder = 0,
}) {
  const { data, error } = await supabase.rpc("upsert_emergency_directory_entry", {
    p_id: id, p_category: category, p_name: name, p_designation: designation || null,
    p_description: description || null, p_phone: phone, p_alt_phone: altPhone || null,
    p_email: email || null, p_location: location || null, p_priority: priority,
    p_is_24x7: !!is24x7, p_weekly_hours: weeklyHours, p_hours_note: hoursNote || null,
    p_campus_id: campusId, p_display_order: displayOrder,
  });
  throwIfError(error);
  return data;
}

export async function verifyEmergencyDirectoryEntry(id, verified, notes = null) {
  const { data, error } = await supabase.rpc("verify_emergency_directory_entry", { p_id: id, p_verified: verified, p_notes: notes });
  throwIfError(error);
  return data;
}

export async function setEmergencyDirectoryActive(id, active) {
  const { data, error } = await supabase.rpc("set_emergency_directory_active", { p_id: id, p_active: active });
  throwIfError(error);
  return data;
}

// campuses.support_email/support_phone (20260818001100_campus_settings.sql)
// existed unused until this pass -- every other "contact support" surface
// (SOS, tickets, appeals) had nowhere campus-specific to point to.
export async function getCampusContactInfo(campusId) {
  if (!campusId) return null;
  const { data, error } = await supabase.from("campuses").select("support_email, support_phone").eq("id", campusId).maybeSingle();
  throwIfError(error);
  return data;
}

