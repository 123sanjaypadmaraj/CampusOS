// CMS data layer for admin-managed content: announcements, events/clubs,
// plus a couple of food/canteen helpers reused by the vendor dashboard. All
// writes rely on the RLS policies added in supabase/migrations/0011 + 0018
// (admin/current_user_is_admin() bypass) -- there's nothing here that isn't
// just a scoped table read/write, except announcement creation which goes
// through publish_announcement() since that's also what fans the
// announcement out as notifications.
//
// Canteen/menu editing itself no longer has an admin-side UI -- it moved
// entirely to each canteen's own vendor login (src/features/vendor/), which
// is why listCanteensAdmin/listFoodItemsAdmin/archiveFoodItem aren't here
// anymore. upsertCanteen/upsertFoodItem/listFoodCategories stay -- the
// vendor data layer (../vendor/api.js) imports and re-exports them rather
// than duplicating the same payload-shaping logic.

import { supabase } from "../../lib/supabase";

function throwIfError(error) {
  if (error) throw error;
}

/* ========================================================================
   FOOD / CANTEENS (shared with the vendor dashboard -- see note above)
======================================================================== */

export async function upsertCanteen(campusId, canteen) {
  const payload = {
    campus_id: campusId,
    name: canteen.name,
    subtitle: canteen.subtitle || "",
    status: canteen.status || "Open",
    eta_min: Number(canteen.eta_min) || 5,
    eta_max: Number(canteen.eta_max) || 15,
    color: canteen.color || "green",
    active: canteen.active !== false,
  };
  const query = canteen.id
    ? supabase.from("canteens").update(payload).eq("id", canteen.id)
    : supabase.from("canteens").insert(payload);
  const { data, error } = await query.select().single();
  throwIfError(error);
  return data;
}

export async function listFoodCategories() {
  const { data, error } = await supabase.from("food_categories").select("*").order("name");
  throwIfError(error);
  return data || [];
}

export async function upsertFoodItem(item) {
  const payload = {
    canteen_id: item.canteen_id,
    category_id: item.category_id || null,
    name: item.name,
    description: item.description || "",
    price: Number(item.price) || 0,
    image_url: item.image_url || null,
    preparation_time_min: Number(item.preparation_time_min) || 10,
    is_vegetarian: Boolean(item.is_vegetarian),
    available: item.available !== false,
    active: item.active !== false,
    featured: Boolean(item.featured),
    track_stock: Boolean(item.track_stock),
    stock_quantity: item.track_stock && item.stock_quantity !== "" && item.stock_quantity != null && Number.isFinite(Number(item.stock_quantity))
      ? Math.max(0, Math.floor(Number(item.stock_quantity)))
      : null,
    low_stock_threshold: Number.isFinite(Number(item.low_stock_threshold))
      ? Math.max(0, Math.floor(Number(item.low_stock_threshold)))
      : 5,
    dietary_tags: Array.isArray(item.dietary_tags) ? item.dietary_tags : [],
    allergens: Array.isArray(item.allergens) ? item.allergens : [],
    spice_level: item.spice_level || null,
    calories: item.calories !== "" && item.calories != null && Number.isFinite(Number(item.calories))
      ? Math.max(0, Math.floor(Number(item.calories)))
      : null,
    available_days: Array.isArray(item.available_days) && item.available_days.length ? item.available_days : null,
    available_from: item.available_from || null,
    available_to: item.available_to || null,
  };
  const query = item.id
    ? supabase.from("food_items").update(payload).eq("id", item.id)
    : supabase.from("food_items").insert(payload);
  const { data, error } = await query.select().single();
  throwIfError(error);
  return data;
}

/* ========================================================================
   ANNOUNCEMENTS
======================================================================== */

export async function listAnnouncementsAdmin(campusId) {
  let query = supabase.from("announcements").select("*").order("created_at", { ascending: false });
  if (campusId) query = query.eq("campus_id", campusId);
  const { data, error } = await query;
  throwIfError(error);
  return data || [];
}

export async function createAnnouncement({ category, title, body, targetScope = "everyone", targetValue = null }) {
  const { data, error } = await supabase.rpc("publish_announcement", {
    p_category: category,
    p_title: title,
    p_body: body,
    p_target_scope: targetScope,
    p_target_value: targetValue,
  });
  throwIfError(error);
  return data;
}

export async function updateAnnouncement(id, { title, body, category }) {
  const { data, error } = await supabase
    .from("announcements")
    .update({ title, body, category })
    .eq("id", id)
    .select()
    .single();
  throwIfError(error);
  return data;
}

export async function deleteAnnouncement(id) {
  const { error } = await supabase.from("announcements").delete().eq("id", id);
  throwIfError(error);
}

/* ========================================================================
   EVENTS
======================================================================== */

