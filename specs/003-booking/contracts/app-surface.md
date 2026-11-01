# Contract: The user surface (Phase 2)

Every procedure below is mounted on `appRouter`. "teacher(approved)" is `teacherProcedure({ admits: 'approved' })`:
drafting is allowed before payout verification (FR-315). "student" is `studentProcedure`. No procedure here admits a
restricted account. Every student procedure that names a teacher, package or slot resolves it through identity's
visibility predicate first (research R-201, R-202).

## `teacher.profile` — identity (FR-310, T158)

| Procedure | Kind | Input | Output | Notes |
|---|---|---|---|---|
| `teacher.profile.get` | teacher(approved) | `{}` | `{ displayName, photoUrl?, bio, qualificationSummary, gender, published }` | `published` is the predicate's answer for this teacher as a same-gender student would get it (FR-315) |
| `teacher.profile.update` | teacher(approved) | `{ bio, qualificationSummary }` | `{ bio, qualificationSummary }` | Bounded lengths in the schema. The display name stays `account.updateProfile`'s; T158 adds the teacher's entry to it. The photo stays `POST /uploads/photos`, stripped by T145 |

## `teacher.packages` — catalog (FR-311 to FR-315)

| Procedure | Kind | Input | Output | Notes |
|---|---|---|---|---|
| `teacher.packages.list` | teacher(approved) | `{}` | `{ published, packages: [{ id, subject, track, sessionCount, sessionDurationMinutes, price_piasters, perSession_piasters, isActive, activeEnrollmentCount, frozen }] }` | `frozen` true once an enrollment exists (FR-312); `perSession_piasters` by `packages/money` (R-212) |
| `teacher.packages.create` | teacher(approved), idempotent | `{ subjectId, track, sessionCount, sessionDurationMinutes: 30 \| 45 \| 60, price_piasters, isActive, idempotencyKey }` | the package | `SUBJECT_NOT_APPROVED` unless the subject is in the teacher's `teacher_subjects` (FR-311); `price_piasters` > 0 |
| `teacher.packages.update` | teacher(approved) | `{ packageId, sessionCount?, track?, sessionDurationMinutes?, price_piasters?, isActive? }` | the package | `PACKAGE_FROZEN` for track or length once an enrollment exists; a price change applies to later purchases (FR-312) |

## `teacher.slots` — catalog (FR-313, FR-314, FR-317, FR-318)

| Procedure | Kind | Input | Output | Notes |
|---|---|---|---|---|
| `teacher.slots.list` | teacher(approved) | `{}` | `{ timezone, slots: [{ id, dayOfWeek, startTimeLocal, durationMinutes, isActive, state: 'free' \| 'booked' \| 'disabled' }] }` | `booked` = in use (R-207), derived |
| `teacher.slots.create` | teacher(approved), idempotent | `{ dayOfWeek, startTimeLocal, durationMinutes: 30 \| 45 \| 60, idempotencyKey }` | the slot | Zone = the teacher's at creation; `SLOT_OVERLAP` on the week (R-206) |
| `teacher.slots.update` | teacher(approved) | `{ slotId, dayOfWeek?, startTimeLocal?, durationMinutes?, isActive? }` | the slot | `SLOT_IN_USE` for day, time or length while a hold or a pending or confirmed enrollment uses it; deactivation always allowed; reactivation re-checks overlap |

## `discovery` — booking's router over catalog's service (FR-330 to FR-338, R-204, R-205)

