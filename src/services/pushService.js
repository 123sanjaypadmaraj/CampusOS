import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
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
|
| Native (iOS/Android) uses a completely different registration path --
| there's no service worker or PushManager inside a Capacitor WebView --
| but writes into the exact same push_subscriptions row shape (see the
| 20260831001200 migration), with `platform` telling send-push which
| gateway (Web Push / FCM / APNs) to deliver through. Everything below
| branches on IS_NATIVE at the top of each exported function rather than
| having two parallel copies of subscribe/unsubscribe/status.
*/

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;
const IS_NATIVE = Capacitor.isNativePlatform();
const PLATFORM = Capacitor.getPlatform();

// Set once a native registration actually succeeds, cleared on unsubscribe --
// there's no OS-level "am I subscribed" query on native the way
// pushManager.getSubscription() gives us on web, so this is the same kind
// of local, best-effort signal getPushSubscriptionStatus() already relies
// on for web (a browser subscription object is local state too, not a
// server round-trip).
const NATIVE_PUSH_TOKEN_KEY = "campusos-native-push-token";

export function isPushSupported() {
  if (IS_NATIVE) return true; // Android/iOS always have a native push channel available
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

  if (IS_NATIVE) {
    const { receive } = await PushNotifications.checkPermissions();
    if (receive === "denied") return "denied";
    return localStorage.getItem(NATIVE_PUSH_TOKEN_KEY) ? "subscribed" : "not-subscribed";
  }

  if (Notification.permission === "denied") return "denied";

  const registration = await navigator.serviceWorker.getRegistration();
  const existing = await registration?.pushManager.getSubscription();
  return existing ? "subscribed" : "not-subscribed";
}

async function subscribeNativePush(userId) {
  let { receive } = await PushNotifications.checkPermissions();
  if (receive === "prompt" || receive === "prompt-with-rationale") {
    ({ receive } = await PushNotifications.requestPermissions());
  }
  if (receive !== "granted") {
    throw new Error("Notification permission was not granted");
  }

  const token = await new Promise((resolve, reject) => {
    let registrationHandle;
    let errorHandle;
    const cleanup = () => {
      registrationHandle?.remove();
      errorHandle?.remove();
    };
    PushNotifications.addListener("registration", (result) => {
      cleanup();
      resolve(result.value);
    }).then((handle) => {
      registrationHandle = handle;
    });
    PushNotifications.addListener("registrationError", (err) => {
      cleanup();
      reject(new Error(err?.error || "Native push registration failed"));
    }).then((handle) => {
      errorHandle = handle;
    });
    PushNotifications.register();
  });

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: token,
      keys: null,
      platform: PLATFORM,
      device_label: `CampusOS ${PLATFORM} app`,
    },
    { onConflict: "endpoint" }
  );
  if (error) throw error;

  localStorage.setItem(NATIVE_PUSH_TOKEN_KEY, token);
  return token;
}

export async function subscribeToPush(userId) {
  if (!userId) throw new Error("Sign in required");
  if (!isPushSupported()) throw new Error("Push notifications are not supported on this device/browser");

  let result;
  if (IS_NATIVE) {
    result = await subscribeNativePush(userId);
  } else {
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
    result = subscription;
  }

  await supabase
    .from("notification_preferences")
    .upsert({ user_id: userId, channel_push: true }, { onConflict: "user_id" });

  return result;
}

// The per-category gate create_notification() has always enforced
// server-side (0010/0046) -- messages/food/events/clubs/community/services/
// marketplace/announcements each individually toggleable -- but nothing in
// the UI ever read or wrote these columns, so a student had no way to turn
// any of them off short of disabling push entirely at the OS/browser level.
const NOTIFICATION_CATEGORY_DEFAULTS = {
  messages: true, events: true, clubs: true, community: true,
  services: true, marketplace: true, food: true, announcements: true,
};

// Email delivery is real as of 20260817002000 (Resend) -- default OFF
// (opt-in), see that migration's notes. SMS delivery is real as of the same
// migration too (Fast2SMS, see supabase/functions/send-sms) -- also default
// OFF except for emergency alerts, which bypass this toggle server-side
// (20260817002200's create_notification() fix) the same way they already
// bypass the category gate.
const NOTIFICATION_CHANNEL_DEFAULTS = {
  channel_push: true, channel_email: false, channel_sms: false,
  quiet_hours_enabled: false, quiet_hours_start: "22:00:00", quiet_hours_end: "07:00:00",
};