export async function listEventsAdmin(campusId) {
  let query = supabase
    .from("events_with_counts")
    .select("*, clubs(id, name)")
    .order("event_date", { ascending: false });
  if (campusId) query = query.eq("campus_id", campusId);
  const { data, error } = await query;
  throwIfError(error);
  return data || [];
}

export async function upsertEvent(campusId, event) {
  const payload = {
    campus_id: campusId,
    club_id: event.club_id || null,
    title: event.title,
    category: event.category || "Event",
    description: event.description || "",
    event_date: event.event_date,
    place: event.place || "",
    capacity: event.capacity ? Number(event.capacity) : null,
    published: event.published !== false,
  };
  const query = event.id
    ? supabase.from("events").update(payload).eq("id", event.id)
    : supabase.from("events").insert(payload);
  const { data, error } = await query.select().single();
  throwIfError(error);
  return data;
}

export async function setEventPublished(id, published) {
  const { error } = await supabase.from("events").update({ published }).eq("id", id);
  throwIfError(error);
}

/* ========================================================================
   CLUBS
======================================================================== */

export async function listClubsAdmin(campusId) {
  let query = supabase.from("clubs_with_counts").select("*").order("name");
  if (campusId) query = query.eq("campus_id", campusId);
  const { data, error } = await query;
  throwIfError(error);
  return data || [];
}

export async function upsertClub(campusId, club) {
  const payload = {
    campus_id: campusId,
    name: club.name,
    category: club.category || "",
    description: club.description || "",
    active: club.active !== false,
  };
  const query = club.id
    ? supabase.from("clubs").update(payload).eq("id", club.id)
    : supabase.from("clubs").insert(payload);
  const { data, error } = await query.select().single();
  throwIfError(error);
  return data;
}

export async function listClubMembers(clubId) {
  const { data, error } = await supabase
    .from("club_members")
    .select("id, user_id, role, joined_at, profiles:user_id(name, usn, course)")
    .eq("club_id", clubId)
    .order("joined_at");
  throwIfError(error);
  return data || [];
}

export async function setClubMemberRole(memberId, role) {
  const { error } = await supabase.from("club_members").update({ role }).eq("id", memberId);
  throwIfError(error);
}

/* ========================================================================
   VENDOR MANAGEMENT (2026-08-18 "AdminCMS operating system" pass, part
   1/5) -- entity-level oversight (create/deactivate/reassign ownership) of
   canteens/stores. Deliberately NOT menu editing -- see the note at the
   top of this file, that stays vendor-only. Print shop status reuses
   vendor/api.js's getMyPrintShopStatus/setPrintShopStatus directly rather
   than duplicating (it's a single per-campus row, not a list of entities).
======================================================================== */

export async function listVendorsAdmin(campusId) {
  const [{ data: canteens, error: cErr }, { data: stores, error: sErr }] = await Promise.all([
    supabase.from("canteens")
      .select("id, name, subtitle, active, owner_id, campus_id, created_at, owner:owner_id(name, email)")
      .eq("campus_id", campusId).order("name"),
    supabase.from("stores")
      .select("id, name, subtitle, category, active, owner_id, campus_id, created_at, owner:owner_id(name, email)")
      .eq("campus_id", campusId).order("name"),
  ]);
  throwIfError(cErr);
  throwIfError(sErr);
  return [
    ...(canteens || []).map((c) => ({ ...c, type: "canteen" })),
    ...(stores || []).map((s) => ({ ...s, type: "store" })),
  ];
}

export async function createVendor(campusId, { type, name, ownerEmail, subtitle, category }) {
  const { data, error } = await supabase.rpc("admin_create_vendor", {
    p_type: type, p_campus_id: campusId, p_name: name, p_owner_email: ownerEmail,
    p_subtitle: subtitle || null, p_category: category || null,
  });
  throwIfError(error);
  return data;
}

export async function setVendorActive(type, id, active) {
  const { error } = await supabase.rpc("admin_set_vendor_active", { p_type: type, p_id: id, p_active: active });
  throwIfError(error);
}

export async function transferVendorOwnership(type, id, newOwnerEmail) {
  const { error } = await supabase.rpc("admin_transfer_vendor_ownership", { p_type: type, p_id: id, p_new_owner_email: newOwnerEmail });
  throwIfError(error);
}

/* ========================================================================
   FACILITIES OVERSIGHT (part 2/5) -- reads were already reachable via RLS
   (tickets.read/bookings.approve or admin); this just gives them a UI, plus
   the new assign_ticket() RPC for the one gap that had no write path at all.
======================================================================== */

export async function listTicketsAdmin(campusId) {
  const { data, error } = await supabase
    .from("service_requests")
    .select("*, submitter:user_id(name, email), assignee:assigned_to(name, email)")
    .eq("campus_id", campusId)
    .order("created_at", { ascending: false })
    .limit(200);
  throwIfError(error);
  return data || [];
}

