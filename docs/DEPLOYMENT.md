# Deployment runbook

This wasn't done during the hardening pass (no hosting/payment accounts were
connected to this session). Here's exactly what's left, in order.

## 0. Rotate the credentials in `SECURITY.md` first

Do this before anything else — a password and a Supabase key are sitting in
this repo's git history. See `SECURITY.md` and, for the legacy JWT /
Razorpay / Groq / Resend rotation specifically, `docs/CREDENTIAL_ROTATION.md`.

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

First time setting these up (or rotating an existing set -- see
`docs/CREDENTIAL_ROTATION.md` for the full masked-input, verified version
of this): `node scripts/rotate-credentials.mjs razorpay-keys --env=<staging|production> [--yes-production]`
and `... razorpay-webhook-secret ... --generate`. The raw form below still
works but puts the value on the command line (shell history, process
list) -- prefer the script.

```bash
npx supabase secrets set RAZORPAY_KEY_ID=rzp_test_xxxxxxxx
npx supabase secrets set RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxx
npx supabase secrets set RAZORPAY_WEBHOOK_SECRET=xxxxxxxxxxxxxxxx
npx supabase secrets set RECONCILIATION_DISPATCH_SECRET=<same value as the auto-generated `reconciliation_dispatch_secret` Vault entry>

npx supabase functions deploy create-razorpay-order
npx supabase functions deploy razorpay-refund
npx supabase functions deploy razorpay-webhook --no-verify-jwt
npx supabase functions deploy payment-reconciliation --no-verify-jwt
```

Register the webhook URL in the Razorpay Dashboard (Settings → Webhooks):
`https://<project-ref>.functions.supabase.co/razorpay-webhook`, subscribed
to `payment.authorized`, `payment.captured`, `payment.failed`.

`payment-reconciliation` (2026-08-24) is a self-healing safety net for a
missed webhook delivery, not something the webhook itself depends on -- see
`supabase/migrations/20260824000800_payment_reconciliation.sql` for what it
does and why. It needs `--no-verify-jwt` because pg_cron/pg_net calls it, not
a signed-in browser; it authenticates that call via
`RECONCILIATION_DISPATCH_SECRET` instead, same pattern as `send-email`/
`send-push`/`send-sms`.

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

## 6. Monitoring, backups, disaster recovery -- done (2026-08-15, storage
   file-bytes backup added 2026-08-19)

In-house error tracking (no third-party account/DSN needed): a global
`ErrorBoundary` + `window.onerror`/`unhandledrejection` handlers
(`src/main.jsx`) plus a couple of explicitly-instrumented critical flows
(food order creation/payment) log to `error_logs` via `log_client_error()`
-- viewable/resolvable in Admin CMS's "Errors" tab. An hourly-ish uptime
check (`.github/workflows/uptime.yml`) pings the deployed frontend + the
Supabase REST API; a failed scheduled run triggers GitHub's own automatic
failure-notification email, no separate alerting service.

Daily automated DB backups (`.github/workflows/backup.yml`) plus weekly
automated storage-bucket-file-bytes backups
(`.github/workflows/storage-backup.yml`), both with retention pruning, and
a written restore procedure -- full detail in `docs/DISASTER_RECOVERY.md`
and `docs/DATA_RETENTION.md`. **Needs 2 GitHub repo secrets this session
couldn't set itself** (no `gh` CLI available), shared by both workflows:
- `SUPABASE_ACCESS_TOKEN` -- a personal access token
  (Supabase Dashboard -> Account -> Access Tokens). Also usable for the
  `SUPABASE_ACCESS_TOKEN` the `uptime`/`backup`/`storage-backup` workflows
  need.
- `PROD_SUPABASE_SERVICE_ROLE_KEY` -- production's service_role key
  (Dashboard -> Project Settings -> API), used only by each workflow's
  retention-pruning step.

Add both via GitHub -> repo -> Settings -> Secrets and variables ->
Actions -> New repository secret, then run the "Database backup
(production)" **and** "Storage backup (production)" workflows once
manually (Actions tab -> Run workflow) to confirm each completes -- see
each workflow file's own comments for why that verification step matters
(both were built and tested manually against real projects, not inside an
actual GitHub Actions run).

