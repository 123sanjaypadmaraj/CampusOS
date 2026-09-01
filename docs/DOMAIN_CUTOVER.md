# Domain cutover runbook

Moving the production frontend from `campusos-amber.vercel.app` to a real
domain. Every step below that's a registrar/DNS-provider button click is
left for you — everything a repo change could remove has already been made
(see "What this repo now does automatically" at the bottom).

Replace `your-domain.example` everywhere below with the domain you actually
bought. `campusos.app` — the name `docs/DEPLOYMENT.md` §5 used to
suggest — is **not available**; it's an unrelated site with zero connection
to this project (confirmed 31 Aug 2026 via the Vercel dashboard: 0 domains
attached to the `campus-os2/campusos` project). A single domain is enough —
the `vendor.`/`admin.`/`facilities.` subdomain idea in the product doc is for
apps that don't exist yet.

Do this in order. Steps 1-4 are additive (nothing that currently works
stops working while you do them) — the only step that can break something
is step 8, and it's placed last on purpose.

## 1. Add the domain in Vercel

1. https://vercel.com/dashboard → the `campus-os2/campusos` project →
   **Settings → Domains**.
2. Type `your-domain.example` (and, separately, `www.your-domain.example`
   if you want both) → **Add**.
3. Vercel shows you the exact DNS record(s) it needs for *that specific
   domain* — copy those verbatim if they differ from step 2 below (Vercel
   occasionally assigns a per-account edge IP or shows a `TXT _vercel...`
   ownership-verification record if the domain has ever touched another
   Vercel account). The values below are Vercel's standard, current ones
   and are correct for the overwhelming majority of setups.
4. Pick one of `your-domain.example` / `www.your-domain.example` as
   **primary** (the Domains page has a "Set as Primary Domain" action on
   whichever one you want canonical) — Vercel auto-redirects the other one
   to it. Recommended: apex (`your-domain.example`) as primary, `www` as
   the redirect target, since every existing link/QR code/printed material
   would otherwise need `www.`.

## 2. DNS records to add

