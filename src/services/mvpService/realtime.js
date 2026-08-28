/**
 * REALTIME
 * Every .subscribe() in this app used to pass no status callback at all --
 * a CHANNEL_ERROR or TIMED_OUT (dropped websocket, RLS misconfig, etc.) was
 * silently invisible. realtimeStatusLogger() is the shared callback: pass
 * its return value into .subscribe(...) at every channel call site (here
 * and in the other services that open channels) to report those into
 * error_logs (category 'realtime') without changing any channel's own
 * postgres_changes wiring.
 */

import { supabase } from "../../lib/supabase";
import { logClientError } from "./errorLogging.js";

export function realtimeStatusLogger(label) {
  return (status, err) => {
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      logClientError(`Realtime channel error: ${label} (${status})`, {
        severity: "warning",
        category: "realtime",
        context: { channel: label, error: err?.message },
      });
    }
  };
}

export function subscribeToUserNotifications(
  userId,
  callback
) {
  if (!userId) return () => {};

  const channel =
    supabase
      .channel(
        `notifications:${userId}`
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter:
            `user_id=eq.${userId}`,
        },
        callback
      )
      .subscribe(realtimeStatusLogger("notifications"));

  return () => {
    supabase.removeChannel(channel);
  };
}


export function subscribeToOrders(
  userId,
  callback
) {
  if (!userId) return () => {};

  const channel =
    supabase
      .channel(`orders:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter:
            `user_id=eq.${userId}`,
        },
        callback
      )
      .subscribe(realtimeStatusLogger("orders"));

  return () => {
    supabase.removeChannel(channel);
  };
}


export function subscribeToPosts(callback) {
  const channel = supabase
    .channel("public:posts_realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, callback)
    .on("postgres_changes", { event: "*", schema: "public", table: "post_likes" }, callback)
    .on("postgres_changes", { event: "*", schema: "public", table: "comments" }, callback)
    .subscribe(realtimeStatusLogger("posts"));

  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeToEvents(callback) {
  const channel = supabase
    .channel("public:events_realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "events" }, callback)
    .on("postgres_changes", { event: "*", schema: "public", table: "event_registrations" }, callback)
    .subscribe(realtimeStatusLogger("events"));

  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeToFood(callback) {
  const channel = supabase
    .channel("public:food_realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "canteens" }, callback)
    .on("postgres_changes", { event: "*", schema: "public", table: "food_items" }, callback)
    .subscribe(realtimeStatusLogger("food"));

  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeToClubs(callback) {
  const channel = supabase
    .channel("public:clubs_realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "clubs" }, callback)
    .on("postgres_changes", { event: "*", schema: "public", table: "club_members" }, callback)
    .subscribe(realtimeStatusLogger("clubs"));

  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeToMarketplace(callback) {
  const channel = supabase
    .channel("public:marketplace_realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "marketplace_listings" }, callback)
    .subscribe(realtimeStatusLogger("marketplace"));

  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeToLostFound(callback) {
  const channel = supabase
    .channel("public:lost_found_realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "lost_found_items" }, callback)
    .subscribe(realtimeStatusLogger("lost_found"));

  return () => {
    supabase.removeChannel(channel);
  };
}