export async function getNotificationChannelPreferences(userId) {
  if (!userId) return { ...NOTIFICATION_CHANNEL_DEFAULTS };
  const { data, error } = await supabase
    .from("notification_preferences")
    .select("channel_push, channel_email, channel_sms, quiet_hours_enabled, quiet_hours_start, quiet_hours_end")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data || { ...NOTIFICATION_CHANNEL_DEFAULTS };
}

export async function setNotificationChannelPreference(userId, field, value) {
  if (!userId) throw new Error("Sign in required");
  const { error } = await supabase
    .from("notification_preferences")
    .upsert({ user_id: userId, [field]: value }, { onConflict: "user_id" });
  if (error) throw error;
}

export async function setQuietHours(userId, { enabled, start, end }) {
  if (!userId) throw new Error("Sign in required");
  const patch = { user_id: userId, quiet_hours_enabled: enabled };
  if (start) patch.quiet_hours_start = start;
  if (end) patch.quiet_hours_end = end;
  const { error } = await supabase.from("notification_preferences").upsert(patch, { onConflict: "user_id" });
  if (error) throw error;
}

export async function getNotificationCategoryPreferences(userId) {
  if (!userId) return { ...NOTIFICATION_CATEGORY_DEFAULTS };
  const { data, error } = await supabase
    .from("notification_preferences")
    .select("messages, events, clubs, community, services, marketplace, food, announcements")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  // No row yet means every category is unrestricted -- same fallback
  // create_notification() itself uses ("v_pref is not null" gate).
  return data || { ...NOTIFICATION_CATEGORY_DEFAULTS };
}

export async function setNotificationCategoryPreference(userId, category, enabled) {
  if (!userId) throw new Error("Sign in required");
  const { error } = await supabase
    .from("notification_preferences")
    .upsert({ user_id: userId, [category]: enabled }, { onConflict: "user_id" });
  if (error) throw error;
}

export async function unsubscribeFromPush(userId) {
  if (!isPushSupported()) return;

  if (IS_NATIVE) {
    // Capacitor's PushNotifications plugin has no "unregister" call that
    // revokes the OS-level token the way pushManager.subscribe().unsubscribe()
    // does on web -- the token stays valid at the OS level. Deleting our row
    // is what actually stops delivery (send-push only ever reads
    // push_subscriptions), which is the part that matters here.
    const token = localStorage.getItem(NATIVE_PUSH_TOKEN_KEY);
    if (token) {
      await supabase.from("push_subscriptions").delete().eq("endpoint", token);
      localStorage.removeItem(NATIVE_PUSH_TOKEN_KEY);
    }
  } else {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();

    if (subscription) {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe().catch(() => {});
      if (endpoint) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
      }
    }
  }

  if (userId) {
    await supabase
      .from("notification_preferences")
      .upsert({ user_id: userId, channel_push: false }, { onConflict: "user_id" });
  }
}

// Wires the two Capacitor push-notification events an installed app needs:
// a foreground-received push (Android shows nothing automatically while the
// app is open, unlike a backgrounded push; iOS honors the notification's
// own presentation options) and a tapped push, which is the native
// equivalent of sw.js's `notificationclick` -> postMessage({type:
// "notification-click"}) relay that src/App.jsx already listens for on web.
// Returns the unsubscribe function; no-ops entirely on web. Call once from
// a mount effect, same as the web message-listener effect it mirrors.
export function registerNativePushListeners({ onNotificationTapped, notify } = {}) {
  if (!IS_NATIVE) return () => {};

  const handles = [];

  PushNotifications.addListener("pushNotificationReceived", (notification) => {
    // Foreground delivery: there's no system banner to tap, so surface it
    // as an in-app toast instead of silently dropping it.
    if (notify) notify(notification.title || notification.body || "New notification");
  }).then((h) => handles.push(h));

  PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    const data = action.notification?.data || {};
    if (onNotificationTapped) onNotificationTapped(data.actionType, data.actionId);
  }).then((h) => handles.push(h));

  return () => {
    handles.forEach((h) => h.remove());
  };
}
