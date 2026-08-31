# Grievance Officer

Formalizes the role the Privacy Policy (`LegalContent()` in `src/App.jsx`)
and `docs/BREACH_NOTIFICATION_PROCEDURE.md` both already refer to as
"campus admin standing in for a formally designated Grievance Officer."
Written to the same posture as the other legal-prep docs in this
directory: an engineering-side starting draft using DPDP-compliant
defaults and industry-standard choices, not a substitute for counsel
reviewing it against the current DPDP Act 2023 and its rules.

> **⬛ REQUIRES YOUR INPUT — the only thing this document can't decide for you:**
> the real name, official email address, and phone number of the person who
> will actually hold this role. Nothing below is legally sufficient until
> that goes into (1) this file's "Current appointment" section and (2) the
> Privacy Policy's grievance paragraph in `src/App.jsx`, in the same edit.
> Until then, both places correctly keep the generic "campus admin" contact
> as the interim default — that's a deliberate placeholder, not a bug.

## Why this role exists

India's DPDP Act, 2023 gives a data principal a right to grievance
redressal against a Data Fiduciary (Section 13), and separately requires a
Data Fiduciary to publish the business contact information of a person
able to answer a data principal's questions about their personal data
(Section 8(9)). A full statutory Data Protection Officer is only mandatory
for entities the Board notifies as a "Significant Data Fiduciary" — a
single-campus deployment like this one is very unlikely to meet that bar
on its own, so this document deliberately scopes the role as a
**Grievance Officer / accountable privacy contact**, not a full DPO
appointment. Confirm current SDF thresholds with counsel before assuming
that stays true as CampusOS grows.

## Scope

This role handles **data-protection grievances only** — questions or
complaints about what personal data CampusOS holds, how it's used, a
correction/erasure/export request that the in-app self-service tools
(Profile page: edit info, hide from directory, download data, request
deletion) didn't resolve, or a report that data was mishandled or exposed.
General app support (a broken feature, an order issue, a lost & found
question) should keep going through the existing Support Tickets system —
routing a data-protection complaint into this role instead of general
support is what actually satisfies the statutory requirement; a shared
inbox that also gets "my order didn't arrive" messages would bury it.

## How a grievance reaches the Officer

- **Primary:** a dedicated email address for this role (see the required
  field above — recommended pattern: `grievance@<the college's real
  domain>`, or `privacy@<domain>` if the college prefers that framing;
  either is a defensible, commonly used convention).
- **Fallback:** the in-app Support Tickets system, for a student who
  doesn't know the dedicated address exists — any ticket that reads as a
  privacy/data grievance should be manually re-routed to the Officer by
  whichever admin triages it, not resolved as a normal support ticket.

## Response defaults

No specific acknowledgment/resolution window for Section 13 grievances was
finalized in the DPDP Rules as of this draft — confirm the current rule
text before treating the numbers below as a compliance guarantee. Absent
that, this document adopts the following as the operating default,
chosen as an industry-standard, defensibly fast turnaround (faster than
what most comparable regimes require, which is intentional — it's easier
to hold a fast internal SLA than to redo this doc every time a rule
finalizes):

| Step | Target |
|---|---|
| Acknowledge receipt | Within **3 business days** |
| Substantive resolution or a written status update if still investigating | Within **30 days** of receipt |
| If unresolved after 30 days | The data principal may escalate to the **Data Protection Board of India** — see `docs/BREACH_NOTIFICATION_PROCEDURE.md` for the same escalation target used there |

## Responsibilities

1. Acknowledge and log every grievance received (who, when, what was
   asked) — a simple dated record is enough; it doesn't need new schema,
   a shared note/spreadsheet the Officer and campus admins can both see is
   sufficient at this scale.
2. Investigate: pull the relevant `audit_logs` rows if the grievance is
   about improper access, confirm what data exists via `export_my_data()`
   if the grievance is about what's held, action a correction/deletion
   request if that's what's being asked and the in-app self-service flow
   didn't already cover it.
3. Respond in writing (email is fine) within the windows above.
4. If the grievance reveals an actual personal data breach rather than a
   process complaint, immediately switch to
   `docs/BREACH_NOTIFICATION_PROCEDURE.md` instead — that procedure's
   internal-notification step names this same role as the first point of
   contact.
5. Keep grievance records for **at least 3 years** after resolution — no
   DPDP-specific retention figure is settled as of this draft, so this
   reuses the general Indian regulatory-recordkeeping default of a
   multi-year window rather than inventing a number with no basis; revisit
   if counsel gives a firmer figure.

## Current appointment

**⬛ REQUIRES YOUR INPUT.** Fill in once decided:

- **Name:** _(not yet appointed — interim default: "your campus admin",
  as published today in the Privacy Policy)_
- **Email:** _(not yet appointed)_
- **Phone:** _(not yet appointed)_
- **Effective from:** _(date of appointment)_

When this is filled in, update the same three details in the Privacy
Policy's "Your choices & data principal rights" section
(`LegalContent()` in `src/App.jsx`) in the same change, and remove the
"interim default" language above.

## What this document doesn't resolve

- **The actual appointment** — a business decision only you can make (see
  above).
- **Legal sign-off** — this is an engineering-side starting point, not
  reviewed by counsel.
- **Significant Data Fiduciary status** — reconfirm this deployment stays
  below whatever threshold the Board sets, as user counts grow past a
  single campus.
