# Admin surface: the programme (admin router, `modules/booking/programmes-admin.router.ts`, mounted as `programmes`)

Additive only. Schemas in `packages/contracts/src/admin/programme.ts`. Each mutation is audited (R-API-12), rate
limited by the existing administrator limit, and keyed by an `idempotencyKey`. No card detail appears in an output or
an audit entry (the card's `last4` is the student's only).

| Procedure | Input | Output | Audit | Notes |
|---|---|---|---|---|
| `programmes.queue` | `{ cursor?, filter: 'paused' \| 'stop' \| 'no_offer' \| 'pay_blocked' }` | `{ items: [{ enrollmentId, teacher, student, state, pausedSince \| null, request \| null, payeeVerifiedNow \| null }], nextCursor }` (`payeeVerifiedNow` on a `pay_blocked` item only) | — | oldest first; how late; the teacher's reason on a `stop`, the recorded reason on a decided `no_offer` item (FR-727); each screen explains itself; no `refusal` filter (SRS DEC-112, below) |
| `programmes.get` | `{ enrollmentId }` | the programme, its months and orders by kind, its requests (each with its `reason`) | — | the programme's history: a `no_offer` item's recorded reason beside it (FR-727) |
| `programmes.decide` | `{ requestId, decision: 'approve' \| 'decline' \| 'extend', note?, reason?, idempotencyKey }` | `{ status }` | `programme_request.approved` / `.declined` / `.extended` | approving a stop closes (R-513); `no_offer` (I-2 (a)): approve = the refusal (`assessment_refused`), `extend` = the decision's time + `programme_offer_hours`, either requiring `reason` (1–500, written to the item's `reason`; refused without it, SRS DEC-112); `pay_blocked` (FR-706b): approve = the lapse (`offer_lapsed`), `extend` = `pay_by` at the decision's time + `programme_pay_rest_hours`, no decline; under the programme's row lock, the sweep's; refusals (CONFLICT, a cause of `programmesDecideRefusal`; nothing written, one line of ids and the cause, never the reason's text): `not_open` (the item not open, or decided meanwhile), `decision_not_allowed` (`decline` on a `no_offer` or `pay_blocked` item; any decision on a stop before T017 or on a `refusal` row), `not_offered` (a `pay_blocked` item whose programme is no longer `offered`), `offer_sent` (approving a `no_offer` item once the programme left `awaiting_offer`), `reason_required` (a `no_offer` decision without `reason`), `makeup_pending` (approving a `no_offer` item while session 1's make-up is pending) |
| `programmes.reopen` | `{ enrollmentId, reason, idempotencyKey }` | `{ state: 'paused' }` | `programme.reopened` | only a `programme_stopped` programme; under the slot's lock; refusals `slot_taken`, `party_restricted`, `gender_mismatch` (restore's) |
| `sessions.restore` (changed) | as today | as today | as today | refused `programme_enrollment` on a programme (R-513) |
| `payments.monitor` (changed) | as today | each order adds `kind`, `instalmentMonth`, `automatic`, `declineKind` | — | |
| `settings.*` (as built) | — | — | — | the eight keys appear with their labels |

> *(2026-11-23, SRS DEC-112, the owner: «بس خلي جنب مفيش عرض السبب اللي العرض متعملش بسببه او اللي المعلم بعته يعني».)*
> No `refusal` item can be raised any more (app-surface.md: `programme.request` takes `stop` only), so the queue has no
> `refusal` filter and `programmes.decide` no refusal branch: the refusal is the approved `no_offer` item. Beside a
> `no_offer` item the panel shows why no offer was made, i.e. what the teacher sent to support; with no support channel
> in the app, the administrator records it at the decision in `reason` (1–500, the bound of `programme_requests.reason`,
> ERD §15 rule 80), not in `note` (`adminReason`, 1–1000, `packages/contracts/src/admin/admins.ts:10`). A decision on a
> `no_offer` item without it is refused with a cause of `programmesDecideRefusal`; «required» is the service's rule,
> red first, not a database check (no migration). The queue and `programmes.get` read it.
