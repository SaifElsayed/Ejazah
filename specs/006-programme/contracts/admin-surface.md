# Admin surface: the programme (admin router)

Additive only. Schemas in `packages/contracts/src/admin/programme.ts`. Each mutation is audited (R-API-12), rate
limited by the existing administrator limit, and keyed by an `idempotencyKey`. No card detail appears in an output or
an audit entry (the card's `last4` is the student's only).

| Procedure | Input | Output | Audit | Notes |
|---|---|---|---|---|
| `programmes.queue` | `{ cursor?, filter: 'paused' \| 'stop' \| 'refusal' \| 'no_offer' \| 'pay_blocked' }` | `{ items: [{ enrollmentId, teacher, student, state, pausedSince \| null, request \| null, payeeVerifiedNow \| null }], nextCursor }` (`payeeVerifiedNow` on a `pay_blocked` item only) | — | oldest first; how late; the teacher's reason (FR-727); each screen explains itself |
| `programmes.get` | `{ enrollmentId }` | the programme, its months and orders by kind, its requests | — | |
| `programmes.decide` | `{ requestId, decision: 'approve' \| 'decline' \| 'extend', note?, idempotencyKey }` | `{ status }` | `programme_request.approved` / `.declined` / `.extended` | approving a stop closes (R-513); approving a refusal cancels `assessment_refused`; `no_offer` (I-2 (a)): approve = a refusal, `extend` = the decision's time + `programme_offer_hours`; `pay_blocked` (FR-706b): approve = the lapse (`offer_lapsed`), `extend` = `pay_by` at the decision's time + `programme_pay_rest_hours`, no decline; under the programme's row lock, the sweep's |
| `programmes.reopen` | `{ enrollmentId, reason, idempotencyKey }` | `{ state: 'paused' }` | `programme.reopened` | only a `programme_stopped` programme; under the slot's lock; refusals `slot_taken`, `party_restricted`, `gender_mismatch` (restore's) |
| `sessions.restore` (changed) | as today | as today | as today | refused `programme_enrollment` on a programme (R-513) |
| `payments.monitor` (changed) | as today | each order adds `kind`, `instalmentMonth`, `automatic`, `declineKind` | — | |
| `settings.*` (as built) | — | — | — | the eight keys appear with their labels |
