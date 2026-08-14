# CampusOS database migrations

This directory is the **single source of truth** for the CampusOS schema. It
supersedes every file under `src/supabase/archive/` — those are kept only for
historical reference and must not be run against any database again (several
of them grant `for all to anon, authenticated using (true)`, i.e. world-write
access to every table, which this migration set explicitly removes).

## Applying these migrations

You need a Supabase **access token** or the project's **database connection
string** to apply these — the app's `.env` only ever holds the public `anon`
key, which cannot run DDL. Two supported ways to apply:

### Option A — Supabase CLI (recommended)

```bash
npx supabase login                       # opens a browser to authenticate
npx supabase link --project-ref <ref>    # <ref> is in your Supabase project URL
npx supabase db push                     # applies every migration in order
```

### Option B — SQL Editor (manual, no CLI needed)

Open the Supabase Dashboard → SQL Editor, and run each file in this folder
**in filename order** (they're timestamp-prefixed). Every migration is
idempotent (`create table if not exists`, `add column if not exists`, guarded
`do $$ ... exception when ... $$` blocks) so it's safe to re-run if you're
unsure whether a step already applied.

## What changed vs. the old schema

- **RLS was fully open.** `canonical_schema_and_seed.sql` granted
  `for all to anon, authenticated using (true) with check (true)` on every
  table, including `orders`, `profiles`, and `audit_logs`. Anyone with the
  public anon key — no login required — could read or write any row,
  including setting their own `profiles.role` to `super_admin` (the
  role-protection trigger only blocked the change when `auth.uid()` was
  **not** null, i.e. backwards). `0011_rls_policies.sql` replaces all of this
  with real `auth.uid()`-scoped policies.
- **Order creation/payment/pickup moved server-side.** The frontend used to
  `insert` directly into `orders`/`order_items`, trust `payment_status` from
  the browser, and store static pickup codes. Now `create_food_order()`,
  `create_payment_order()`, `record_payment_event()` (webhook-only) and
  `redeem_pickup_token()` are the only way to touch these tables.
- **A real order/ticket/booking state machine** replaces free-text status
  fields, enforced in Postgres (`order_status_transitions`,
  `service_request_status_transitions`, the booking exclusion constraint).
- **RBAC tables** (`roles`, `permissions`, `role_permissions`, `user_roles`)
  back every privileged RLS policy and RPC, instead of ad-hoc
  `role === 'vendor'` string checks.
- **Idempotency** on order creation (`idempotency_key`), so retried "Pay"
  clicks under flaky Wi-Fi don't create duplicate orders.
- **Double-booking is impossible at the database level** via a `gist`
  exclusion constraint on `bookings`, not just a frontend calendar check.

## Applying to a fresh (empty) database

Run the files in order — 0001 through 0014. Seed data (0013) is safe to skip
for a real production campus; it only inserts demo canteens/food
items/clubs/events/locations/services tagged to the `nhce` campus slug.
