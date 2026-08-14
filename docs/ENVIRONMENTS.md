# Environments

CampusOS runs two separate Supabase projects and two separate Vercel
deployments. **Nothing that touches staging can affect production, and
nothing should ever run against production without saying so explicitly.**

| | Production | Staging |
|---|---|---|
| Supabase project | `dzjzjlylsfpmymkcavrq` ("CampusOS") | `qmfmziilgkktwnqoxakk` |
| Frontend | https://campusos-amber.vercel.app | https://campusos-staging.vercel.app |
| Real students | Yes | No |
| Razorpay | test mode (see `SECURITY.md`/`docs/DEPLOYMENT.md` — not live yet) | test mode |
| Local env file | `.env.production.local` | `.env.staging.local` |
| service_role key | `.service_role_key.local` | `.service_role_key.staging.local` |

Both env files and both service_role key files are gitignored and local-only
(never committed). `.env` (the file Vite/scripts actually read) is a plain
copy of whichever one you want active locally — **it defaults to staging**.
Never hand-edit `.env` directly if you can help it; copy from the
`.env.<target>.local` files instead so you don't lose track of which project
you're pointed at:

```bash
cp .env.staging.local .env       # back to the safe default
cp .env.production.local .env    # only when you deliberately need prod
```

## Why staging exists

Production has real students on it as of 2026-08-14. Local development,
migration testing, seed-data experiments, and the `scripts/setup-*.mjs` /
`tests/live/*` suite all used to point at production directly — fine when
this was a solo build, not fine once someone else's order history, event
registrations, or ID verification documents are on the other end of every
query. Staging is a second, otherwise-identical Supabase project + Vercel
deployment that gets the exact same migrations, edge functions, and RLS
policies, with nobody real using it.

**Staging is not a truly fresh install** — it's an older, previously-abandoned
Supabase project (created 2026-08-10, one day before production, with the
old pre-hardening schema: 12 tables, no RBAC, no order state machine). It
had zero real users when repurposed, so the leftover tables were reconciled
non-destructively (columns added, nothing dropped or renamed) rather than
wiped — see the migration-robustness fixes in
`supabase/migrations/20260814000800_printing.sql` and the git history around
2026-08-14 for exactly what that involved. **A few staging tables carry
harmless legacy columns production doesn't have** (e.g. `events.event_date`
is `date` on staging vs `timestamptz` on production — a pre-existing type
that predates this migration set and wasn't retyped to keep the "no drops,
no existing-column changes" rule; times on staging events collapse to
midnight, which doesn't matter for testing purposes but is worth remembering
if a staging-only event-time test ever looks wrong).

## Running admin/seed scripts safely

Every script in `scripts/setup-*.mjs`, plus `tests/live/*`, resolves its
target via `scripts/env-target.mjs`:

- **No flags → staging.** This is the default specifically so a script run
  out of habit can't hit production.
- **`--env=production --yes-production` → production.** Both flags are
  required; either alone is refused. The resolved project ref is also
  double-checked against the known production ref before anything runs.
- The resolver also refuses to proceed if `--env=staging` (or no flag)
  somehow resolves to the production project ref — i.e. if
  `.env.staging.local` is missing/misconfigured and it would silently fall
  back to a `.env` that happens to point at prod.

```bash
node scripts/setup-test-users.mjs                              # staging
node scripts/setup-test-users.mjs --env=production --yes-production   # prod, on purpose
```

`tests/live/*` (Playwright) doesn't take CLI flags the same way — it derives
its target from whatever `.env` currently points at (see
`tests/live/helpers/realSession.js` / `resolveServiceRoleKey.js`), and
`playwright.live.config.cjs` defaults `baseURL` to the staging deployment.
Keep `.env` and `LIVE_URL` pointed at the *same* project when overriding —
the deployed frontend's own baked-in Supabase client has to match the
session token the test seeds into `localStorage`, or you'll just see a
signed-out app:

```bash
# staging (default) -- .env already points here by default
npx playwright test --config=playwright.live.config.cjs

# production, on purpose -- point .env at prod first
cp .env.production.local .env
LIVE_URL=https://campusos-amber.vercel.app npx playwright test --config=playwright.live.config.cjs
cp .env.staging.local .env   # switch back when done
```

## Applying migrations to both projects

New migrations go in `supabase/migrations/` as always and get applied to
**both** projects — staging first (to catch problems like the two migration
bugs found while first setting staging up), then production once verified:

```bash
npx supabase link --project-ref qmfmziilgkktwnqoxakk   # staging
npx supabase db push --linked

npx supabase link --project-ref dzjzjlylsfpmymkcavrq   # production
npx supabase db push --linked
```

**`supabase link` is mutable local CLI state shared by every terminal/agent
working in this repo.** If two sessions are working in the repo at once (has
happened before — see the hardening-pass history), whichever one links last
wins, silently, for every subsequent `--linked` command in *both* sessions.
Always run `cat supabase/.temp/project-ref` (or re-run `supabase link`) right
before anything destructive, don't assume it's still pointed where you left
it. `scripts/env-target.mjs`'s `runProjectSql()` re-links immediately before
every query for exactly this reason.

## Vercel environments

One Vercel project (`campus-os2/campusos`) serves both deployments via
Vercel's built-in Preview/Production environment variables:

- **Production** env vars (`VITE_SUPABASE_URL` etc.) point at the production
  Supabase project. `vercel --prod` deploys here → campusos-amber.vercel.app.
- **Preview** env vars point at staging. A regular `vercel` (no `--prod`)
  deploy creates a new preview URL using those; the stable alias
  `campusos-staging.vercel.app` was pointed at one specific preview
  deployment via `vercel alias set`. **Re-run the alias command after
  deploying a new preview build if you want campusos-staging.vercel.app to
  reflect it** — aliases don't auto-follow new deployments:
  ```bash
  npx vercel                                            # new preview build
  npx vercel alias set <new-preview-url> campusos-staging.vercel.app
  ```
- Deployment Protection (Vercel's SSO wall) is **disabled** project-wide —
  it was on by default and would have blocked both Playwright and casual
  visitors from reaching campusos-staging.vercel.app. The app has its own
  auth; an extra Vercel-level gate wasn't an intentional choice, just the
  platform default.

## Secrets / edge function config

Razorpay keys, VAPID push keys, etc. are set independently per project via
`supabase secrets set --project-ref <ref> ...` — they do **not** carry over
automatically when you deploy a new migration or function. Staging's push
notification secrets (`PUSH_DISPATCH_SECRET`, `VAPID_*`) were freshly
generated, not copied from production (no reason to share them — push
subscriptions are project-specific anyway). Razorpay test keys for staging
need to be set separately from production's — see `docs/DEPLOYMENT.md`.

## What's NOT duplicated

- Storage bucket **contents** (avatars, ID verification documents, etc.) —
  staging starts empty; nothing syncs from production.
- The backups pipeline (`docs/DISASTER_RECOVERY.md`) targets production only.
- A couple of one-off historical scripts (`scripts/live-check-*.mjs`) were
  written specifically against production and were not updated to be
  environment-aware — they still read `.service_role_key.local` (production)
  regardless of what `.env` points at. Since `.env` now defaults to staging,
  running one of these old scripts unmodified will just fail loudly with a
  401 (mismatched project key), not silently touch the wrong project — but
  don't reuse them as a template for new scripts. Use `scripts/env-target.mjs`
  instead.
