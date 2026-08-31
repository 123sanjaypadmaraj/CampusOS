// Edge Function: send-push
//
// The real delivery channel behind push_subscriptions/notification_preferences
// .channel_push (both have existed since the 0010 migration with nothing
// ever sending through them). Called by the `notifications_dispatch_push`
// DB trigger (see supabase/migrations/20260814004500_push_notification_dispatch.sql)
// via pg_net immediately after create_notification() inserts a row -- NOT
// meant to be called from a signed-in browser, so it verifies a shared
// secret header instead of a Supabase JWT (deploy with --no-verify-jwt).
//
// One notification can fan out across three gateways depending on each
// row's push_subscriptions.platform (20260831001200 migration): Web Push
// for browsers/PWA installs, FCM for the Android app, APNs for the iOS
// app. Each gateway is independently optional -- a platform with no
// subscriptions, or no secrets configured for it yet, is skipped for that
// platform only, it never fails the whole dispatch. Today only Web Push
// has real subscribers (the native apps have no push registrations until
// someone opens the installed app and grants permission), so until FCM/
// APNs secrets are set below, this behaves exactly as it did before native
// existed.
//
// Required secrets (set via `supabase secrets set`):
//   PUSH_DISPATCH_SECRET   -- must match the `push_dispatch_secret` Vault entry
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...)  -- Web Push
//   FCM_SERVICE_ACCOUNT_JSON  -- Android; the full JSON key of a Firebase
//     service account with "Firebase Cloud Messaging API" access (Firebase
//     console -> Project settings -> Service accounts -> Generate new
//     private key), pasted in as one secret value. Not set yet -- the
//     Android app has no Firebase project behind it.
//   APNS_AUTH_KEY, APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID  -- iOS; a .p8
//     APNs Auth Key from the Apple Developer portal (Certificates,
//     Identifiers & Profiles -> Keys), its Key ID, the Apple Developer
//     Team ID, and the app's bundle id (in.edu.nhce.campusos). Not set yet
//     -- iOS has never been built (needs a Mac), so there's no APNs
//     capability to enable regardless.
//   APNS_SANDBOX  -- optional, "true" to use APNs' sandbox host (TestFlight/
//     debug builds) instead of production. Defaults to production.
// Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/* =========================================================================
   Shared JWT signing helpers (FCM's OAuth bearer + APNs' provider token are
   both "sign a JWT with an RSA/EC private key" -- no npm dependency needed,
   Deno's Web Crypto covers both algorithms).
========================================================================= */

function base64UrlFromBytes(bytes: Uint8Array): string {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlFromString(s: string): string {
  return base64UrlFromBytes(new TextEncoder().encode(s));
}

function pemToBytes(pem: string): ArrayBuffer {
  // Secrets are pasted with real newlines or with literal "\n" depending on
  // how they were set -- normalize both before stripping the PEM headers.
  const normalized = pem.replace(/\\n/g, "\n");
  const b64 = normalized
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const raw = atob(b64);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

/* =========================================================================
   FCM (Android) -- OAuth2 JWT-bearer flow to get a short-lived access
   token, then the HTTP v1 send API. Cached at module scope since a warm
   Edge Function instance can serve many notifications before the token
   (1hr lifetime) expires.
========================================================================= */

let fcmTokenCache: { token: string; expiresAt: number } | null = null;

async function getFcmAccessToken(serviceAccountJson: string): Promise<{ accessToken: string; projectId: string }> {
  const sa = JSON.parse(serviceAccountJson);
  const now = Math.floor(Date.now() / 1000);

  if (fcmTokenCache && fcmTokenCache.expiresAt - 60 > now) {
    return { accessToken: fcmTokenCache.token, projectId: sa.project_id };
  }

  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${base64UrlFromString(JSON.stringify(header))}.${base64UrlFromString(JSON.stringify(claims))}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  const assertion = `${signingInput}.${base64UrlFromBytes(new Uint8Array(signature))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(`FCM OAuth token request failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  fcmTokenCache = { token: body.access_token, expiresAt: now + (body.expires_in || 3600) };
  return { accessToken: fcmTokenCache.token, projectId: sa.project_id };
}

async function sendFcm(
  accessToken: string,
  projectId: string,
  deviceToken: string,
  payload: { title: string; body: string; actionType?: string; actionId?: string; notificationId: string }
): Promise<{ ok: boolean; shouldPrune: boolean; error?: string }> {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token: deviceToken,
        notification: { title: payload.title, body: payload.body },
        data: {
          actionType: payload.actionType || "",
          actionId: payload.actionId || "",
          notificationId: payload.notificationId,
        },
      },
    }),
  });
  if (res.ok) return { ok: true, shouldPrune: false };

  const errorBody = await res.json().catch(() => ({}));
  const status = errorBody?.error?.status;
  // Token no longer valid on Google's end (app uninstalled, token rotated) --
  // same cleanup role the 404/410 branch plays for Web Push below.
  const shouldPrune = status === "UNREGISTERED" || status === "NOT_FOUND" || res.status === 404;
  return { ok: false, shouldPrune, error: `FCM ${res.status} ${status || ""}` };
}

