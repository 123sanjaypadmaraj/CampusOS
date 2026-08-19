# Disaster recovery

This project is on Supabase's **free tier**, which has no built-in daily
backups or point-in-time recovery. The pipelines described here
(`.github/workflows/backup.yml` + `.github/workflows/storage-backup.yml` +
`scripts/backup-retention.mjs`) are the **only** safety net against data
loss on production — there is no second system quietly backing this up. If
you ever upgrade to a paid Supabase plan with its own backups, keep these
pipelines running anyway (an independent second copy, not reliant on
trusting one vendor's backup system alone, is good practice regardless).

## What's backed up

**Database** — a GitHub Action runs daily (`17 20 * * *` UTC, ~01:47 IST —
a low-traffic hour) against **production only**:

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

**Storage bucket file bytes** — a separate GitHub Action
(`.github/workflows/storage-backup.yml`) runs weekly (`37 20 * * 0` UTC,
Sunday — right after the daily DB backup) against **production only**:

1. Lists every storage bucket live from the Storage API (`GET
   /storage/v1/bucket`), excluding `backups` itself — so a bucket added by
   a future migration is picked up automatically instead of silently
   missing until someone remembers to update a hardcoded list.
2. Downloads every object in every bucket (`supabase storage cp -r`) —
   avatars, food/post/event/marketplace/lost-found/club images, print job
   PDFs, ID verification documents, vendor KYC documents, club files,
   message attachments, support ticket screenshots.
3. Tars and gzips the lot (`storage-YYYY-MM-DD.tar.gz`).
4. Uploads it to the same private bucket, under `backups/storage/`.
5. Prunes old archives down to a separate, smaller retention policy
   (below) — weekly cadence means far fewer archives pile up than the
   daily DB dump, but each one is much bigger.

Weekly (not daily) because file bytes change far less often than DB rows,
and a full re-copy of every bucket is a meaningfully bigger/slower job
than the ~150KB SQL dump. Trigger manually any time: GitHub → Actions →
"Storage backup (production)" → Run workflow.

Both pipelines share the same `backups` bucket and the same two repository
secrets (`SUPABASE_ACCESS_TOKEN`, `PROD_SUPABASE_SERVICE_ROLE_KEY`) — no
extra setup needed if the DB backup pipeline is already configured. The
bucket's per-object size limit was raised from 100MB to 500MB
(`supabase/migrations/20260819001500_backups_bucket_storage_size.sql`) to
comfortably fit the storage archive as it grows; 500MB exceeds the
project's total Supabase Storage quota on the current plan, so a single
archive can't realistically hit that ceiling.

## What's NOT backed up

- **Edge Function secrets** (`RAZORPAY_KEY_ID`, `VAPID_PRIVATE_KEY`, etc.).
  Supabase doesn't expose secret values back out once set (confirmed live:
  `supabase secrets list` only ever returns hashes, never values) — there
  is no way to back these up even if we wanted to. A fresh project needs
  every secret in `docs/DEPLOYMENT.md` re-entered by hand.
- **Staging.** Deliberately not backed up — see `docs/ENVIRONMENTS.md` for
  why (nothing on it is real/irreplaceable).
- **Total Supabase Storage quota headroom.** Both the storage archives
  themselves and the live buckets they copy count against the same
  project storage quota on the free tier. Retention (below) caps this at
  11 archives at any time, but if the live storage footprint grows large,
  worth watching that backups don't crowd out real data — not an issue at
  today's data volume.

## Retention policy

`scripts/backup-retention.mjs`, run at the end of every backup workflow —
`--kind=db` (the default) for the daily DB dump, `--kind=storage` for the
weekly storage archive:

**DB (`db/` prefix):**
- Last **14 daily** backups
- Newest backup in each of the last **8 ISO weeks**
- Newest backup in each of the last **12 calendar months**

So a problem noticed a month later still has something to restore from,
without keeping 365+ full dumps forever. Verified live against the real
production bucket while building this (seeded 41 synthetic dated backups
spanning ~15 months, confirmed the script kept exactly the expected 29 and
deleted the expected 12 — see git history for the exact run).

