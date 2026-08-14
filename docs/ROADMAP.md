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

## Deferred — infrastructure/access blockers (need the project owner)

These aren't skipped by choice — they need credentials or accounts nobody
but the project owner can provide:

- **§94-98 Live deployment, monitoring, DNS.** No Vercel/Cloudflare account
  was connected this session. See `docs/DEPLOYMENT.md` for the exact steps
  once you have one.
- **§24 Real (non-test) payment gateway.** Needs a business KYC'd Razorpay/
  Cashfree account.
- **§47, §49 Real email/SMS/push providers.** Needs accounts + API keys.
- **§97 Sentry/PostHog.** Needs accounts.
- **§94 dev/staging/prod Supabase separation.** Needs the owner to create
  the additional projects; the migrations in `supabase/migrations/` will
  apply cleanly to any of them.

## Deferred — new feature surface (out of "harden existing modules" scope)

The database/RPC layer for most of these is either fully or partially in
place; there's no UI yet:

- **§16-22 Vendor CMS** (menu management, bulk CSV import/export, inventory,
  staff accounts, order queue dashboard). `food.menu.write`/
  `food.orders.update` permissions and the RPCs exist; no vendor-facing app.
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
- **§76-78 Multi-app split** (separate Student/Vendor/Admin/Facilities
  frontends). Currently one app.
- **§79-80 Full PWA** (service worker, offline shell, install prompt, push
  notifications). `useOnlineStatus` + an offline banner exist; no service
  worker/manifest yet.
- **§99-101 Backup/DR runbooks, data retention policies.** Supabase's
  built-in backups apply once you're on a paid plan; no custom retention
  jobs configured.
- **§102 Formal privacy policy / terms / consent flows / data export.**
- **§104 Admin approval workflows** for vendor registration, club creation,
  event publishing.
- **§109-113 Opportunities/mentorship, academic announcements integration,
  hostel module, transport module, emergency contacts module.**
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