/* =========================================================================
   APNs (iOS) -- provider JWT (ES256, ~valid 1hr, cached and reused the
   same way Apple's own docs recommend), sent as a bearer token per request
   over HTTP/2 (Deno's fetch negotiates h2 automatically over TLS).
========================================================================= */

let apnsJwtCache: { token: string; issuedAt: number } | null = null;

async function getApnsJwt(keyId: string, teamId: string, authKeyPem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (apnsJwtCache && now - apnsJwtCache.issuedAt < 50 * 60) {
    return apnsJwtCache.token;
  }

  const header = { alg: "ES256", kid: keyId };
  const claims = { iss: teamId, iat: now };
  const signingInput = `${base64UrlFromString(JSON.stringify(header))}.${base64UrlFromString(JSON.stringify(claims))}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(authKeyPem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(signingInput));
  const token = `${signingInput}.${base64UrlFromBytes(new Uint8Array(signature))}`;
  apnsJwtCache = { token, issuedAt: now };
  return token;
}

async function sendApns(
  jwt: string,
  bundleId: string,
  sandbox: boolean,
  deviceToken: string,
  payload: { title: string; body: string; actionType?: string; actionId?: string; notificationId: string }
): Promise<{ ok: boolean; shouldPrune: boolean; error?: string }> {
  const host = sandbox ? "api.sandbox.push.apple.com" : "api.push.apple.com";
  const res = await fetch(`https://${host}/3/device/${deviceToken}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${jwt}`,
      "apns-topic": bundleId,
      "apns-push-type": "alert",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      aps: { alert: { title: payload.title, body: payload.body }, sound: "default" },
      actionType: payload.actionType || null,
      actionId: payload.actionId || null,
      notificationId: payload.notificationId,
    }),
  });
  if (res.ok) return { ok: true, shouldPrune: false };

  const errorBody = await res.json().catch(() => ({}));
  // 410 = APNs itself says the token is gone; 400/BadDeviceToken = it was
  // never valid (wrong environment, malformed, etc). Both mean "stop
  // retrying this row."
  const shouldPrune = res.status === 410 || errorBody?.reason === "BadDeviceToken";
  return { ok: false, shouldPrune, error: `APNs ${res.status} ${errorBody?.reason || ""}` };
}

