/**
 * NOTIFICATIONS
 *
 * In-app notification list, read/unread state, and delivery preferences.
 */

import { supabase } from "../../lib/supabase";
import { cacheRead, cacheWrite } from "../../utils/offlineCache";
import { formatRelativeTime, throwIfError } from "./_shared.js";

export async function getUserNotifications(
  userId,
  { limit = 30, cursor = null } = {}
) {
  if (!userId) return [];

  // Doc §9 "Offline Mode": only cache/serve the first page -- same
  // reasoning as getCampusEvents' cursor guard above.
  const cacheKey = cursor ? null : `notifications:${userId}`;

  try {
    let query = supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", {
        ascending: false,
      })
      .limit(limit);

    if (cursor) {
      query = query.lt("created_at", cursor);
    }

    const {
      data,
      error,
    } = await query;

    if (error) {
      console.warn("getUserNotifications warning:", error.message);
      if (cacheKey) {
        const cached = await cacheRead(cacheKey);
        if (cached) return cached.data;
      }
      return [];
    }

    const notifications = (data || []).map(
      (notification) => ({
        ...notification,
        time:
          formatRelativeTime(
            notification.created_at
          ),
        unread:
          !notification.read,
      })
    );

    if (cacheKey) cacheWrite(cacheKey, notifications);
    return notifications;
  } catch (err) {
    console.warn("getUserNotifications catch:", err);
    if (cacheKey) {
      const cached = await cacheRead(cacheKey);
      if (cached) return cached.data;
    }
    return [];
  }
}


export async function markNotificationRead(
  notificationId,
  userId
) {
  if (!userId) return;

  const {
    error,
  } = await supabase
    .from("notifications")
    .update({
      read: true,
    })
    .eq("id", notificationId)
    .eq("user_id", userId);

  throwIfError(error);
}


export async function markAllNotificationsRead(
  userId
) {
  if (!userId) return;

  const {
    error,
  } = await supabase
    .from("notifications")
    .update({
      read: true,
    })
    .eq("user_id", userId);

  throwIfError(error);
}