**Storage (`storage/` prefix):**
- Last **8** archives (~2 months at weekly cadence)
- Newest archive in each of the last **6 calendar months**
- No separate weekly tier — redundant when the source cadence is already
  weekly.

So at most **11** storage archives exist at once. Verified live against
the real staging bucket while building this (real recursive download of
every bucket incl. one with real files, real tar.gz, real upload, then
seeded 20 synthetic weekly-dated archives spanning ~5 months on top of the
1 real one — 21 total — confirmed the script kept exactly the expected 11
and deleted the expected 10; test artifacts cleaned up afterward, see git
history for the exact run).

## RPO / RTO

- **RPO (recovery point objective): ~24 hours for the database, ~7 days
  for storage file bytes.** Worst case, a disaster right before the next
  scheduled DB backup loses up to a day of writes (orders, posts,
  registrations, everything); a disaster right before the next scheduled
  storage backup loses up to a week of newly-uploaded files (a KYC doc or
  print job submitted that week, for example). Both are real, accepted
  gaps for a free-tier project with no PITR — if that's ever unacceptable,
  the fix is either upgrading Supabase's plan (gets you real PITR for the
  DB) or running these workflows more often (trivial cron change, more GH
  Actions minutes — storage in particular could move to daily if upload
  volume ever makes a week of exposure too much).
- **RTO (recovery time objective): not automated, budget 1-2 hours for a
  practiced DB restore, plus more for storage depending on file volume.**
  The restore procedure below is manual — there is no one-command "restore
  production" script for either. Practicing it once (the quarterly drill
  below) is what keeps these estimates realistic instead of aspirational.

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
6. **What a DB-only restore does NOT bring back:** Storage file bytes and
   Edge Function secrets. Edge Function secrets need re-entering by hand
   (see "What's NOT backed up" above). For storage file bytes, restore the
   matching (or nearest-preceding) storage archive separately:
   ```bash
   npx supabase --experimental storage cp ss:///backups/storage/storage-2026-08-16.tar.gz . --project-ref <target-project-ref>
   mkdir restore && tar -xzf storage-2026-08-16.tar.gz -C restore
   # for each bucket dir under restore/, upload it back:
   npx supabase --experimental storage cp -r restore/avatars ss:///avatars --project-ref <target-project-ref>
   # ...repeat per bucket (see .github/workflows/storage-backup.yml for the
   # full list, or list them live: GET /storage/v1/bucket)
   ```
   Note the storage archive's date won't exactly match the DB dump's date
   (different cadence — daily vs. weekly) — a full restore mixes the
   nearest DB dump and the nearest storage archive, which for `storage.objects`
   metadata rows and their actual file bytes could differ by up to a few
   days. Rows referencing files not yet in that week's storage archive (or
   files present in the archive but for a `storage.objects` row the DB
   dump predates) are the expected edge case; not usually worth reconciling
   by hand unless a specific missing file matters.
7. **Verify.** At minimum: sign in as a real test account, check
   `select count(*) from auth.users`, `select count(*) from public.orders`
   (or whatever's most load-bearing) look sane, spot-check that a few
   restored files (an avatar, a print job PDF) actually open, and run the
   live E2E suite (`tests/live/`, pointed at whichever project you just
   restored) before calling it done.

## Restore drills

**Not yet performed.** Recommend doing one against staging (safe,
disposable) before this is ever needed for real: take a real production
DB backup **and** a real production storage archive, restore both into
staging (overwriting staging's current state — fine, nothing there is
precious), and time how long steps 1-7 actually take end to end (DB
restore + storage restore + verification). Repeat quarterly, or after any
significant schema/bucket change, so the RTO estimate above stays honest
instead of theoretical. Note this is a real, separate follow-up from
"the backup pipelines exist and were verified live" above — a pipeline
producing a valid backup and someone actually restoring from one under
time pressure are different claims, and only the first has been checked.
