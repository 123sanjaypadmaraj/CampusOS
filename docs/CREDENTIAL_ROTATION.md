# Credential rotation

Everything SECURITY.md and the readiness audit have been calling "rotate the
legacy JWT + Razorpay/Groq/Resend keys" reduced to one script,
`scripts/rotate-credentials.mjs`, plus the handful of dashboard actions it
genuinely can't do for you. Run the script **yourself, in your own
terminal** — every prompt is masked and nothing it reads is ever printed,
logged, or pasted into a chat session, which is the entire point of
rotating a credential that's already been exposed once (see SECURITY.md).

**Current state as of 2026-09-01** (from a live, digests-only `supabase
secrets list` against both projects — see `status` below): `GROQ_API_KEY`
and `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` are set on **production only**
(test-mode keys; staging has none of the three payment/AI secrets
configured at all — a separate, pre-existing gap, not part of this
checklist). Two secrets are **not set anywhere**, not stale — first-time
setup, not rotation: `RAZORPAY_WEBHOOK_SECRET` (so a real Razorpay webhook
hitting production right now gets HTTP 503 `GATEWAY_NOT_CONFIGURED`, logged
to `error_logs` as a fatal `payment` error — not silent, but nothing has
ever confirmed a payment server-side) and `RESEND_API_KEY` (so
`send-email` gracefully 503s instead of sending; SMS's `FAST2SMS_API_KEY`
is in the same boat). Run `node scripts/rotate-credentials.mjs status`
before starting to see today's actual picture rather than trusting this
paragraph — it goes stale the moment someone runs the script.

## What the script does (no dashboard access needed)

- Prompts for the new value with masked input (never a CLI arg, never
  echoed) — see its header comment for exactly why.
- **Razorpay webhook secret**: can generate a strong random value for you
  (`--generate`) since Razorpay doesn't hand this one out itself — it's a
  shared secret you choose and paste into both sides.
- Writes Supabase Edge Function secrets via a throwaway `--env-file`
  (never a plaintext CLI arg — that's what `docs/DEPLOYMENT.md` §2 and
  `supabase/functions/README.md` used to recommend directly; both now
  point here instead) or, for the legacy JWT, the local
  `.service_role_key(.staging).local` file `scripts/env-target.mjs` and
  `tests/live/helpers/resolveServiceRoleKey.js` already read.
- **Verifies the change actually took**, every time — a live REST call
  against the project for the JWT, a fresh `supabase secrets list`
  timestamp check for everything else — rather than trusting the `set`
  command's exit code alone.
- Prints the one or two things that genuinely need a human afterward (a
  GitHub repo secret, the Razorpay webhook config) as an exact
  copy-pasteable follow-up command, never does them silently.

```bash
node scripts/rotate-credentials.mjs status                                     # what's set where, right now
node scripts/rotate-credentials.mjs legacy-jwt --env=staging                   # after rolling in the Dashboard
node scripts/rotate-credentials.mjs legacy-jwt --env=production --yes-production
node scripts/rotate-credentials.mjs razorpay-keys --env=production --yes-production
node scripts/rotate-credentials.mjs razorpay-webhook-secret --env=production --yes-production --generate
node scripts/rotate-credentials.mjs groq-api-key --env=production --yes-production
node scripts/rotate-credentials.mjs resend --env=production --yes-production
node scripts/rotate-credentials.mjs fast2sms-api-key --env=production --yes-production   # bonus, see SECURITY.md
```

## The ordered checklist — dashboard actions only you can perform

Everything else (the parts above) is one command each, already covered.
This is what's left, in the order it makes sense to do it, each one either
a single copy-pasteable command or the exact button to click:

1. **Legacy Supabase JWT — staging.** Dashboard → project `qmfmziilgkktwnqoxakk`
   → Project Settings → API → Legacy API Keys → **Roll**. Then:
   `node scripts/rotate-credentials.mjs legacy-jwt --env=staging`
2. **Legacy Supabase JWT — production.** Dashboard → project
   `dzjzjlylsfpmymkcavrq` → Project Settings → API → Legacy API Keys →
   **Roll**. Then:
   `node scripts/rotate-credentials.mjs legacy-jwt --env=production --yes-production`
   — the script's own output tells you the one GitHub secret this can't
   reach (`PROD_SUPABASE_SERVICE_ROLE_KEY`); if you have `gh` set up
   locally it gives you the exact `gh secret set ... < file` line.
