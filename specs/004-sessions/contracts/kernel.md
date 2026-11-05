# Contract: Kernel changes (Phase 3)

What the kernel and the composition root gain. Raw SQL stays in `apps/api/src/platform/db/` (R-API-6).

## Locks and refusals (`apps/api/src/platform/db/`)

| Export | File | Contract |
|---|---|---|
| `lockRows(tx, table, ids)` | `row-lock.ts` | `LockedTable` widens to `sessions`, `session_remedies`, `cancellation_requests`, `disputes`, listed in the one order: `users`, `teacher_profiles`, `availability_slots` (after `lockKey('teacher-slots', …)`), `slot_holds`, `enrollments`, `sessions`, `session_remedies`, `cancellation_requests`, `disputes`, `payments`. `FOR UPDATE`, id order, as T005 decided. A row-lock spec per new table, as the application role |
| `isUniqueViolation`, `isExclusionViolation` | `db-errors.ts` | The closed union gains `cancellation_requests_one_pending_key`, `disputes_one_open_per_session_key`, `session_remedies_session_id_key`, `session_participant_events_provider_event_id_key`, and the session exclusions already named (for a make-up) |
| `clockTimestamp(tx)` | `db-clock.ts` (new) | `SELECT clock_timestamp()`, for the instant a case or dispute closes (FR-422), never the transaction's `now()` |

T005's rules, with this phase's paths (Saif reviews each lock and FK-insert path against them):

| Path | Locks, in order | Inserts referencing an account |
|---|---|---|
| `sessions.join` | `users` (both, one call) | none |
| evaluation, a review or dispute resolution | `enrollments`, `sessions` | none (`session_events`, a case: enrollment and session only) |
| a dispute resolved `party_suspended` or `party_banned` (the owner's decision of 2026-11-05 on the analysis, F3) | `users` (the party, first, `lockAccount`), `lockKey('teacher-slots')`, `enrollments` (the dispute's and the party's confirmed ones, one call), `sessions`, `session_remedies`, `disputes`; `StandingService` and its consequences run on these locks | none (the case and the events reference no account) |
| threshold termination | (held) `enrollments`, `sessions` (remaining, one call), `session_remedies` | none |
| cancellation request, a decline | `sessions`, `cancellation_requests` | the request references the requester: `users` (both parties) locked first |
| cancellation accepted (the make-up offered at once, the owner's decision 5) | `users` (both), `lockKey('teacher-slots')`, `enrollments`, `sessions`, `session_remedies`, `cancellation_requests` | the request's accounts locked first |
| dispute raised | `users` (the raiser), `enrollments`, `sessions` | the dispute references the raiser, locked first |
| remedy offer, a `frozen` remedy's new offer after the reinstatement included; a counter-proposal, its decline, its withdrawal (the student accepts the proposal while it is pending) | `users` (both), `lockKey('teacher-slots')`, `enrollments`, `sessions`, `session_remedies` | none (`session_events` reference the enrollment and the session) |
| make-up booking | `users` (both), `lockKey('teacher-slots')`, `availability_slots` (the slot), `enrollments`, `sessions`, `session_remedies` | the session references both accounts, locked first |
| a hold (Phase 2) reading reservations | unchanged (both accounts first), then reads `reservedTimesOf` | unchanged |
| the confirmation's new hold for a released one (FR-PAYG-19's late payment) reading reservations (the analysis, F5's question) | unchanged (both accounts in one call first, the slot, the holds, the enrollments), then reads `reservedTimesOf`; an overlap takes the refusal branch | unchanged |
| closing a case or dispute | `enrollments`, then the conditional update of `disputes` | none |
| a `student_suspended` case closed: cleared (remedies offered: on recitation a make-up or a refund, on the ijazah track a make-up) or the fault confirmed (the enrollment cancelled) | cleared: `users` (both), `lockKey('teacher-slots')`, `enrollments`, `sessions`, `session_remedies`, `disputes`; confirmed: `enrollments`, `session_remedies`, `disputes` | none |
| an account's end (booking's subscriber), a student's suspension freezing remedies and deletion lapsing them included | (held) the account; `lockKey('teacher-slots')`; `enrollments`; `sessions`; `session_remedies` | none |
| outage record (the analysis, F4) | `enrollments` (of the overlapped sessions, one call), then `sessions` (the overlapped, one call) | none |

## The composition root

`AppServices` gains `sessions` (join, the session read, cancellation, remedies, disputes) and `chat`;
`AdminSurfaceServices` gains `sessionsAdmin`, `disputes`, `cases`, `students`. `main.ts` binds:

- sessions' `EnrollmentSide` port to booking's `createEnrollmentSide()` (R-301);
- booking's `terminationSubscriber` widened with sessions' `cancelRemainingSessions` and moderation's cases (R-313);
- sessions' `DisputeChat` port to chat's `createDisputeChat()` (R-301, R-314; the owner's decision of 2026-11-05 on the
  analysis, C5): `disputes.chat` asks it once the dispute is checked open, so sessions imports no chat;
- verification's `users.get` reads the cancellation-request counts from sessions' entry (an import, R-301);
- `StandingService` into sessions' dispute resolution (FR-421);
- the video port into sessions; the `POST /webhooks/video` route beside the payment webhook.

The worker binds the same port for the sweeps.

## Jobs (`apps/api/src/jobs/`, registered in `worker.ts`)

| Job | Schedule | Payload | Double-run spec |
|---|---|---|---|
| `evaluate-sessions` | every minute | `{}` | twice = once: one outcome, one event row, one termination at most, rooms of cancelled sessions ended (idempotent) |
| `advance-remedies` | every minute | `{}` | twice = once: one remedy per session, one booking, one case; no offer on an enrollment not `confirmed` or to a suspended student, none to a `frozen` remedy |
| `expire-cancellation-requests` | every minute | `{}` | twice = once |
| `purge-chat` | daily | `{}` | twice = once: the same rows purged, each file removed once (a missing file is not an error) |

`jobs/README.md`'s list loses `send-reminder` from Phase 3 (Phase 4's, spec Assumptions).

## Gates

- The magic-number gate covers `modules/sessions` and `modules/chat`: every number a setting, a contract bound or a
  conversion.
- `boundaries/no-money-vocabulary` covers `modules/chat` as it covers `modules/sessions`; a CI test finds no price,
  `_piasters`, payment or order reference in either (FR-497, SC-409).
- The mandatory CI tests the enforcement map gives this phase: R-SESS-2 (a session with no final event settles), R-SESS-4
  (the reconnection case), R-SESS-5 (a suspended, revoked or banned teacher gets no token), R-GENDER-7 (token replay
  and cross-gender in the adversarial suite), R-SEC-5 (the image corpus, SC-408).
- The adversarial suite's procedure harness gains every procedure of this phase that issues a token or reads a
  session, its chat or its counterparty (FR-496).
- The coverage floor widens to `modules/chat`; `modules/sessions` and `modules/moderation` already on it.
- `pnpm contract:snapshot --check --base origin/develop` before a batch with contract changes is pushed.
