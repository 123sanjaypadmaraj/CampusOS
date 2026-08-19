# Data retention policy

What CampusOS keeps, for how long, and what's still an open question. This
is a starting policy written during the 2026-08-14/15 production-hardening
pass, not a legal review — CampusOS handles real student data (names,
USNs, emails, phone numbers, ID verification documents) for a campus in
India; if this ever needs to formally comply with India's DPDP Act (or any
other jurisdiction's data protection law), the open questions below need a
real legal/product decision, not just an engineering default.

## Backups

Covered in full in `docs/DISASTER_RECOVERY.md`. Database: 14 daily + 8
weekly + 12 monthly snapshots (oldest possible retained: ~12 months).
Storage bucket file bytes (weekly cadence): 8 recent + 6 monthly archives
(oldest possible retained: ~6 months). Both auto-pruned by
`scripts/backup-retention.mjs`.

## Error logs (`error_logs`, monitoring)

- `resolved = true` rows are deleted after **90 days** by
  `prune_old_error_logs()` (`supabase/migrations/20260814005200_error_logs.sql`).
- `resolved = false` rows are kept **indefinitely** until an admin resolves
  them — deliberate: an unresolved error shouldn't silently disappear.
- `prune_old_error_logs()` is not currently scheduled anywhere (no pg_cron
  job, no GitHub Action) — it's callable but nothing calls it yet. Open
  item: either add a `pg_cron` schedule (if the extension is available on
  this Supabase plan) or a small addition to the existing uptime/backup
  GitHub Actions workflows to call it periodically.

## Audit logs (`audit_logs`)

No retention policy exists — every row is kept forever today. Worth a
decision once volume matters (currently low). Not touched by this pass.

## Student ID verification documents (`documents` storage bucket)

Kept indefinitely today, whether the verification was approved, rejected,
or never reviewed. This is the most sensitive data category in the app (a
photo ID) and currently has no expiry. **Open question, not resolved by
this pass**: how long a rejected/never-reviewed ID photo should be kept
before automatic deletion, since there's no ongoing reason to hold onto it
once no longer needed for verification.

## Suspended accounts

An admin can suspend a `profiles` row (`status = 'suspended'`,
`suspended_reason` set) — see `20260814003000_enforce_account_suspension.sql`.
This **hides and blocks** the account (can't post, order, register, etc.
— enforced by `reject_if_suspended()`), it does not delete any data. There
is currently **no self-service account deletion** anywhere in the app — a
student cannot request their own data be removed. **Open question**: if
this needs to support a "right to erasure"-style request, that flow
doesn't exist yet and needs a product decision (hard-delete vs.
anonymize-in-place, and what happens to their orders/posts/event history
which other people's records reference).

## What's explicitly fine to keep indefinitely

Everything not called out above — profiles, posts, orders, event
registrations, marketplace listings, etc. — is treated as ordinary
operational data with no expiry, same as before this pass. This document
only tracks categories that specifically needed a decision (backups,
error logs, ID documents) or are flagged as an open gap (audit logs,
account deletion).
