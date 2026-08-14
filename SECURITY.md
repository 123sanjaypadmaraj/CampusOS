# Security notes

## Action required before this goes anywhere near production

Two real secrets were committed to this repository's git history and must be
treated as **compromised**:

1. **A live Supabase account password** — `create_kingpin.js`, `test_login.js`
   and `test_signup.js` (removed in this pass) hardcoded the password
   `CampusOS@2026` for the account `sanjaypadmaraj@nhce.edu.in`, and the app
   itself (`src/App.js`) auto-signed into that account on every page load.
   **Rotate this password** in Supabase Dashboard → Authentication → Users,
   or delete the account if it was only ever used for local testing.
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

## Ongoing practices

- Never commit `.env`. It's gitignored; use `.env.example` as the template.
- Sensitive operations (pricing, payment verification, refunds, role
  changes, pickup redemption) live in `SECURITY DEFINER` Postgres functions
  or Edge Functions using the service_role key — never in client code. See
  `supabase/migrations/` and `supabase/functions/`.
- Before adding a new table, add an RLS policy in the same migration. A
  table with RLS enabled and no policies denies all access by default, which
  is the safe failure mode — prefer that over forgetting RLS entirely.
