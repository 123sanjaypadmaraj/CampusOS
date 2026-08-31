-- =============================================================================
-- Native push notifications: let push_subscriptions hold an FCM (Android) or
-- APNs (iOS) device token alongside the existing Web Push subscriptions.
--
-- push_subscriptions has only ever stored Web Push subscriptions (a URL
-- `endpoint` + a `keys` {p256dh, auth} pair) -- see the 0010 migration and
-- src/services/pushService.js. A native app has no such thing: Capacitor's
-- PushNotifications plugin hands back a single opaque device token instead.
-- Rather than a second table, this reuses the same row shape: `endpoint`
-- becomes a generic subscription identifier (a Web Push URL for platform
-- 'web', or the raw FCM/APNs token for 'android'/'ios'), and `keys` -- which
-- native subscriptions have no equivalent of -- becomes nullable. send-push
-- (supabase/functions/send-push) reads `platform` to decide whether to
-- deliver via web-push, FCM, or APNs.
-- =============================================================================

alter table public.push_subscriptions
  add column if not exists platform text not null default 'web';

alter table public.push_subscriptions
  drop constraint if exists push_subscriptions_platform_check;
alter table public.push_subscriptions
  add constraint push_subscriptions_platform_check check (platform in ('web', 'ios', 'android'));

-- Native rows have no {p256dh, auth} pair -- only Web Push does.
alter table public.push_subscriptions
  alter column keys drop not null;

comment on column public.push_subscriptions.endpoint is
  'Web Push subscription URL for platform=web; the raw FCM/APNs device token for platform=android/ios.';
comment on column public.push_subscriptions.keys is
  'Web Push {p256dh, auth} key pair. Always null for platform=android/ios -- native tokens carry no equivalent.';
comment on column public.push_subscriptions.platform is
  'Which delivery gateway this row is sent through: web (Web Push/VAPID), android (FCM), ios (APNs).';
