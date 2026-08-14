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
// Required secrets (set via `supabase secrets set`):
//   PUSH_DISPATCH_SECRET  -- must match the `push_dispatch_secret` Vault entry
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...)
// Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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
  try {
    const body = await req.json();
    notificationId = body?.notification_id;
  } catch {
    return json({ code: "BAD_REQUEST", message: "Invalid JSON body" }, 400);
  }
  if (!notificationId) {
    return json({ code: "BAD_REQUEST", message: "notification_id is required" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  const { data: notif, error: notifError } = await admin
    .from("notifications")
    .select("id, user_id, type, title, body, action_type, action_id")
    .eq("id", notificationId)
    .single();

  if (notifError || !notif) {
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
    return json({ code: "SKIPPED_PREFERENCE" }, 200);
  }

  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, keys")
    .eq("user_id", notif.user_id);

  if (!subs?.length) {
    return json({ code: "NO_SUBSCRIPTIONS" }, 200);
  }

  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@campusos.app";

  if (!vapidPublic || !vapidPrivate) {
    console.error("VAPID keys are not configured -- push cannot be delivered.");
    return json({ code: "GATEWAY_NOT_CONFIGURED" }, 503);
  }

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  const payload = JSON.stringify({
    title: notif.title,
    body: notif.body || "",
    actionType: notif.action_type,
    actionId: notif.action_id,
    notificationId: notif.id,
  });

  let sent = 0;
  const stalePrunes: Promise<unknown>[] = [];

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          payload
        );
        sent += 1;
      } catch (err) {
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // Subscription is gone on the browser's end (uninstalled,
          // permission revoked, etc.) -- clean it up so future
          // notifications don't keep retrying a dead endpoint.
          stalePrunes.push(
            admin.from("push_subscriptions").delete().eq("id", sub.id)
          );
        } else {
          console.error("send-push: delivery failed", statusCode, err);
        }
      }
    })
  );

  await Promise.allSettled(stalePrunes);

  return json({ code: "OK", sent, total: subs.length }, 200);
});