3. **Razorpay API keys — production.** Razorpay Dashboard → Settings →
   API Keys → **Regenerate Test Key** (still test mode — see
   `docs/DEPLOYMENT.md` §3, don't touch Live Keys until you've gone
   through the KYC/real-account item in the readiness audit first). Then:
   `node scripts/rotate-credentials.mjs razorpay-keys --env=production --yes-production`
4. **Razorpay webhook secret — production (first-time set, not a
   rotation).**
   `node scripts/rotate-credentials.mjs razorpay-webhook-secret --env=production --yes-production --generate`
   — copy the value it prints once, then Razorpay Dashboard → Settings →
   Webhooks → Add/Edit the endpoint
   `https://dzjzjlylsfpmymkcavrq.functions.supabase.co/razorpay-webhook`,
   subscribe to `payment.authorized`/`payment.captured`/`payment.failed`,
   paste the same value into the Secret field, Save.
5. **Groq API key — production.** console.groq.com → API Keys →
   create/regenerate. Then:
   `node scripts/rotate-credentials.mjs groq-api-key --env=production --yes-production`
6. **Resend API key — production (first-time set, not a rotation).**
   resend.com → API Keys → create/regenerate. Then:
   `node scripts/rotate-credentials.mjs resend --env=production --yes-production`
7. **(Bonus, not one of the three named above, but flagged next to Resend
   in SECURITY.md) Fast2SMS key — production.** fast2sms.com dashboard →
   API Keys. Then:
   `node scripts/rotate-credentials.mjs fast2sms-api-key --env=production --yes-production`
8. **Confirm nothing regressed:**
   `node scripts/rotate-credentials.mjs status` — every row for
   production should read `SET` with a fresh `updated_at`; re-run
   `node scripts/live-check-payment-and-store-billing.mjs --env=staging`
   (or the production-safe equivalent once you're comfortable) if you
   want a functional check beyond "the secret store has a value".

None of the above needs staging's Razorpay/Groq/Resend/Fast2SMS keys set
for the first time — that's a separate, pre-existing gap
(`docs/DEPLOYMENT.md` §3: "staging needs its own Razorpay test key pair,
not yet") outside this rotation checklist's scope. Use the same
`razorpay-keys`/`groq-api-key`/`resend`/`fast2sms-api-key` commands with
`--env=staging` (no `--yes-production` needed) if/when you want to close
that gap too.

## Why nothing else breaks silently

- Every Edge Function's own `SUPABASE_SERVICE_ROLE_KEY` is Supabase's
  auto-injected runtime var — it updates itself the moment you roll the
  legacy JWT in the Dashboard. No redeploy, no manual propagation, nothing
  in this codebase hardcodes it.
- The frontend and every Edge Function already migrated off the legacy
  anon JWT onto the new `sb_publishable_...`/`sb_secret_...` key system
  (`VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.production.local`/
  `.env.staging.local`, `SUPABASE_PUBLISHABLE_KEYS`/`SUPABASE_SECRET_KEYS`/
  `SUPABASE_JWKS` as Edge Function secrets) — rolling the *legacy* keys
  doesn't touch any of that, and doesn't invalidate already-issued user
  session tokens either. The only local, static copies of the legacy
  service_role JWT are the two `.service_role_key(.staging).local` files
  and the `PROD_SUPABASE_SERVICE_ROLE_KEY` GitHub secret — all three are
  what this checklist covers.
- `razorpay-webhook`/`send-email` both already fail closed and log a
  fatal `error_logs` entry when their secret is missing, rather than
  silently pretending to succeed — confirmed by reading both functions,
  not assumed. `system-health`'s Admin CMS tab surfaces the same
  presence/absence per secret group live, for a human glance after
  rotating without needing this script's `status` command.
- Every admin/seed script and `tests/live/**` reads the service_role key
  fresh from `.service_role_key(.staging).local` on every run (via
  `scripts/env-target.mjs` / `tests/live/helpers/resolveServiceRoleKey.js`)
  — nothing caches the old value in memory or a committed file.
