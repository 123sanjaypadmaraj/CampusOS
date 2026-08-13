import { supabase } from "../lib/supabase";


export async function getEvents(campusId) {
  let query = supabase
    .from("events")
    .select(`
      *,
      clubs (
        id,
        name,
        logo_url
      )
    `);

  if (campusId) {
    query = query.eq(
      "campus_id",
      campusId
    );
  }

  const {
    data,
    error
  } = await query.order(
    "event_date",
    { ascending: true }
  );

  if (error) throw error;

  return data || [];
}


export async function registerForEvent({
  eventId,
  userId
}) {
  if (!userId) {
    throw new Error(
      "Please sign in first."
    );
  }

  const {
    data,
    error
  } = await supabase
    .from("event_registrations")
    .insert({
      event_id: eventId,
      user_id: userId
    })
    .select()
    .single();

  if (error) throw error;

  return data;
}


export async function cancelEventRegistration({
  eventId,
  userId
}) {
  const {
    error
  } = await supabase
    .from("event_registrations")
    .delete()
    .eq("event_id", eventId)
    .eq("user_id", userId);

  if (error) throw error;
}


export async function getMyEventRegistrations(
  userId
) {
  const {
    data,
    error
  } = await supabase
    .from("event_registrations")
    .select(`
      *,
      events (
        *
      )
    `)
    .eq("user_id", userId);

  if (error) throw error;

  return data || [];
}