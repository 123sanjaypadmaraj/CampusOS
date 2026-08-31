# Breach notification procedure

Prep for readiness-audit phase 6's remainder (go-live runbook step 5). This
is a starting draft written to unblock a legal review, not a substitute for
one — same posture as `docs/DATA_RETENTION.md` and the in-app Privacy
Policy: written in plain language for a campus deployment, not drafted or
reviewed by a lawyer. Have counsel check this against India's DPDP Act 2023
(notably Section 8(6), which requires intimating the Data Protection Board
and affected data principals of a personal data breach) before treating it
as binding.

> **⬛ REQUIRES YOUR INPUT — the only thing this document can't decide for
> you:** the real Grievance Officer contact used in step 3 and the
> notification template below. See `docs/GRIEVANCE_OFFICER.md` — fill that
> document in first; everything else here uses a decidable default and
> needs no further input before an incident happens.

## 1. Detection

A "personal data breach" here means unauthorized access, disclosure,
alteration, or loss of any data covered by the Privacy Policy — account
info, ID verification photos, order/payment records, etc. Sources that
should surface one:

- The error-tracking/alerting system (`error_logs`, threshold alerting via
  pg_cron — see the observability pass) flagging an anomaly in auth,
  storage, or payment paths.
- `audit_logs` showing privileged access outside its normal pattern.
- A report from a student, vendor, or admin.
- A report from the external pentest (once commissioned — step 4).
- A cloud/hosting provider (Supabase, Vercel, Razorpay) notifying us
  directly of an incident on their side.

## 2. Triage — severity

| Level | Definition | Example |
|---|---|---|
| **Low** | Contained, no evidence of actual exposure | A misconfigured RLS policy caught before any row was actually read by an unauthorized party |
| **Moderate** | Limited, identifiable exposure | One account's data exposed to another single account via a bug |
| **High** | Broad or sensitive exposure | Any exposure of ID verification photos, payment details, or a credential (password/API key/session token) at scale |

Severity decides the notification window below. When in doubt, escalate to
the higher severity — this list can't anticipate every real incident.

## 3. Who gets notified, and within what window

- **Immediately (within 1 hour of confirming a Moderate/High incident):**
  internal — the Grievance Officer named in `docs/GRIEVANCE_OFFICER.md`
  (interim default: campus admin, until that document's appointment field
  is filled in).
- **Without undue delay, target within 72 hours of confirming a High
  incident:** the Data Protection Board of India, per DPDP Act Section
  8(6). **Default filing channel, since the Board's prescribed form/manner
  isn't settled in the rules as of this draft:** send a written intimation
  (the template below, adapted) to whatever contact channel the Board's
  official website (meity.gov.in is the current home of DPDP Act
  publications; the Board is expected to publish its own site/portal once
  operational — check there first) lists at the time, and — regardless of
  which channel actually exists — keep a dated internal record of the
  attempt (who sent it, when, to what address/portal, and any
  acknowledgment received) as evidence of a good-faith, on-time attempt.
  That record is what actually protects you if the "correct" channel turns
  out to have changed by the time of a real incident; don't skip logging
  it just because the channel felt uncertain.
- **Without undue delay, same target window:** every affected data
  principal (student, vendor, or admin) whose data was actually exposed,
  by email to the address on file, using the template below.
- **Within 7 days for High-severity incidents:** a public disclosure if the
  incident affects a significant share of users, even if not individually
  identifiable (mirrors typical practice; not a DPDP-mandated number as of
  this draft). Default publication channel: a notice on the in-app Legal
  page (`LegalContent()`) plus an email to all affected users' addresses
  on file — no separate public website exists for this deployment, so
  reuse the channel that's already there rather than standing up a new
  one.

Low-severity incidents are logged and reviewed internally; no external
notification unless triage later upgrades the severity.

## 4. Notification template

> Subject: Important notice about your CampusOS account data
>
> [Name], we're writing to let you know about a data security incident
> that affected your CampusOS account.
>
> **What happened:** [plain-language description — what was accessed, by
> whom if known, when discovered].
>
> **What data was involved:** [specific fields — e.g. "your name and USN",
> never vaguer than what's actually known].
>
> **What we've done:** [containment action taken, e.g. "revoked the
> affected credential", "patched the access-control gap"].
>
> **What you should do:** [concrete action — e.g. "change your password",
> "watch for suspicious activity on X"], or "no action needed" if none
> applies.
>
> **Who to contact:** [Grievance Officer contact from
> `docs/GRIEVANCE_OFFICER.md` + how to reach them].
>
> We take this seriously and are sorry this happened.

## 5. Post-incident

- Write up what happened, root cause, and the fix, in the same style as
  the observability pass's incident notes.
- Decide whether the fix needs a schema/RLS change, not just a one-off
  patch — check whether other tables have the same gap before closing it
  out.
- Update this document if the incident revealed a gap in the procedure
  itself (a source of detection it didn't cover, a window that was
  unrealistic in practice, etc.).
- Keep the incident write-up, the notifications sent, and the DPB filing
  record (step 3) for **at least 3 years** — same default recordkeeping
  window as `docs/GRIEVANCE_OFFICER.md` uses, for the same reason (no
  DPDP-specific figure is settled as of this draft; reuse one consistent
  default rather than inventing a different number per document).

## Open items this draft doesn't resolve

- **Named Grievance Officer.** Isolated into its own document —
  `docs/GRIEVANCE_OFFICER.md` — since the breach procedure, the Privacy
  Policy, and this doc's own step 3/notification template all need the
  same real name/email/phone. Fill that one document in and every
  reference here resolves itself.
- **DPDP Board filing mechanics.** This draft now has a default (step 3
  above: check the Board's official channel at incident time, log the
  attempt regardless of which channel exists), but the exact prescribed
  form/manner for Section 8(6) intimation still isn't settled in the rules
  as of this draft — reconfirm before an actual incident, don't assume the
  default channel described above is still current.
- **Legal sign-off.** Everything above is an engineering-side starting
  point — it hasn't been reviewed by counsel.