export async function listFacilitiesStaff(campusId) {
  const { data, error } = await supabase
    .from("profiles").select("id, name, email")
    .eq("campus_id", campusId).eq("role", "facilities_staff").order("name");
  throwIfError(error);
  return data || [];
}

export async function assignTicket(requestId, staffId) {
  const { data, error } = await supabase.rpc("assign_ticket", { p_request_id: requestId, p_staff_id: staffId });
  throwIfError(error);
  return data;
}

export async function transitionTicketStatus(requestId, toStatus, notes) {
  const { data, error } = await supabase.rpc("transition_ticket_status", { p_request_id: requestId, p_to_status: toStatus, p_notes: notes || null });
  throwIfError(error);
  return data;
}

export async function listBookingsAdmin(campusId) {
  const { data, error } = await supabase
    .from("bookings")
    .select("*, requester:user_id(name, email), resource:resource_id!inner(name, campus_id, resource_type)")
    .eq("resource.campus_id", campusId)
    .order("start_time", { ascending: false })
    .limit(200);
  throwIfError(error);
  return data || [];
}

export async function setBookingStatusAdmin(bookingId, status) {
  const { data, error } = await supabase.rpc("set_booking_status", { p_booking_id: bookingId, p_status: status });
  throwIfError(error);
  return data;
}

/* ========================================================================
   SYSTEM HEALTH (part 3/5)
======================================================================== */

export async function getSystemHealth() {
  const { data, error } = await supabase.rpc("admin_system_health");
  throwIfError(error);
  return data;
}

export async function getEdgeFunctionHealth() {
  const { data, error } = await supabase.functions.invoke("system-health", { method: "GET" });
  throwIfError(error);
  return data;
}

/* ========================================================================
   CAMPUS SETTINGS / CONFIGURATION (part 4/5)
======================================================================== */

export async function listCampusesAdmin() {
  const { data, error } = await supabase.from("campuses").select("*").order("name");
  throwIfError(error);
  return data || [];
}

export async function updateCampusSettings(campusId, fields) {
  const { data, error } = await supabase.rpc("admin_update_campus", {
    p_campus_id: campusId,
    p_name: fields.name ?? null,
    p_domain: fields.domain ?? null,
    p_timezone: fields.timezone ?? null,
    p_active: fields.active ?? null,
    p_support_email: fields.supportEmail ?? null,
    p_support_phone: fields.supportPhone ?? null,
    p_settings: fields.settings ?? null,
  });
  throwIfError(error);
  return data;
}

/* ========================================================================
   FEATURE FLAGS (part 5/5) -- reads go straight through feature_flags_read
   RLS (config, not secret -- same posture as announcements/campuses), no
   RPC needed for listing. Writes are RPC-only, matching that table having
   no write RLS policy at all.
======================================================================== */

export async function listFeatureFlags() {
  const { data, error } = await supabase.from("feature_flags").select("*").order("key");
  throwIfError(error);
  return data || [];
}

export async function upsertFeatureFlag({ key, campusId, description, enabled, rolloutPercentage }) {
  const { data, error } = await supabase.rpc("admin_upsert_feature_flag", {
    p_key: key, p_campus_id: campusId ?? null, p_description: description || null,
    p_enabled: !!enabled, p_rollout_percentage: rolloutPercentage ?? 100,
  });
  throwIfError(error);
  return data;
}

export async function deleteFeatureFlag(key, campusId) {
  const { error } = await supabase.rpc("admin_delete_feature_flag", { p_key: key, p_campus_id: campusId ?? null });
  throwIfError(error);
}

export {
  listPendingVerifications,
  reviewStudentVerification,
  getVerificationDocumentUrl,
  listAllUsers,
  setUserRole,
  setUserStatus,
  listOpenReports,
  getReportContext,
  moderateContent,
  adminGetConversationMessages,
  resolveReport,
  listPendingOrgRequests,
  approveOrgRequest,
  rejectOrgRequest,
  listLostFoundItemsAdmin,
  verifyLostFoundHandover,
  setLostFoundItemStatusAdmin,
  deleteLostFoundItemAdmin,
  createLostFoundItem,
  listErrorLogs,
  setErrorLogResolved,
  listPendingEmergencyContacts,
  verifyEmergencyContact,
  setAiAccess,
  listAiKnowledge,
  upsertAiKnowledge,
  deleteAiKnowledge,
  getAiUsageSummary,
  listAiReports,
  getAuditLogs,
  proposeRoleChange,
  listRoleChangeRequests,
  decideRoleChange,
  listAccountDeletionRequests,
  adminProcessAccountDeletion,
  listBannedWords,
  addBannedWord,
  removeBannedWord,
  listProhibitedListingTerms,
  addProhibitedListingTerm,
  removeProhibitedListingTerm,
  listSuspensionAppeals,
  resolveSuspensionAppeal,
} from "../../services/mvpService";
