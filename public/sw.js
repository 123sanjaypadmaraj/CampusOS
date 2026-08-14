// CampusOS push notification service worker.
// Minimal by design: receive a push payload from send-push (see
// supabase/functions/send-push/index.ts), show it, and route a tap back
// into the app. No offline caching / asset precaching here -- Vite's build
// output isn't versioned by this file, so this intentionally does not try
// to be an app-shell cache (that's a separate, bigger project).

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = { title: "CampusOS", body: "" };
  try {
    if (event.data) payload = event.data.json();
  } catch {
    payload = { title: "CampusOS", body: event.data ? event.data.text() : "" };
  }

  const { title, body, actionType, actionId, notificationId } = payload;

  event.waitUntil(
    self.registration.showNotification(title || "CampusOS", {
      body: body || "",
      icon: "/favicon.png",
      badge: "/favicon.png",
      tag: notificationId || undefined,
      data: { actionType, actionId, notificationId },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const { actionType, actionId } = event.notification.data || {};
  // The app itself resolves actionType/actionId into a tab once open (see
  // NOTIFICATION_ACTION_ROUTES in src/App.jsx) -- the service worker just
  // needs to get a window open/focused with that hint in the URL.
  const targetUrl =
    actionType && actionId ? `/?notif_action=${actionType}&notif_id=${actionId}` : "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.postMessage({ type: "notification-click", actionType, actionId });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
