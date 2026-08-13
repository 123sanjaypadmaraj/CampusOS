import { supabase } from "../lib/supabase";


export async function getProfile(userId) {
  const {
    data,
    error
  } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (error) throw error;

  return data;
}


export async function updateProfile(
  userId,
  updates
) {
  const {
    data,
    error
  } = await supabase
    .from("profiles")
    .update({
      ...updates,
      updated_at:
        new Date().toISOString()
    })
    .eq("id", userId)
    .select()
    .single();

  if (error) throw error;

  return data;
}


export async function getClubs(campusId) {
  let query = supabase
    .from("clubs")
    .select("*");

  if (campusId) {
    query = query.eq(
      "campus_id",
      campusId
    );
  }

  const {
    data,
    error
  } = await query.order("name");

  if (error) throw error;

  return data || [];
}


export async function joinClub({
  clubId,
  userId
}) {
  const {
    data,
    error
  } = await supabase
    .from("club_members")
    .insert({
      club_id: clubId,
      user_id: userId,
      role: "member"
    })
    .select()
    .single();

  if (error) throw error;

  return data;
}


export async function leaveClub({
  clubId,
  userId
}) {
  const {
    error
  } = await supabase
    .from("club_members")
    .delete()
    .eq("club_id", clubId)
    .eq("user_id", userId);

  if (error) throw error;
}