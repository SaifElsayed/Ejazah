# Admin surface: the programme (admin router)

Additive only. Schemas in `packages/contracts/src/admin/programme.ts`. Each mutation is audited (R-API-12), rate
limited by the existing administrator limit, and keyed by an `idempotencyKey`.

| Procedure | Input | Output | Audit | Notes |
|---|---|---|---|---|
| `programmes.queue` | `{ cursor?, filter: 'paused' \| 'stop' \| 'refusal' }` | `{ items: [{ enrollmentId, teacher, student, state, pausedSince \| null, request \| null }], nextCursor }` | — | oldest first; how late; the teacher's reason (FR-727) |
| `programmes.get` | `{ enrollmentId }` | the programme, its months and orders by kind, its requests, the card's `last4` only | — | |
| `programmes.decide` | `{ requestId, decision: 'approve' \| 'decline', note?, idempotencyKey }` | `{ status }` | `programme_request.approved` / `.declined` | approve stop → the close (R-513); approve refusal → `assessment_refused` |
| `programmes.reopen` | `{ enrollmentId, reason, idempotencyKey }` | `{ state: 'paused' }` | `programme.reopened` | only a closed `programme_stopped` programme |
| `payments.monitor` (changed) | as today | each order adds `kind` and `instalmentMonth` | — | |
| `settings.*` (as built) | — | — | — | the six keys appear with their labels |
