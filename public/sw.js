// CampusOS service worker: push notifications + app-shell offline caching
// (doc §9 "Offline Mode"). Two independent jobs in one file since a page
// can only have one active service worker -- receive a push payload from
// send-push (see supabase/functions/send-push/index.ts) and show it/route
// a tap back into the app, and separately, cache the app shell (the HTML
// document + built JS/CSS) so CampusOS can still boot with no connection
// at all. This is registered unconditionally on every visit now (see the
// mount effect in src/App.jsx) -- it used to only get registered lazily
// when someone opted into push.
//
// Not a build-time precache manifest: Vite fingerprints every JS/CSS
// filename per build, so there's nothing to list up front. Instead this is
// runtime caching -- whatever same-origin GET this worker actually sees
// gets cached the first time, then served cache-first (with a background
// refresh) afterward. Live app *data* (profile/events/menus/notifications/
// saved events) is cached separately, client-side, in
// src/utils/offlineCache.js -- this file only ever sees same-origin
// document/asset requests, never the Supabase API calls those go over.
const SHELL_CACHE = "campusos-shell-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Drop any previous version's cache the moment SHELL_CACHE's own
      // name is bumped (deliberately manual, not per-deploy -- runtime
      // caching already self-heals into the latest build on every fetch).
      caches
        .keys()
        .then((keys) => Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key)))),
    ])
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    // App-shell fallback: any client-side route (e.g. a refresh on
    // /events while offline) still boots off whatever document this
    // worker last saw succeed, since this is a single-page app.
    event.respondWith(
      fetch(request)
        .then((response) => {
          caches.open(SHELL_CACHE).then((cache) => cache.put("/", response.clone()));
          return response;
        })
        .catch(() => caches.open(SHELL_CACHE).then((cache) => cache.match("/")))
    );
    return;
  }

  // Built JS/CSS/static assets: stale-while-revalidate -- serve the cached
  // copy instantly if there is one (and refresh it in the background), or
  // fall back to a network fetch for anything not seen before.
  event.respondWith(
    caches.open(SHELL_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => null);

      if (cached) return cached;
      return (await network) || Response.error();
    })
  );
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
