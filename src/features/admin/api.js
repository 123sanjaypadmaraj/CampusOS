// CMS data layer for admin-managed content: food menu/canteens,
// announcements, events/clubs. All writes rely on the RLS policies added
// in supabase/migrations/0011 + 0018 (admin/current_user_is_admin() bypass)
// -- there's nothing here that isn't just a scoped table read/write, except
// announcement creation which goes through publish_announcement() since
// that's also what fans the announcement out as notifications.

import { supabase } from "../../lib/supabase";

function throwIfError(error) {
  if (error) throw error;
}

/* ========================================================================
   FOOD / CANTEENS
======================================================================== */

export async function listCanteensAdmin(campusId) {
  let query = supabase.from("canteens").select("*").order("name");
  if (campusId) query = query.eq("campus_id", campusId);
  const { data, error } = await query;
  throwIfError(error);
  return data || [];
}

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

export async function listFoodItemsAdmin(canteenId) {
  let query = supabase
    .from("food_items")
    .select("*, food_categories(id, name)")
    .order("name");
  if (canteenId) query = query.eq("canteen_id", canteenId);
  const { data, error } = await query;
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
    is_vegetarian: Boolean(item.is_vegetarian),
    available: item.available !== false,
    active: item.active !== false,
    featured: Boolean(item.featured),
  };
  const query = item.id
    ? supabase.from("food_items").update(payload).eq("id", item.id)
    : supabase.from("food_items").insert(payload);
  const { data, error } = await query.select().single();
  throwIfError(error);
  return data;
}

// Never hard-delete a food item with order history (doc §17) -- archive it.
export async function archiveFoodItem(id) {
  const { error } = await supabase.from("food_items").update({ active: false, available: false }).eq("id", id);
  throwIfError(error);
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
  resolveReport,
} from "../../services/mvpService";
