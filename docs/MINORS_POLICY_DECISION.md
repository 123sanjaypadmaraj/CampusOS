# Minors policy

Prep for readiness-audit phase 6's remainder (go-live runbook step 5). Not
legal advice; have counsel confirm this against the current DPDP Act 2023
and its rules before treating it as binding — same posture as the other
docs in this directory.

> **⬛ REQUIRES YOUR INPUT — the only thing this document can't decide for
> you:** ask the college's admissions office one question — *"does your
> admitted student body ever include anyone under 18?"* — and record the
> answer in the "College confirmation" section below. Everything else in
> this document is a decided default that holds either way; only that one
> answer determines whether the default below is sufficient on its own or
> needs Option B's extra engineering work (see "If the answer is 'yes'").

## Why this needs a decision

India's DPDP Act 2023 treats anyone under 18 as a "Child" (Section 2(f))
and requires verifiable parental/guardian consent before processing a
child's personal data (Section 9), with the details of what counts as
"verifiable consent" left to rules that were still being finalized as of
this draft — confirm the current rule text before relying on any specific
mechanism here.

CampusOS's actual population is college students. Most join at 18+, but a
real slice of first-years turn 18 only partway through their first year —
so "our users are all adults" isn't quite true on day one of any given
cohort, even though it's true for the large majority. Most Indian degree
programs require 12th-standard completion for admission, which typically
puts an enrolled student at 18+ already — but "typically" isn't the same
as a documented certainty for *this* college.

## Decided default: self-declared adult population (Option A), backed by a college confirmation (Option C)

This document adopts the combination of the two lowest-friction options as
the operating default, rather than leaving the choice open:

1. **The Terms of Service now state, as a condition of creating an
   account, that the student confirms they are 18 or older** (shipped in
   this pass — see `LegalContent()` in `src/App.jsx`, Terms of Service
   section). The existing signup flow already requires checking "I agree
   to the Privacy Policy & Terms of Service" before an account can be
   created (`agreedToTerms` in the signup form), so this reuses a checkbox
   that's already mandatory rather than adding new signup friction —
   agreeing to the Terms now doubles as the age affirmation.
2. This is the same self-declaration pattern most consumer platforms use
   to satisfy an age-eligibility requirement without collecting a birth
   date (which would itself be new sensitive data to protect). It's a
   reasonable, industry-standard default — not a bulletproof one; a
   self-declaration doesn't verify anything, it documents an assumption.
3. **The college confirmation (the field above) is what upgrades this from
   "reasonable assumption" to "documented basis."** Until that answer is
   on file, the ToS clause is doing the work alone. Get the confirmation
   before treating this as fully closed.

This was Option A+C from the original version of this document, chosen
over Option B (collect date of birth, gate under-18 accounts) because
Option B's engineering cost — new signup field, schema change, an
unbuilt verifiable-parental-consent flow the DPDP rules don't even fully
define yet — isn't justified unless the college confirmation below comes
back "yes." Building Option B speculatively, before knowing it's needed,
would be solving a problem that may not exist for this college.

## College confirmation

**⬛ REQUIRES YOUR INPUT.** Fill in once asked:

- **Question asked:** "Does your admitted student body ever include
  anyone under 18?"
- **Answer:** _(not yet asked)_
- **Date / source:** _(not yet asked — ideally something in writing:
  an email from admissions is enough, doesn't need to be a formal letter)_

## If the answer is "no, never"

The decided default above (self-declaration via the ToS clause) is
sufficient as documented. No further engineering work needed for this
item — mark it closed in the readiness audit once the confirmation is on
file.

## If the answer is "rarely, but yes"

Option B becomes worth scoping. Before building it, this still needs a
product call this document can't make for you: should "gate the account"
mean **block signup entirely** for a declared under-18 student, or **allow
signup but hide privileged/data-sharing features** (Connect directory
visibility, marketplace, posting) **until consent clears**? Bring that
answer back along with the college's response above, and this becomes a
normal engineering ticket (DOB field, RLS gate, a guardian-consent
intake — the actual verification mechanism still depends on DPDP rules
that aren't finalized, so that specific piece may need a second pass once
they are).

## What this document doesn't resolve

- **The college's actual answer** — the one input above.
- **Legal sign-off** — this is an engineering-side starting point, not
  reviewed by counsel.
- **Option B's build**, if the college confirmation comes back "yes" —
  correctly not started speculatively.

Either way, this decision and the Grievance Officer appointment (see
`docs/GRIEVANCE_OFFICER.md`) should land in the in-app Privacy Policy
(`LegalContent()` in `src/App.jsx`) together whenever either changes.
