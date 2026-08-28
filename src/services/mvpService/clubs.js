/**
 * CLUBS
 *
 * Club listing, membership (join/leave), and a member's own club list.
 */

import { supabase } from "../../lib/supabase";
import { isUuid } from "../../utils/mvpHelpers";
import { throwIfError } from "./_shared.js";

export async function getClubs(
  campusId
) {
  // members/events are derived counts (clubs_with_counts view), not
  // hand-maintained integer columns that can drift from reality.
  let query = supabase
    .from("clubs_with_counts")
    .select(`
      id,
      campus_id,
      name,
      category,
      members,
      events,
      description,
      logo_url,
      recruitment_mode,
      recruitment_message
    `)
    .eq("active", true)
    .order("name");

  if (campusId) {
    query = query.eq(
      "campus_id",
      campusId
    );
  }

  const {
    data,
    error,
  } = await query;

  throwIfError(error);

  return data || [];
}


export async function joinClub({
  clubId,
  userId,
}) {
  if (!userId) {
    throw new Error(
      "Please sign in first."
    );
  }

  if (!isUuid(clubId)) {
    throw new Error("Invalid club ID.");
  }

  // Plain insert, not upsert: the RLS update policy for club_members
  // requires clubs.manage permission (role changes are staff-only), so an
  // upsert's ON CONFLICT DO UPDATE path would be rejected for a student
  // re-joining a club they're already in. Treat "already a member" as a
  // harmless no-op instead.
  const {
    data,
    error,
  } = await supabase
    .from("club_members")
    .insert({
      club_id: clubId,
      user_id: userId,
      role: "member",
    })
    .select()
    .single();

  if (error?.code === "23505") {
    return { club_id: clubId, user_id: userId, role: "member" };
  }

  throwIfError(error);

  return data;
}


export async function leaveClub({
  clubId,
  userId,
}) {
  if (!userId) {
    throw new Error(
      "Please sign in first."
    );
  }

  if (!isUuid(clubId)) {
    throw new Error("Invalid club ID.");
  }

  const {
    error,
  } = await supabase
    .from("club_members")
    .delete()
    .eq("club_id", clubId)
    .eq("user_id", userId);

  throwIfError(error);

  return true;
}


export async function getMyClubs(
  userId
) {
  if (!userId) return [];

  const {
    data,
    error,
  } = await supabase
    .from("club_members")
    .select(`
      club_id,
      role,
      joined_at,
      clubs (
        id,
        name,
        category,
        description,
        logo_url
      )
    `)
    .eq("user_id", userId);

  throwIfError(error);

  return data || [];
}


