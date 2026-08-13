import { supabase } from "../lib/supabase";


export async function getServices(campusId) {
  let query = supabase
    .from("services")
    .select("*")
    .eq("active", true);

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


export async function createServiceRequest({
  serviceId,
  userId,
  locationId = null,
  title,
  details = {}
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
    .from("service_requests")
    .insert({
      service_id: serviceId,
      user_id: userId,
      location_id: locationId,
      title,
      details,
      status: "pending"
    })
    .select()
    .single();

  if (error) throw error;

  return data;
}


export async function getMyServiceRequests(userId) {
  const {
    data,
    error
  } = await supabase
    .from("service_requests")
    .select(`
      *,
      services (
        name
      )
    `)
    .eq("user_id", userId)
    .order("created_at", {
      ascending: false
    });

  if (error) throw error;

  return data || [];
}


export async function getResources(campusId) {
  let query = supabase
    .from("resources")
    .select(`
      *,
      locations (
        name
      )
    `)
    .eq("active", true);

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


export async function createBooking({
  resourceId,
  userId,
  startTime,
  endTime,
  notes = ""
}) {
  if (!userId) {
    throw new Error(
      "Please sign in first."
    );
  }

  if (
    !startTime ||
    !endTime
  ) {
    throw new Error(
      "Select a start and end time."
    );
  }

  const {
    data,
    error
  } = await supabase
    .from("bookings")
    .insert({
      resource_id: resourceId,
      user_id: userId,
      start_time: startTime,
      end_time: endTime,
      status: "pending",
      notes
    })
    .select()
    .single();

  if (error) throw error;

  return data;
}


export async function createPrintJob({
  userId,
  fileUrl,
  fileName,
  copies = 1,
  colorMode = "black_white",
  paperSize = "A4",
  binding = null,
  price = 0
}) {
  if (!userId) {
    throw new Error(
      "Please sign in first."
    );
  }

  const pickupCode =
    Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase();

  const {
    data,
    error
  } = await supabase
    .from("print_jobs")
    .insert({
      user_id: userId,
      file_url: fileUrl,
      file_name: fileName,
      copies,
      color_mode: colorMode,
      paper_size: paperSize,
      binding,
      price,
      status: "pending",
      pickup_code: pickupCode
    })
    .select()
    .single();

  if (error) throw error;

  return data;
}