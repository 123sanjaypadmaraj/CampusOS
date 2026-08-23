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
— enforced by `reject_if_suspended()`), it does not delete any data.

## Self-service account deletion — corrected 2026-08-24

This document previously said "no self-service account deletion exists
anywhere in the app" — that was true when this document was first written
(14/15 Aug) but went stale: `20260818000500_email_domain_enforcement_and_account_deletion.sql`
(18 Aug) added exactly that, and it's been live since. A student can
request deletion from their profile page at any time
(`request_account_deletion()` RPC); an admin reviews and actions it via
`admin_process_account_deletion()` rather than it happening instantly,
since the account's data intersects other people's records (a vendor's
order history, an event roster, etc.) — the chosen approach is a
**soft-delete** (`profiles.status = 'deleted'`), same posture as
suspension, not a hard delete/anonymize pass. A student can cancel their
own pending request before it's actioned. This is the "right to
erasure"-equivalent flow the previous version of this document flagged as
missing — the *particular* design decision it asked for (hard-delete vs.
anonymize-in-place) is answered (soft-delete), but a true hard-delete pass
that actually removes rows, rather than just hiding the account, is still
undecided and out of scope for this correction.

## Self-service data export — added 2026-08-24

Closed the matching gap on the read side: `export_my_data()`
(`20260824000100_export_my_data.sql`), callable from the same profile page,
returns a jsonb snapshot of everything scoped to `auth.uid()` across the
tables that hold a student's own generated activity (orders, event
registrations, club memberships, marketplace listings, lost &amp; found
reports, support tickets, service requests, bookings, print jobs,
emergency contacts, posts/comments, student verification, and account
deletion request history) and downloads it as a `.json` file client-side.
Computed on read, nothing is stored server-side. Every export call is
logged to `audit_logs` (`account.export_data`). Not exhaustive over every
one of this schema's ~90 tables — see that migration's header comment for
the scoping rationale — but covers what a data-principal access request
would reasonably expect.

## What's explicitly fine to keep indefinitely

Everything not called out above — profiles, posts, orders, event
registrations, marketplace listings, etc. — is treated as ordinary
operational data with no expiry, same as before this pass. This document
only tracks categories that specifically needed a decision (backups,
error logs, ID documents) or are flagged as an open gap (audit logs,
account deletion).
