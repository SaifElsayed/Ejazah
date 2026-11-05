# Contract: Kernel changes (Phase 3)

What the kernel and the composition root gain. Raw SQL stays in `apps/api/src/platform/db/` (R-API-6).

## Locks and refusals (`apps/api/src/platform/db/`)

| Export | File | Contract |
|---|---|---|
| `lockRows(tx, table, ids)` | `row-lock.ts` | `LockedTable` widens to `sessions`, `session_remedies`, `cancellation_requests`, `disputes`, listed in the one order: `users`, `teacher_profiles`, `availability_slots` (after `lockKey('teacher-slots', …)`), `slot_holds`, `enrollments`, `sessions`, `session_remedies`, `cancellation_requests`, `disputes`, `payments`. `FOR UPDATE`, id order, as T005 decided. A row-lock spec per new table, as the application role |
| `isUniqueViolation`, `isExclusionViolation` | `db-errors.ts` | The closed union gains `cancellation_requests_one_pending_key`, `disputes_one_open_per_session_key`, `session_remedies_session_id_key`, `session_participant_events_provider_event_id_key`, `disputes_one_open_complaint_per_enrollment_key` (a second open complaint, `COMPLAINT_OPEN`; R-322), and the session exclusions already named (for a make-up and a restore's sessions) |
| `clockTimestamp(tx)` | `db-clock.ts` (new) | `SELECT clock_timestamp()`, for the instant a case or dispute closes (FR-422), never the transaction's `now()` |

T005's rules, with this phase's paths (Saif reviews each lock and FK-insert path against them). Beside F3 and F4's
rows below, one more rule (the owner's decision of 2026-11-05 on the second analysis, L1): a path that takes more than
one teacher's `lockKey('teacher-slots', …)` takes the keys in ascending teacher id order, as rows of one table are
taken in id order; the rows marked **(L1)** are those paths. A make-up's booking takes both slots it touches in one
call in id order (L2).

| Path | Locks, in order | Inserts referencing an account |
|---|---|---|
| `sessions.join` | `users` (both, one call) | none |
| evaluation, a review or dispute resolution | `enrollments`, `sessions`; a dispute resolution also `disputes` (the dispute closed, `resolved_at` by `clockTimestamp`) (the second analysis, L3). No count is checked: no settlement ends an enrollment (the owner's decision of 2026-11-05, no automatic termination; R-322) | none (`session_events`, a case: enrollment and session only) |
| an administrator's revision of a dispute's ruling (SRS FR-DISPUTE-7; the owner's decision of 2026-11-05 on the third analysis) | a resolution's order: `enrollments`, `sessions`, then `disputes` (the dispute revised, read again; never written); no `StandingService`, so no account | none (`session_events` reference the enrollment, the session and the dispute) |
| a dispute resolved `party_suspended` or `party_banned` (the owner's decision of 2026-11-05 on the analysis, F3) | `users` (the party, first, `lockAccount`), `teacher_profiles` (a teacher party banned: `StandingService.ban`'s `lockApplication`, after the account and before the slots' key; the third analysis, L-A), `lockKey('teacher-slots')` (a student party: each of their teachers' keys, ascending teacher id, **(L1)**), `enrollments` (the dispute's and the party's confirmed ones, one call), `sessions`, `session_remedies`, `disputes`; `StandingService` and its consequences run on these locks | none (the case and the events reference no account) |
| a student's complaint raised, `sessions.complaint.raise` (R-322) | `users` (the student, `lockRows`), `enrollments` (read again: `confirmed`, the caller its student); the insert under `disputes_one_open_complaint_per_enrollment_key` | the complaint references the student, locked first |
| a complaint decided (a), the enrollment ended (R-322; the threshold termination's row, removed, had these locks) | `enrollments`, `sessions` (remaining, one call), `session_remedies`, `disputes` (the complaint closed, the `absence_termination` case opened), a confirmed fault's order | none (the case and the events reference the enrollment and the sessions only) |
| a complaint decided (b), the teacher suspended (R-322) | a `party_suspended` resolution's against a teacher: `users` (the teacher, first, `lockAccount`), `lockKey('teacher-slots')`, `enrollments` (the complaint's and the teacher's confirmed ones, one call), `sessions`, `session_remedies`, `disputes`; no `teacher_profiles` row, `StandingService.suspend` locking the account only (L-A is a ban's) | none |
| a complaint decided (c), closed (R-322) | `enrollments`, then `disputes` (closing a case or dispute) | none |
| an administrator's restore, `sessions.restore` (R-322) | `sessions.cancel`'s order widened: `users` (both, one call), `lockKey('teacher-slots')`, `availability_slots` (the enrollment's slot), `enrollments`, `sessions`, `session_remedies` (the remedies offered again), `disputes` (the closing's case closed, `restored`); the reservations and open holds read under them | the sessions it inserts reference both accounts, locked first |
| an administrator's correction of an outcome nobody disputed, `sessions.review.revise` (R-323, GAP-3; the owner's decision of 2026-11-05) | a revision's order without its dispute: `enrollments`, `sessions`; the session's disputes and remedy read under them, nothing of `disputes` written; no `StandingService`, so no account | none (`session_events` reference the enrollment and the session) |
| an administrator's manual case, `cases.openManual` with no remedy (R-326; the owner's decision of 2026-11-05) | `enrollments` (the case's own lock, `lockCasesOf`; the enrollment read again through `EnrollmentSide` under it), then `disputes` (the case opened or joined through `openCompensationCase`) | none (the case references the enrollment only; `raised_by_user_id` NULL) |
| `cases.openManual` with `remedyId`, the remedy handed to the student's manual case (R-326) | the refund hand-off's order, as `sessions.remedy.choose`'s: the enrollment's parties read with no lock, then `users` (both, one call), `lockKey('teacher-slots')`, `enrollments`, `sessions`, `session_remedies` (the remedy read again: open, of this enrollment), `disputes` | none (the case references the enrollment only; `session_events` the enrollment and the session) |
| cancellation request, a decline | `sessions`, `cancellation_requests` | the request references the requester: `users` (both parties) locked first |
| cancellation accepted (the make-up offered at once, the owner's decision 5) | `users` (both), `lockKey('teacher-slots')`, `enrollments`, `sessions`, `session_remedies`, `cancellation_requests` | the request's accounts locked first |
| dispute raised | `users` (the raiser), `enrollments`, `sessions` | the dispute references the raiser, locked first |
| an administrator's `sessions.cancel` (the third analysis, L-C) | `enrollments` (the session's), `sessions`, `disputes` (the `admin_cancellation` case opened or joined through `openCompensationCase`, whose own enrollment lock is the one already held) | none (the case references the enrollment only; `session_events` the enrollment, the session and the case) |
| `chat.send`, `POST /uploads/chat` (the third analysis, L-B) | `users` (the sender, `lockRows`), `enrollments` (the enrollment, read again under the lock: `confirmed`, the sender one of its parties) | the message references the sender, locked first |
| remedy offer, a `frozen` remedy's new offer after the reinstatement included; a counter-proposal, its decline, its withdrawal (the student accepts the proposal while it is pending) | `users` (both), `lockKey('teacher-slots')`, `enrollments`, `sessions`, `session_remedies` | none (`session_events` reference the enrollment and the session) |
| `sessions.remedy.choose` (a make-up: `proposed`; a refund: handed to the enrollment's `refund_choice` case through T030), and a counter left unanswered handed to a `counter_unanswered` case by the sweep (T030, T032) (the second analysis, L3) | `users` (both, one call), `lockKey('teacher-slots')`, `enrollments`, `sessions`, `session_remedies`, then for a hand-off `disputes` (the case opened or joined, `openCompensationCase`) | none (the case references the enrollment only; `session_events` the enrollment and the session) |
| make-up booking | `users` (both), `lockKey('teacher-slots')`, `availability_slots` (both slots it touches, the enrollment's own and, for a counter, the counter's, one call, id order; one when they are the same: L2), `enrollments`, `sessions`, `session_remedies` | the session references both accounts, locked first |
| a hold (Phase 2) reading reservations | unchanged (both accounts first), then reads `reservedTimesOf` | unchanged |
| the confirmation's new hold for a released one (FR-PAYG-19's late payment) reading reservations (the analysis, F5's question) | unchanged (both accounts in one call first, the slot, the holds, the enrollments), then reads `reservedTimesOf`; an overlap takes the refusal branch | unchanged |
| closing a case or dispute | `enrollments`, then the conditional update of `disputes` | none |
| a `student_suspended` case closed: cleared (remedies offered: on recitation a make-up or a refund, on the ijazah track a make-up) or the fault confirmed (the enrollment cancelled, its make-ups still scheduled cancelled, every remedy still owed handed to a new `student_fault_confirmed` case; the second analysis, C1) | cleared: `users` (both), `lockKey('teacher-slots')`, `enrollments`, `sessions`, `session_remedies`, `disputes`; confirmed: `enrollments`, `sessions` (its make-ups still scheduled, one call), `session_remedies`, `disputes` (the case dismissed, the new case opened) | none (the new case and the events reference the enrollment and the sessions only) |
| an account's end (booking's subscriber), a student's suspension freezing remedies and deletion lapsing them included | (held) the account; `lockKey('teacher-slots')` (a student's end: each of their teachers' keys, ascending teacher id, **(L1)**); `enrollments`; `sessions`; `session_remedies` | none |
| outage record (the analysis, F4) | `enrollments` (of the overlapped sessions, one call), then `sessions` (the overlapped, one call) | none |

## Rate limits (`apps/api/src/platform/guards/rate-limit.guard.ts`, `apps/api/src/surfaces/procedures.ts`)

The owner's decision of 2026-11-05 (spec FR-470, research R-321; T062):

| Export | File | Contract |
|---|---|---|
| `adminProcedure({ input, output, rateLimit? })` | `procedures.ts` | An optional `RateLimitDeclaration` over the administrator's context, applied by `throttle` after `requireAdministrator` and the input schema and before the `.use` that opens the transaction, so a refused call opens none; `AdminMeta.rateLimit` stamps the key. `disputes.revise` (`rate_limit_dispute_revision`), `sessions.restore` (`rate_limit_enrollment_restore`), `sessions.review.revise` (`rate_limit_outcome_correction`, R-323 GAP-3) and `cases.openManual` (`rate_limit_manual_compensation_case`, R-326) declare one, `subject: 'caller'`, the administrator's id from the context the kind authenticated (R-321, item 6) |
| `throttleDefault` | `rate-limit.guard.ts` | Applied by every signed-in kind (student, user, teacher, administrator) given no `rateLimit`, where `throttle` would be: the key `rate_limit_signed_in_default` (160 per 60 s per research R-325; the reason, the larger of 120 and the heaviest normal minute × 2–3, so a normal user is never refused, a result above 200 setting no number and sending the screen that calls too often back to the owner), the subject `user:<userId>` or `admin:<adminId>`. A procedure with its own limit is counted by it only |
| `RateLimiter` | `rate-limit.guard.ts` | The default key's setting held in process memory for up to 60 s (the one setting so held; a `SettingError` never held, the call refused); its count on a second Redis client (`enableOfflineQueue: false`, `maxRetriesPerRequest: 0`, `commandTimeout: 100`) raced against a 100 ms timer; a failure or a timeout lets the call through and opens a 10 s breaker with one warning; every declared key keeps the first client (`lazyConnect: true`, `maxRetriesPerRequest: 1`) and fails closed, as today. `check(key, subject: RateLimitSubject, procedure)` logs once, at `count === limit + 1`, the first refusal of a subject in a window, and nothing after it in that window: `{ procedure, userId }`, `{ procedure, adminId }`, `{ procedure, subjectDigest }` (the counter key's HMAC, never the value) or `{ procedure, budget }` by the subject's kind, through `RateLimiterDependencies.log` (R-321, item 6; SRS NFR-SEC-12) |
| `RateLimitDeclaration` | `rate-limit.guard.ts` | `{ key, budget?, subject: 'caller' }` or `{ key, budget?, subjectOf }`: `'caller'` accepted by the signed-in kinds only and filled from the context they authenticated, as a `user` or `administrator` subject; a `subjectOf` string always an `identifier`. `throttle` and `throttleDefault` pass tRPC's `path` as the procedure; the upload, public page and account-deletion routes pass their route's fixed name |
| `createRateLimiter` | `rate-limit.guard.ts` | Builds both clients from the one `REDIS_URL`; the header's «every limit read on every check» gains the default key's exception |

`live.events` (app-surface.md, `live`) declares its own, `rate_limit_live_channel` (10 per 60 s), `subject: 'caller'`,
through the user kind's existing `rateLimit`, failing closed (the owner's decision of 2026-11-05, research R-324).

## The live channel (`apps/api/src/platform/live/`; research R-324, the owner's decision of 2026-11-05)

| Export | Contract |
|---|---|
| `LiveRegistry` | The open streams of this process, by user id and by sign-in session id: at most `live_channel_max_connections_per_user` per user (a setting, read at each open), the oldest ended when one more opens; a bounded queue per stream (a kernel constant), a stream that falls behind ended; `endUser(userId)`, `endSession(sessionId)` and `endAll()` |
| `LiveBus` | `publish({ to: userIds, event })` and `subscribe`; in-process only (`InProcessLiveBus`). Exact while the API is one process and every producer runs in it. A Redis bus between processes is Not scheduled, required before a second API process, any worker event made live or payment confirmation made live |
| `LivePublisher` | What a context carries: `afterCommit(to, event)` adds to the transaction's after-commit list, which the user kinds and the administrator kind flush once their transaction has committed, and drop on a rollback (the shape of `deletion.service.ts`' `#afterCommit`); a publish that fails is logged at warn, without its payload, and never retried |
| the user instance's SSE options | `procedures.ts`' user `initTRPC`: `sse.ping` every 25 s and `sse.client.reconnectAfterInactivityMs` 60 s, kernel constants as the limiter's are (R-321, item 5); every yielded event parsed by `liveEvent`; the stream ended at the access token's expiry, which `ResolvedUserSession` exposes additively (`modules/identity/session.service.ts`) |

