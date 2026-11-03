# Phase 2 Contracts

**Feature**: `specs/003-booking/` · **Date**: 2026-10-31

The procedures that sell and schedule a package, the stand-in gateway's boundary, and what changes in the kernel's
contract. As in Phase 1: every procedure is additive-only once merged (R-API-9), declared through a caller kind with
its input and output schema, and, where public, its rate limit; every output is exactly its schema's fields
(R-HONEST-4); every non-public user-surface procedure has a refusal test naming it (`pnpm check:authz`).

| Document | Contract |
|---|---|
| [app-surface.md](./app-surface.md) | The user surface: the teacher's profile, packages, slots, students and day; discovery; the booking sheet; checkout; the student's enrollments; the public configuration's additions |
| [admin-surface.md](./admin-surface.md) | The administrator surface: the payments monitor |
| [gateway.md](./gateway.md) | The payment port as this phase calls it, the webhook's order branch, the stand-in's hosted page and its test harness |
| [kernel.md](./kernel.md) | The row and key locks, the deferred constraints, the new services in the context, the idempotent procedures, the jobs |

## Conventions

- **Names.** `namespace.verb` in camelCase. New namespaces on the user surface: `teacher.profile`,
  `teacher.packages`, `teacher.slots`, `teacher.students`, `teacher.today` (teacher); `discovery`, `booking`,
  `checkout`, `enrollments` (student). On the administrator surface: `payments`.
- **Ids in inputs.** `teacherId`, `packageId`, `slotId`, `holdId`, `enrollmentId`: never `userId`, `gender` or `role`
  (R-GENDER-4's rule refuses them; `teacherId` names what is asked for, never who asks).
- **Errors.** The codes this phase adds, each a stable string: `NOT_FOUND` (one message, one shape, for an id that
  does not exist and for one the requester may not see, R-GENDER-2), `NOT_BOOKABLE` (a visible teacher whose account
  is not active, T143), `ACCOUNT_NOT_ACTIVE` (the student's own account is `verification_required`, FR-VERIFY-10),
  `SLOT_TAKEN` (the hold was refused: held, occupied or overlapping), `PREVIOUS_CHECKOUT` (FR-BOOK-12's refusal, with
  `enrollmentId`, `state: 'processing' | 'payable'` and `expiresAt` in details), `HOLD_EXPIRED`, `ORDER_NOT_PAYABLE`
  (Retry past the last moment an order may be created), `SUMMARY_CHANGED` (Pay on a package that is
  inactive or whose price, session count, length or track is not the summary the student saw, or whose count is not the
  one its hold was checked for; nothing written, the package as it now is in details; the owner's decisions of 2026-11-03), `SUBJECT_NOT_APPROVED`, `SLOT_OVERLAP` (with the other slot's
  id in details), `SLOT_IN_USE`, `PACKAGE_FROZEN` (track or length after the first enrollment).
- **Money.** `_piasters` integers on the wire (R-MONEY-1/2); formatting is the client's (R-212).
- **Time.** Instants as ISO-8601 UTC strings; a slot's start as `HH:MM` local with its zone; a session as its local
  date, local start and zone plus its instants; nothing client-supplied is an instant (R-TIME-6).
- **What is not here.** No session join, cancellation, make-up, dispute, chat, report, review write, notification or
  certificate procedure (Phases 3 and 4); no manual-paid, proof-upload or admin-confirm path, now or later
  (FR-PAYG-8).
