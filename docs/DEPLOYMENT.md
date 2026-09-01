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

Full copy-paste runbook (exact DNS records, exact Vercel steps, SSL
verification, the old `*.vercel.app` redirect, rollback plan):
**`docs/DOMAIN_CUTOVER.md`**. Doc §78's `campusos.app` +
`vendor.`/`admin.`/`facilities.` subdomain suggestion is moot — that name
turned out to be an unrelated site with no connection to this project
(confirmed 31 Aug 2026, 0 domains attached in Vercel) — pick any domain you
actually own; a single domain is fine, the subdomains were only ever for
apps that don't exist yet (§76-78).

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
writing it, and its shell logic as a whole is proven by
`node scripts/deploy-dry-run.mjs` (mocked CLIs, fake secrets, no network --
see that script's header; it also runs on every push as `ci.yml`'s
`deploy-dry-run` job). What's NOT yet proven is a real GitHub Actions run
against real infrastructure — trigger one once via the Actions tab's "Run
workflow" button after the checklist below, before trusting the on-merge
trigger alone.

### CI/CD secrets -- 5-minute setup checklist

None of these could be set by the session that wrote `deploy.yml` (no `gh`
CLI available). Six secrets, in the order that's fastest to get all six —
do them top to bottom and it's a five-minute job. Every command below
either sets the secret directly (needs `gh auth login` once) or prints
exactly what to paste into repo → **Settings → Secrets and variables →
Actions → New repository secret** if you'd rather use the UI.

**1. `SUPABASE_ACCESS_TOKEN`** — skip this step if `backup.yml` already
has it (Actions → check its secret list); it's the same token, don't mint
a second one.
- Get it: https://supabase.com/dashboard/account/tokens → **Generate new token**
- Set it: `gh secret set SUPABASE_ACCESS_TOKEN` (paste the token, then Ctrl-D)

**2. `VERCEL_TOKEN`**
- Get it: https://vercel.com/account/tokens → **Create Token** (no expiry, or 1 year)
- Set it: `gh secret set VERCEL_TOKEN` (paste the token, then Ctrl-D)

**3 & 4. `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`** — both come from one command, run from the repo root with the token from step 2:
```bash
npx vercel login   # if not already logged in
npx vercel link --token=<the VERCEL_TOKEN from step 2>
cat .vercel/project.json
```
That prints `{"orgId":"team_xxxx","projectId":"prj_xxxx",...}`.
- Set them: `gh secret set VERCEL_ORG_ID --body "team_xxxx"` and `gh secret set VERCEL_PROJECT_ID --body "prj_xxxx"` (the real values from the JSON above)

**5. `STAGING_SUPABASE_ANON_KEY`**
- Get it: https://supabase.com/dashboard/project/qmfmziilgkktwnqoxakk/settings/api → **Project API keys** → the `anon` / `public` key (starts with `sb_publishable_`). Not sensitive on its own — it's the same key the deployed frontend ships to every browser — but the live-check job needs it directly. **Never** use the `service_role` key here.
- Set it: `gh secret set STAGING_SUPABASE_ANON_KEY --body "sb_publishable_xxxx"`

**6. `STAGING_E2E_ACCOUNTS`** — JSON array of `{email, password, label}` for every staging test account the live suite signs in as. Generate it **yourself, locally** — never through an agent session, it prints real (if synthetic) passwords:
```bash
node scripts/print-ci-staging-accounts-secret.mjs | gh secret set STAGING_E2E_ACCOUNTS
```
(See that script's header comment for what local credential files it needs already set up.)

**Verify all six before trusting a real run**: push anything to `master`
(or re-run a past `Deploy` workflow_dispatch) and check the new
`validate-secrets` job — it runs `scripts/validate-deploy-secrets.mjs`
against the real secrets and fails immediately, with one specific reason
per problem, if any of the six is missing or malformed (wrong prefix,
truncated paste, not valid JSON, etc.) before anything touches staging or
production. To sanity-check a single value by hand before pasting it in:
```bash
VERCEL_PROJECT_ID=prj_xxxx node scripts/validate-deploy-secrets.mjs
```

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
- **The `staging-live-check` job itself** — `scripts/deploy-dry-run.mjs`
  deliberately does NOT simulate it (it needs a real deployed staging site
  and real Playwright browsers, which can't be meaningfully faked without
  just not testing anything). It's covered a different way instead: it's
  the same `tests/live/**` suite that's already run by hand against staging
  after every pass this month, so its own correctness isn't new/unproven —
  only "does the workflow correctly wire it up as this job's gate" is.
