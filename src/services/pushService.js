import { supabase } from "../lib/supabase";

/*
|--------------------------------------------------------------------------
| Push notifications -- the real delivery channel
|--------------------------------------------------------------------------
| push_subscriptions / notification_preferences.channel_push have existed
| since the 0010 migration; this is what actually writes/removes a
| subscription row and registers the service worker that receives the
| push. Delivery itself is server-side: create_notification() -> a DB
| trigger -> the send-push Edge Function (see
| supabase/migrations/20260814004500_push_notification_dispatch.sql).
*/

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

export function isPushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.register("/sw.js");
}

export async function getPushSubscriptionStatus() {
  if (!isPushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";

  const registration = await navigator.serviceWorker.getRegistration();
  const existing = await registration?.pushManager.getSubscription();
  return existing ? "subscribed" : "not-subscribed";
}

export async function subscribeToPush(userId) {
  if (!userId) throw new Error("Sign in required");
  if (!isPushSupported()) throw new Error("Push notifications are not supported on this device/browser");
  if (!VAPID_PUBLIC_KEY) throw new Error("Push is not configured for this deployment yet");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission was not granted");
  }

  const registration = (await navigator.serviceWorker.getRegistration()) || (await registerServiceWorker());
  await navigator.serviceWorker.ready;

  const subscription =
    (await registration.pushManager.getSubscription()) ||
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    }));

  const json = subscription.toJSON();

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      keys: json.keys,
      device_label: navigator.userAgent.slice(0, 200),
    },
    { onConflict: "endpoint" }
  );

  if (error) throw error;

  await supabase
    .from("notification_preferences")
    .upsert({ user_id: userId, channel_push: true }, { onConflict: "user_id" });

  return subscription;
}

export async function unsubscribeFromPush(userId) {
  if (!isPushSupported()) return;

  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();

  if (subscription) {
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe().catch(() => {});
    if (endpoint) {
      await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
    }
  }

  if (userId) {
    await supabase
      .from("notification_preferences")
      .upsert({ user_id: userId, channel_push: false }, { onConflict: "user_id" });
  }
}
