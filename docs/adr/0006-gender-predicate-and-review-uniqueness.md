# ADR 0006 — Gender visibility predicate and review uniqueness

**Status:** accepted; the D1 predicate gains a fourth conjunct (payout verified) in [ADR 0007](0007-direct-gateway-checkout.md) · **Date:** 2026-09-05 · **Addendum to:** [ADR 0005](0005-phase-0-document-amendments.md)

## Context

A pre-implementation review of two risks found one stale requirement and one
unimplementable integrity rule in the reconciled baseline (ADR 0005):

1. **Gender filtering.** SRS §3.7.1 (DEC-39) makes the pairing rule symmetric,
   but NFR-SEC-4 still described only one direction (female teacher to male
   student), no document stated the visibility predicate as a single testable
   expression, and nothing said what filtering does while a gender dispute is
   open (FR-GENDER-2: "unless and until disputed").
2. **Review uniqueness.** ERD §15.11 declared `reviews.enrollment_id` unique
   `WHERE deleted_at IS NULL`, but `reviews` carries no `deleted_at` column, and
   a PostgreSQL partial-index predicate may reference only columns of the
   indexed table. The rule could not be created, and tasks T066 and T070
   expected it. Its stated purpose, releasing a deleted enrollment's review
   slot, is moot: a soft-deleted enrollment is excluded from ordinary reads and
   cannot be reviewed at all.

## Decisions

### D1 — One visibility predicate, stated once, enforced symmetrically

A teacher is visible to a requester on any student-facing path if and only if:

```
teacher.gender = requester.gender
AND teacher_profile.verification_status = 'approved'
AND teacher.deleted_at IS NULL
```

The predicate lives in SRS §3.7.1 and is implemented as the single repository
filter in `catalog` that R-GENDER-5 requires. NFR-SEC-4 is rewritten so that it
binds both directions equally. The adversarial suite (FR-064, T087) must run
every case in both directions: male requester against female teachers and
female requester against male teachers.

### D2 — An open gender dispute changes nothing until an admin rules

While a `gender_flags` row is pending, the flagged user remains active with
their declared gender. Discovery, booking and token issuance apply the predicate
above to the declared value. No pre-emptive exclusion, hiding or suspension
occurs. Only an admin ruling (FR-GENDER-4, FR-GENDER-6, FR-GENDER-7) changes the
record, and the consequences of that ruling are the ones those requirements
already define. Recorded as OPEN-09, closed.

Rationale: a flag is an accusation, not a finding. Excluding a teacher on
accusation alone would let any user remove any teacher from the marketplace at
no cost, which is a worse abuse surface than the window it would close.

### D3 — Review uniqueness is a plain unique constraint

`reviews.enrollment_id` is unique, unconditionally, exactly as ERD §15.3 already
declares and FR-REVIEW-2 requires: at most one review per enrollment, ever.
ERD §15.11 keeps only the two `users` partial indexes (`phone`, `email`), which
are correct because `users` carries `deleted_at`. No `deleted_at` is added to
`reviews`, no trigger is introduced (research R-5 rejects triggers for tier-DB
guarantees), and moderation continues to remove the comment only
(`comment_removed_at`, FR-REVIEW-5).

## Documents amended

`docs/SRS.md` (§3.7.1, FR-GENDER-2, NFR-SEC-4, §16 OPEN-09), `docs/ERD.md`
(§15.11, changelog), `specs/001-foundations/spec.md` (FR-064, Assumptions),
`specs/001-foundations/data-model.md` (§4), `specs/001-foundations/tasks.md`
(T053, T066, T070, T087), `specs/001-foundations/quickstart.md` (§3),
`tests/db-integrity/soft-delete.spec.ts`, `tests/adversarial/gender.spec.ts`.

## Consequences

- The gender rule is now one expression in one place, testable in both
  directions, with the disputed state defined rather than implied.
- Phase 0's schema work no longer depends on an index that cannot exist. The
  soft-delete probe for enrollments asserts only that the row is absent from
  reads, which is the behaviour the model actually promises.
