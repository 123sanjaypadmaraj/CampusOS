import { supabase } from "../lib/supabase";


export async function getNotifications(
  userId
) {
  if (!userId) {
    return [];
  }

  const {
    data,
    error
  } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", {
      ascending: false
    });

  if (error) throw error;

  return data || [];
}


export async function markNotificationRead(
  notificationId
) {
  const {
    error
  } = await supabase
    .from("notifications")
    .update({
      read: true
    })
    .eq("id", notificationId);

  if (error) throw error;
}


export async function markAllNotificationsRead(
  userId
) {
  const {
    error
  } = await supabase
    .from("notifications")
    .update({
      read: true
    })
    .eq("user_id", userId);

  if (error) throw error;
}