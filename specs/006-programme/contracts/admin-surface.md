# Admin surface: the programme (admin router, `modules/booking/programmes-admin.router.ts`, mounted as `programmes`)

Additive only. Schemas in `packages/contracts/src/admin/programme.ts`. Each mutation is audited (R-API-12), rate
limited by the existing administrator limit, and keyed by an `idempotencyKey`. No card detail appears in an output or
an audit entry (the card's `last4` is the student's only).

| Procedure | Input | Output | Audit | Notes |
|---|---|---|---|---|
| `programmes.queue` | `{ cursor?, filter: 'paused' \| 'stop' \| 'no_offer' \| 'pay_blocked' \| 'charge_unknown' }` | `{ items: [{ enrollmentId, teacher, student, state, pausedSince \| null, request \| null, payeeVerifiedNow \| null }], nextCursor }` (`payeeVerifiedNow` on a `pay_blocked` item only) | `programmes.listed` (the reader; 006:T018, Q-f4 (a): every administrator call records one entry, R-API-12) | oldest first; how late; the teacher's reason on a `stop`, the recorded reason on a decided `no_offer` item (FR-727); each screen explains itself; no `refusal` filter offered (SRS DEC-112, below; the contract keeps the value, unused, R-API-9) |
| `programmes.get` | `{ enrollmentId }` | the programme, its months and orders by kind, its requests (each with its `reason`), `cardSaved` (a boolean, never a card detail; B-P3 Q-9 (a)), and «the assessment was not held» on a closed programme with no `assessment` release (PR #158 r2 Follow-up 2) | `programmes.viewed` (the enrollment; 006:T018, Q-f4 (a)) | the programme's history: a `no_offer` item's recorded reason beside it (FR-727); a `charge_unknown` item (SRS DEC-113): approve = no charge found in the gateway, extend = keep asking |
| `programmes.decide` | `{ requestId, decision: 'approve' \| 'decline' \| 'extend', note?, reason?, idempotencyKey }` | `{ status }` | `programme_request.approved` / `.declined` / `.extended` | approving a stop closes (R-513); `no_offer` (I-2 (a)): approve = the refusal (`assessment_refused`), `extend` = the decision's time + `programme_offer_hours`, either requiring `reason` (1–500, written to the item's `reason`; refused without it, SRS DEC-112); `pay_blocked` (FR-706b): approve = the lapse (`offer_lapsed`), `extend` = `pay_by` at the decision's time + `programme_pay_rest_hours`, no decline; under the programme's row lock, the sweep's; refusals (CONFLICT, a cause of `programmesDecideRefusal`; nothing written, one line of ids and the cause, never the reason's text): `not_open` (the item not open, or decided meanwhile), `decision_not_allowed` (`decline` on a `no_offer` or `pay_blocked` item; `extend` on a stop; any decision on a `refusal` row or, until T021, on a `charge_unknown` item), `sessions_pending` (approving a stop while a session of the programme is scheduled or a remedy is open; Q-e4 (b)), `not_offered` (a `pay_blocked` item whose programme is no longer `offered`), `offer_sent` (approving a `no_offer` item once the programme left `awaiting_offer`), `reason_required` (a `no_offer` decision without `reason`), `makeup_pending` (approving a `no_offer` item while session 1's make-up is pending) |
| `programmes.reopen` | `{ enrollmentId, reason, idempotencyKey }` | `{ state: 'paused' }` | `programme.reopened` | only a `programme_stopped` programme; under the slot's lock; refusals `not_stopped` (no approved stop closed it), `slot_inactive` (the weekly time deactivated or deleted), `slot_taken`, `time_taken` (the student booked the same weekly time elsewhere), `party_restricted`, `gender_mismatch` (restore's) *(PR #160 r1 Minor 6, 2026-11-24)* |
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

> **B-P4 (the owner's answers on B-P4's conflict check, 2026-11-25, Q-1 (a) amended; SRS DEC-113).**
> `programmes.decide` takes `charge_unknown`'s approve and extend only; no «confirm paid» decision exists (a payment is
> confirmed only by the gateway, R-HONEST-1, ADR 0026). Under the programme's row, the enrollment's, then the order's
> (kernel.md `006:T021`): approve writes the month's still-`created` automatic order `expired` (a soft decline, the
> retries from the decision); extend writes the item `extended` (the asking goes on; no new item for that order); an
> order already answered is refused `charge_answered` (additive in `programmesDecideRefusal`), nothing written. Audited
> as the other decisions.
