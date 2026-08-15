# Deployment runbook

This wasn't done during the hardening pass (no hosting/payment accounts were
connected to this session). Here's exactly what's left, in order.

## 0. Rotate the credentials in `SECURITY.md` first

Do this before anything else — a password and a Supabase key are sitting in
this repo's git history. See `SECURITY.md`.

## 1. Apply the database schema

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

Or paste each file in `supabase/migrations/` into the Supabase Dashboard's
SQL Editor, in filename order. Full detail in `supabase/migrations/README.md`.

Skip `0013_seed_dev_data.sql` for a real campus — it inserts demo
canteens/food items/clubs/events tagged to the `nhce` campus slug.

## 2. Get Razorpay test keys and deploy the payment Edge Functions

```bash
npx supabase secrets set RAZORPAY_KEY_ID=rzp_test_xxxxxxxx
npx supabase secrets set RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxx
npx supabase secrets set RAZORPAY_WEBHOOK_SECRET=xxxxxxxxxxxxxxxx

npx supabase functions deploy create-razorpay-order
npx supabase functions deploy razorpay-webhook --no-verify-jwt
```

Register the webhook URL in the Razorpay Dashboard (Settings → Webhooks):
`https://<project-ref>.functions.supabase.co/razorpay-webhook`, subscribed
to `payment.authorized`, `payment.captured`, `payment.failed`.

Full detail, including how to get free test-mode keys with no KYC, in
`supabase/functions/README.md`. **Stay in Razorpay test mode until you've
gone through §3-4 below and are ready for a real launch** — doc §94 is
explicit that payments/refunds should never be tested against production.

## 3. Dev/staging/prod separation -- done

As of 2026-08-14 there are two full environments: production
(`dzjzjlylsfpmymkcavrq`, https://campusos-amber.vercel.app) and staging
(`qmfmziilgkktwnqoxakk`, https://campusos-staging.vercel.app), same
migrations/edge functions/RLS on both. Every admin/seed script and the live
E2E suite target staging by default and refuse to run against production
without an explicit `--env=production --yes-production`. Full detail,
including how the two Vercel environments are wired and how to apply a new
migration to both projects: **`docs/ENVIRONMENTS.md`**.

Still open: staging needs its own Razorpay test key pair (separate from
production's, so test payments stay isolated) -- production's are already
set, staging's are not yet. Never point production traffic at a project
that's ever had test payments/refunds run against it.

## 4. Deploy the frontend

No hosting account was available to this session, so nothing has been
pushed anywhere yet. Vercel is the path of least resistance for a Vite app:

```bash
npm install -g vercel   # or use npx vercel each time
vercel login             # opens a browser to authenticate
vercel                    # first run: links/creates the project, deploys a preview
vercel --prod             # promotes to production
```

Set the same two env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`)
in the Vercel project's Environment Variables settings — once per
environment (Preview / Production), pointing at staging/production Supabase
respectively per §3.

Cloudflare Pages is an equally reasonable alternative (`npx wrangler pages
deploy dist`), doc §96 mentions both.

## 5. DNS + domain

Point your domain at the hosting provider (Vercel/Cloudflare both have
one-click custom domain flows once you own the domain). Doc §78 suggests
`campusos.app` with `vendor.`/`admin.`/`facilities.` subdomains for the
apps that don't exist yet (§76-78) — irrelevant until those apps exist;
a single domain is fine for now.

## 6. Monitoring, backups, disaster recovery -- done (2026-08-15)

In-house error tracking (no third-party account/DSN needed): a global
`ErrorBoundary` + `window.onerror`/`unhandledrejection` handlers
(`src/main.jsx`) plus a couple of explicitly-instrumented critical flows
(food order creation/payment) log to `error_logs` via `log_client_error()`
-- viewable/resolvable in Admin CMS's "Errors" tab. An hourly-ish uptime
check (`.github/workflows/uptime.yml`) pings the deployed frontend + the
Supabase REST API; a failed scheduled run triggers GitHub's own automatic
failure-notification email, no separate alerting service.

Daily automated backups (`.github/workflows/backup.yml` + retention
pruning) and a written restore procedure -- full detail in
`docs/DISASTER_RECOVERY.md` and `docs/DATA_RETENTION.md`. **Needs 2
GitHub repo secrets this session couldn't set itself** (no `gh` CLI
available):
- `SUPABASE_ACCESS_TOKEN` -- a personal access token
  (Supabase Dashboard -> Account -> Access Tokens). Also usable for the
  `SUPABASE_ACCESS_TOKEN` the `uptime`/`backup` workflows need.
- `PROD_SUPABASE_SERVICE_ROLE_KEY` -- production's service_role key
  (Dashboard -> Project Settings -> API), used only by the backup
  workflow's retention-pruning step.

Add both via GitHub -> repo -> Settings -> Secrets and variables ->
Actions -> New repository secret, then run the "Database backup
(production)" workflow once manually (Actions tab -> Run workflow) to
confirm it completes -- see the workflow file's own comments for why that
verification step matters (it was built and tested manually, not inside an
actual GitHub Actions run).

Not done: PostHog or any product-analytics account (doc §96-98 also
mentions this) -- out of scope for this pass, which focused on the
reliability side (errors/uptime/backups), not usage analytics. A
first-party `analytics`/`user_activity_daily` table already exists
(`supabase/migrations/20260814005000_analytics.sql`) and covers basic
usage numbers without needing a third-party account, if that's enough.

## 7. CI deploy step

`.github/workflows/ci.yml` currently stops at build + E2E, deliberately —
there was nothing to deploy to yet. Once step 4 is done, add a job like:

```yaml
  deploy:
    needs: [lint-typecheck-test-build, e2e]
    if: github.ref == 'refs/heads/master'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npx vercel deploy --prod --token=${{ secrets.VERCEL_TOKEN }} --yes
```

(or the equivalent `wrangler pages deploy` for Cloudflare), gated behind
whatever manual-approval GitHub Environment you want per doc §95's
"Approval → Production" step.
