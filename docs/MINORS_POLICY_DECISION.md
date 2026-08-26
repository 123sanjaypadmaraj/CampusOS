# Minors policy — decision needed (not resolved by this document)

Prep for readiness-audit phase 6's remainder (go-live runbook step 5). This
lays out the actual question and the realistic options so the decision
takes minutes instead of starting from a blank page — it doesn't pick one.
Not legal advice; have counsel confirm whatever you land on.

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
cohort, even though it's true for the large majority.

## Options

**A. Treat the whole population as adult, document the assumption.**
Simplest — no signup friction, no schema change. Defensible if the
college's own admission policy guarantees no enrolled student is under 18
at signup (many Indian degree programs do, since 12th-standard completion
typically puts students at 18+ already). Risk: if that assumption turns
out false for even one student, there's no consent mechanism at all for
that account.

**B. Collect date of birth at signup, gate under-18 accounts.**
Add a DOB field to the signup flow; block or hold accounts under 18 pending
a verifiable-guardian-consent step (however that ends up being defined by
the eventual DPDP rules). More signup friction, more schema/RLS work, but
closes the gap directly. Only worth building if Option A's assumption is
actually false for this college.

**C. Ask the college directly.** Most colleges already have their own
admission-age records. If the college can attest (in writing) that no
enrolled student is under 18, that's arguably the strongest and cheapest
version of Option A — a documented basis rather than an assumption.

## Recommendation

Start with **C** — ask the college's admissions office one question
("does your admitted student body ever include anyone under 18?") before
building anything. If the answer is "no, never," Option A with that answer
on file is likely sufficient and Option B's engineering cost isn't worth
it yet. If the answer is "rarely, but yes," Option B becomes worth
scoping.

## What to bring back

Whichever option you pick, tell me:
1. The college's answer to the admission-age question.
2. If Option B: whether "gate the account" should mean "block signup
   entirely" or "allow signup but hide privileged features until consent
   clears" — that's a product call, not just a legal one.

Either way, this decision and the Grievance Officer name (see
`docs/BREACH_NOTIFICATION_PROCEDURE.md`) should land in the in-app Privacy
Policy (`LegalContent()` in `src/App.jsx`) together, not as two separate
edits.
