# App surface: the programme (user router)

Additive only (R-API-9). Every output has its `.output(schema)`, and every procedure declares its caller kind. Schemas
live in `packages/contracts/src/programme.ts`. An `idempotencyKey` is required on every mutation, with its scope
listed in `idempotent-procedures.ts`. Every refusal writes nothing and logs one line of ids and a reason.

| Procedure | Kind | Input | Output | Notes |
|---|---|---|---|---|
| `teacher.packages.create` / `.update` (changed) | teacher | an ijazah-track package: `{ subjectId, track: 'ijazah_track', prices: { m30, m45, m60 } }` | as today, with `prices` | refusals: `assessment_fee_unset`, a price ≤ 0; a recitation package unchanged |
| `teacher.packages.priceAverage` (changed) | teacher | `{ track, durationMinutes }` | as today | on the ijazah track, over the other teachers' prices for that length (FR-704a) |
| `discovery.*` (changed) | participant | as today | an ijazah-track card adds `{ assessmentFee, priceRange: { lowest, highest } }` | gender-filtered as today |
| `booking.slots` (changed) | student | as today | for an ijazah-track package: active weekly times of length ≥ `assessment_duration_minutes` | |
| `checkout.hold` / `pay` (changed) | student | as today | as today | an ijazah-track package → an `assessment` order, gross = the fee |
| `programme.get` | participant | `{ enrollmentId }` | `{ state, payBy, offer \| null, plan, monthsPaid, monthCount, nextDueAt, paused: { since } \| null, card: { last4, brand } \| null, renewOpen, chargePending }` | the two parties only, else NOT_FOUND; the card part to the student only |
| `teacher.programme.offer` | teacher | `{ enrollmentId, level, readiness, expectedLength, durationMinutes, sessionCount, idempotencyKey }` | `{ total, sessionPrice, monthCount }` | refusals: `not_awaiting_offer`, `pay_by_passed`, `length_exceeds_slot`, `count_out_of_bounds`, `teacher_not_active` |
| `programme.pay` | student | `{ enrollmentId, plan: 'in_full' \| 'monthly', saveCard: boolean, idempotencyKey }` | `{ checkoutUrl }` | the first payment, within `payBy`; `saveCard` records consent; refusals: `not_offered`, `pay_by_passed` |
| `programme.renew` | student | `{ enrollmentId, saveCard: boolean, idempotencyKey }` | `{ checkoutUrl }` | the next month by hand: «renew now», «pay now», «change card»; refusals: `not_due_yet` (before `programme_renew_early_days`), `charge_pending`, `nothing_due`, `closed` |
| `teacher.programme.request` | teacher | `{ enrollmentId, kind: 'stop' \| 'refusal', reason, idempotencyKey }` | `{ requestId }` | stop: `not_paused`, `too_early` (before 7 days), `request_open`; refusal: `not_after_assessment`, `offer_sent`, `request_open` |
| `programme.cancel` | student | `{ enrollmentId, idempotencyKey }` | `{ ok }` | before any payment of the rest: cancels `offer_lapsed`, the fee kept |

The live channel: an `enrollment` signal to both parties on every programme change (offer, payment, pause, request,
close), after commit; no new member.
