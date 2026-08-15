# Disaster recovery

This project is on Supabase's **free tier**, which has no built-in daily
backups or point-in-time recovery. The pipeline described here
(`.github/workflows/backup.yml` + `scripts/backup-retention.mjs`) is the
**only** safety net against data loss on production — there is no second
system quietly backing this up. If you ever upgrade to a paid Supabase
plan with its own backups, keep this pipeline running anyway (an
independent second copy, not reliant on trusting one vendor's backup
system alone, is good practice regardless).

## What's backed up

A GitHub Action runs daily (`17 20 * * *` UTC, ~01:47 IST — a low-traffic
hour) against **production only**:

1. Dumps the `public` schema's structure (tables, functions, triggers,
   policies) and the `public` + `auth` schemas' **data** (every row,
   including `auth.users` — a restore needs real accounts to mean
   anything) via `supabase db dump`, run twice (schema-only, then
   data-only — see the workflow file's comments for why) and concatenated.
2. Gzips it (`db-YYYY-MM-DD.sql.gz`, ~150KB compressed for the current
   dataset size).
3. Uploads it to a private Supabase Storage bucket (`backups/db/`) — no
   RLS policy grants the anon/authenticated keys any access to this
   bucket at all; only the Management-API-authenticated CLI/service_role
   key can reach it.
4. Prunes old backups down to the retention policy (below).

Trigger a backup manually any time: GitHub → Actions → "Database backup
(production)" → Run workflow.

## What's NOT backed up

- **Storage bucket file *contents*** (avatars, post/event images, ID
  verification documents, print job PDFs, etc.). The data dump captures
  `storage.objects` *metadata rows* (filenames, paths, owners) but not the
  actual file bytes — those live in Supabase's object store, not Postgres.
  If production storage is ever lost, uploaded files are gone even with a
  fresh restore from this pipeline. Not addressed by this pass — syncing
  actual file bytes would need `supabase storage cp -r` per bucket, which
  is a meaningfully bigger, slower job than the ~150KB SQL dump above; if
  this matters for compliance/liability, it needs a deliberate follow-up.
- **Edge Function secrets** (`RAZORPAY_KEY_ID`, `VAPID_PRIVATE_KEY`, etc.).
  Supabase doesn't expose secret values back out once set (confirmed live:
  `supabase secrets list` only ever returns hashes, never values) — there
  is no way to back these up even if we wanted to. A fresh project needs
  every secret in `docs/DEPLOYMENT.md` re-entered by hand.
- **Staging.** Deliberately not backed up — see `docs/ENVIRONMENTS.md` for
  why (nothing on it is real/irreplaceable).

## Retention policy

`scripts/backup-retention.mjs`, run at the end of every backup workflow:

- Last **14 daily** backups
- Newest backup in each of the last **8 ISO weeks**
- Newest backup in each of the last **12 calendar months**

So a problem noticed a month later still has something to restore from,
without keeping 365+ full dumps forever. Verified live against the real
production bucket while building this (seeded 41 synthetic dated backups
spanning ~15 months, confirmed the script kept exactly the expected 29 and
deleted the expected 12 — see git history for the exact run).

## RPO / RTO

- **RPO (recovery point objective): ~24 hours.** Worst case, a disaster
  right before the next scheduled backup loses up to a day of writes
  (orders, posts, registrations, everything). This is a real, accepted
  gap for a free-tier project with no PITR — if that's ever unacceptable,
  the fix is either upgrading Supabase's plan (gets you real PITR) or
  running this workflow more often (trivial cron change, more GH Actions
  minutes).
- **RTO (recovery time objective): not automated, budget 1-2 hours for a
  practiced restore.** The restore procedure below is manual — there is no
  one-command "restore production" script. Practicing it once (the
  quarterly drill below) is what keeps that 1-2 hour estimate realistic
  instead of aspirational.

## Restore procedure

1. **Get the backup file.** Via the Supabase Dashboard (Storage →
   `backups` bucket → `db/`) or the CLI:
   ```bash
   npx supabase --experimental storage cp ss:///backups/db/db-2026-08-15.sql.gz . --project-ref <target-project-ref>
   gunzip db-2026-08-15.sql.gz
   ```
2. **Decide the target.** Restoring into the *same* project you're
   recovering (because data got corrupted/deleted, schema intact) is
   different from restoring into a *brand-new* project (because the whole
   project is gone). Either way, the SQL file is schema-then-data and
   mostly idempotent (`create table if not exists`, etc. — same
   conventions as `supabase/migrations/`), but restoring into a
   *non-empty* project will hit unique-constraint conflicts on the data
   `INSERT`/`COPY` statements for any row that already exists. For a
   full disaster (project gone), create a fresh Supabase project first.
3. **Get connection credentials** without needing the DB password (same
   mechanism the backup pipeline itself uses):
   ```bash
   npx supabase link --project-ref <target-project-ref>
   npx supabase db dump --linked --dry-run   # prints ephemeral PGHOST/PGUSER/PGPASSWORD
   ```
4. **Restore:**
   ```bash
   export PGHOST=... PGPORT=... PGUSER=... PGPASSWORD=... PGDATABASE=postgres  # from step 3
   psql -f db-2026-08-15.sql
   ```
   If this is a fresh project, run `supabase db push --linked` **first**
   to apply the real migration set (gets you the RLS policies, RBAC
   grants, triggers, storage buckets, etc. that a schema-only restore
   from an old dump might not have if migrations have moved on since that
   backup was taken) — then restore just the *data* half separately
   instead of the concatenated file, so the current schema isn't
   overwritten by a possibly-older one:
   ```bash
   # split the two halves back apart if needed, or re-dump data-only from
   # the source instead of relying on the backup's schema section at all
   ```
5. **Known restore gotcha:** `pg_dump --data-only` warned live (while
   building this pipeline) about a circular foreign key on `comments`
   (`parent_comment_id` self-references `comments.id`). A plain `psql -f`
   restore usually still works because Postgres defers constraint
   checking to the end of the statement/transaction, but if it doesn't,
   re-run with triggers disabled for that table:
   ```sql
   alter table public.comments disable trigger all;
   -- re-run the COPY/INSERT statements for comments
   alter table public.comments enable trigger all;
   ```
6. **What a restore does NOT bring back:** Storage file bytes and Edge
   Function secrets — see "What's NOT backed up" above. Re-upload/
   re-configure those separately.
7. **Verify.** At minimum: sign in as a real test account, check
   `select count(*) from auth.users`, `select count(*) from public.orders`
   (or whatever's most load-bearing) look sane, and run the live E2E
   suite (`tests/live/`, pointed at whichever project you just restored)
   before calling it done.

## Restore drills

**Not yet performed.** Recommend doing one against staging (safe,
disposable) before this is ever needed for real: take a real production
backup, restore it into staging (overwriting staging's current state —
fine, nothing there is precious), and time how long steps 1-7 actually
take. Repeat quarterly, or after any significant schema change, so the RTO
estimate above stays honest instead of theoretical.
