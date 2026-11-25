# App surface: the programme (user router)

Additive only (R-API-9).
> *(2026-11-22, B-P1 Q-C1.)* Money fields carry `_piasters` (R-MONEY-2), and the assessment's fee crosses as
> `assessmentPrice_piasters` (R-MONEY-6 (b) refuses «fee» with an amount outside the payment folders): the names below
> are the code's.
- Every output has its `.output(schema)`, and every procedure declares its caller kind.
- Schemas live in `packages/contracts/src/programme.ts`.
- An `idempotencyKey` is required on every mutation, with its scope listed in `idempotent-procedures.ts`.
- Every refusal writes nothing and logs one line of ids and a reason.
- Every procedure here is registered in the adversarial harness, both gender directions, in the batch that adds it
  (R-517).
- The switch `programme_enabled` (R-503, I-3) gates only new programme packages and new assessments: while it is off,
  ijazah-track packages are sold as today and no new programme starts; a running programme goes on whatever it says. The
  procedures that start one answer
  `programme_disabled`.

| Procedure | Kind | Input | Output | Notes |
|---|---|---|---|---|
| `teacher.packages.create` / `.update` (changed) | teacher | a programme package: `{ subjectId, track: 'ijazah_track', prices: { m30_piasters, m45_piasters, m60_piasters } }` | the package as a union by track: recitation (and a pre-switch ijazah package) as today, non-null; a programme package with `prices` | refusals: `assessment_fee_unset`, a price ≤ 0 |
| `teacher.packages.averagePrice` (changed) | teacher | `{ track, durationMinutes }` | as today | on a programme package, over the other teachers' prices for that length (FR-704a) |
| `discovery.*` (changed) | participant | as today | a programme card adds `{ assessmentPrice_piasters, priceRange: { lowest_piasters, highest_piasters } }` | gender-filtered as today |
| `booking.slots` (changed) | student | as today | for a programme package: active weekly times of length ≥ `assessment_duration_minutes`, each with its length; none overlapping the student's own active programme's weekly time (U-1) | |
| `checkout.hold` / `pay` (changed) | student | as today | as today | a programme package → an `assessment` order, gross = the fee; the hold checks length ≥, not = (`holds.service.ts:505`); `checkout.current` on a hold of a programme package answers CONFLICT `programme_disabled` or `assessment_fee_unset` once the programme closed meanwhile, a read that refuses (`checkout-reads.service.ts:126`; PR #156 r1); `checkout.pay` on a bare own hold is refused `PREVIOUS_CHECKOUT` `payable` (naming the programme's enrollment and the order's expiry) while a programme order of the student is payable (T009, Q-C5 (a)) |
| `checkout.current` / `continue` (changed) | student | as today | `checkout.current` adds an optional `programmeOrder: { enrollmentId, expiresAt, canContinue }` (`packages/contracts/src/checkout.ts`; T009, Q-C2 (a)) | the student's programme order still payable (`programme.pay`'s, which has no hold), so the previous-checkout screen shows it; not a hold; `continue` with its enrollment hands its page back |
| `programme.get` | participant | `{ enrollmentId }` | `{ state, offerDueAt, payBy, offer \| null, plan, monthsPaid, monthCount, nextDueAt, paused: { since } \| null, renewOpen, chargePending, payeePending, payBlocked, teacherUnavailable, card: { last4, brand } \| null }` | the two parties only, else NOT_FOUND; `card` to the student only; `payeePending` is true only in live mode with the teacher's payout account unverified (PR #153 r4 Minor 2); `payBlocked` is true while a `pay_blocked` item is open (FR-706b) |
| `programme.offer` | teacher | `{ enrollmentId, level, readiness, expectedLength, durationMinutes, sessionCount, idempotencyKey }` | `{ total_piasters, sessionPrice_piasters, monthCount }` | refusals: `assessment_not_delivered`, `not_awaiting_offer`, `offer_due_passed` (unless an administrator extended it), `length_exceeds_slot`, `count_out_of_bounds` (1–200), `teacher_not_active` |
| `programme.pay` | student | `{ enrollmentId, plan: 'in_full' \| 'monthly', saveCard: boolean, idempotencyKey }` | `{ checkoutUrl }` | the first payment, within `payBy`; no hold; the order expires at min(`slot_hold_ttl_minutes`, `payBy`); FR-BOOK-12's one checkout per student applies; `saveCard` records consent; refusals: `not_offered`, `pay_by_passed`, `party_suspended`, `payee_unverified` (CONFLICT, before the gateway, in live mode only), `rest_not_positive` (in full with total ≤ fee); and FR-BOOK-12's `PREVIOUS_CHECKOUT` (the error as a hold's, not a cause): `payable` (naming the enrollment and the order's expiry) while the student's own hold's order or an order of the programme itself is payable, `processing` while the own hold's order is paid, or a `rest_in_full` or `instalment` order of the programme is paid and not yet processed by the confirm step (`confirmed_at` NULL; PR #158 r1 Major 1) |
| `programme.renew` | student | `{ enrollmentId, saveCard: boolean, idempotencyKey }` | `{ checkoutUrl }` | the next month by hand: «renew now» (no saved card, from `programme_renew_early_days`), «pay now» and «change card» (after a failed or unanswered charge); refusals: `party_suspended`, `payee_unverified` (CONFLICT, before the gateway, in live mode only; no «pay now» while `payeePending`, shown again once it is false), `not_due_yet`, `charge_pending` (an automatic order of the month `created`, expired or not, until the gateway answers; Q-f2 (a)), `nothing_due`, `closed`, and FR-BOOK-12's `PREVIOUS_CHECKOUT` as `programme.pay`'s (a manual checkout of the month payable, the student's own hold's order payable or paid, or the programme's paid order not yet processed; PR #160 r2 nit 4) *(PR #160 r1 Minor 6, 2026-11-24)* |
| `programme.request` | teacher | `{ enrollmentId, kind: 'stop', reason, idempotencyKey }` | `{ requestId }` | stop: `not_paused`, `too_early` (before 7 days; the app shows the button only from `paused_at` + 7 days, `too_early` its guard), `request_open`; no `refusal` kind (SRS DEC-112, below) |
| `programme.autoRenewOff` | student | `{ enrollmentId, idempotencyKey }` | `{ ok }` | at any time: deletes the saved card; later months by hand under the same rules; a charge already `created` stays (the review session's reading of DEC-95); under the programme's row lock, the due step's lock; refusals (CONFLICT, a cause of `programmeAutoRenewOffRefusal`, B-P3): `party_suspended`, `closed` |
| `programme.cancel` | student | `{ enrollmentId, idempotencyKey }` | `{ ok }` | before any payment of the rest: cancels `offer_declined`, the fee kept; refusals (CONFLICT, a cause of `programmeCancelRefusal`): `rest_paid` (`active` or `paused`), `closed` (the programme closed, or its enrollment no longer `confirmed`), `assessment_not_settled` (until session 1, or its make-up, is `done` or `student_no_show`: FR-BOOK-15 «after the assessment»; PR #158 r1 Follow-up 1 (a)), `payment_processing` (a programme order payable or paid and not yet confirmed; PR #158 r2 Follow-up 1, B-P3 Q-8 (a)) |

> *(2026-11-23, SRS DEC-112, the owner: «لا متخليش في زر رفض الطلب في التصميم / لازم بقى يخش يكلم الدعم من الاعدادات
> ومش هنوضحله ده».)* `programme.request` takes `stop` only: the `refusal` kind, its refusals (`assessment_not_delivered`,
> `offer_sent`), its service branch, attacks and specs are removed (T008). A teacher who wants to refuse tells support
> and sends no offer; the refusal is the administrator's approval of the `no_offer` item (admin-surface.md).

The live channel: an `enrollment` signal to both parties after commit on every programme change (offer, payment,
pause, request, decision, close, reopen); no new member.

> **B-P4 (the owner's answers on B-P4's conflict check, 2026-11-25; additive, R-API-9).** `programme.get` gains
> `stopRequestFrom` (the teacher's: `paused_at` + `programme_stop_request_days` on the database's clock, null unless
> paused; Q-2 (a)) and `payReminderFrom` (`payBy` − `programme_pay_reminder_hours` while `offered`, else null; Q-5 (b),
> SRS DEC-114). The student's `enrollments.list` / `get` and the teacher's students list / get gain an optional
> `programme: { state, payBy, payReminderFrom }` on a programme's enrollment (Q-3 (a)), and the enrollment outputs'
> session count is widened to `MAX_PROGRAMME_SESSION_COUNT + 1` (Q-4 (a); the admin payment detail's
> `paymentEnrollment.summary` with it). No new procedure.
