/**
 * EVENTS
 *
 * Event listing/formatting, registration (incl. waitlisting), saved events
 * & posts, and the production-completion surface added in
 * 20260819002000_events_production_completion.sql: QR tickets,
 * organizer roster/check-in, feedback, cover image upload, and the
 * admin approval workflow for club-officer-created events.
 */

import { supabase } from "../../lib/supabase";
import { isUuid } from "../../utils/mvpHelpers";
import { withOfflineCache } from "../../utils/offlineCache";
import { throwIfError } from "./_shared.js";

function formatEvent(event) {
  const dateObj = new Date(event.event_date);
  const isValidDate = !isNaN(dateObj.getTime());

  return {
    id: event.id,
    date: isValidDate ? dateObj.getDate().toString() : "12",
    month: isValidDate
      ? dateObj.toLocaleString("en-US", { month: "short" }).toUpperCase()
      : "AUG",
    title: event.title,
    club: event.clubs?.name || "Campus Event",
    time: isValidDate
      ? dateObj.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        })
      : "2:00 PM",
    place: event.place || "Campus",
    color:
      event.category === "Hackathon"
        ? "blue"
        : event.category === "Workshop"
        ? "purple"
        : "green",
    category: event.category || "Event",
    attendees: event.attendees || 0,
    description: event.description || "",
    coverImageUrl: event.cover_image_url || null,
    checkedInCount: event.checked_in_count || 0,
    avgRating: event.avg_rating || null,
    feedbackCount: event.feedback_count || 0,
    certificates_enabled: event.certificates_enabled || false,
    eventDate: event.event_date,
  };
}

export async function getCampusEvents(
  campusId,
  { limit = 50, cursor = null } = {}
) {
  const fetchEvents = async () => {
    // attendees is a derived count (events_with_counts view), not a
    // hand-maintained integer column that can drift from real registrations.
    let query = supabase
      .from("events_with_counts")
      .select(`
        id,
        campus_id,
        club_id,
        title,
        category,
        event_date,
        place,
        description,
        capacity,
        registration_status,
        attendees,
        checked_in_count,
        avg_rating,
        feedback_count,
        cover_image_url,
        certificates_enabled,
        clubs (
          id,
          name,
          logo_url
        )
      `)
      .order("event_date")
      .limit(limit);

    if (campusId) {
      query = query.eq(
        "campus_id",
        campusId
      );
    }

    if (cursor) {
      query = query.gt("event_date", cursor);
    }

    const {
      data,
      error,
    } = await query;

    throwIfError(error);

    return (data || []).map(formatEvent);
  };

  // Doc §9 "Offline Mode": "previously loaded events" -- only cache/serve
  // the first page. A paginated "load more" while offline should just
  // fail normally rather than silently re-showing page one as if it were
  // the next page.
  if (cursor) return fetchEvents();
  return withOfflineCache(`events:${campusId || "default"}`, fetchEvents);
}


export async function getMyEventRegistrations(
  userId
) {
  if (!userId) return [];

  const {
    data,
    error,
  } = await supabase
    .from("event_registrations")
    .select(`
      event_id,
      registered_at,
      events (
        id,
        title,
        category,
        event_date,
        place,
        certificates_enabled
      )
    `)
    .eq("status", "confirmed")
    .eq("user_id", userId);

  throwIfError(error);

  return data || [];
}


export async function isRegisteredForEvent({
  eventId,
  userId,
}) {
  if (!eventId || !userId || !isUuid(eventId)) {
    return false;
  }

  const {
    data,
    error,
  } = await supabase
    .from("event_registrations")
    .select("id")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .eq("status", "confirmed")
    .maybeSingle();

  throwIfError(error);

  return Boolean(data);
}


const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;

export function isValidPhone(phone) {
  return typeof phone === "string" && PHONE_PATTERN.test(phone.trim());
}

