/**
 * SOS / EMERGENCY (supabase/migrations/20260815000300_sos_alerts.sql)
 * Real dispatch: a persisted alert, fanned out to facilities_staff/admins
 * as a preference-proof 'emergency' notification, with an audited
 * acknowledge/resolve lifecycle -- not a UI-only simulation.
 */

import { supabase } from "../../lib/supabase";
import { throwIfError } from "./_shared.js";
import { isValidPhone } from "./events.js";
import { realtimeStatusLogger } from "./realtime.js";

// Best-effort geolocation: resolves with { latitude, longitude, accuracy }
// on success, or null on denial/timeout/unsupported browser -- an SOS
// trigger must never block on (or be blocked by) location permission.
export function getBestEffortLocation({ timeout = 5000 } = {}) {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      }),
      () => resolve(null),
      { timeout, maximumAge: 60000 }
    );
  });
}

export async function triggerSosAlert({ alertType = "general", location } = {}) {
  const { data, error } = await supabase.rpc("trigger_sos_alert", {
    p_alert_type: alertType,
    p_latitude: location?.latitude ?? null,
    p_longitude: location?.longitude ?? null,
    p_location_accuracy_m: location?.accuracy ?? null,
  });
  throwIfError(error);
  return data;
}

export async function cancelMySosAlert(alertId) {
  const { data, error } = await supabase.rpc("cancel_my_sos_alert", { p_alert_id: alertId });
  throwIfError(error);
  return data;
}

export async function listActiveSosAlerts() {
  const { data, error } = await supabase.rpc("list_active_sos_alerts");
  throwIfError(error);
  return data || [];
}

export async function acknowledgeSosAlert(alertId) {
  const { data, error } = await supabase.rpc("acknowledge_sos_alert", { p_alert_id: alertId });
  throwIfError(error);
  return data;
}

export async function resolveSosAlert(alertId, notes = null) {
  const { data, error } = await supabase.rpc("resolve_sos_alert", { p_alert_id: alertId, p_notes: notes });
  throwIfError(error);
  return data;
}

export function subscribeToSosAlerts(callback) {
  const channel = supabase
    .channel("sos-alerts-realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "sos_alerts" }, callback)
    .subscribe(realtimeStatusLogger("sos_alerts"));

  return () => {
    supabase.removeChannel(channel);
  };
}

/* =========================================================================
   EMERGENCY CONTACTS (doc §113, supabase/migrations/20260815000600_emergency_contacts.sql)
   A verified next-of-kin directory per student, feeding the SOS responder
   flow above -- a responder can pull a student's contacts, but only in the
   context of a real active/acknowledged alert (get_emergency_contacts_for_alert),
   not by browsing the directory at will.
========================================================================= */

export async function listMyEmergencyContacts() {
  const { data, error } = await supabase
    .from("emergency_contacts")
    .select("*")
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });
  throwIfError(error);
  return data || [];
}

export async function upsertEmergencyContact({
  id = null,
  contactName,
  relationship,
  phone,
  altPhone = null,
  email = null,
  isPrimary = false,
}) {
  if (!contactName || !contactName.trim()) throw new Error("Contact name is required.");
  if (!isValidPhone(phone)) throw new Error("Enter a valid phone number for this contact.");
  if (altPhone && altPhone.trim() && !isValidPhone(altPhone)) {
    throw new Error("Enter a valid alternate phone number, or leave it blank.");
  }
  const { data, error } = await supabase.rpc("upsert_emergency_contact", {
    p_id: id,
    p_contact_name: contactName.trim(),
    p_relationship: relationship,
    p_phone: phone.trim(),
    p_alt_phone: altPhone ? altPhone.trim() : null,
    p_email: email ? email.trim() : null,
    p_is_primary: Boolean(isPrimary),
  });
  throwIfError(error);
  return data;
}

export async function deleteEmergencyContact(id) {
  const { error } = await supabase.rpc("delete_emergency_contact", { p_id: id });
  throwIfError(error);
}

// Facilities/admin verification queue (emergency_contacts.verify permission).
export async function listPendingEmergencyContacts() {
  const { data, error } = await supabase.rpc("admin_list_pending_emergency_contacts");
  throwIfError(error);
  return data || [];
}

export async function verifyEmergencyContact(id, verified, notes = null) {
  const { data, error } = await supabase.rpc("verify_emergency_contact", {
    p_id: id,
    p_verified: verified,
    p_notes: notes,
  });
  throwIfError(error);
  return data;
}

// SOS responder pulling a student's contacts for a specific, real,
// currently-active alert -- see the RPC's own comment for why this is
// scoped this way instead of a plain directory read.
export async function getEmergencyContactsForAlert(alertId) {
  const { data, error } = await supabase.rpc("get_emergency_contacts_for_alert", { p_alert_id: alertId });
  throwIfError(error);
  return data || [];
}