| Procedure | Kind | Input | Output | Notes |
|---|---|---|---|---|
| `discovery.browse` | student, `rate_limit_search` (the cursor is opaque and carries the last card's rating, count, name and id, R-204) | `{ subjectId?, query?, track?, minRating?: 1..5, riwaya?, cursor? }` | `{ tabs?: [{ subjectId: string \| null, nameAr, nameEn, count }], cards: [{ teacherId, displayName, match?: { length }, photoUrl?, subjects, tracks, bioExcerpt, rating?, reviewCount, nearestSlot?: { startsAt, timezone }, lowestPerSession_piasters }], nextCursor? }` | `tabs` on the first page only, counted after the predicate (R-GENDER-3); `query` folded (R-203); `match.length` marks the matched prefix |
| `discovery.filters` | student, `rate_limit_search` | `{ subjectId }` | `{ riwayas: string[] }` | Of approved credentials of visible teachers in the subject; empty hides the filter |
| `discovery.teacher` | student, `rate_limit_search` | `{ teacherId }` | `{ teacherId, displayName, gender, photoUrl?, bio, qualificationSummary, subjects, rating?, reviewCount, packages: [{ packageId, subject, track, sessionCount, sessionDurationMinutes, price_piasters, perSession_piasters }] }` | `NOT_FOUND` for an excluded teacher (R-GENDER-2); no riwaya, tariq or chain (FR-336) |

## `booking` — the booking sheet (FR-350, FR-386)

| Procedure | Kind | Input | Output | Notes |
|---|---|---|---|---|
| `booking.slots` | student, `rate_limit_search` | `{ packageId }` | `{ teacherTimezone, slots: [{ slotId, dayOfWeek, startTimeLocal, durationMinutes, firstSession: { localDate, startsAt }, lastSession: { localDate, startsAt } }] }` | Offerable slots of the package's length, without the student's own overlaps (R-205); previews by FR-368's rule from now; `NOT_FOUND` for an excluded teacher's package |

## `checkout` — payments (FR-351 to FR-358, FR-380 to FR-386)

| Procedure | Kind | Input | Output | Notes |
|---|---|---|---|---|
| `checkout.hold` | student, idempotent, `rate_limit_payment_initiation` | `{ packageId, slotId, idempotencyKey }` | `{ holdId, expiresAt, summary, firstSession, lastSession }` | FR-351/352/353; `SLOT_TAKEN`; `NOT_BOOKABLE`; `ACCOUNT_NOT_ACTIVE`; `PREVIOUS_CHECKOUT` (FR-BOOK-12 (b)/(c)) |
| `checkout.pay` | student, idempotent, `rate_limit_payment_initiation` | `{ holdId, idempotencyKey }` | `{ enrollmentId, checkoutUrl, orderExpiresAt }` | ARCHITECTURE §8.1: order created outside the transaction, recorded and handed over only if the hold is still active (FR-354); `HOLD_EXPIRED` otherwise |
| `checkout.retry` | student, idempotent, `rate_limit_payment_initiation` | `{ enrollmentId, idempotencyKey }` | `{ checkoutUrl, orderExpiresAt }` | A new order on the same hold; `ORDER_NOT_PAYABLE` past the hold's expiry minus the grace (FR-356) |
| `checkout.current` | student | `{}` | `{ hold?: { holdId, expiresAt, enrollmentId?, summary, lastOrder?: { status, expiresAt, canContinue } } }` | What `CheckoutPrevious` shows; `canContinue` when the last order is still payable |
| `checkout.continue` | student | `{ enrollmentId }` | `{ checkoutUrl, orderExpiresAt }` | Reopens the payable order's hosted page (FR-BOOK-12 (c)): `NOT_FOUND` unless the enrollment is the caller's; `ORDER_NOT_PAYABLE`, with nothing decrypted, unless the order is `created` and its `expires_at` is after now; the address is never logged (data-model §2.4.1) |
| `checkout.status` | student | `{ enrollmentId }` | `{ status, cancellationReason?, lastOrder: { status, reference, gross_piasters }, summary, sessions?: [{ sequenceNumber, localDate, startTimeLocal, timezone, startsAt, endsAt }], firstSessionMoved?: { quoted, actual } }` | Read by Processing, the Confirming badge and the success screen (FR-380 to FR-386); `confirmed` only from the server's row (R-HONEST-1) |

## `enrollments` and the teacher's lists — booking (FR-390 to FR-395)

| Procedure | Kind | Input | Output | Notes |
|---|---|---|---|---|
| `enrollments.list` | student | `{ tab: 'active' \| 'ended', cursor? }` | `{ items: [{ enrollmentId, teacher: { teacherId, displayName, photoUrl? }, summary, status, confirming, next?: session, completed, remaining }], nextCursor? }` | Active ordered by next session (FR-390); `completed`/`remaining` derived (R-DB-4). The home reads the first item's `next` |
| `enrollments.get` | student | `{ enrollmentId }` | the item and its `sessions` | Only the student's own; `NOT_FOUND` otherwise |
| `teacher.students.list` | teacher(approved) | `{ tab: 'active' \| 'ended', query?, cursor? }` | `{ items: [{ enrollmentId, student: { displayName, photoUrl? }, summary, next?, completed, remaining }], nextCursor? }` | `query` folded and matched on the student's name (R-218); no date of birth, minor flag, document or dispute history (R-HONEST-4) |
| `teacher.students.get` | teacher(approved) | `{ enrollmentId }` | the item and its `sessions` | Only the teacher's own |
| `teacher.today` | teacher(approved) | `{}` | `{ localDate, timezone, sessions: [{ enrollmentId, student: { displayName }, summary, startsAt, endsAt, startTimeLocal }] }` | The teacher's local day |

Every session in an output carries its local date, local start and zone, and its instants; the phone shows it in the
teacher's zone and the viewer's (FR-393).

## `platform.publicConfig` — additive fields (FR-383)

`{ supportEmail, termsVersion }` gains `checkout: { confirmationTimeoutSeconds, processingPollSeconds,
confirmingPollSeconds, confirmingPollWindowMinutes }`, read from settings.

## Idempotent procedures

`packages/contracts/src/idempotent-procedures.ts` gains `teacher.packages.create`, `teacher.slots.create`,
`checkout.hold`, `checkout.pay` and `checkout.retry` (additive). The keyed effect never calls the gateway: `pay` and
`retry` create the order before `idempotency.run` and record it inside, as Phase 1's payout registration does
(`identity/payout.service.ts` lines 99–126).
