/**
 * CAMPUS SERVICES
 *
 * General campus service requests (the doc-driven workflow cards) plus
 * resource booking (rooms/equipment) with date-range conflict checks.
 */

import { supabase } from "../../lib/supabase";
import { hasValidBookingRange } from "../../utils/mvpHelpers";
import { throwIfError } from "./_shared.js";

export async function getCampusServices(
  campusId
) {
  let query = supabase
    .from("services")
    .select(`
      id,
      campus_id,
      name,
      description,
      active
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


export async function getMyServiceRequests(
  userId
) {
  if (!userId) return [];

  const {
    data,
    error,
  } = await supabase
    .from("service_requests")
    .select(`
      id,
      title,
      details,
      status,
      created_at,
      updated_at,
      services (
        id,
        name
      ),
      locations (
        id,
        name,
        building,
        floor,
        room
      )
    `)
    .eq("user_id", userId)
    .order("created_at", {
      ascending: false,
    });

  throwIfError(error);

  return data || [];
}


export async function createCampusServiceRequest({
  userId,
  campusId,
  serviceName,
  title,
  details = {},
  locationId = null,
}) {
  if (!userId) {
    throw new Error(
      "Please sign in first."
    );
  }

  if (!serviceName) {
    throw new Error(
      "Select a service."
    );
  }

  const {
    data: service,
    error: serviceError,
  } = await supabase
    .from("services")
    .select("id")
    .eq("campus_id", campusId)
    .eq("name", serviceName)
    .eq("active", true)
    .maybeSingle();

  throwIfError(serviceError);

  if (!service) {
    throw new Error(
      `Service "${serviceName}" is not configured.`
    );
  }

  const {
    data,
    error,
  } = await supabase
    .from("service_requests")
    .insert({
      service_id: service.id,
      user_id: userId,
      campus_id: campusId,
      location_id: locationId,
      title,
      details,
      status: "SUBMITTED",
    })
    .select()
    .single();

  throwIfError(error);

  return data;
}


/* =========================================================================
   RESOURCE BOOKING
========================================================================= */

export async function getResources(
  campusId
) {
  // `available` is the canonical column (see supabase/migrations/
  // 20260814000700_services_bookings.sql) -- `active` was only ever a
  // legacy alias some pre-existing installs happened to carry (backfilled
  // into `available` at migration time, not kept in sync afterward). This
  // used to query `active` directly, which 42703'd outright on the staging
  // project (whose resources table never had an `active` column at all),
  // silently emptying the resource list and falling back to hardcoded mock
  // data with no real resource ids -- "Book" then couldn't open the booking
  // modal, only a "not configured" toast.
  let query = supabase
    .from("resources")
    .select(`
      id,
      campus_id,
      name,
      resource_type,
      available,
      locations (
        id,
        name,
        building,
        floor,
        room
      )
    `)
    .eq("available", true)
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


export async function getMyBookings(
  userId
) {
  if (!userId) return [];

  const {
    data,
    error,
  } = await supabase
    .from("bookings")
    .select(`
      id,
      resource_id,
      start_time,
      end_time,
      status,
      notes,
      created_at,
      resources (
        id,
        name,
        resource_type
      )
    `)
    .eq("user_id", userId)
    .order("start_time", {
      ascending: true,
    });

  throwIfError(error);

  return data || [];
}


export async function createResourceBooking({
  userId,
  resourceId,
  resourceName,
  startTime,
  endTime,
  notes = "",
}) {
  if (!userId) {
    throw new Error(
      "Please sign in first."
    );
  }

  if (!startTime || !endTime) {
    throw new Error(
      "Select a start and end time."
    );
  }

  if (!hasValidBookingRange(startTime, endTime)) {
    throw new Error(
      "End time must be after start time."
    );
  }

  let resource;

  if (resourceId) {
    const {
      data,
      error,
    } = await supabase
      .from("resources")
      .select("id,name")
      .eq("id", resourceId)
      .single();

    throwIfError(error);

    resource = data;
  } else {
    const {
      data,
      error,
    } = await supabase
      .from("resources")
      .select("id,name")
      .eq("name", resourceName)
      .maybeSingle();

    throwIfError(error);

    resource = data;
  }

  if (!resource) {
    throw new Error(
      "Resource not found."
    );
  }

  // The actual double-booking guard is a PostgreSQL exclusion constraint
  // (doc §35) enforced inside create_booking() -- no client-side
  // pre-check can race it, so we don't bother with one here.
  const { data, error } = await supabase.rpc("create_booking", {
    p_resource_id: resource.id,
    p_start_time: startTime,
    p_end_time: endTime,
    p_notes: notes,
  });

  if (error) {
    const message = (error.message || "").replace(/^[A-Z_]+:\s*/, "");
    throw new Error(
      error.message?.includes("BOOKING_SLOT_TAKEN")
        ? "This resource is already booked for that time."
        : (message || "Unable to create booking")
    );
  }

  return data;
}

export async function setBookingStatus(bookingId, status) {
  const { data, error } = await supabase.rpc("set_booking_status", {
    p_booking_id: bookingId,
    p_status: status,
  });
  throwIfError(error);
  return data;
}

