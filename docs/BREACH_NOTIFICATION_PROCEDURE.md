# Breach notification procedure (draft)

Prep for readiness-audit phase 6's remainder (go-live runbook step 5). This
is a starting draft written to unblock a legal review, not a substitute for
one — same posture as `docs/DATA_RETENTION.md` and the in-app Privacy
Policy: written in plain language for a campus deployment, not drafted or
reviewed by a lawyer. Have counsel check this against India's DPDP Act 2023
(notably Section 8(6), which requires intimating the Data Protection Board
and affected data principals of a personal data breach) before treating it
as binding.

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
  internal — whoever holds the Grievance Officer / admin point-of-contact
  role today (see the Privacy Policy's Grievance section; currently campus
  admin standing in for a formally appointed Grievance Officer).
- **Without undue delay, target within 72 hours of confirming a High
  incident:** the Data Protection Board of India, per DPDP Act Section
  8(6) — the Board's prescribed form/manner isn't settled in the rules as
  of this draft; confirm the current filing method before an actual
  incident, don't assume this document is current.
- **Without undue delay, same target window:** every affected data
  principal (student, vendor, or admin) whose data was actually exposed,
  by email to the address on file, using the template below.
- **Within 7 days for High-severity incidents:** a public disclosure if the
  incident affects a significant share of users, even if not individually
  identifiable (mirrors typical practice; not a DPDP-mandated number as of
  this draft).

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
> **Who to contact:** [Grievance Officer / admin contact + how to reach
> them].
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

## Open items this draft doesn't resolve

- **Named Grievance Officer.** This document reuses the same placeholder
  ("campus admin") as the Privacy Policy. Once a real name/contact exists,
  update both this doc and the in-app Privacy Policy section together.
- **DPDP Board filing mechanics.** The exact prescribed form/manner for
  Section 8(6) intimation should be confirmed against the current DPDP
  Rules before relying on the 72-hour target above.
- **Legal sign-off.** Everything above is an engineering-side starting
  point — it hasn't been reviewed by counsel.
