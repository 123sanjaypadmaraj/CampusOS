# Security notes

## Older, unresolved finding: this repo is PUBLIC and a real password is in its history

Two real secrets were committed to this repository's git history and must be
treated as **compromised**. **Reconfirmed still live on 2026-08-18** (see the
incident entry below) -- `git log -S"CampusOS@2026" --all` still finds it,
and `curl -o/dev/null -w '%{http_code}' https://api.github.com/repos/
123sanjaypadmaraj/CampusOS` returns `200` unauthenticated, meaning this repo
is genuinely public and that history is visible to anyone right now, not a
theoretical risk:

1. **A live Supabase account password** — `create_kingpin.js`, `test_login.js`
   and `test_signup.js` (removed in this pass) hardcoded the password
   `CampusOS@2026` for the account `sanjaypadmaraj@nhce.edu.in`, and the app
   itself (`src/App.js`) auto-signed into that account on every page load.
   **Rotated 2026-08-18** (production -- the account doesn't exist on
   staging) via the Admin Auth API. The old string is still permanently
   readable in git history (see the incident entry below); only the live
   credential was fixed, by the account owner's own explicit choice.
2. **The Supabase anon/publishable key** currently in `.env` was also visible
   in `test_db_crud.js` in git history. The anon key is *designed* to be
   public (it's shipped to every browser), so this is lower severity, but if
   you'd rather not have it discoverable in old commits, rotate it from
   Project Settings → API and update `.env`.

Rotating a value doesn't remove it from git history — anyone with clone
access can still see old commits. If this repo is or will be public, consider
scrubbing history (`git filter-repo` / BFG) in addition to rotating.

## What else changed in this hardening pass

- **RLS was fully open** on every table (`for all to anon, authenticated
  using (true)`) — see `supabase/migrations/README.md` for the full
  writeup and the fix.
- **The "kingpin" dev-login backdoor** (auto sign-in with a hardcoded email
  + password on every app load, bypassing magic-link auth entirely) has been
  removed from `src/App.js`. Local development now goes through the same
  magic-link flow real students use.
- **profiles.role could be self-escalated to `super_admin`** — the old
  `protect_profile_role` trigger only blocked the change when
  `auth.uid() IS NOT NULL`, meaning an *anonymous* request (no login at all)
  could freely rewrite it. Fixed in `0002_rbac.sql` — role changes now only
  happen through `admin_set_user_role()`, gated by `users.roles.manage`.

## 2026-08-18 incident: local credential files present in an uploaded archive

A ZIP of this project handed to an assistant session for analysis contained
several files that are `.gitignore`d and were **never committed to git**
(confirmed via `git log --all` for every filename below -- clean), but were
still physically present because zipping a working directory doesn't respect
`.gitignore` unless you tell it to. Treat everything below as compromised
regardless of git status, since git status was never the exposure vector:

- `.service_role_key.local` / `.service_role_key.staging.local` (Supabase
  legacy `service_role` JWTs, production + staging)
- `scripts/.vendor-credentials(.staging).local.json`,
  `.facilities-credentials(.staging).local.json`,
  `.store-credentials(.staging).local.json` (test vendor/facilities/store
  account passwords, production + staging)
- `scripts/.vapid-keys(.staging).local.json` (Web Push VAPID private keys,
  production + staging)
- `scripts/.sessions(.staging).json` (cached live access/refresh tokens --
  a bearer credential in its own right, arguably worse than a password leak
  since it needs no login step to use)

**Done, same session**:
- Vendor/facilities/store test-account passwords rotated on **both**
  production and staging via the Admin Auth API (`PUT /auth/v1/admin/users/
  {id}`), new passwords written back to the same gitignored local files.
- `e2e.alice/bob/carol` (used by `scripts/setup-test-users.mjs` and every
  live-check script) rotated the same way on both environments. That script
  no longer hardcodes plaintext passwords in source at all (it used to --
  see the entry below, a related but distinct finding); passwords now live
  only in gitignored `scripts/.e2e-credentials(.staging).local.json`.
- Cached `scripts/.sessions(.staging).json` cleared (emptied to `{}`) on
  both environments so no stale leaked access/refresh token is sitting in
  the repo tree anymore. This clears the *local cache*, not necessarily the
  token's validity server-side -- a changed password is expected to revoke
  outstanding sessions for that user, but if you want certainty, check
  Supabase Dashboard -> Authentication -> Users -> (each rotated account) ->
  Sessions and revoke any still listed.
- VAPID keypairs regenerated for both environments (`web-push generate-
  vapid-keys`), pushed to Supabase Edge Function secrets
  (`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`) via `supabase
  secrets set --project-ref <ref>`, and to `.env.production.local` /
  `.env.staging.local` / the root `.env` (whichever it was pointed at).
  Vercel's `VITE_VAPID_PUBLIC_KEY` updated on both the Production and
  Preview (staging) environments, then both redeployed (`npx vercel --yes`
  + `vercel alias set ... campusos-staging.vercel.app`, then `npx vercel
  --prod --yes`) -- confirmed the new public key is actually present in
  each deployed JS bundle by curling it directly, not just trusting the
  deploy succeeded. Every existing push subscription is invalidated by this
  rotation; users get the browser's own subscribe prompt again next time
  they enable notifications.
- `.gitignore` given a set of glob safety nets (`.service_role_key*.local`,
  `scripts/.*credentials*.local.json`, `scripts/.sessions*.json`,
  `scripts/.vapid-keys*.local.json`, `*.local.json`) in addition to the
  existing exact-filename entries, so a new credential file added later
  without a matching explicit `.gitignore` line still can't reach git by
  accident.
- `.github/workflows/secret-scan.yml` added: gitleaks on every push/PR diff,
  plus a weekly full-history scan (nothing in CI checked for this before).
- Full-history `gitleaks` run done manually this session (174 commits
  scanned). Two findings, both already-known/deliberate publishable keys,
  not new leaks: the `test_db_crud.js` one from item 2 below, and the
  current, intentionally-hardcoded `PROD_ANON_KEY` in
  `.github/workflows/uptime.yml` (its own comment already explains why --
  publishable-by-design, "rotate here too if it's ever rotated in
  Supabase"). No hit on the `CampusOS@2026` password below -- gitleaks'
  generic rules match API-key-shaped strings, not arbitrary passwords, so
  that finding is still only confirmed by the direct `git log -S` search,
  not by the scanner. Don't take a clean gitleaks run as proof a password
  isn't sitting in history somewhere.

**Still needs action from you directly** (dashboard access this session
doesn't have, or a decision only you should make):
- **Supabase legacy `service_role`/`anon` JWTs** (production + staging):
  these are what `.service_role_key*.local` actually held. This project has
  already partly migrated to the new API key system (`sb_secret_...`/
  `sb_publishable_...` keys exist alongside the legacy ones -- see the
  `SUPABASE_SECRET_KEYS`/`SUPABASE_PUBLISHABLE_KEYS`/`SUPABASE_JWKS` edge
  function secrets), but the **legacy keys are still active** and nothing in
  the CLI can roll or disable them -- that's Dashboard -> Project Settings
  -> API -> Legacy API Keys, for both `dzjzjlylsfpmymkcavrq` (production)
  and `qmfmziilgkktwnqoxakk` (staging). Rolling/disabling breaks anything
  still coded against the legacy key by name until updated, so check what
  in this codebase still reads `SUPABASE_SERVICE_ROLE_KEY` as a static JWT
  before disabling outright.
- **Razorpay key secret + webhook secret** (production only -- staging never
  had its own, see `docs/DEPLOYMENT.md` §3): regenerate in the Razorpay
  Dashboard, then run `supabase secrets set RAZORPAY_KEY_SECRET=... 
  RAZORPAY_WEBHOOK_SECRET=... --project-ref dzjzjlylsfpmymkcavrq` **yourself,
  directly in your own terminal** rather than pasting the new value into a
  chat session -- the whole point of rotating is to stop a value from
  sitting somewhere it doesn't need to.
- **`GROQ_API_KEY`** (production): same reasoning, same fix -- regenerate at
  console.groq.com, `supabase secrets set` it yourself.
- **`RESEND_API_KEY` / Fast2SMS key**: same, whichever dashboards those come
  from (email/SMS dispatch infra, see the 2026-08-18 hardening entry above).
- **GitHub Actions repository secrets**: this session has no `gh` CLI/token
  to check or rotate them. `.github/workflows/backup.yml` references
  `SUPABASE_ACCESS_TOKEN` and `PROD_SUPABASE_SERVICE_ROLE_KEY` -- check
  Settings -> Secrets and variables -> Actions on the GitHub repo and rotate
  those two once the corresponding Supabase-side values above are rotated.
- **The account/password this file already flagged below**
  (`sanjaypadmaraj@nhce.edu.in` / `CampusOS@2026`) is a **separate, older**
  finding, not part of this incident -- see the section above. Reconfirmed
  still sitting in this **public** GitHub repo's history during this pass
  (`git log -S"CampusOS@2026"` -> introduced `5453fc4`, the files that used
  it removed in `8e82349`, but the string itself is permanent in both
  commits). **Password rotated** on the production account (the only
  environment it existed on -- staging has no matching account) via the
  same Admin Auth API path, to a value the account owner chose directly.
  Explicitly decided **not** to rewrite git history over this (disruptive:
  rewrites every commit hash, forces a push, breaks existing clones/forks/
  PRs) or make the repo private -- the owner's call, made knowingly: the old
  string stays permanently readable in this public repo's history, but is
  no longer a working credential.
- **Distribution hygiene going forward**: nothing in this repo generates
  ZIPs/archives (checked -- no `archiver`/`adm-zip`/`Compress-Archive`/zip
  script anywhere), so the exposure was a manual "zip the whole folder"
  export, not a code bug. Use `git archive HEAD -o campusos.zip` instead
  when you need to hand the codebase to anything/anyone -- it only includes
  tracked files, so a gitignored credential file can't ride along even by
  accident.

## 2026-08-23 finding: the real admin account's password was hardcoded in 19 public, tracked scripts

Found during a readiness-audit internal-security-audit pass (phase 05):
a second, separate instance of the exact same class of bug as the
`CampusOS@2026` incident above, in files that same incident-response pass
itself introduced. `scripts/setup-admin-account.mjs` -- the script that
creates/promotes the real owner's super_admin account, and is designed to
be run with `--env=production --yes-production` -- hardcoded the literal
password `Sanjay@123` for `1nh25cs265@usn.campusos.internal` ("Admin
(Sanjay Padmaraj)"). That literal, and copies of it, sat in **24 tracked
files** (not gitignored, this repo is public -- see above): the setup
script itself, `scripts/add-staging-sessions.mjs`,
`scripts/print-ci-staging-accounts-secret.mjs`, 20
`scripts/live-check-*.mjs` files that each independently re-hardcoded it
(in a `signIn(...)` call, or as a bare `const adminPassword = "..."`)
instead of reading it from a shared file -- despite several of those
files' own header comments already claiming the password came from
`setup-admin-account.mjs`'s credentials file, which didn't actually
exist -- and `tests/live/03-usn-login-and-cms.spec.js`, which typed the
literal directly into the real login form on every run. Introduced in
`8e823497` (14 Aug), the same commit that removed the *original*
`create_kingpin.js`/`test_login.js` hardcoded credential -- a regression
in the very pass meant to fix this class of bug. A separate, unrelated
file (`scripts/setup-facilities-account.mjs`) had the same pattern for the
`facilities.staff@nhce.edu.in` test account (`FacilitiesTest@2026`).

**Done, this pass** (pure code fix, no live credential touched -- an
autonomous session correctly refused to call the production Admin API
directly, even read-only, when attempted):
- `setup-admin-account.mjs` no longer hardcodes a password. It mints a
  random one via the Admin API only when creating the account fresh, and
  added a `--rotate` flag (must be run by a human, not through this
  script's default path) that resets an *existing* account's password to a
  fresh random value and writes it to the gitignored
  `scripts/.admin-credentials[.staging].local.json`.
- `setup-facilities-account.mjs` now mints a random password on first run
  and persists/reuses it via the same gitignored-credentials-file
  convention `setup-vendor-accounts.mjs`/`setup-store-account.mjs` already
  used correctly, instead of a literal.
- All 23 consumer files (22 `scripts/*.mjs` + the Playwright spec, via a
  new `tests/live/helpers/resolveAdminPassword.js`) now read the admin
  password from `.admin-credentials[.staging].local.json` instead of a
  hardcoded string, with a clear error telling you to run `--rotate` first
  if that file doesn't exist yet.

**Still needs action from you directly** (this session cannot touch the
real owner's live login without your say-so):
- **The account's actual current password, in both staging and
  production, is still `Sanjay@123` until you run
  `node scripts/setup-admin-account.mjs --rotate --env=production
  --yes-production` (and the staging equivalent) yourself.** Treat it as
  compromised the same way `CampusOS@2026` was treated — it's been
  sitting in this public repo's history since 14 Aug regardless of what
  the code does going forward.
- Same reasoning as `FacilitiesTest@2026` if `facilities.staff@nhce.edu.in`
  was ever created against a real environment with that literal — check and
  rotate via `setup-facilities-account.mjs` (no flag needed, it always
  resets on run) if so.
- Consider whether this warrants a closer look at every other
  `scripts/setup-*.mjs`/`scripts/live-check-*.mjs` file for the same
  pattern beyond this pass's grep sweep (`grep -rn "password.*:.*\"" scripts/`
  and `grep -rn "signIn(.*,.*\"" scripts/` were both used here and came back
  clean afterward, but a new script added later could reintroduce this).
  That sweep did turn up one more instance in the same pass, already fixed:
  `scripts/live-check-store-variants-stock.mjs` reset the real Udupi Canteen
  vendor account's password to a fixed literal (`LiveCheckTemp!2026`) on
  every run instead of a random one, even though the write-back to
  `.vendor-credentials.local.json` (the actual source of truth every other
  script reads from) was already correct -- only the *value* being written
  was the bug. Now generates a random value per run.

## Ongoing practices

- Never commit `.env`. It's gitignored; use `.env.example` as the template.
- Sensitive operations (pricing, payment verification, refunds, role
  changes, pickup redemption) live in `SECURITY DEFINER` Postgres functions
  or Edge Functions using the service_role key — never in client code. See
  `supabase/migrations/` and `supabase/functions/`.
- Before adding a new table, add an RLS policy in the same migration. A
  table with RLS enabled and no policies denies all access by default, which
  is the safe failure mode — prefer that over forgetting RLS entirely.