// Capacity enforcement + waitlisting now happens atomically inside
// register_for_event() (doc §35/§38) -- direct inserts into
// event_registrations are no longer permitted (no client insert policy).
// The registration confirmation dialog lets the student edit their display
// name and add a roll number/department per-registration; phone/name are
// validated here, USN/email still come from the signed-in profile inside
// the RPC (unspoofable) -- roll number/department are free text, no format
// to validate client-side.
export async function registerEvent({
  eventId,
  userId,
  contactPhone,
  contactName,
  rollNumber,
  department,
}) {
  if (!userId) {
    throw new Error(
      "Please sign in first."
    );
  }

  if (!isUuid(eventId)) {
    throw new Error("Invalid event ID.");
  }

  if (!isValidPhone(contactPhone)) {
    throw new Error("Enter a valid phone number to register.");
  }

  if (!contactName || !contactName.trim()) {
    throw new Error("Enter a name to register.");
  }

  const {
    data,
    error,
  } = await supabase.rpc("register_for_event", {
    p_event_id: eventId,
    p_contact_phone: contactPhone.trim(),
    p_contact_name: contactName.trim(),
    p_roll_number: rollNumber?.trim() || null,
    p_department: department?.trim() || null,
  });

  throwIfError(error);

  return data; // { status: 'confirmed' | 'waitlisted', registration_id?, ticket_token?, position? }
}

export async function cancelEventRegistration({ eventId }) {
  if (!isUuid(eventId)) throw new Error("Invalid event ID.");
  const { error } = await supabase.rpc("cancel_event_registration", { p_event_id: eventId });
  throwIfError(error);
  return true;
}

/* =========================================================================
   EVENTS -- QR ticket, organizer roster/check-in, feedback, cover image,
   approval (supabase/migrations/20260819002000_events_production_completion.sql)
========================================================================= */

// Ticket for the signed-in user's own confirmed registration -- shown as a
// QR code (see App.jsx's EventTicketModal) and re-fetchable any time after
// registration, not just at the moment of registering.
export async function getMyEventTicket({ eventId, userId }) {
  if (!userId || !isUuid(eventId)) return null;
  const { data, error } = await supabase
    .from("event_registrations")
    .select("id, contact_name, event_tickets(token, checked_in_at)")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .eq("status", "confirmed")
    .maybeSingle();
  throwIfError(error);
  if (!data) return null;
  const ticket = Array.isArray(data.event_tickets) ? data.event_tickets[0] : data.event_tickets;
  return ticket
    ? { registrationId: data.id, token: ticket.token, checkedInAt: ticket.checked_in_at, name: data.contact_name }
    : null;
}

// Organizer-only: confirmed registrants + waitlist for one event, with
// contact details, ticket token and check-in status. Powers the roster
// list, the check-in screen and the attendance CSV export.
export async function getEventRoster(eventId) {
  if (!isUuid(eventId)) throw new Error("Invalid event ID.");
  const { data, error } = await supabase.rpc("get_event_roster", { p_event_id: eventId });
  throwIfError(error);
  return data || [];
}

// Scans (or manually entered) a ticket token at the door. Duplicate
// check-in is rejected server-side (TICKET_ALREADY_USED).
export async function checkinEventTicket(token) {
  const cleanToken = (token || "").trim();
  if (!cleanToken) throw new Error("Enter or scan a ticket code.");
  const { data, error } = await supabase.rpc("checkin_event_ticket", { p_token: cleanToken });
  throwIfError(error);
  return data; // { event_id, user_id, name }
}

export async function submitEventFeedback({ eventId, rating, comment }) {
  if (!isUuid(eventId)) throw new Error("Invalid event ID.");
  const { data, error } = await supabase.rpc("submit_event_feedback", {
    p_event_id: eventId,
    p_rating: rating,
    p_comment: comment || null,
  });
  throwIfError(error);
  return data;
}