**Addressing.** No event is addressed by a topic the client chose: each producer names the user ids it read in its own
transaction (a chat send's two parties under L-B's locks; a session's two participants; an enrollment's two parties;
the person whose standing changed). **`account`.** `StandingService`, a student's standing, a deletion and a sign-out
publish `account` after commit and end the person's streams (a sign-out, that sign-in session's).

**Shutdown order (the owner's hard condition).** `onShutdown` in `apps/api/src/main.ts`: `live.endAll()` →
`application.close()` → the queue → the database. Every live stream ends before `application.close()`, whose
`server.close()` would otherwise wait on it; a spec proves shutdown completes with streams open and never waits on one.
Clients reconnect after a random 1 to 15 s delay.

## The composition root

`AppServices` gains `sessions` (join, the session read, cancellation, remedies, disputes) and `chat`;
`AdminSurfaceServices` gains `sessionsAdmin`, `disputes`, `cases`, `students`. `main.ts` binds:

- sessions' `EnrollmentSide` port to booking's `createEnrollmentSide()` (R-301), with `restore(tx, id)` for an administrator's restore (R-322) and `eventsOf(tx, enrollmentId)` for the monitor's timeline (`{ kind, cancellationReason?, occurredAt }`, no payment id; R-323, GAP-1);
- booking's `terminationSubscriber` widened with sessions' `cancelRemainingSessions` and moderation's cases (R-313);
- sessions' `DisputeChat` port to chat's `createDisputeChat()` (R-301, R-314; the owner's decision of 2026-11-05 on the
  analysis, C5): `disputes.chat` asks it once the dispute is checked open, so sessions imports no chat;
- verification's `users.get` reads the cancellation-request counts from sessions' entry (an import, R-301);
- `StandingService` into sessions' dispute resolution and a complaint's decision (b) (FR-421, R-322);
- the video port into sessions; the `POST /webhooks/video` route beside the payment webhook;
- identity's `FileHold` port (`filesHeld(userId)`, a new optional member of the deletion's dependencies) to booking's
  `heldFileOwnersAmong`, which reads its `enrollments` and asks moderation's `enrollmentsWithOpenMatterAmong`, so a
  deleted person's files wait while an enrollment of theirs has an open dispute, case or complaint (spec FR-487,
  research R-327; the owner's decision of 2026-11-05).