At your registrar or DNS provider (GoDaddy, Namecheap, Cloudflare, Google
Domains, etc. — the record types below are identical everywhere; only the
provider's own UI for adding a record differs):

| Type | Host/Name | Value | Notes |
|---|---|---|---|
| `A` | `@` (or blank / apex) | `76.76.21.21` | Vercel's anycast edge IP for apex domains. |
| `CNAME` | `www` | `cname.vercel-dns.com` | Only needed if you're also adding `www.your-domain.example`. |
| `TXT` | *(only if Vercel's dashboard showed one)* | *(the exact value Vercel gave you)* | Ownership verification — skip entirely if step 1 didn't ask for it. |

**Alternative — full nameserver delegation.** If your registrar lets you
change nameservers (not just add records) and you'd rather not manage A/CNAME
records by hand, Vercel's Domains page also offers **"Use Vercel's
Nameservers"** (`ns1.vercel-dns.com`, `ns2.vercel-dns.com`). That hands
Vercel the whole zone (any MX/other records you have — e.g. Google
Workspace mail — must be recreated in Vercel's DNS UI first, or mail
breaks). For a single-purpose domain with no existing email/other DNS, this
is simpler than the table above; for a domain that already has other
records on it, stick to the A/CNAME approach so you don't have to
re-recreate everything else.

DNS propagation is typically minutes, occasionally up to ~48 hours
depending on the previous record's TTL. Vercel's Domains page shows a live
"Valid Configuration" ✅ / pending status per domain — wait for that, don't
just guess from `dig`.

## 3. SSL verification

Nothing to configure — Vercel auto-provisions a Let's Encrypt certificate
the moment DNS resolves correctly, no button to click. Confirm it actually
happened before moving on:

```bash
curl -vI https://your-domain.example 2>&1 | grep -E "SSL certificate|subject:|expire"
```

Expect `subject: CN=your-domain.example` (or a wildcard covering it) and an
expiry ~90 days out. The Vercel Domains page also shows a padlock/"Valid
Encryption" ✅ next to the domain once issuance completes — usually within
a few minutes of DNS validating, occasionally up to ~1 hour.

If it's been over an hour and still pending: the most common cause is a
leftover conflicting `A`/`AAAA`/`CNAME` record at the apex or `www` host
from a previous provider (e.g. a parking-page record) — check your DNS
provider's record list for duplicates, not just what you added.

## 4. Point Supabase Auth at the new domain

Magic-link sign-in (`src/services/mvpService/auth.js`) redirects back to
`window.location.origin` — that's already domain-agnostic, no code change
needed. But Supabase itself only allows redirecting to URLs on an
allowlist:

1. Supabase Dashboard → **production** project (`dzjzjlylsfpmymkcavrq`) →
   **Authentication → URL Configuration**.
2. **Site URL**: change to `https://your-domain.example`.
3. **Redirect URLs**: add `https://your-domain.example/*` (keep the
   existing `https://campusos-amber.vercel.app/*` entry too, at least
   through step 8 below, so the old URL doesn't break mid-cutover).

## 5. Point the two email-link Edge Functions at the new domain

Password-reset and email-verification links are built server-side
(`request-password-reset`, `send-email`, `request_contact_email_verification()`)
and, as of this pass, read the frontend URL from config rather than a
hardcoded string — see "What this repo now does automatically" below. Set
the new value on **production**:

```bash
npx supabase secrets set FRONTEND_URL=https://your-domain.example --project-ref dzjzjlylsfpmymkcavrq
```

And the DB-side copy used by `request_contact_email_verification()`
(same `app_config` table `functions_base_url` already uses per
`docs/ENVIRONMENTS.md`):

```sql
update public.app_config set value = 'https://your-domain.example'
  where key = 'frontend_base_url';
```

Run against production only — staging should keep pointing at
`https://campusos-staging.vercel.app` unless you're also giving staging its
own subdomain (not necessary for this cutover).

## 6. Point CI/CD's production bundle-check at the new domain

`.github/workflows/deploy.yml` (staged, never yet run end-to-end — see
`docs/DEPLOYMENT.md` §7) and `.github/workflows/uptime.yml` (already live,
runs every 15 min) both read the production URL from a repo *variable* now,
not a hardcoded string — see below. Set it once:

GitHub repo → **Settings → Secrets and variables → Actions → Variables tab**
→ **New repository variable**:

- Name: `PROD_URL`
- Value: `https://your-domain.example`

No code change, no PR, no redeploy needed — both workflows pick it up on
their next run.

## 7. Redirect the old `campusos-amber.vercel.app` URL — do this last

Only after steps 1-3 show the new domain fully live with a valid
certificate. Two ways to do it; the first is enough on its own:

**A. Vercel dashboard (recommended — no deploy needed).** Project →
Settings → Domains → find the `campusos-amber.vercel.app` row → **Edit** →
enable **"Redirect to another Domain"** → target
`your-domain.example` → redirect type **308 Permanent**. Takes effect
immediately, no rebuild.

**B. `vercel.json` (defense-in-depth / if you'd rather it live in code).**
Add this to the `vercel.json` in the repo root, redeploy, and it 308s at
the edge before the redirect in A would even be checked:

```json
{
  "redirects": [
    {
      "source": "/:path*",
      "has": [{ "type": "host", "value": "campusos-amber.vercel.app" }],
      "destination": "https://your-domain.example/:path*",
      "permanent": true
    }
  ]
}
```

This isn't pre-added to `vercel.json` in this pass on purpose: shipping it
before the new domain is verified live would redirect production's
*only currently-working URL* to a domain that doesn't resolve yet — a
self-inflicted outage. Add it only once step 3 is green.

## 8. Verify, then watch for a week

```bash
# New domain serves the app over HTTPS
curl -sI https://your-domain.example | head -1

# Old URL now redirects (once step 7 is done)
curl -sI https://campusos-amber.vercel.app | grep -i location

# Magic-link + password-reset actually land on the new domain
# (sign in / request a reset through the real UI and check the email link)
```

- Watch `.github/workflows/uptime.yml`'s scheduled runs (Actions tab) for a
  few days — it's now checking `PROD_URL`, so it'll immediately flag if the
  new domain becomes unreachable.
- Leave the old `campusos-amber.vercel.app` Redirect URL entry in Supabase's
  auth allowlist (step 4) for a couple of weeks in case any already-sent
  email (a reset link mailed right before cutover) still points at it.

## Rollback plan

Every step above is reversible independently — nothing is destructive:

- **DNS records (step 2)**: delete or revert them at your registrar. Once
  they stop resolving, the new domain simply goes dark; `campusos-amber.vercel.app`
  was never touched and keeps working the whole time (until you do step 7).
- **Vercel domain (step 1)**: Settings → Domains → remove
  `your-domain.example`. Harmless — it only affects that hostname.
- **Supabase Auth URL config (step 4)**: change Site URL back to
  `https://campusos-amber.vercel.app`; you were told to leave the old
  Redirect URL entry in place, so nothing to re-add there.
- **`FRONTEND_URL` secret / `app_config.frontend_base_url` (step 5)**:
  `npx supabase secrets set FRONTEND_URL=https://campusos-amber.vercel.app --project-ref dzjzjlylsfpmymkcavrq`
  and the matching `update public.app_config set value = ...` — both fall
  back to that exact value automatically if unset, so even forgetting this
  step fails safe.
- **`PROD_URL` repo variable (step 6)**: delete the variable (or set it back
  to the old URL) in GitHub Settings — both workflows fall back to the old
  URL automatically if the variable is absent.
- **The redirect (step 7)**: this is the one step that actively changes
  behavior for existing visitors. To undo: Vercel dashboard →
  `campusos-amber.vercel.app` → **Edit** → turn "Redirect to another
  Domain" back off (instant), or, if you used the `vercel.json` route,
  revert that commit and redeploy. Either way `campusos-amber.vercel.app`
  immediately starts serving the app directly again — nothing about the
  app itself, the database, or its data was ever touched by this cutover.

If something breaks mid-cutover and you're not sure which step caused it,
the fastest safe move is always step 7's rollback first (stop redirecting
the old URL) — that alone restores the one URL every existing bookmark,
QR code, and sent email points at, regardless of what's wrong with the new
domain.

## What this repo now does automatically

Shipped in this pass so the above is config, not code:

- `supabase/functions/request-password-reset/index.ts` and
  `supabase/functions/send-email/index.ts` build their links from a
  `FRONTEND_URL` env var (falls back to
  `https://campusos-amber.vercel.app` if unset — zero behavior change until
  step 5 is done).
- `request_contact_email_verification()` (`supabase/migrations/20260901000200_domain_cutover_frontend_base_url.sql`)
  reads the same URL from `public.app_config` (`frontend_base_url` key,
  same table/pattern `functions_base_url` already used for the Edge
  Function dispatch URL) instead of a hardcoded string.
- `.github/workflows/uptime.yml` and `.github/workflows/deploy.yml`'s
  production bundle-hash check both read a `PROD_URL` repo variable
  (falls back to the current domain if unset).
- Edge function CORS (`supabase/functions/_shared/cors.ts`) is already
  `Access-Control-Allow-Origin: "*"` — domain-agnostic by design, nothing
  to change there.
- The CSP in `vercel.json` uses `'self'` for all first-party directives, not
  a hardcoded origin — nothing to change there either.
- Magic-link auth (`src/services/mvpService/auth.js`) already redirects via
  `window.location.origin`, not a hardcoded URL.

Nothing else in the codebase hardcodes `campusos-amber.vercel.app` —
verified by grepping the full repo (excluding `node_modules`) before
writing this doc.