export async function getMyEventFeedback({ eventId, userId }) {
  if (!userId || !isUuid(eventId)) return null;
  const { data, error } = await supabase
    .from("event_feedback")
    .select("*")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .maybeSingle();
  throwIfError(error);
  return data || null;
}

// Public 'event-covers' bucket, path `${eventId}/${filename}` -- same
// convention as club-gallery (clubs/api.js's uploadClubGalleryImage).
export async function uploadEventCoverImage(eventId, file) {
  if (!file) throw new Error("Choose an image to upload.");
  if (!isUuid(eventId)) throw new Error("Save the event first, then add a cover image.");
  const safeName = (file.name || "cover").replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${eventId}/${Date.now()}-${safeName}`;
  const { error: uploadError } = await supabase.storage
    .from("event-covers")
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || "image/jpeg" });
  throwIfError(uploadError);

  const { data: pub } = supabase.storage.from("event-covers").getPublicUrl(path);
  const { data, error } = await supabase
    .from("events")
    .update({ cover_image_url: pub?.publicUrl })
    .eq("id", eventId)
    .select()
    .single();
  throwIfError(error);
  return data;
}

// Admin/moderator-only: approve or reject an event pending review (see the
// events_approval_guard trigger -- any event created by a plain club
// officer starts 'pending' and stays invisible to students until this
// runs).
export async function setEventApproval(eventId, decision, reason) {
  if (!isUuid(eventId)) throw new Error("Invalid event ID.");
  const { error } = await supabase.rpc("set_event_approval", {
    p_event_id: eventId,
    p_decision: decision,
    p_reason: reason || null,
  });
  throwIfError(error);
}

export async function getMyRegisteredEventIds(userId) {
  const rows = await getMyEventRegistrations(userId);
  return rows.map((row) => row.event_id);
}

export async function getSavedEvents(userId) {
  if (!userId) return [];
  // Doc §9 "Offline Mode": "saved content" -- this is the only real saved/
  // bookmarked-content list in the app today.
  return withOfflineCache(`saved_events:${userId}`, async () => {
    const { data, error } = await supabase.from("saved_events").select("event_id").eq("user_id", userId);
    throwIfError(error);
    return (data || []).map((row) => row.event_id);
  });
}

export async function toggleSavedEvent({ eventId, userId }) {
  if (!userId) throw new Error("Please sign in first.");
  if (!isUuid(eventId)) throw new Error("Invalid event ID.");
  const { data: existing, error: readError } = await supabase.from("saved_events").select("event_id").eq("event_id", eventId).eq("user_id", userId).maybeSingle();
  throwIfError(readError);
  if (existing) {
    const { error } = await supabase.from("saved_events").delete().eq("event_id", eventId).eq("user_id", userId);
    throwIfError(error);
    return false;
  }
  const { error } = await supabase.from("saved_events").insert({ event_id: eventId, user_id: userId });
  throwIfError(error);
  return true;
}

// Saved posts (20260818000600_community_hardening.sql) -- same shape/pattern
// as saved_events above, just against public.posts instead of public.events.
export async function getSavedPosts(userId) {
  if (!userId) return [];
  const { data, error } = await supabase.from("saved_posts").select("post_id").eq("user_id", userId);
  throwIfError(error);
  return (data || []).map((row) => row.post_id);
}

export async function toggleSavedPost({ postId, userId }) {
  if (!userId) throw new Error("Please sign in first.");
  if (!isUuid(postId)) throw new Error("Invalid post ID.");
  const { data: existing, error: readError } = await supabase.from("saved_posts").select("post_id").eq("post_id", postId).eq("user_id", userId).maybeSingle();
  throwIfError(readError);
  if (existing) {
    const { error } = await supabase.from("saved_posts").delete().eq("post_id", postId).eq("user_id", userId);
    throwIfError(error);
    return false;
  }
  const { error } = await supabase.from("saved_posts").insert({ post_id: postId, user_id: userId });
  throwIfError(error);
  return true;
}


