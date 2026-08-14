// Data layer for the club self-service leadership dashboard. Distinct from
// src/features/admin/api.js's club functions (those are admin-only, gated
// by current_user_is_admin()/'clubs.manage'): everything here is usable by
// any club's own owner/president/vice_president/secretary/coordinator, per
// the RLS + RPCs added in supabase/migrations/20260814004800_club_self_service.sql.

import { supabase } from "../../lib/supabase";

function throwIfError(error) {
  if (error) throw error;
}

// Powers the "Manage club" entry point on the Clubs Hub -- which clubs (if
// any) does the signed-in user lead, and in what role.
export async function getMyClubLeadership() {
  const { data, error } = await supabase.rpc("get_my_club_leadership");
  throwIfError(error);
  return data || [];
}

// One call for the whole dashboard: club profile, full roster (with
// names), every event regardless of published state, and a 30-day
// member-growth trend. See get_club_dashboard() for why this is one RPC
// rather than several client-side joins.
export async function getClubDashboard(clubId) {
  const { data, error } = await supabase.rpc("get_club_dashboard", { p_club_id: clubId });
  throwIfError(error);
  return data;
}

export async function updateClubProfile(clubId, { name, category, description, logoUrl }) {
  const { data, error } = await supabase
    .from("clubs")
    .update({
      name: name?.trim(),
      category: category?.trim() || "",
      description: description?.trim() || "",
      logo_url: logoUrl?.trim() || null,
    })
    .eq("id", clubId)
    .select()
    .single();
  throwIfError(error);
  return data;
}

export async function upsertClubEvent(clubId, event, organizerId) {
  const payload = {
    campus_id: event.campus_id,
    club_id: clubId,
    title: event.title,
    category: event.category || "Club Event",
    description: event.description || "",
    event_date: event.event_date,
    place: event.place || "",
    capacity: event.capacity ? Number(event.capacity) : null,
    published: event.published !== false,
  };
  if (!event.id) payload.organizer_id = organizerId;

  const query = event.id
    ? supabase.from("events").update(payload).eq("id", event.id)
    : supabase.from("events").insert(payload);
  const { data, error } = await query.select().single();
  throwIfError(error);
  return data;
}

export async function setClubEventPublished(eventId, published) {
  const { error } = await supabase.from("events").update({ published }).eq("id", eventId);
  throwIfError(error);
}

export async function cancelClubEvent(eventId) {
  const { error } = await supabase.from("events").update({ registration_status: "CANCELLED", published: false }).eq("id", eventId);
  throwIfError(error);
}

export async function setClubMemberRole(memberId, role) {
  const { data, error } = await supabase.rpc("set_club_member_role", { p_member_id: memberId, p_role: role });
  throwIfError(error);
  return data;
}

export async function removeClubMember(memberId) {
  const { error } = await supabase.rpc("remove_club_member", { p_member_id: memberId });
  throwIfError(error);
}
