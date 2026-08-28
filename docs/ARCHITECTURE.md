# Architecture — module map for developers

A quick orientation for anyone new to this codebase: where things live, why
they're organized that way, and which parts are known to still be monolithic
(with a plan for those, not just a warning).

## Layout

```text
src/
├── main.jsx                React root + providers
├── App.jsx                 Router shell + most page-level components (see "Known monoliths" below)
├── features/<name>/        Newer feature code: Component(s).jsx + api.js + *.test.js side by side
│   ├── admin/               Admin CMS
│   ├── auth/                USN<->email helpers used by the auth data layer
│   ├── clubs/                Club management (roster, applications, QR check-in)
│   ├── emergency/            Campus emergency directory (frontend)
│   ├── facilities/           Facilities staff dashboard + SOS alerts
│   ├── marketplace/          Student marketplace listings
│   ├── payments/             Razorpay Checkout.js wrapper
│   ├── store/                Campus Store vendor dashboard pieces
│   ├── support/              Support ticket / help centre UI
│   ├── teams/                Teams/opportunities board
│   └── vendor/                Vendor (canteen/store/print) dashboard
├── services/                Data layer -- talks to Supabase (RPCs for anything
│   │                          security-sensitive, direct reads for public data)
│   ├── mvpService.js          Barrel re-exporting every module below (see "Data layer" below)
│   ├── mvpService/            One file per domain -- start here to find a function
│   ├── messagingService.js, campusService.js, opportunitiesService.js,
│   │   socialService.js, pushService.js, recommendationsService.js,
│   │   remindersService.js, storeService.js, studentAnalyticsService.js,
│   │   orderService.js        Newer, already-domain-scoped service modules
│   └── *.test.js               Unit tests colocated with the module they cover
├── hooks/                   useAuth, usePermissions, useOnlineStatus, useModalA11y, ...
├── components/ui/           Shared LoadingState/EmptyState/ErrorState, Charts, etc.
├── lib/supabase.ts          The one Supabase client instance (browser-safe key only)
├── types/database.ts        Hand-authored DB types (see file header)
└── utils/                   orderCalculator, mvpHelpers, offlineCache, ...
```

Backend: `supabase/migrations/` is the canonical schema (own README there);
`supabase/functions/` holds Edge Functions (Razorpay order + webhook, etc.).
`src/supabase/archive/` is superseded schema history -- never run it.

## Data layer: `src/services/mvpService/`

`mvpService.js` used to be a single ~4,000-line file. It's now a thin barrel
(`export * from "./mvpService/<domain>.js"` for each module) that re-exports
every function under its original name, so no other file's imports had to
change. Internally it's split by domain, one file per concern:

| Module | Covers |
|---|---|
| `_shared.js` | Internal-only helpers (`throwIfError`, `randomCode`, `formatRelativeTime`) — not part of the public API |
| `errorLogging.js` | Client/admin error monitoring |
| `auth.js` | Sign-in/sign-up, session, identity linking |
| `campus.js` | Campus lookup |
| `profile.js` | Own profile + people directory |
| `adminUsers.js` | Admin: user/role/status/account-deletion management |
| `adminAi.js` | Admin: AI assistant access, knowledge base, usage |
| `moderation.js` | Admin: reports, moderation actions, banned words, suspension appeals |
| `orgRequests.js` | Club/vendor org creation requests |
| `verification.js` | Student ID verification |
| `posts.js` | Campus feed: posts, likes, comments |
| `clubs.js` | Club listing + membership |
| `events.js` | Events, registration, tickets, roster/check-in, feedback |
| `food.js` | Canteens/menu + food order lifecycle |
| `payments.js` | Shared payment-record helpers |
| `print.js` | Print shop: rate cards, jobs, payment |
| `campusServices.js` | Campus service requests + resource booking |
| `facilitiesStaff.js` | Facilities staff dashboard queue |
| `notifications.js` | In-app notifications + delivery preferences |
| `realtime.js` | Shared `.subscribe()` status-logging helper |
| `reporting.js` | Content reporting + audit trail |
| `emergency.js` | SOS alerts + emergency contacts |
| `emergencyDirectory.js` | Campus emergency directory (data) |
| `support.js` | Support tickets + help centre FAQ |
| `resourceCatalog.js` | Resource catalog management |
| `vendorAccounts.js` | Vendor manager accounts (store/print) |
| `lostAndFound.js` | Lost & found items + photo matching |

If you're looking for a specific function: grep its name — it now lives in
exactly one of these files (verified by an export-surface diff against the
original single file when this split was made; nothing was dropped or
renamed).

Everything built more recently already followed this per-domain pattern from
the start (`src/features/<name>/api.js`, `src/services/messagingService.js`,
etc.) — the `mvpService` split brings the oldest part of the codebase in
line with that convention rather than introducing a new one.

## Known monoliths (deferred, not forgotten)

These are called out explicitly so they're a visible backlog item, not a
silent gap:

- **`src/App.jsx`** (~11,400 lines) — the router shell plus ~90 page-level
  components, all defined inline and sharing state via prop-drilling
  (`notify`, `authUser`, `go`, `campusId`, etc.). The highest-value and
  highest-risk modularization target: splitting it means extracting each
  page/section into its own file (mirroring the `features/<name>/` pattern)
  without changing any of that shared prop wiring. Do this incrementally,
  one section at a time, with the full test suite green between each step —
  not as a single pass.
- **`src/features/admin/AdminCMS.jsx`** (~4,150 lines) — the Admin CMS is
  already feature-scoped to one file, but its internal tabs (user
  management, moderation, analytics, vendor onboarding, ...) are large
  enough to warrant their own files within `features/admin/`.
- **`src/features/vendor/VendorDashboard.jsx`** (~2,500 lines) — same
  shape as AdminCMS: one feature, multiple large internal tabs/sections
  that could become their own files under `features/vendor/`.

None of these have the tight cross-cutting risk `mvpService.js` didn't have
(they're UI, not a pure data layer), so they need more care and should stay
their own separate passes.