Not done: PostHog or any product-analytics account (doc §96-98 also
mentions this) -- out of scope for this pass, which focused on the
reliability side (errors/uptime/backups), not usage analytics. A
first-party `analytics`/`user_activity_daily` table already exists
(`supabase/migrations/20260814005000_analytics.sql`) and covers basic
usage numbers without needing a third-party account, if that's enough.

## 7. CI/CD deploy automation -- done (2026-08-22, readiness-audit phase 3)

`.github/workflows/ci.yml` stays PR/push checks only (lint, typecheck,
tests, build, mocked E2E) on purpose. A separate workflow,
`.github/workflows/deploy.yml`, picks up after CI goes green on a push to
`master`: it pushes migrations + edge functions to **staging**, deploys the
frontend there and re-aliases `campusos-staging.vercel.app`, runs the real
`tests/live/**` Playwright suite against that freshly-deployed staging
build as a gate, and only if that passes repeats the same three steps
against **production**, finishing with a bundle-hash check against the
live URL (the same check the RBAC pass did by hand — curl the deployed
page, confirm it's serving the content-hashed JS filename that was just
built, not a stale cached one).

Like `backup.yml`/`storage-backup.yml`, every individual CLI call in it
(`supabase db push`, `supabase functions deploy`, `vercel build`/`vercel
deploy --prebuilt`) was exercised manually against the real projects while
writing it, but the workflow as a whole has not run inside an actual
GitHub Actions job yet — trigger it once via the Actions tab's "Run
workflow" button after setting every secret below, before trusting the
on-merge trigger alone.

### CI/CD secrets

None of these could be set by the session that wrote `deploy.yml` (no `gh`
CLI available) — add them under repo → Settings → Secrets and variables →
Actions:

| Secret | What it is |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | Same personal access token `backup.yml` already needs (Dashboard → Account → Access Tokens) — reuse it, don't mint a second one. |
| `VERCEL_TOKEN` | Vercel → Account Settings → Tokens. Needs deploy access to the `campus-os2/campusos` project. |
| `VERCEL_ORG_ID` | From `.vercel/project.json` after running `vercel link` locally once against the real project, or Vercel project Settings → General. |
| `VERCEL_PROJECT_ID` | Same source as `VERCEL_ORG_ID`. |
| `STAGING_SUPABASE_ANON_KEY` | Staging project's anon/publishable key (Supabase Dashboard → staging project → Project Settings → API). Not sensitive on its own (it's the same key the deployed frontend ships to every browser), but the live-check job needs it directly rather than reading it from Vercel's pulled env vars. |
| `STAGING_E2E_ACCOUNTS` | JSON array of `{email, password, label}` for every staging test account the live suite signs in as. Generate it **yourself, locally** — never through an agent session, it contains real (if synthetic) passwords — with `node scripts/print-ci-staging-accounts-secret.mjs`, piped straight into `gh secret set STAGING_E2E_ACCOUNTS` or pasted into the GitHub secret UI. See that script's header comment for what it needs already set up locally. |

Production's Supabase URL/anon key aren't needed as separate secrets —
`vercel pull --environment=production` already reads them from the
Vercel project's own Production environment variables (see
`docs/ENVIRONMENTS.md` § Vercel environments), and the migrations/functions
steps use `--project-ref` directly, not a locally-linked project.

### What still isn't automated

- **Staging's edge function secrets** (`RAZORPAY_KEY_ID` etc.) — `supabase
  secrets set` is a one-time-per-project setup step, not a per-deploy one;
  `deploy.yml` deploys function *code*, not function *config*. Run it by
  hand once per project per §2 above if it hasn't been (`node
  scripts/rotate-credentials.mjs status` shows what's actually set on each
  project right now).
- **A manual-approval gate on the production job** — right now the staging
  live-check passing is the only gate; there's no "someone clicks Approve"
  step before production. Add a GitHub `environment` protection rule on the
  `production` environment (repo → Settings → Environments → production →
  Required reviewers) if you want a human in the loop before every deploy,
  not just before the first one.
