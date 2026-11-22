# App surface: the programme (user router)

Additive only (R-API-9).
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
| `teacher.packages.create` / `.update` (changed) | teacher | a programme package: `{ subjectId, track: 'ijazah_track', prices: { m30, m45, m60 } }` | the package as a union by track: recitation (and a pre-switch ijazah package) as today, non-null; a programme package with `prices` | refusals: `assessment_fee_unset`, a price ≤ 0 |
| `teacher.packages.averagePrice` (changed) | teacher | `{ track, durationMinutes }` | as today | on a programme package, over the other teachers' prices for that length (FR-704a) |
| `discovery.*` (changed) | participant | as today | a programme card adds `{ assessmentFee, priceRange: { lowest, highest } }` | gender-filtered as today |
| `booking.slots` (changed) | student | as today | for a programme package: active weekly times of length ≥ `assessment_duration_minutes`, each with its length; none overlapping the student's own active programme's weekly time (U-1) | |
| `checkout.hold` / `pay` (changed) | student | as today | as today | a programme package → an `assessment` order, gross = the fee; the hold checks length ≥, not = (`holds.service.ts:505`) |
| `programme.get` | participant | `{ enrollmentId }` | `{ state, offerDueAt, payBy, offer \| null, plan, monthsPaid, monthCount, nextDueAt, paused: { since } \| null, renewOpen, chargePending, payeePending, payBlocked, teacherUnavailable, card: { last4, brand } \| null }` | the two parties only, else NOT_FOUND; `card` to the student only; `payeePending` is true only in live mode with the teacher's payout account unverified (PR #153 r4 Minor 2); `payBlocked` is true while a `pay_blocked` item is open (FR-706b) |
| `programme.offer` | teacher | `{ enrollmentId, level, readiness, expectedLength, durationMinutes, sessionCount, idempotencyKey }` | `{ total, sessionPrice, monthCount }` | refusals: `assessment_not_delivered`, `not_awaiting_offer`, `offer_due_passed` (unless an administrator extended it), `length_exceeds_slot`, `count_out_of_bounds` (1–200), `teacher_not_active` |
| `programme.pay` | student | `{ enrollmentId, plan: 'in_full' \| 'monthly', saveCard: boolean, idempotencyKey }` | `{ checkoutUrl }` | the first payment, within `payBy`; no hold; the order expires at min(`slot_hold_ttl_minutes`, `payBy`); FR-BOOK-12's one checkout per student applies; `saveCard` records consent; refusals: `not_offered`, `pay_by_passed`, `party_suspended`, `payee_unverified` (CONFLICT, before the gateway, in live mode only), `rest_not_positive` (in full with total ≤ fee) |
| `programme.renew` | student | `{ enrollmentId, saveCard: boolean, idempotencyKey }` | `{ checkoutUrl }` | the next month by hand: «renew now» (no saved card, from `programme_renew_early_days`), «pay now» and «change card» (after a failed or unanswered charge); refusals: `party_suspended`, `payee_unverified` (CONFLICT, before the gateway, in live mode only; no «pay now» while `payeePending`, shown again once it is false), `not_due_yet`, `charge_pending` (an automatic order of the month `created` and unexpired), `nothing_due`, `closed` |
| `programme.request` | teacher | `{ enrollmentId, kind: 'stop' \| 'refusal', reason, idempotencyKey }` | `{ requestId }` | stop: `not_paused`, `too_early` (before 7 days), `request_open`; refusal: `assessment_not_delivered`, `offer_sent`, `request_open` |
| `programme.autoRenewOff` | student | `{ enrollmentId, idempotencyKey }` | `{ ok }` | at any time: deletes the saved card; later months by hand under the same rules; a charge already `created` stays (the review session's reading of DEC-95); under the programme's row lock, the due step's lock |
| `programme.cancel` | student | `{ enrollmentId, idempotencyKey }` | `{ ok }` | before any payment of the rest: cancels `offer_declined`, the fee kept |

The live channel: an `enrollment` signal to both parties after commit on every programme change (offer, payment,
pause, request, decision, close, reopen); no new member.