- the live channel's registry, in-process bus and publisher into the user and administrator contexts, the publisher
  into sessions, chat and identity's `StandingService`, deletion and sign-out, and `live.endAll()` first in
  `onShutdown` (R-324).

The worker binds the same port for the sweeps, and hands `erase-deleted-files` the same `heldFileOwnersAmong` as its
`held` option. The worker publishes nothing live (R-324).

## Jobs (`apps/api/src/jobs/`, registered in `worker.ts`)

| Job | Schedule | Payload | Double-run spec |
|---|---|---|---|
| `evaluate-sessions` | every minute | `{}` | twice = once: one outcome, one event row, no enrollment ended (no count is checked, R-322), rooms of cancelled sessions ended (idempotent), each `endRoom` and `removeParticipant` call one `info` log line, `{ sessionId }` and a removal's `userId`, never a token (R-323, GAP-7) |
| `reresolve-session-instants` (Phase 2's, changed) | at the worker's start and daily, unchanged | `{}` | unchanged; in the run's one transaction, one `session_events` row `instants_reresolved` per session kept back and per session moved, `previous_start_at` the start it keeps or had (R-323, GAP-6); a refused commit writes none |
| `advance-remedies` | every minute | `{}` | twice = once: one remedy per session, one booking, one case; no offer on an enrollment not `confirmed` or to a suspended student, none to a `frozen` remedy |
| `expire-cancellation-requests` | every minute | `{}` | twice = once |
| `purge-chat` | daily | `{}` | twice = once: the same rows purged, each file removed once (a missing file is not an error) |
| `erase-deleted-files` (Phase 1's, changed) | hourly, unchanged | `{}` | twice = once, unchanged; a held owner's files (`held`, R-327) neither removed nor reported, and removed by the first run after the owner's last open dispute, case or complaint closes (spec FR-487) |

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
- `pnpm contract:snapshot --check --base origin/develop` before a batch with contract changes is pushed;
  `scripts/contract-snapshot.ts` records a subscription's event schema (`live.events`' `liveEvent`), since its
  `_def.output` does not describe what it yields (R-324).
