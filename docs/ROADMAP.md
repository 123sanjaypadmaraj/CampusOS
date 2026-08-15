# Roadmap — what this hardening pass covered vs. deferred

The source document ("CampusOS — Complete Production Implementation Plan")
describes 114 sections covering a full multi-tenant campus super-app:
student-facing modules, vendor/admin/facilities CMSs, payments, RBAC,
messaging, an AI assistant, IoT/delivery robots, a multi-app frontend split,
CI/CD, and disaster recovery. That's a multi-month, multi-engineer build.

This pass scoped to **"harden and ship the existing modules"** — see the
session's scoping decision below — rather than build the full plan. This
document is the honest map of what landed vs. what's still ahead, organized
by the source doc's section numbers so nothing is silently dropped.

## Scope decision made at the start of this pass

1. **Harden & ship existing modules** (not a breadth-pass across all 114
   sections, not a deep-dive on a hand-picked few).
2. **Skip live deployment** this round — no Vercel/Cloudflare account was
   connected, and payments/hosting need credentials only the project owner
   has.
3. **Keep the single existing Supabase project** rather than splitting into
   dev/staging/prod (doc §94) — noted as a near-term follow-up below.

## Done ✅ (by doc section)

| Doc § | What | Where |
|---|---|---|
| §5, §60 | Sensitive logic moved server-side; RLS actually enforced | `supabase/migrations/0011_rls_policies.sql` |
| §6-7 | Magic-link auth with domain allowlist; `student_verifications` table exists (not yet wired to a verification UI) | `src/App.jsx` LoginModal; `0001_extensions_and_core.sql` |
| §8 | Real RBAC (roles/permissions/role_permissions/user_roles) | `0002_rbac.sql` |
| §12-15 | Order state machine, idempotent creation, secure pickup tokens | `0003_food_ordering.sql` |
| §24-27 | Payment ledger, Razorpay test-mode integration, webhook verification, refund tables/RPCs | `0004_payments.sql`, `supabase/functions/` |
| §35 | Booking double-booking prevented via Postgres exclusion constraint | `0007_services_bookings.sql` |
| §38 | Event capacity + waitlist, QR check-in tickets | `0005_events_clubs.sql` |
| §40-41 | Moderation actions, content reports, blocked_users, rate-limited posting | `0006_community.sql`, `0016_rate_limiting_triggers.sql` |
| §42 | People directory never exposes email/phone (`search_people`/`get_profile_snippets` RPCs) | `0012_people_directory_and_indexes.sql` |
| §52-53 | Announcements + emergency alerts (admin/super_admin gated, audited) | `0010_notifications_map_ratelimit.sql` |
| §59, §103 | Central `audit_logs` with actor/entity/old/new/reason, written by every privileged RPC | `0002_rbac.sql` |
| §61 | Indexes on the fields the doc calls out | throughout `supabase/migrations/` |
| §63 | Idempotency keys on order creation | `0003_food_ordering.sql` |
| §64 | Rate limiting (DB-level, via triggers + RPC-embedded checks) | `0016_rate_limiting_triggers.sql` |
| §65-66 | Storage buckets + RLS policies (previously didn't exist at all) | `0015_storage_buckets.sql` |
| §81-82 | Standardized `{code, message}` errors; loading/empty/error/offline states on Food/Campus/Events/Home | `mvpService.js` `throwIfError`, `src/components/ui/States.jsx` |
| §85-86 | Expanded unit tests; network-mocked critical order-flow E2E test | `src/services/mvpService.test.js`, `tests/critical-order-flow.spec.js` |
| §90 | Cursor pagination (posts/orders/notifications/marketplace/lost&found/events/people) | `mvpService.js` |
| §92-93 | Hardcoded dev-login backdoor + committed password found and removed; rotation documented | `SECURITY.md` |
| §95 | CI: lint → typecheck → unit → build → E2E | `.github/workflows/ci.yml` |
| §76-78 | Multi-app split — done as **one app, route-branched**, not separate Student/Vendor/Admin/Facilities frontends. Real URL per section (deep links, refresh, browser back/forward all work via the History API); `/admin`, `/vendor`, `/facilities` are reachable URLs but only render for the matching role (unauthorized visitors are bounced to Home and the URL is corrected) — same one Vite build, one Vercel deployment, for every role. | `src/App.jsx` (`ROUTABLE_KEYS`/`pathToKey`/`keyToPath`/`go()`), `vercel.json` (SPA rewrite so a hard refresh on a deep route doesn't 404) |
| §107 | Production profile fields (name/photo/USN/course/department/year/skills/bio/clubs/projects/achievements/privacy/notification settings/security) | `src/App.jsx` `Profile`/`EditProfileModal`, `0001_extensions_and_core.sql` |
| §108 | Dashboard personalization — real recommendation engine (food/events/clubs/opportunities, scored from skills/course/department/year/club membership/order & registration/application history; "recommended people" reuses the existing People-you-may-know feature). Deliberately rule-based, not an LLM call — the doc's own "avoid creepy behavior and provide controls" ask is satisfied with a `profiles.personalization_enabled` toggle (falls back to campus-wide popular/recent, not an empty dashboard) and a per-card "not interested" dismiss, both self-service, no admin involved. | `supabase/migrations/20260815000600_profile_personalization_recommendations.sql`, `src/services/recommendationsService.js`, `RecommendedForYou` in `src/App.jsx` |

## Deferred — infrastructure/access blockers (need the project owner)

These aren't skipped by choice — they need credentials or accounts nobody
but the project owner can provide:

- **§94-98 Live deployment, monitoring, DNS — done as of 2026-08-15**
  (deployment: 2026-08-14). Live at https://campusos-amber.vercel.app
  (production) and https://campusos-staging.vercel.app (staging).
  Monitoring is in-house (no Sentry/PostHog account) — error tracking via
  `error_logs` + Admin CMS's "Errors" tab, uptime via
  `.github/workflows/uptime.yml`. See `docs/DEPLOYMENT.md`.
- **§24 Real (non-test) payment gateway.** Still needs a business KYC'd
  Razorpay/Cashfree account — both environments run Razorpay test mode.
- **§47, §49 Real email/SMS/push providers.** Needs accounts + API keys.
  (Web push notifications *are* real and working, via VAPID — no account
  needed for that specific channel.)
- **§94 dev/staging/prod Supabase separation — done as of 2026-08-15.**
  See `docs/ENVIRONMENTS.md` for the full split (separate projects, separate
  Vercel Preview/Production env vars, `scripts/env-target.mjs` defaulting
  every admin/seed script to staging).

## Deferred — new feature surface (out of "harden existing modules" scope)

The database/RPC layer for most of these is either fully or partially in
place; there's no UI yet:

- **§16-22 Vendor CMS — mostly done as of 2026-08-15.** A real per-canteen
  vendor dashboard exists (`src/features/vendor/VendorDashboard.jsx`):
  menu CRUD, bulk select + actions (availability, archive, move category,
  price ±amount/%, set stock), CSV import/export
  (`supabase/migrations/20260815000800_food_stock_tracking.sql` +
  `foodItemsToCsv`/`parseFoodItemsCsv`/`bulkImportFoodItems` in
  `src/features/vendor/api.js`), and stock/low-stock tracking (opt-in
  `track_stock` per item; stock auto-decrements on a captured payment,
  auto-restores if the vendor rejects/cancels a paid order, and the item
  auto-hides at zero — see the migration's `adjust_stock_for_order()`).
  **Order-ops depth added 2026-08-15**
  (`supabase/migrations/20260815001000_vendor_order_ops.sql`): a
  Kitchen/Pickup/All queue split, order priority (normal/high/urgent),
  vendor-internal notes (never shown to the student), a lightweight staff
  roster + per-order assignment (`canteen_staff` table — a name label, not
  a real login), sound/browser new-order alerts, a working
  confirm-or-resume path out of `CANCEL_REQUESTED` (previously a dead end —
  no button anywhere could move it forward), and refund initiation
  (`request_refund()` existed since the original payments migration but
  nothing ever called it, and it had the same cross-canteen ownership gap
  0024 fixed on `transition_order_status`/`redeem_pickup_token` — fixed the
  same way + a real gateway call via the new `razorpay-refund` Edge
  Function). Still missing: menu variants/add-ons/availability schedules,
  richer dietary tags, real image upload, a stock adjustment audit log,
  inventory reports, and per-vendor staff *sub-accounts* (the new roster is
  a name label for assignment, not a real login per staff member).
- **§28 Campus Store** as a real commerce module (currently static mock data
  in `App.jsx`).
- **§30-33 Print vendor dashboard, facilities dashboard.** `print.manage`/
  `tickets.update` RPCs exist; no staff UI.
- **§39 Club CMS** beyond join/leave/post (roles, applications, documents,
  gallery, analytics).
- **§45-46 Marketplace messaging, seller ratings UI** (tables exist:
  `seller_ratings`; `marketplace_messages` doesn't exist — messaging as a
  whole platform capability, doc §46, was never built).
- **§54-58 Admin dashboard** (user management, vendor onboarding/approval,
  content moderation console). The RPCs (`admin_set_user_role`,
  `moderate_content`, etc.) exist; no admin UI.
- **§67-69 Analytics** (student/vendor/admin dashboards).
- **§70-72 AI assistant / recommendation engine / smart search.**
- **§73-75 Autonomous delivery, IoT.**
- **§79-80 Full PWA** (service worker, offline shell, install prompt, push
  notifications). `useOnlineStatus` + an offline banner exist; no service
  worker/manifest yet.
- **§99-101 Backup/DR runbooks, data retention policies — done as of
  2026-08-15.** Free-tier Supabase has no built-in backups, so a custom
  daily pipeline was built instead of waiting on a paid plan:
  `.github/workflows/backup.yml` + `scripts/backup-retention.mjs`. See
  `docs/DISASTER_RECOVERY.md` and `docs/DATA_RETENTION.md`.
- **§102 Formal privacy policy / terms / consent flows / data export.**
- **§104 Admin approval workflows** for vendor registration, club creation,
  event publishing.
- **§109-112 Opportunities/mentorship, academic announcements integration,
  hostel module, transport module.**
- **§113 Emergency/contact module -- partially done as of 2026-08-15.** A
  verified next-of-kin/emergency-contacts directory per student now exists
  (`supabase/migrations/20260815000700_emergency_contacts.sql`): students
  self-report contacts from Profile, facilities/admin verify them, and a
  responder can pull a student's contacts scoped to a real active SOS alert
  (`get_emergency_contacts_for_alert`, wired into `SosAlertsPanel`'s "View
  emergency contacts"). The doc's other half of §113 -- a directory of
  verified *campus office* contacts (Security/Medical/Admin/Facilities/
  Transport/Hostel) -- is still not built.
- **§114 Feature flags table.**

## Deferred — polish within modules that WERE hardened

- Full UI componentization of `App.jsx` into `src/features/*/components/`
  (the service/data layer was fully migrated to the new RPCs; the
  presentational component tree is still mostly in one file).
- Loading/empty/error states exist as a reusable pattern
  (`src/components/ui/States.jsx`) but are only wired into Home/Food/
  Campus/Events — extend to Marketplace/Lost&Found/Bookings/Print/
  Notifications lists.
- `student_verifications` table + USN/document verification flow (§7) has
  no UI.
- Real-time vendor-side order queue UI (student-side realtime tracking
  exists via `subscribeToOrders`; there's no vendor screen to drive
  RECEIVED → ACCEPTED → PREPARING → READY yet, only the RPC).
- ~50 ESLint "unused variable" warnings — mostly seed/mock data left in
  `App.jsx` next to the real DB-backed data paths that replaced them; safe
  to clean up but not urgent.
