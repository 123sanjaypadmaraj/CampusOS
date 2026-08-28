/**
 * FACILITIES STAFF DASHBOARD (doc §30-33)
 * tickets.read/tickets.update/bookings.approve already existed on the
 * facilities_staff role and transition_ticket_status()/set_booking_status()
 * already existed as RPCs -- neither had a UI calling them.
 *
 * The queue facilities_staff/admin accounts work from for service requests
 * and bookings.
 */

import { supabase } from "../../lib/supabase";
import { throwIfError } from "./_shared.js";

// RESOLVED is included -- it's not done yet, the UI still needs to show it
// with a "Close ticket" action. Only CLOSED (the true terminal state)
// actually drops off this queue.
const ACTIVE_TICKET_STATUSES = ["SUBMITTED", "TRIAGED", "ASSIGNED", "IN_PROGRESS", "WAITING", "RESOLVED"];

export async function listActiveTickets(campusId) {
  let query = supabase
    .from("service_requests")
    .select("*")
    .in("status", ACTIVE_TICKET_STATUSES)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true });
  if (campusId) query = query.eq("campus_id", campusId);
  const { data, error } = await query;
  throwIfError(error);

  const tickets = data || [];
  if (tickets.length === 0) return tickets;

  // A direct `profiles!...(name)` embed resolves to null here -- facilities
  // staff can read/update tickets (tickets.read/tickets.update) but that
  // permission doesn't extend to profiles RLS, which only trusts
  // `users.read`/admin for reading someone else's row. get_profile_snippets()
  // is the safe, RLS-bypassing way every other feature already shows "who
  // did this" (see getMarketplaceListings above) -- same fix here.
  const reporterIds = [...new Set(tickets.map((t) => t.user_id))];
  const { data: profiles } = await supabase.rpc("get_profile_snippets", { p_ids: reporterIds });
  const profileMap = {};
  (profiles || []).forEach((p) => { profileMap[p.id] = p; });
  return tickets.map((t) => ({ ...t, profiles: profileMap[t.user_id] || null }));
}

export async function transitionTicketStatus(requestId, toStatus, notes) {
  const { data, error } = await supabase.rpc("transition_ticket_status", {
    p_request_id: requestId,
    p_to_status: toStatus,
    p_notes: notes || null,
  });
  throwIfError(error);
  return data;
}

// Not campus-filtered -- bookings has no campus_id of its own (only via
// resources, and this deployment only ever has one campus); a facilities
// staff account already only has one campus's resources to see.
export async function listPendingBookings() {
  const { data, error } = await supabase
    .from("bookings")
    .select("*, resources(name)")
    .eq("status", "PENDING")
    .order("start_time", { ascending: true });
  throwIfError(error);

  const bookings = data || [];
  if (bookings.length === 0) return bookings;

  // Same RLS-visibility reason as listActiveTickets() above: a direct
  // profiles embed resolves to null for facilities staff (bookings.approve
  // doesn't extend to profiles RLS).
  const requesterIds = [...new Set(bookings.map((b) => b.user_id))];
  const { data: profiles } = await supabase.rpc("get_profile_snippets", { p_ids: requesterIds });
  const profileMap = {};
  (profiles || []).forEach((p) => { profileMap[p.id] = p; });
  return bookings.map((b) => ({ ...b, profiles: profileMap[b.user_id] || null }));
}