/* =========================================================================
   Main handler
========================================================================= */

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json({ code: "METHOD_NOT_ALLOWED", message: "POST only" }, 405);
  }

  const dispatchSecret = Deno.env.get("PUSH_DISPATCH_SECRET");
  const provided = req.headers.get("x-push-secret");
  if (!dispatchSecret || provided !== dispatchSecret) {
    return json({ code: "UNAUTHORIZED" }, 401);
  }

  let notificationId: string | undefined;
  let deliveryId: string | undefined;
  try {
    const body = await req.json();
    notificationId = body?.notification_id;
    deliveryId = body?.delivery_id;
  } catch {
    return json({ code: "BAD_REQUEST", message: "Invalid JSON body" }, 400);
  }
  if (!notificationId) {
    return json({ code: "BAD_REQUEST", message: "notification_id is required" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  // Delivery tracking (20260817001300/1600) -- best-effort, never lets a
  // tracking failure mask the real push result.
  const reportResult = async (status: "sent" | "failed" | "skipped", error?: string) => {
    if (!deliveryId) return;
    await admin.rpc("mark_delivery_result", { p_delivery_id: deliveryId, p_status: status, p_error: error ?? null }).catch(() => {});
  };

  const { data: notif, error: notifError } = await admin
    .from("notifications")
    .select("id, user_id, type, title, body, action_type, action_id")
    .eq("id", notificationId)
    .single();

  if (notifError || !notif) {
    await reportResult("failed", "Notification not found");
    return json({ code: "NOT_FOUND", message: "Notification not found" }, 404);
  }

  // create_notification() already applies the per-category preference gate
  // before this trigger ever fires, but channel_push is a separate on/off
  // switch layered on top of that (a user can want the category but not
  // want it as a push), so it's re-checked here.
  const { data: pref } = await admin
    .from("notification_preferences")
    .select("channel_push")
    .eq("user_id", notif.user_id)
    .maybeSingle();

  if (pref && pref.channel_push === false) {
    await reportResult("skipped", "channel_push disabled");
    return json({ code: "SKIPPED_PREFERENCE" }, 200);
  }

  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, keys, platform")
    .eq("user_id", notif.user_id);

  if (!subs?.length) {
    await reportResult("skipped", "no push subscriptions on this account");
    return json({ code: "NO_SUBSCRIPTIONS" }, 200);
  }

  const payload = {
    title: notif.title,
    body: notif.body || "",
    actionType: notif.action_type,
    actionId: notif.action_id,
    notificationId: notif.id,
  };

  const webSubs = subs.filter((s) => (s.platform || "web") === "web");
  const androidSubs = subs.filter((s) => s.platform === "android");
  const iosSubs = subs.filter((s) => s.platform === "ios");

  let sent = 0;
  let notConfiguredCount = 0;
  const stalePrunes: Promise<unknown>[] = [];
  const gatewayErrors: string[] = [];

  // ---- Web Push ----
  if (webSubs.length) {
    const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@campusos.app";

    if (!vapidPublic || !vapidPrivate) {
      notConfiguredCount += webSubs.length;
      gatewayErrors.push(`web: VAPID keys not configured (${webSubs.length} subscription(s) skipped)`);
    } else {
      webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
      const webPayload = JSON.stringify(payload);

      await Promise.allSettled(
        webSubs.map(async (sub) => {
          try {
            await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, webPayload);
            sent += 1;
          } catch (err) {
            const statusCode = (err as { statusCode?: number })?.statusCode;
            if (statusCode === 404 || statusCode === 410) {
              stalePrunes.push(admin.from("push_subscriptions").delete().eq("id", sub.id));
            } else {
              console.error("send-push: web delivery failed", statusCode, err);
            }
          }
        })
      );
    }
  }

  // ---- Android (FCM) ----
  if (androidSubs.length) {
    const serviceAccountJson = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON");
    if (!serviceAccountJson) {
      notConfiguredCount += androidSubs.length;
      gatewayErrors.push(`android: FCM_SERVICE_ACCOUNT_JSON not configured (${androidSubs.length} subscription(s) skipped)`);
    } else {
      try {
        const { accessToken, projectId } = await getFcmAccessToken(serviceAccountJson);
        await Promise.allSettled(
          androidSubs.map(async (sub) => {
            const result = await sendFcm(accessToken, projectId, sub.endpoint, payload);
            if (result.ok) {
              sent += 1;
            } else {
              if (result.shouldPrune) stalePrunes.push(admin.from("push_subscriptions").delete().eq("id", sub.id));
              console.error("send-push: android delivery failed", result.error);
            }
          })
        );
      } catch (err) {
        console.error("send-push: FCM auth/send failed", err);
        gatewayErrors.push(`android: ${(err as Error).message}`);
      }
    }
  }

  // ---- iOS (APNs) ----
  if (iosSubs.length) {
    const authKey = Deno.env.get("APNS_AUTH_KEY");
    const keyId = Deno.env.get("APNS_KEY_ID");
    const teamId = Deno.env.get("APNS_TEAM_ID");
    const bundleId = Deno.env.get("APNS_BUNDLE_ID");
    const sandbox = Deno.env.get("APNS_SANDBOX") === "true";

    if (!authKey || !keyId || !teamId || !bundleId) {
      notConfiguredCount += iosSubs.length;
      gatewayErrors.push(`ios: APNs secrets not configured (${iosSubs.length} subscription(s) skipped)`);
    } else {
      try {
        const jwt = await getApnsJwt(keyId, teamId, authKey);
        await Promise.allSettled(
          iosSubs.map(async (sub) => {
            const result = await sendApns(jwt, bundleId, sandbox, sub.endpoint, payload);
            if (result.ok) {
              sent += 1;
            } else {
              if (result.shouldPrune) stalePrunes.push(admin.from("push_subscriptions").delete().eq("id", sub.id));
              console.error("send-push: ios delivery failed", result.error);
            }
          })
        );
      } catch (err) {
        console.error("send-push: APNs auth/send failed", err);
        gatewayErrors.push(`ios: ${(err as Error).message}`);
      }
    }
  }

  await Promise.allSettled(stalePrunes);

  if (sent > 0) {
    await reportResult("sent", gatewayErrors.length ? gatewayErrors.join("; ") : undefined);
  } else if (notConfiguredCount === subs.length) {
    // Every subscription belonged to a platform with no gateway configured
    // yet -- same "not ready to deliver" signal the old VAPID-only check
    // gave, just gateway-aware now.
    await reportResult("skipped", gatewayErrors.join("; "));
    return json({ code: "GATEWAY_NOT_CONFIGURED", details: gatewayErrors, sent, total: subs.length }, 503);
  } else {
    await reportResult("failed", `delivery failed to all ${subs.length} subscription(s)${gatewayErrors.length ? `; ${gatewayErrors.join("; ")}` : ""}`);
  }

  return json({ code: "OK", sent, total: subs.length, gatewayErrors }, 200);
});
