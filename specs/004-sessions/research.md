# Research: Phase 3 — Live sessions

**Date**: 2026-11-05 · **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

Each decision below resolves a question the specification leaves to the plan. Numbered R-301 to R-327 so that a
citation never collides with Phase 0's R-1…, Phase 1's R-101… or Phase 2's R-201 to R-222. Every decision was taken
against the code as it stands on `Ejazah_app/003-booking/T106` at `da35d59` (`develop` `8e3614e` plus the spec and
clarify commits, read on 2026-11-05); where it names existing code, the path is given. Versions were read from the npm
registry on 2026-11-05 and each one pinned is at least fourteen days old on that date (seventeen on D17, when the
first batch installs it). Decisions that only the owner could take were put to the owner, who answered them on 2026-11-05
(plan.md, "Decisions recorded"); each is marked **Decided** with the answer, and the text below follows it.

---

## R-301 — Where the phase's code lives, and the module graph

**Decision.** `sessions` owns the live lifecycle, as ARCHITECTURE §4 already says: the join, the attendance webhook's
records, the evaluation, cancellation requests, remedies and make-ups, the session dispute's effects on a session, the
outage windows and the durable session events (R-315). `moderation` keeps the `disputes` rows and gains their primitives
(open a session dispute, close a case or a dispute with the database's instant); `chat` owns `chat_messages`; the
account-end consequences on confirmed enrollments live in booking's existing `termination.subscriber.ts` (R-313).

The graph after this phase (each new edge closes no cycle):

| Module | Imports (new in **bold**) |
|---|---|
| sessions | **identity** (gender, standing, `StandingService` through the composition root), **moderation**, **catalog** (the teacher's slots for a counter-proposal, `lockTeacherSlots`) |
| booking | identity, catalog, sessions, **moderation** (the cases of a teacher's or a student's end, T059) |
| chat | **booking** (an enrollment's parties and status), **moderation** (an open dispute) |
| verification | identity, catalog, **sessions** (the user directory's cancellation-request counts, R-318; the owner's decision of 2026-11-05 on the analysis) |
| moderation | none |
| admin | any |

Sessions needs booking's enrollments (the snapshot's track, zone, length and count, the slot, the status) and must
write an enrollment's `completed` and `terminated_no_show`, but booking imports sessions. As Phase 2 did for catalog
(R-207), sessions declares the port it needs, `EnrollmentSide` (`sessions/enrollment-side.port.ts`), and `main.ts`
binds it to booking's `createEnrollmentSide()`: `enrollmentFor(tx, id)`, `lockEnrollments(tx, ids)`,
`terminateNoShow(tx, id)` (an administrator's decision on a complaint, R-322), `restore(tx, id)` (an administrator's restore, R-322), `complete(tx, id)`, `cancel(tx, id, 'admin')` (a suspended student's fault confirmed,
R-313), `slotWeekTaken(tx, slotId, localDate)` (held, or occupied by another
enrollment under R-205's release), `heldTimesOf(tx, userIds, window)` (the occurrences every active hold of those
users would generate, so the proposal and the counter options avoid an open payment window; the analysis's F5), and
`enrollmentPage(tx, filter, cursor)` (a page of enrollments by status, student, teacher or a set of ids, with their
parties, track and snapshot count, keyset by id, for the administrator's monitor, which sessions cannot read from
booking's table; **Decided**, the owner, 2026-11-05, on the third analysis, U3; R-API-6). Every function takes the
caller's transaction and takes no lock it does not name.

The administrator's read of a dispute's chat (`disputes.chat`, R-314) is served by sessions' admin router, but chat
owns the messages, and sessions importing chat would close the cycle chat → booking → sessions. So sessions declares a
second port, `DisputeChat` (`sessions/dispute-chat.port.ts`: `chatPage(tx, enrollmentId, cursor)`, the page as
`chat.list` answers it with the sender's role), chat implements it (`createDisputeChat()` in `modules/chat/`), and
`main.ts` binds it, as it binds `EnrollmentSide` (**Decided**, the owner, 2026-11-05, on the analysis, C5). Sessions
checks the dispute is open, then asks the port; chat imports nothing new.

Verification's `users` router (`requireIdentity` since Phase 1) gains the user directory's two reads, `users.list` and
`users.get` (FR-481, R-318); the counts come from sessions' entry, so verification imports sessions. No cycle: sessions
imports identity, moderation and catalog, and none of them imports verification.

**Rationale.** ARCHITECTURE §4 gives sessions these tables and says "Circular dependency needed? The logic belongs in
platform or in a new module", and Phase 2 established the inverted port as the answer for one edge (R-207, R-219).
Putting the session machine in booking would hand booking four tables ARCHITECTURE gives to sessions.

**Alternatives considered.** A new orchestration module above both: a thirteenth module for one edge. Moving
enrollments' status writes into sessions: R-API-6 forbids touching another module's table.

## R-302 — The LiveKit adapter, its configuration and the Daily rename

**Decision.** `platform/ports/video/livekit.adapter.ts` over `livekit-server-sdk` **2.19.2** (2026-10-22; Node ≥ 19,
depends on `jose` and `@livekit/protocol`), beside the stand-in; `VIDEO_PROVIDER: 'fake' | 'livekit'`, production
refusing `fake` in configuration as the payment port does. Configuration keys replace Daily's, which ADR 0003 lists for
this rename (FR-425): `LIVEKIT_URL` (the project's `wss://` address, given to the app by `sessions.join`, never built
into the app), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (it signs tokens and verifies webhooks; there is no separate
webhook secret in LiveKit). `.env.example`, `config.spec.ts`, `docs/ARCHITECTURE.md` §3.4, `docs/RUNBOOK.md` and
`specs/001-foundations/quickstart.md` §5 are renamed in the adapter's task.

The port's operations, as the adapter implements them:

| Port operation | LiveKit call |
|---|---|
| `createRoom(sessionId, { emptyTimeoutSeconds, departureTimeoutSeconds })` (widened) | `RoomServiceClient.createRoom({ name: sessionId, maxParticipants: 2, emptyTimeout, departureTimeout })`, the two from settings — idempotent (an existing room is answered); `maxParticipants: 2` holds FR-436 at the provider |
| `createSessionToken(sessionId, userId, { validUntil })` (widened) | `AccessToken` with `identity = userId` (an opaque UUID: LiveKit records identities in its logs, so no name), `ttl` ending at `validUntil`, grant `{ roomJoin: true, room: sessionId, canPublish: true, canSubscribe: true, canPublishData: false }`; no `roomCreate`, no `roomAdmin` |
| `endRoom(sessionId)` | `RoomServiceClient.deleteRoom(room)`, which disconnects both participants (FR-482, R-313); an ended room is not an error |
| `removeParticipant(sessionId, userId)` (only if T009 finds room creation on join cannot be turned off, R-313) | `RoomServiceClient.removeParticipant(room, identity)`, a server-API call the project's key may make (it needs `roomAdmin`, which no participant token carries); an absent participant or room is not an error |
| `verifyAndParseParticipantEvent(rawBody, headers)` | R-303 |

`validUntil` is the session's scheduled end: LiveKit checks a token's expiry "only [on] the initial connection, and
not subsequent reconnects", and sends connected clients refreshed tokens itself, so the TTL bounds when a leaked token
can open a connection, and no number is added (R-MONEY-12). `emptyTimeout` and `departureTimeout` are admin settings,
`video_empty_timeout_seconds` (300) and `video_departure_timeout_seconds` (20), SRS §3.14 rows, read by `sessions.join`
and handed to `createRoom` (`createRoom(sessionId, { emptyTimeoutSeconds, departureTimeoutSeconds })`, widened
additively); the defaults are LiveKit's own server defaults (`empty_timeout: 300`, `departure_timeout: 20` in
livekit/livekit's `config-sample.yaml`), no project document having named a value (**Decided**, the owner,
2026-11-05, on the analysis, K2).

**Rationale.** ADR 0003 D2. The grant gives no publish permission per source: camera and screen share are each
participant's own choice and nothing about them is minted into a token (§3.7.2, FR-433).

**Alternatives considered.** Daily, the documented fallback (ADR 0003). A token per connection attempt with a short TTL
setting: a new setting with no requirement behind it; the scheduled end already bounds it.

**Sources.** [Tokens & grants](https://docs.livekit.io/frontends/reference/tokens-grants.md) (expiry on initial
connection only; refreshed tokens; revocation on Cloud; no PII in identity), npm registry (`livekit-server-sdk`
2.19.2 published 2026-10-22), ADR 0003.

## R-303 — The video webhook: verification on the raw body, before any handler

**Decision.** `POST /webhooks/video` (`modules/sessions/video-webhook.controller.ts`), a raw-body route outside tRPC
shaped exactly as `modules/payments/webhook.controller.ts`: the body read untouched up to `MAX_REQUEST_BODY_BYTES`,
LiveKit's `Content-Type: application/webhook+json` accepted, then the kernel's `verifyInboundEvent` over the port's
`verifyAndParseParticipantEvent`. The adapter calls `new WebhookReceiver(key, secret).receive(rawBody.toString('utf8'),
headers.authorization)` — never with `skipAuth`: it verifies the JWT in `Authorization` and compares its `sha256` claim
with the base64 SHA-256 of the body, so a body changed after signing is refused. Absent or wrong signature 401, a
signed body the port cannot read 400, anything recorded or acknowledged 200, a failure while recording 500 (LiveKit
retries). Nothing of the body, the header or the event is logged (R-SEC-2); a refusal is logged at warn with its code,
which the video signature alert of ARCHITECTURE §12 counts.

The rule is R-SESS-7 (constitution 2.5.0, T107 of `specs/003-booking/tasks.md`, done in this cycle on 2026-11-05),
to which R-MONEY-9's parenthesis now points.

**Rationale.** FR-440, R-SESS-1, R-SESS-7, the R-MONEY-9 pattern. One guard core for both providers.

**Alternatives considered.** Parsing JSON through the framework first: the signature covers the exact bytes.

**Sources.** [LiveKit webhooks](https://docs.livekit.io/home/server/webhooks/) (signed JWT in `Authorization`,
"The token includes a sha256 hash of the payload", raw body required), `livekit-server-sdk`'s
[`WebhookReceiver.ts`](https://github.com/livekit/node-sdks/blob/main/packages/livekit-server-sdk/src/WebhookReceiver.ts).

## R-304 — Which provider events become attendance, and how

**Decision.** The adapter maps LiveKit's events to the port's domain events; the service records them in one
transaction under `session_participant_events.provider_event_id` (LiveKit's event `id`, unique and NOT NULL, ERD §15
rule 4), and a replay answers 200 having written nothing.

| LiveKit event | Port event | Stored |
|---|---|---|
| `participant_joined` | `joined` | `user_id` = the participant's identity, `connection_ref` = the participant's `sid` |
| `participant_left`, `participant_connection_aborted` | `left` | the same |
| `room_finished` | `room_ended` | `user_id` NULL, `connection_ref` NULL |
| anything else (`track_*`, `room_started`, egress) | not an attendance event | nothing; 200 |

`occurred_at` is the event's `createdAt` (UNIX seconds), the provider's clock, never the app's (R-TIME-6). The room's
name is the session id; an event whose room is no session, or whose identity is neither of the session's two
participants, is answered 200, written nowhere and reported to error tracking (the payment webhook's rule for an
unknown order). An event for a session already settled is recorded and changes nothing (spec, Edge Cases).

`connection_ref` is new (data-model §2.2): LiveKit gives no ordering or duplicate guarantee, a `participant_left` may
arrive with no `participant_joined` when ICE fails (livekit/livekit#1130), and a rejoin under the same identity may
replace a connection whose `left` arrives after the new `joined`. Keyed by connection, each connection is its own
interval and a participant's time is the union of theirs (R-305), so neither order nor a duplicate identity changes
the sum.

**Rationale.** FR-440, FR-443, R-SESS-1. The port names stay the domain's (R-API-5).

**Alternatives considered.** Pairing joins and leaves per identity in arrival order: wrong under the replacement and
out-of-order cases above. Using `participant.joinedAt`: present on joins only; `createdAt` is on every event.

**Sources.** [LiveKit webhooks](https://docs.livekit.io/home/server/webhooks/) ("there are no guarantees around
delivery"; event `id` a UUID; `createdAt` UNIX seconds; `participant_connection_aborted`); [livekit/livekit#1130](https://github.com/livekit/livekit/issues/1130);
[#4477](https://github.com/livekit/livekit/issues/4477).

## R-305 — Attendance is computed at evaluation from the recorded events

**Decision.** A pure function `evaluateAttendance(events, window, settings)` in `sessions/attendance.rules.ts`, over
interval operations added to `packages/time` (R-TIME-1: instant arithmetic lives there): `intervalsOf`, `union`,
`intersect`, `clip`, `measureSeconds`.

1. Per connection (`connection_ref`): an interval from its `joined` to its first later `left`; a `left` with no open
   interval is ignored; a connection never left closes at the first `room_ended` after it, or at the scheduled end,
   whichever is first (FR-443, R-SESS-2); nothing extends past the scheduled end.
2. Per participant: the union of their connections (a reconnection overlapping the old connection counts once).
3. **Joined** (FR-442): some connection began no later than start + `join_window_minutes`, and the participant's union
   within [start − `early_join_lead_minutes`, end] measures at least `minimum_connection_seconds`.
4. **Simultaneous** (FR-443, R-SESS-4): the measure of the intersection of the two unions, clipped to [start, end].
5. **Outcome** (FR-444, SRS §3.7.5's table): an outage window overlapping [start, end] → `provider_outage`; else both
   joined and simultaneous ≥ ⌈`attendance_threshold_pct` × length⌉ → `done`; both joined below it → `under_threshold`;
   only the teacher → `student_no_show`; only the student → `teacher_no_show`; neither → `both_no_show`.

Ties at one second (LiveKit's resolution), within one connection: a `left` closes an interval already open on that
connection, a `joined` in the same second then reopening it (a reconnect, with no gap); otherwise the `joined` opens it
and the same second's `left` closes it at zero length. Different connections never tie, each being its own interval.
*(Amended 2026-11-08, the owner's decision on T013's findings: was «sort `joined` before `left` for different
connections and `left` before `joined` for the same one», under which a connection joined and left in one second stayed
open until the room's end or the scheduled end.)* Properties (fast-check, as `packages/time` already uses): the result does not depend on the
events' order or on a duplicate; a reconnection never lowers simultaneous time; a left lost changes nothing past the
end. SC-402 is the spec that a disconnect and reconnection yields the sum of the overlaps.

The result is written once, by the evaluation, to `sessions.simultaneous_connected_seconds` as the figure the outcome
was decided on (**Decided**, the owner, 2026-11-05, plan.md decision 3; R-DB-4 names it and cites [ADR 0022](../../docs/adr/0022-simultaneous-connected-seconds-as-a-recorded-figure.md), constitution 2.5.1).

**Rationale.** FR-SESS-9, FR-SESS-11, FR-SESS-17, FR-SESS-18. Computing at evaluation, not accumulating per webhook,
keeps the webhook a pure recorder (R-SESS-2) and makes order irrelevant.

**Alternatives considered.** Accumulating on every webhook: order-dependent and a webhook reaction. Recomputing on
every read: a settled session's telemetry would move as late events arrive, and the admin would see a number the
outcome was not decided on.

## R-306 — The evaluation is a sweep every minute

**Decision.** `jobs/evaluate-sessions.ts`, a sweep with schedule `* * * * *` registered through
`queue.upsertJobScheduler` as every sweep is (`jobs/queue.ts`). Each run reads `session_evaluation_delay_minutes`
(new setting, default 2, R-317) and selects sessions with `evaluated_at IS NULL`, `status IN ('scheduled',
'disputed')` and `scheduled_end_at + delay ≤ now()` (the ERD §14 partial index serves the `scheduled` ones), then
settles each in its own transaction: lock the enrollment, then the session (T005 order, R-321), read again, return if
already evaluated, compute R-305, write `status` (or `outcome_under_dispute` when the session is disputed, R-308),
`simultaneous_connected_seconds`, `evaluated_at`, one `session_events` row, and then the completion
check (R-309; no count is checked, R-322). Run twice equals once (R-API-14). The same run ends the rooms of cancelled sessions still inside their
join period (R-313), each `endRoom` and `removeParticipant` call logged once, `{ sessionId }` and for a removal the
participant's `userId`, never a token (R-323, GAP-7). R-SESS-3: the guard compares with the database's clock and never settles before the end plus the
delay. SC-403 (settled within the delay plus one minute) follows from the minute schedule.

**Rationale.** A sweep survives a lost Redis, a restart and a re-resolved instant (FR-SESS-20 moves `scheduled_end_at`;
a delayed job per session would keep the old instant); one job, idempotent by its `evaluated_at` guard.

**Alternatives considered.** A delayed BullMQ job per session at generation: the delay goes stale when the zone data
changes, and Redis would hold the only record of the evaluation's existence. A webhook reaction: R-SESS-2.

**Sources.** [BullMQ job schedulers](https://docs.bullmq.io/guide/job-schedulers); `jobs/queue.ts` (T112, T171).

## R-307 — Provider outages are windows an administrator records

**Decision.** A new table `provider_outages` (sessions', data-model §2.5): `starts_at`, `ends_at`, `reason`,
`recorded_by_admin_id`. `sessions.outages.record` (admin, second factor, audit `provider_outage.recorded`) takes the
window as local date, local time and an IANA zone, resolved to instants by `packages/time` on the server: an absolute
instant in an input schema is what `time/no-client-timestamp` refuses (R-TIME-6), and the administrator's statement is
the only evidence there is (LiveKit sends no outage event; ADR 0003). The evaluation reads every window overlapping the
session. In the same transaction as the record, after locking the overlapped sessions' enrollments and then the
sessions, each in one call in id order (T005's one order, `enrollments` before `sessions`; the owner's decision of
2026-11-05 on the analysis, F4), each session the window overlaps that is already settled
(`done`, `*_no_show`, `under_threshold`), still inside its dispute window and not disputed moves to `provider_outage`
with one `session_events` row (FR-445), an administrator's resolved or revised session included; a remedy is offered
only once the dispute window has closed, even after a resolution (R-311), so a session still inside it has none, and
none is withdrawn (FR-462) (**Decided**, the owner, 2026-11-05, on the third analysis, G1: before it, a resolution
offered the remedy at once and this sentence did not hold for a resolved session). A recorded window is not edited; a wrong one is answered by resolving its sessions.

**Rationale.** FR-445 and the owner's decision of 2026-11-05.

**Alternatives considered.** Inferring an outage from both participants dropping at once: a guess the SRS does not
allow (R-PROC-3).

## R-308 — A dispute freezes the outcome, which is kept beside the `disputed` status

**Decision.** `sessions.outcome_under_dispute` (new, nullable, data-model §2.1): raising a dispute moves `status` to
`disputed` and copies the outcome there in the same update; a dispute raised between the scheduled end and the
evaluation (the spec's edge case) leaves it NULL and the evaluation writes the automatic outcome into it rather than
into `status`. What counts while frozen reads `outcome_under_dispute`: progress counts it consumed when it is `done` or
`student_no_show` (`sessions/progress.ts` widens its `CONSUMED` read); no remedy is offered for it (R-311). *(Removed on 2026-11-05 with the threshold, the owner's decision of no automatic termination: «the threshold counts only settled `teacher_no_show` sessions, so a disputed absence never terminates an enrollment until it is resolved», plan.md decision 7, served only the threshold. No count ends an enrollment; the repeated-absence mark reads a session by its final status, a disputed one once resolved, R-322.)* Resolution writes the final status, clears the column, writes
`settled_by_admin_id` and `admin_settled_at`, and the dispute's `resolution`, `resolution_notes`, `resolved_by_admin_id`
and `resolved_at` (the database's `clock_timestamp()`, FR-422's rule).

The resolution maps to the session's final status:

| `disputes.resolution` | Final session status |
|---|---|
| `upheld` | the frozen outcome |
| `re_marked` | consumed → `done`; not consumed → `both_no_show` (no attribution, a make-up owed) |
| `no_show_recorded` | against the student → `student_no_show`; against the teacher → `teacher_no_show` |
| `compensation_ordered` | the frozen outcome; the decision recorded, no money moved (FR-DISPUTE-6) |
| `party_suspended`, `party_banned` | the frozen outcome; `StandingService` on the same transaction (FR-421), the party's `users` row locked first, then, for a teacher party banned, their `teacher_profiles` row (`StandingService.ban`'s `lockApplication`; the third analysis, L-A), before the teacher's slots' key (a student party's teachers' keys in ascending teacher id order; the second analysis, L1), the enrollments (the dispute's and the party's confirmed ones, one call), the sessions, the remedies and the dispute (T005's one order; the owner's decision of 2026-11-05 on the analysis, F3) |

A dispute is raised over a session whose status is `done`, `student_no_show`, `teacher_no_show` or `both_no_show`, or
still `scheduled` past its end and unevaluated; one under review (`under_threshold`, `provider_outage`) is already
frozen for an administrator and answers `SESSION_UNDER_REVIEW`; a cancelled session, by agreement or by an
administrator, answers `NOT_DISPUTABLE`, a Cancelled-By-Agreement one being final at its acceptance (**Decided**, the
owner, 2026-11-05, plan.md decision 5, and K1 on the analysis: SRS FR-DISPUTE-1 now says any cancelled session). A
dispute may be raised from the scheduled end, before the evaluation too (SRS FR-DISPUTE-1 as amended on 2026-11-05).
At most one open dispute per session (a partial unique, data-model §2.7); a session whose dispute was resolved may be
disputed again while its window is open, since no remedy is offered before the window closes (R-311; **Decided**, the
owner, 2026-11-05, on the third analysis, G1). No resolution offers a remedy in its own transaction: `advance-remedies`
offers it once the window has closed and no dispute is open (the third analysis, A2).

*A ruling's revision* (SRS FR-DISPUTE-7, spec FR-472; **Decided**, the owner, 2026-11-05, on the third analysis).
`disputes.revise` (admin-surface.md) sets the session's outcome to one of `done`, `student_no_show`,
`teacher_no_show`, `both_no_show`, with a mandatory reason and an `idempotencyKey`, only while the session's dispute window is open, no other
dispute of the session is open, the dispute revised is the session's last resolved one, the session still holds a
ruling's outcome (not reclassified `provider_outage` since), and no remedy exists for it. It writes `status`,
`settled_by_admin_id` and `admin_settled_at` (the session's current settlement), never the dispute's `resolution`,
`resolution_notes`, `resolved_by_admin_id` or `resolved_at`, which keep the ruling; one `session_events` row
`dispute_revised` with `outcome_before`, `outcome_after` and the dispute's id in `case_id`; and the audit entry
`dispute.revised` with the reason. Storage, against the R-DB rules: `outcome_before` is the only record of the outcome
the ruling produced (the resolution clears `outcome_under_dispute`, and `upheld` or `party_*` names no status), so it is
a fact, not a derived value (R-DB-4), and `outcome_after` is what this revision wrote, an event's content a later
revision does not rewrite; the row is append-only (R-DB-3, rule 43's revokes) with its checks in the database (R-DB-5,
rule 43); no index is added (R-DB-9; `case_id` has its plain index); the row references no account, the administrator
being in the audit entry. One row is then both the history and the durable event FR-495 asks for. The rejected
alternative, a `dispute_revisions` table, would be a forty-fifth table repeating `session_events`' append-only pattern
and the audit entry's reason. A revision checks no count: the repeated-absence mark is read when shown, so it follows the revised outcome (R-322). A revision suspends, bans, reinstates and reopens nothing: what the ruling did to an
account (`party_suspended`, `party_banned`) or an enrollment (an enrollment the ruling ended) stays, and the
response's `notUndone` names it. It counts as a resolution for R-311's moment: the remedy waits for it. It is keyed
as every idempotent mutation is (`platform/idempotency/idempotency.service.ts`, `IdempotencyService.run`, as
`teacher.slots.create` in `modules/catalog/slots.service.ts` calls it; ADR 0008, R-API-14): the key claimed, the
revision run and its answer stored in one transaction, a repeat with the same key answered from the stored row and
writing nothing new, a reuse with another input refused `CONFLICT`; the scope `disputes.revise` joins
`packages/contracts/src/idempotent-procedures.ts`, the first administrator procedure there, its actor the
administrator's id (the owner's decision of 2026-11-05). Its locks are a resolution's (contracts/kernel.md), with no account's, since it
calls no `StandingService`. It declares its own rate limit, `rate_limit_dispute_revision` (10 per 60 s), the administrator as
subject, apart from the key and checked before the kind's transaction opens (R-321, the owner's decision of 2026-11-05 on
the administrator's control and the rate limits).

**Rationale.** FR-DISPUTE-3, FR-DISPUTE-4, FR-473 to FR-476. The ERD's status enum keeps `disputed`; without a column
the frozen outcome would be lost.

**Alternatives considered.** Leaving `status` as the outcome and marking the dispute by its row: contradicts the ERD's
`disputed` status and the spec ("marks the session Disputed").

## R-309 — An enrollment's completion; no termination by count

**Decision.** No settlement ends an enrollment: no path counts absences toward an end, and `termination.service.ts`
is not written (**Decided**, the owner, 2026-11-05, no automatic termination; ADR 0023; R-322). *Was:* after each
settlement, a count of the enrollment's `teacher_no_show` sessions at `teacher_no_show_threshold` cancelled the remaining
sessions, handed the open remedies to a `teacher_no_show_threshold` case and set the enrollment `terminated_no_show`. That
end now comes only from an administrator's decision on a student's complaint (R-322), with the same effects, its case
`absence_termination`: a session of that enrollment owed a remedy and not yet offered one (inside its dispute window, or
disputed) is never offered one once the enrollment is no longer `confirmed` (R-311); the case covers it (R-312), as the
cases of a teacher's end, a student's ban and a suspended student's confirmed fault cover theirs (**Decided**, the
owner, 2026-11-05, on the analysis, C1, and on the second analysis, C1).

Completion (FR-449) is checked by the same paths and by the remedy sweep (R-311): an enrollment is `completed` when
every session is settled and not frozen, no remedy is owed (none awaiting its offer, none open), and the last session's
dispute window has closed, and no `student_suspended` case is open on it (FR-486) (**Decided**, the owner, 2026-11-05,
plan.md decisions 4 and 1: otherwise a dispute could reopen what a completed enrollment
owes). Booking's occupancy then frees its slot from the week after the final session plus `slot_release_buffer_weeks`
(FR-423): R-205's rule reads `confirmed` only, so T026's nit 6 is fixed by counting `completed` with the same release
rule. *(Amended 2026-11-10, the owner's rule of 2026-11-10: a package's slot does not return to the teacher until the package has fully ended, its make-ups part of it: a `confirmed` enrollment keeps its slot whatever the date, and only a `completed` one is released from the week after its final session plus the buffer, FR-394 and FR-423 as amended.)*

**Rationale.** FR-NOSHOW-3/4 as rewritten on 2026-11-05, FR-449, the notes under T026.

## R-310 — Cancellation requests

**Decision.** `sessions.cancellation.request` (either participant, a `scheduled` session whose start is in the future,
a reason of bounded length, idempotent), `.answer` (the counterparty, accept or decline), each deciding under the
session's lock (rule 1): a request and a decline take `users` (both parties, one call), `enrollments` (the session's),
`sessions`, then `cancellation_requests`, since the `session_events` row each writes takes a key-share lock on the
enrollment (**Decided**, the owner, 2026-11-06, on the fifth analysis, L2; contracts/kernel.md). At most one pending request per session: a partial unique index on `(session_id) WHERE status
= 'pending'` (ERD §15, new rule), so the second party answers the first instead (the edge case). A request is read as
expired from the scheduled start whatever its row says; an answer at or after the start is refused
`CANCELLATION_EXPIRED` and changes nothing (FR-458, SC-411); a sweep `expire-cancellation-requests` (every minute,
idempotent) writes `expired` for the record. Acceptance sets the session `cancelled_by_agreement` (frees both parties'
time, ERD §15 rule 19), records nothing against either party, and offers the make-up in the same transaction: the session is final at
acceptance and cannot be disputed (R-311; **Decided**, the owner, 2026-11-05, plan.md decision 5). Each request,
answer and expiry writes a `session_events` row. The user's admin record shows the count of requests made, in total
and over the last `cancellation_requests_recent_days` (**Decided**, the owner, 2026-11-05, plan.md decision 8: 30 days,
an admin setting).

## R-311 — Remedies: offered when final, placed by agreement, reserved in code

**Decision.**

*Offering.* A sweep `advance-remedies` (every minute) offers a remedy for each session whose final status owes one
(`teacher_no_show`, `both_no_show`), that has no remedy yet, and whose outcome is final: its dispute window
(`dispute_window_hours` after the scheduled end) has closed and no dispute on it is open (the session is not
`disputed`) (FR-462). A resolution or a revision inside the window offers nothing: the remedy waits for the window's
end, and a dispute raised inside the window, a second one included, holds it until resolved, so the offer comes at the
latest of the window's end, the last resolution and the last revision (R-308), and no review or dispute resolution
offers a remedy in its own transaction (**Decided**, the owner, 2026-11-05, on the third analysis, G1 and A2: before
it, a resolution offered at once, and a second dispute or an outage window could then withdraw what was offered). Every offer, by any path, needs the enrollment `confirmed` and the student's account not suspended:
a session owed on an enrollment that ended is covered by that ending's case (R-309, R-312), and one owed to a
suspended student waits for the reinstatement, the sweep offering it on its next run after (**Decided**, the owner,
2026-11-05, on the analysis, C1 and C3). The sweep also offers a remedy for a `cancelled_by_agreement` session of a
`confirmed` enrollment that has none: an acceptance between B37 (T021) and B38 (T028) wrote no remedy, and the sweep
closes that gap (F8). A Cancelled-By-Agreement session is final at its acceptance and cannot be disputed, so its remedy is
offered in the acceptance's own transaction, not by the sweep: the one exception to the wait for the dispute window
(**Decided**, the owner, 2026-11-05, plan.md decision 5). The sessions a student's suspension cancelled are offered
theirs when the administrator closes the `student_suspended` case as cleared, in that transaction (R-313). The
`session_remedies` row is inserted at that moment (unique on `session_id`, so "recorded once"), with `offered_at`,
`choice_closes_at = offered_at + makeup_choice_window_days`, `snapshot_answer_window_hours` (A, from
`makeup_counter_answer_hours`) and `snapshot_first_session_lead_hours` (L, from `first_session_lead_hours`) fixed then,
so a later change to any of the three settings applies prospectively (§3.14) and no counter-proposal's answer window
can run past the proposal's start (**Decided**, the owner, 2026-11-05, on the analysis: the windows fixed at the
system proposal's offer). Because no row exists before the offer, nothing is ever offered and withdrawn.

*The proposal* (FR-464, FR-466): the enrollment's weekly slot, in the snapshot's zone, in the first week after its last
session (make-ups and reservations included) whose occurrence starts no earlier than `choice_closes_at` + A + L (H1 of
the owner's rule of 2026-11-05 with the analysis's lead, R-320: a counter-proposal sent at the choice window's last
moment keeps the matter open until `choice_closes_at` + A, and no make-up starts within L of its decision), is not held
or occupied by another enrollment (`EnrollmentSide.slotWeekTaken`), and overlaps no session, reservation or open hold
(an unexpired payment window: the occurrences each active hold of either party would generate, read through
`EnrollmentSide.heldTimesOf`, the read the counter options use too) of the teacher or the student (F5). Resolved per
occurrence by `packages/time` (R-TIME-2). Fixed at the offer and never moved: no counter-proposal's answer window ends
after it. Recitation after a Teacher-No-Show, or a session a cleared student's suspension cancelled on a recitation
enrollment: `status = 'awaiting_choice'`, the proposal shown with the refund; otherwise `proposed`.

*The student* (before `choice_closes_at`): accepts the proposal → it is booked, and a counter-proposal still pending is
withdrawn and its time released (the owner's approval of 2026-11-05); chooses a refund (only from `awaiting_choice`, only
on a recitation enrollment: after a Teacher-No-Show, or for a session a cleared student's suspension cancelled, R-313;
the third analysis, A1) →
`refund_case`, handed to the enrollment's open `refund_choice` case or a new one (R-312); counter-proposes one of the teacher's active slots of the
session's length on a date offered by `sessions.remedy.counterOptions`, which lists only occurrences starting no
earlier than max(now + A + L, `choice_closes_at`) (H2 with the analysis's lead; decision 14 (i)) and free for
both parties (sessions, holds, reservations) → `counter_proposed`, the `counter_*` columns set
with `counter_proposed_at` = now, its answer window closing at `counter_proposed_at` + A. On a recitation enrollment, after a Teacher-No-Show and for a session a
cleared student's suspension cancelled (R-313), the refund is also offered (`awaiting_choice`). One counter-proposal pending at a time (`COUNTER_PENDING`); a counter-proposal is the student's choice of a
make-up, so after a decline the remedy is `proposed`, not `awaiting_choice`.

*The teacher* (before the counter's answer window closes): accepts → the counter is booked; declines → while the choice window
is still open, the remedy returns to `proposed`, the counter's time is released and the student may accept the
proposal or counter-propose again, from options read again under H2 (H4); once the choice window has closed, the
system's proposal is booked at once (**Decided**, the owner's rule of 2026-11-05, plan.md decision 9, which replaces
both earlier options).

*Windows ending* (`advance-remedies`): `proposed` or `awaiting_choice` past `choice_closes_at`, with no counter-proposal
pending → the proposal is booked (H5, FR-MAKEUP-4), a refusal retried under "Booking a make-up" below; `counter_proposed` past its answer window's close, whether the
choice window is open or closed → refund on either track: one compensation case `counter_unanswered` with no amount
(FR-465, FR-467). A `counter_proposed` remedy past `choice_closes_at` waits for its answer window; the worst case is the
choice window plus one answer window (7 days + 72 hours), and the make-up then starts at least L after it.

*The answer window's close is computed, not stored* (**Decided**, the owner, 2026-11-05, on the second analysis, D1).
No column holds it: one sessions function answers `counter_proposed_at` + A (the remedy's
`snapshot_answer_window_hours`, never the live setting) through `packages/time`'s `addHours` (R-TIME-1), and every
reader uses it: `RemedyView.counter.answerClosesAt`, which the API returns computed under the field the contracts name;
`sessions.remedy.answerCounter`'s `REMEDY_NOT_OPEN`; and the sweep above, which compares it with its run's instant. A
stored copy would be a derived value with no ADR (R-DB-4). `choice_closes_at` stays a column: it is what fixes the
choice window, and no column holds the window's days.

*Frozen* (FR-486; **Decided**, the owner, 2026-11-05, on the analysis, C3). When a student is suspended, each of their
open remedies not yet frozen (`awaiting_choice`, `proposed`, `counter_proposed`; «open» as data-model §3 defines it,
`frozen` included, the third analysis's F1) becomes `frozen` in the suspension's transaction: a pending counter-proposal is withdrawn (`counter_*` cleared, one `counter_withdrawn` row) and its time
released, the system's proposal's reserved time is released too, and one `remedy_frozen` row is written. Nothing
advances a frozen remedy while the account is suspended: the sweep skips it, and its windows do not run. Once the
account is reinstated (`StandingService.reinstateStudent`), the sweep's next run offers each frozen remedy again as a
new offer, under the offer's own locks (both accounts in one call first, contracts/kernel.md), not on the
reinstatement's transaction, which holds the student's account alone: `offered_at` = that run's instant, a new full
`choice_closes_at`, A and L read again from the settings, a new proposal placed by the rule above (H1, F5, the lead),
and `awaiting_choice` or `proposed` again by its kind of debt; one `remedy_offered` row. A frozen remedy reserves
nothing.

*Lapsed* (FR-484; **Decided**, the owner, 2026-11-05, on the analysis, C2). A student's deletion moves each of their
open remedies (`awaiting_choice`, `proposed`, `counter_proposed`, `frozen`) to `lapsed`, with `decided_at` and no case,
nothing owed (one `remedy_lapsed` row each); a remedy already `refund_case` keeps its case open for the administrator.

*History.* `session_remedies` holds the current pending counter-proposal only: the `counter_*` columns are set exactly
while `status = 'counter_proposed'` and cleared at the decline, the withdrawal or the hand-off to a case. Every
counter-proposal, with its slot, date, time and zone, is kept on its `session_events` row (`counter_proposed`), and its
end on another (`counter_accepted`, `counter_declined`, `counter_withdrawn`, `counter_booking_refused`, `remedy_handed_to_case`) (R-315; `counter_booking_refused` the owner's decision of 2026-11-06 on the fourth analysis, A1).

*Reservation* (FR-466, H3). No row reserves a time: the system's proposal, from the offer until the remedy settles
(booked, or handed to a case), and a pending counter-proposal, during its answer window, are read as occupied by every
path that places a session or a hold — `checkout.hold` and `booking.slots` (booking's one overlap check), the make-up
proposal and counter options, and a make-up's booking — through `sessions`' `reservedTimesOf(tx, userIds, window)`,
each path holding both accounts' locks first (T005 rule 2), so a reservation and a hold of the same people serialise.
A counter's time is released at its decline, its withdrawal or its window's end; a frozen remedy reserves nothing.
Phase 2's confirmation (`confirm-enrollment`, booking's `confirmation.service.ts`) does not read booking's overlap
check: its branch that places a new hold for a released one (FR-PAYG-19's late payment, `reholdEnrollment`) relies on
the database's exclusions, which see no reservation. So that branch reads `reservedTimesOf` too, under the accounts'
locks it already holds, and takes its refusal branch when a generated session would overlap a reservation of either
party; the branch that converts a still-active hold needs nothing, since no reservation is made over an open hold
(F5, H2). The database's exclusion constraints remain the second line for every real session (FR-468). **Decided** (the owner, 2026-11-05, plan.md decision 2): in
code, not with a session row.

*Booking a make-up* (FR-469, FR-423): lock both accounts, the teacher's slots' key, the slots (the enrollment's own
and, for a counter, the counter's, in one call in id order: L2 of the second analysis), the enrollment, the session
and the remedy (in that order), read again, insert one session `scheduled` with `sequence_number` = last + 1,
`makeup_for_session_id`, the local date, start and zone as the fact and the instants from `packages/time`; the
remedy `booked`, `decided_at`. An exclusion refusal (`isExclusionViolation`) rolls back, leaves the remedy open and
reports it (**Decided**, the owner, 2026-11-05, on the third analysis, A3, which names the window):

- a refused acceptance of the system's proposal by the student leaves the remedy as it was, its windows running;
- a refused acceptance of a counter-proposal by the teacher releases the counter as a decline does, in a second
  transaction under the same locks: the `counter_*` columns cleared, one `counter_booking_refused` row (not
  `counter_withdrawn`, the student's acceptance of the proposal: **Decided**, the owner, 2026-11-06, A1) and one `warn`
  log line `{ sessionId, enrollmentId, constraint }`, the constraint `sessions_teacher_no_overlap` or
  `sessions_student_no_overlap`, no personal data and no new column (**Decided**, the owner, 2026-11-06, on the fifth
  analysis, A7; T032), the remedy
  `proposed` while the choice window is open (the student may accept the proposal or counter-propose again from options
  read again, H4), the proposal booked as below once it has closed; so the sweep never reads it as unanswered;
- a booking of the system's proposal the rules decided (H5 at `choice_closes_at`, a decline or a refused counter after
  it) leaves the remedy `proposed` past `choice_closes_at`, which `advance-remedies` books on its next run. Its retry
  window: each run tries again only while the proposal's occurrence starts at least L (the remedy's
  `snapshot_first_session_lead_hours`) after the run's instant, and reads again, under the booking's locks, the
  reservations (`reservedTimesOf`) and open holds (`EnrollmentSide.heldTimesOf`) of both parties, an overlap counting as
  a refusal; once the occurrence would start within L of a run, the remedy is handed to a `makeup_refused` case
  (T030), a reason the case list shows. The proposal itself never moves and never started before C + A + L (H1), so
  no retry books a time the window rule hides (R-320).

**Rationale.** FR-462 to FR-469, ADR 0018 D2 to D4, the clarifications and the owner's decisions of 2026-11-05.

**Alternatives considered.** A remedy row at settlement with an "awaiting offer" state: needs a withdrawal when a
dispute removes the debt, which FR-462 forbids. Reserving with session rows: database-enforced, but a provisional
session in every list, a sequence number that may be abandoned, and a new session status. Booking the proposal at once
on a decline while the choice window is open (ADR 0018 D3's first "falls back"), and keeping each counter-proposal on
the remedy row: both replaced by the owner's rule of 2026-11-05.

## R-312 — Compensation cases: the new reasons, and closing one

**Decision.** `COMPENSATION_REASONS` (`moderation/compensation-case.service.ts`) gains `absence_termination` (the
case an administrator's termination on a complaint opens, R-322; it replaces `teacher_no_show_threshold`, removed with the
threshold on 2026-11-05), `admin_cancellation`, `teacher_ended` (a teacher's suspension, revocation, ban or deletion), `student_suspended`,
`student_banned`, `student_fault_confirmed` (the remedies still owed when a suspended student's fault is confirmed,
R-313; the second analysis, C1), `refund_choice`, `counter_unanswered` and `makeup_refused`; and, on the decisions of
2026-11-05 answering the administrator's control inventory, `admin_opened_for_student` and `admin_opened_for_teacher`,
an administrator's manual case (R-326), Phase 2's covering rule reading none of the eleven (R-326). One open case per enrollment and reason
stays the rule, so two refunds on one enrollment join one case; which sessions a case covers is the remedies whose
`case_id` names it, plus the sessions its opening action cancelled (the `cancelled_by_admin` rows of `session_events`
whose `case_id` names it, C4), plus, for the case an enrollment's end opened (`absence_termination`,
`teacher_ended`, `student_banned`, `student_fault_confirmed`), every session of that enrollment owed a remedy that was never offered one
(`teacher_no_show`, `both_no_show` or `cancelled_by_agreement` with no `session_remedies` row, including one whose
dispute is resolved so after the end) (C1; Cancelled-By-Agreement named on the third analysis, I1, as R-313's
confirmed fault already counted it). Two more, on the third analysis (**Decided**, the owner, 2026-11-05, U1 and U2):
a `student_fault_confirmed` case also covers each make-up session the suspension cancelled (a `cancelled_by_admin`
event naming the dismissed `student_suspended` case, on a session with `makeup_for_session_id`), owed for the session
it made up; and the case an enrollment's end opened also covers the sessions the suspension cancelled when a
`student_suspended` case on that enrollment, open at the end, is later resolved (the student cleared), owed as
refunds. `cases.list` shows the open `student_suspended` cases first, then the rest by their opening, so a
suspended student's enrollment, which keeps its slot, is settled fast (the owner's decision of 2026-11-05 on the
analysis). Moderation gains `closeCase(tx, caseId, { status: 'resolved' | 'dismissed', note, adminId })`: lock
the enrollment's row first (`lockRows`), then one conditional update `WHERE status = 'open'` writing `status`,
`resolution` (`compensation_ordered` for resolved), `resolution_notes`, `resolved_by_admin_id` and `resolved_at =
clock_timestamp()` together (FR-422, the note under T082), with the specs that note asks for: a race with a paid event,
and one resolved and one dismissed case on one enrollment, the later closing winning in `caseInstantsAmong`. A
`student_suspended` case's closing carries its effect on the same transaction (R-313, plan.md decision 1): resolved is
the student cleared (the remedies offered, a make-up or, on recitation, a make-up or a refund), dismissed is the fault
confirmed (the enrollment cancelled `admin`, its make-ups cancelled, every remedy still owed handed to a new
`student_fault_confirmed` case); on an enrollment that ended another way while the case was open, only R-313's
narrower effect.

## R-313 — When an account ends: T059, a teacher's end and a student's (002:T144)

**Decision.** Booking's `terminationSubscriber` (already subscribed to identity's `AccountConsequences`) gains the
confirmed part, on the action's transaction, after the account's lock the action already holds:

| Cause | Account | Sessions | Confirmed enrollments | Case |
|---|---|---|---|---|
| `account_deleted` | student | remaining `cancelled_by_admin` | `cancelled`, `account_deleted`; open remedies `lapsed`, a chosen refund's case kept open (C2) | none (T059) |
| `account_deleted` | teacher | remaining `cancelled_by_admin` | `cancelled`, `account_deleted` | one per enrollment, `teacher_ended` (T059) |
| `suspended` | teacher | remaining `cancelled_by_admin`, one in its join period included | stay `confirmed`, keep their slot, cannot complete while the case is open; open remedies `frozen` and not offered while the teacher is suspended; resumed at the reinstatement (T071, **Decided**, FR-504, SRS FR-SESS-16 as amended) | one per enrollment, `teacher_suspended` (T071) |
| `approval_revoked`, `banned` | teacher | remaining `cancelled_by_admin` | `cancelled`, `teacher_suspended` | one per enrollment, `teacher_ended` (FR-483) |
| `suspended` | student | upcoming `cancelled_by_admin` | stay `confirmed`, keep their slot, cannot complete while the case is open (**Decided**, the owner, 2026-11-05, plan.md decision 1 (b)); open remedies `frozen` (C3) | one per enrollment, `student_suspended` (FR-486) |
| `banned` | student | upcoming `cancelled_by_admin` | `cancelled`, `admin`, at once (**Decided**, plan.md decision 1 (a)) | one per enrollment, `student_banned`, nothing owed by default (FR-486) |

Open remedies of the enrollments cancelled are handed to the case (a student's deletion, which opens none, lapses
them). Sessions are cancelled through the sessions entry (`cancelRemainingSessions(tx, enrollmentIds, now, caseOf)`),
never booking's own write; each `cancelled_by_admin` event row carries the case its enrollment's action opened or
joined, NULL for a student's deletion (C4). Lock order: the account (held), the
teacher's slots' key (for a student, each of their teachers' keys in ascending teacher id order: **Decided**, the
owner, 2026-11-05, on the second analysis, L1), the enrollments in id order, their sessions, their remedies; no row referencing an account is
written (the case's `raised_by_user_id` is NULL, `session_events` reference the enrollment and the session).

A suspended student's enrollment stays `confirmed`. A remedy already open at the suspension (offered before it, its
choice window still running) is frozen and offered again at the reinstatement (R-311, "Frozen"; **Decided**, the
owner, 2026-11-05, on the analysis, C3). The `student_suspended` case is closed by the administrator one of two ways,
under FR-422's lock rule:

- **Cleared** (`cases.resolve`): allowed only once the student's account is active again (`students.reinstate`), since
  a suspended account answers no remedy (`STUDENT_SUSPENDED` before); in the same transaction each session the
  suspension cancelled (the `cancelled_by_admin` rows naming the case, C4) is offered what FR-MAKEUP-2 gives for a
  Teacher-No-Show, the fault not being the student's: on a recitation enrollment `awaiting_choice` (a make-up or a
  refund), on an ijazah-track one `proposed`, placed as R-311 places every make-up, a counter-proposal left unanswered
  becoming a refund (**Decided**, the owner, 2026-11-05, on the analysis; SRS FR-ADMIN-5 as amended).
- **Fault confirmed** (`cases.dismiss`): an enrollment's end like the others (**Decided**, the owner, 2026-11-05, on
  the second analysis, C1; SRS FR-ADMIN-5 as amended). In the transaction that dismisses the case: the enrollment is
  cancelled with the reason `admin` through `EnrollmentSide.cancel(tx, id, 'admin')` (an `enrollment_events` row
  `cancelled`), and booking's occupancy frees its slot; a new compensation case `student_fault_confirmed` is opened
  on it; every make-up session still scheduled on it (booked after the reinstatement, the suspension having cancelled
  every upcoming session) is cancelled `cancelled_by_admin` through `cancelRemainingSessions`, its event carrying the
  new case's `case_id`; and every remedy owed on it is handed to the new case, never to the case dismissed: the open
  and `frozen` remedies (`refund_case`, its `case_id`), the cancelled make-ups (through their events), and every
  session owed a remedy never offered, which `covers` lists (R-312), whatever it is owed for: a Teacher-No-Show,
  a Both-No-Show, a Cancelled-By-Agreement session (the teacher's request or the student's), a provider outage
  resolved to an outcome that owes one; and each make-up session the suspension itself cancelled, owed for the session
  it made up (a cause that was not the student's fault), which `covers` lists as R-312 says (**Decided**, the owner,
  2026-11-05, on the third analysis, U1). The ordinary sessions the suspension cancelled are owed nothing, the fault
  being the student's.
- **An enrollment that ended another way while the case was open** (a ban, a teacher's end; **Decided**,
  the owner, 2026-11-05, on the third analysis, U2): there is no second end, and the case decides only the sessions the
  suspension cancelled. Cleared (`cases.resolve`, once the account is reinstated): no remedy is offered, the
  enrollment not being `confirmed`; those sessions join the case the first end opened, owed as refunds, which that
  case's `covers` lists (R-312). The fault confirmed (`cases.dismiss`): they are owed nothing, and the case closes with
  no further effect (no cancellation, no new case).

A teacher's suspension pauses (T071; FR-504; SRS FR-SESS-16 as amended; the notes under T071 of
`specs/004-sessions/tasks.md`): a student's suspension's path reused, the `teacher_suspended` case named by every
session it cancelled. The case is closed two ways only, never by `cases.resolve` or `cases.dismiss` (`CONFLICT`
`closed_by_reinstatement`, nothing written):

- **The reinstatement** (`teachers.reinstate`, `StandingService.reinstate` with the `reinstatement` the admin module
  hands in, sessions' `createTeacherReinstatement`): in its transaction, the paused enrollments' students read with
  no lock, then `users` (the teacher and those students, one call, id order) in place of `lockAccount`, the teacher's
  key, the paused enrollments, their cancelled sessions, their remedies, `disputes`; each session the suspension
  cancelled offered through T028's `offerLocked` with `clearedSuspension` (recitation `awaiting_choice`, ijazah track
  `proposed`), the case closed `resolved`, `compensation_ordered`, the note `reinstated`; the frozen remedies offered
  by `advance-remedies`' next run. No free week refuses the whole reinstatement `CONFLICT` `no_free_week`, nothing
  written (T036's precedent).
- **An end of the paused enrollment meanwhile** (Q5 (a), widened by the review session): the case closed in the end's
  transaction, `resolved`, `compensation_ordered`, the fixed note `ended_meanwhile`, `covered_by_case_id` the end's
  case (rule 49 as T069 widened it), by the ending administrator (`AccountConsequence`'s `actor`), `disputes` last, so
  the sessions it cancelled are that case's `covers` (U2, `suspensionCasesCoveredBy` widened). Covered: a teacher's
  ban or revocation (`teacher_ended`), the student's ban (`student_banned`), a complaint decided (a)
  (`absence_termination`), a `student_suspended` case's fault confirmed (`student_fault_confirmed`); T081's and T082's
  ends by their tasks. A person's own deletion names no administrator, so the case is left open with one warn line of
  ids until T080 refuses such a deletion. A completion cannot end it (held while the case is open), nor a payment's or
  a hold's cancellation (`pending_payment` only). A student's suspension of a paused enrollment ends nothing: a second
  case opens.

A student's suspension and ban are new `StandingService` methods, `suspendStudent`, `banStudent` and
`reinstateStudent` (a reinstatement restores the account only; nothing cancelled is restored, the case deciding),
behind admin procedures `students.suspend/ban/reinstate`, each ending the account's sign-in sessions and calling the one
consequences entry, as the teacher's do (002:T144, FR-421). A dispute's `party_suspended`/`party_banned` calls the same
methods (`suspend` for a teacher, `suspendStudent` for a student) on the resolution's transaction.

FR-482's removal from a room: the token is refused from the commit (the join reads the standing under the accounts'
locks, R-302's join, so it waits for an action in flight); the session, cancelled, admits no new token; and the
`evaluate-sessions` sweep ends, every minute, the room of every cancelled session still inside its join period
(`endRoom`, idempotent), which removes both participants within a minute. LiveKit creates a room on join when it does not exist unless the
project forbids it, so a token minted before the cancellation and still valid could open a fresh room: B34's adapter
task checks this on the free project (quickstart §3) and, if so, records the setting that turns automatic creation off
in `docs/RUNBOOK.md`; the session being cancelled, nothing such a room records counts. If the free plan has no such
setting, the adapter gains `removeParticipant(sessionId, userId)` over LiveKit's server API
(`RoomServiceClient.removeParticipant`, R-302), and the same sweep, for a cancelled session inside its join period whose
room exists again, removes each restricted participant (a teacher suspended, revoked or banned) before ending the room,
so a token minted before the cancellation keeps no one in a room beyond the sweep's minute (**Decided**, the owner,
2026-11-05, on the analysis, K3). A post-commit hook in identity's registry
would make it immediate but changes identity's contract for one call; the minute is the plan's reading of "removed".

## R-314 — Chat, its documents, and its purge

**Decision.** `chat.list` (newest first, keyset pages of `chat_page_size`), `chat.send` (text, `rate_limit_chat_message`,
idempotent), and the document upload as a third use of the upload route (`surfaces/upload-route.ts`), kind `chat`,
`POST /uploads/chat`, fields `enrollmentId` and `filename`, under `rate_limit_upload` and `upload_max_bytes`. Both
sending paths insert a `chat_messages` row referencing the sender, so each locks the sender's `users` row first
(`lockRows`), then the enrollment's `enrollments` row, and reads the enrollment's status and parties again under those
locks (T005 rules 1 and 2; **Decided**, the owner, 2026-11-05, on the third analysis, L-B; contracts/kernel.md). Both
parties of a `confirmed` enrollment, and only they, from confirmation (FR-488); after the enrollment ends, reading stays
until the purge, sending stops (**Decided**, the owner, 2026-11-05, plan.md decision 11).

The `chat` kind's types are decided by content, the declaration discarded (R-SEC-4): **refused** whenever
`sniffContentType` names any image type (the head of every upload, R-SEC-5) whatever the extension; **accepted**
`application/pdf` (`%PDF-`); **accepted** `text/plain` when no signature matches and the whole stream, checked as it
streams, decodes as UTF-8 with no WHATWG "binary data byte" (0x00–0x08, 0x0B, 0x0E–0x1A, 0x1C–0x1F) — every other file
refused. A filename whose extension is an image's is refused too (FR-490 "by its extension"), after the content check.
Office documents (ZIP containers that can carry images and macros) are not admitted (**Decided**, the owner,
2026-11-05, plan.md decision 12; SRS FR-SESS-7 records it: Office files can carry macros, and may be added later). RISK-02
(an image inside a PDF) stays accepted. The key is private; `chat.attachmentLink` answers a link valid
`document_link_ttl_seconds` (R-SEC-3).

`jobs/purge-chat.ts` (daily, idempotent): for an enrollment `completed`, `terminated_no_show` or `cancelled` whose last
session's scheduled end + `dispute_window_hours` + `chat_retention_days` (30 days by default, the owner's decision of
2026-11-05: was 0; an administrator's setting) has passed, with no open dispute, compensation case or (from Phase 4) report, null each message's body and attachment fields, set `purged_at`, and remove the stored
files after the commit (a failed removal retried, as `erase-deleted-files` does). An administrator reads the chat only
through `disputes.chat` while that dispute is open, each read audit-logged (FR-475): sessions' admin router checks the
dispute and asks the `DisputeChat` port, which chat implements and `main.ts` binds (R-301, C5).

**Sources.** [WHATWG MIME Sniffing, binary data byte](https://mimesniff.spec.whatwg.org/#binary-data-byte); the kernel's
sniffer (`platform/guards/upload.middleware.ts`, T104).

## R-315 — Every event is a durable row

**Decision.** A new append-only table `session_events` (sessions', data-model §2.4) records each session-level event
FR-495 names (settled, cancellation requested, accepted, declined, expired, cancelled by an
administrator, remedy offered, counter-proposed, counter accepted, declined or withdrawn, remedy frozen, make-up booked,
handed to a case, lapsed, dispute raised, dispute resolved, a ruling revised, review resolved, outage reclassified, a complaint of
the teacher's absence raised or decided (R-322), an administrator's correction of an outcome nobody disputed and a
session's instants re-resolved (R-323, GAP-3 and GAP-6); a
`cancelled_by_admin` row carries the case its action opened or joined, C4; a `dispute_revised` row the dispute revised
and the outcome before and after, R-308; an `outcome_corrected` row the outcome before and after; an
`instants_reresolved` row the previous start; a `complaint_raised` or `complaint_decided` row, with no session, the complaint,
R-322); `enrollment_events` (booking's) gains the kinds
`completed`, `terminated_no_show` and `restored` (R-322). Phase 4's notifications read both and change nothing here; the names they give these events are SRS FR-NOTIF-1's, amended by the owner on 2026-11-05 with fourteen Phase 3 names (plan.md, «Decisions of 2026-11-05, the administrator's control and the rate limits», item 6), and on 2026-11-06 with a fifteenth, `session_outcome_corrected`, read from `outcome_corrected` (plan.md, «Decisions on the fourth analysis»); `compensation_case_opened` is read
from the manual case's `disputes` row and its audit entry `case.opened_manually` (R-326); `absence_complaint_decided`,
read from the `complaint_decided` row, is told to both parties, the student and the teacher, as SRS FR-NOSHOW-5 says (the
owner's decision of 2026-11-05: it named the student only). The screens are the
notice in this phase (FR-495, clarification 1). A `counter_proposed` row also carries the counter-proposal's slot,
local date, local start and zone, because `session_remedies` keeps only the pending one: the history of every
counter-proposal is in `session_events` (the owner's decision 9). **Decided** (the owner, 2026-11-05, plan.md
decision 6); the rejected alternative widened `enrollment_events` with a `session_id`.

## R-316 — The phone: a development build with LiveKit's React Native SDK

**Decision.** The development build exists since Phase 2 (`expo-dev-client` 58.0.15, Expo 58, React Native 0.88).
Installed, pinned exactly: `@livekit/react-native` **3.1.0** (2026-10-17), `@livekit/react-native-webrtc` **150.1.0**
(2026-10-17; 150.1.1 of 2026-10-26 is too new), `livekit-client` **2.23.0** (2026-10-16; peer `^2.20.0`),
`@livekit/react-native-expo-plugin` **1.1.0** (2026-10-17; peer `@livekit/react-native ^3`), and
`@config-plugins/react-native-webrtc` **15.0.2** (2026-08-15; peer `expo >= 56`). Both config plugins in `app.json`;
`registerGlobals()` at the root; `AudioSession.startAudioSession()` before connecting and `stopAudioSession()` after.
Android: `RECORD_AUDIO`, `CAMERA`, and for screen share `FOREGROUND_SERVICE_MEDIA_PROJECTION` (the SDK runs the service
since 2.4.0). The room screen connects with `serverUrl` and `token` from `sessions.join`, audio on, camera and screen
share off until the participant turns them on (FR-433); a dropped connection is rejoined by the SDK, and a lost room by
asking `sessions.join` again until the scheduled end (FR-435). The first video batch builds the development build on
the owner's phone before any screen task (a peer failure on Expo 58 is reported, not worked around).

**Sources.** [LiveKit Expo quickstart](https://docs.livekit.io/transport/sdk-platforms/expo/) ("not compatible with
the Expo Go app"; the two plugins; `registerGlobals`; `AudioSession`), [screen sharing](https://docs.livekit.io/transport/media/screenshare/),
npm registry for every version and peer range above.

## R-317 — Settings

**Decision.** Seeded by `prisma/seed.ts` at their defaults, read on every use (R-MONEY-12), written only by the panel
(R-PROC-11): `session_evaluation_delay_minutes` 2 (FR-441), `rate_limit_chat_message` `{ limit, window_seconds }`
(FR-491; 30 per 60 s), `makeup_counter_answer_hours` 72 (SRS §3.14, 2026-11-05), and two the spec does not name but
the design needs: `chat_page_size` 50 and `cancellation_requests_recent_days` 30 (**Decided**, the owner, 2026-11-05,
plan.md decision 8: every one an admin setting, SRS §3.14 rows); and the video room's `video_empty_timeout_seconds` 300
and `video_departure_timeout_seconds` 20 (R-302; **Decided**, the owner, 2026-11-05, on the analysis, K2). The rest
exist (seed lines 89–147), `first_session_lead_hours` among them, which the remedies now read (R-311). On the decision of
no automatic termination (**Decided**, the owner, 2026-11-05; ADR 0023, R-322): `teacher_no_show_threshold` is removed,
its row deleted by the first batch's migration and no longer seeded; `repeated_absence_flag_count` 5 and
`enrollment_restore_window_days` 7 are added, and `rate_limit_absence_complaint` `{ limit: 5, window_seconds: 3600 }`,
the limit the owner's decision and its default this cycle's reading; each an SRS §3.14 row. On the decisions of the
administrator's control and the rate limits (**Decided**, the owner, 2026-11-05; R-321): `rate_limit_signed_in_default`
`{ limit: 150, window_seconds: 60 }` per R-325 (the owner's decision of 2026-11-06 on the fifth analysis; the larger of 120 and the heaviest normal minute × 2–3, never a number above 200: R-321, item 5), and `rate_limit_dispute_revision`, `rate_limit_enrollment_restore` and
`rate_limit_manual_compensation_case`, `{ limit: 10, window_seconds: 60 }` each; each an SRS §3.14 row (NFR-SEC-12).
On the decisions answering the administrator's control inventory (**Decided**, the owner, 2026-11-05):
`rate_limit_outcome_correction`, `{ limit: 10, window_seconds: 60 }`, `sessions.review.revise`'s own limit (R-323,
GAP-3), an SRS §3.14 row. An existing row changes its default (the same decisions): `chat_retention_days` 30 (was 0; SRS §3.14,
FR-SESS-13), still editable in the panel. The seed inserts a row only where it is absent (`prisma/seed.ts`), so the
seed's new default reaches a new database; a database already seeded keeps its row until an administrator changes it in
the panel (R-PROC-11). On the live channel (**Decided**, the owner, 2026-11-05; R-324): `rate_limit_live_channel`
`{ limit: 10, window_seconds: 60 }`, the user as subject, and `live_channel_max_connections_per_user` 3; each an SRS
§3.14 row.

## R-318 — The administrator's surfaces

**Decision.** As Phase 2's monitor (R-220): each module's admin router mounted on `adminRouter`, every procedure an
`adminProcedure` (second factor), every call one audit entry, reads included. `sessions`: the enrollment and session
monitor (FR-479; its timeline and each session's remedy, R-323 GAP-1 and GAP-4), the session review queue (FR-477; the
telemetry of any session no longer scheduled and an administrator's correction of an outcome nobody disputed, GAP-2 and
GAP-3, FR-439), a manual compensation case (`cases.openManual`, FR-493, R-326), the cancellation of a session (FR-460), the outage windows
(FR-445), the disputes queue and its resolution (FR-475, FR-476), an enrollment's restore (`sessions.restore`, FR-454, R-322).
`chat`: `disputes.chat`'s read. `moderation`'s
primitives under an admin router in `sessions` for cases (`cases.list/get/resolve/dismiss`, and `cases.decideComplaint`
for a complaint of a teacher's absence, R-322), since a case's page names
the sessions and remedies it covers, which moderation cannot read (R-301). `identity`: `students.*` (R-313).
`verification`: the user directory of FR-ADMIN-4 (FR-481), two new reads in its `users` router beside
`requireIdentity`: `users.list` (names by the folded prefix through `idsWithFoldedNamePrefix`, pages of
`admin_list_page_size`) and `users.get` (FR-ADMIN-4's fields read through identity's entry and verification's own
rows, and `cancellationRequests: { total, recent }` through sessions' entry, FR-459, and, for a teacher, the enrollments
the repeated-absence mark names, through sessions' entry, FR-451, R-322) (**Decided**, the owner,
2026-11-05, on the analysis). The monitor, `cases.list` and `disputes.list` show each enrollment's Teacher-No-Show count
and the mark (FR-451). The panel's pages: `/sessions`, `/review`, `/disputes`, `/cases`, `/outages`, `/users`.

## R-319 — What the carried tasks ask of this plan

**Decision.** T059 (FR-420) lands in the first batch with the sessions entry's `cancelRemainingSessions` it needs.
`002:T144` is named here and lands with the student's suspension, B34 (FR-421). T107 was done in this cycle on
2026-11-05 (`9c710e3`, R-SESS-7, constitution 2.5.0), before the video webhook (B35). T090 lands in B34: a deleted party answers `displayName: null` with `deleted: true`
additively (R-API-9) on Phase 2's lists and every Phase 3 output naming a party, and the phone shows the stand-in key
(FR-426). The notes under T026 land with the make-up booking (R-311) and completion (R-309); the note under `003:T082` with
`closeCase` (R-312). T079 and T080 land in the first batch, B33 (**Decided**, the owner, 2026-11-05,
plan.md decision 10): one `testTimeout` and `hookTimeout` of 30 s for `tests/db-integrity`, the `node` project at 5 s
with file-level timeouts for its three heavy specs, and a per-run prefix on each adversarial world's names. The rest of the Not-scheduled row stays where it is: none of its tasks is a precondition of a
Phase 3 requirement; T099 (the booking sheet's empty-state cause) and T093 (a link to no enrollment) touch screens this
phase edits and are listed for the owner, not timed.

## R-320 — No time is offered that starts before the matter could still be decided

**Decision.** The owner's rule of 2026-11-05: wherever a choice waits on a window, no time is shown or offered that
starts before that window can end, as booking hides a slot whose first session falls within
`first_session_lead_hours`; for a make-up, neither the system's proposal nor any counter-proposal may start before the
matter could still be decided (the owner's decision 9, H1 to H5, plan.md), nor within the first-session lead of the
moment it is decided (the decisions on the analysis, items 6, 9, 12 and 13, plan.md). A = the remedy's
`snapshot_answer_window_hours` (72), L = its `snapshot_first_session_lead_hours` (24), both fixed at the system
proposal's offer; C = `choice_closes_at`. Applied by the server (the screens render what it answers, R-MOBILE-12),
with a spec each:

| Where | Window (setting, default) | Hidden |
|---|---|---|
| The system's make-up proposal (H1) | the choice window, `makeup_choice_window_days`, 7 days, plus one answer window A, 72 h, plus the lead L, 24 h (L new on the analysis, F6) | any week whose occurrence starts before C + A + L, and any occurrence overlapping a session, a reservation or an open hold (payment window) of either party (holds new, F5); fixed at the offer, never moves |
| The counter-proposal's options (H2), read again after each decline (H4) | the answer window A from now, the lead L (new, F6), and the choice window | any occurrence starting before max(now + A + L, C), and any overlapping a session, a hold or a reservation of either party |
| A refund-or-make-up choice (recitation; a cleared suspension's sessions too) | the choice window, 7 days | the proposal shown beside the refund obeys the first row |
| A remedy frozen by a student's suspension, offered again at reinstatement (new, C3) | a new full choice window from the reinstatement; A and L read again then | while frozen, nothing is offered or reserved (a pending counter withdrawn, both times released); at reinstatement the new proposal obeys the first row |
| The remedy's offer itself (new on the third analysis, G1) | the session's dispute window, `dispute_window_hours`, 72 h, from the scheduled end; any dispute raised inside it, until resolved; any revision of a ruling (FR-DISPUTE-7) | no remedy, and so no proposal or counter option, is offered before the latest of the window's end, the last resolution and the last revision; once offered, the proposal obeys the first row from that offer |
| A refused booking of the system's proposal, retried (new on the third analysis, A3) | from the decision that books it (H5, a decline or a refused counter after `choice_closes_at`) until its occurrence would start within L of an attempt | no attempt books an occurrence starting within L of the attempt's instant, nor one overlapping an open hold or a reservation of either party (read again at each attempt); past that, a `makeup_refused` case; the proposal never moves, so the first row's C + A + L still holds |
| A restore's recreated sessions (new on 2026-11-05, R-322) | the first-session lead L, `first_session_lead_hours`, 24 h, from the restore's instant; every open hold (payment window: checkout TTL plus grace, 10 + 5 min) and every reservation (H3) of either party | the first recreated session never starts before the restore + L, moving to the next weekly occurrence; a recreated occurrence overlapping an open hold, a reservation or a session of either party is not offered: the restore is refused `time_taken`, or `slot_taken` for another student's hold on the slot |
| A remedy offered again by a restore (new on 2026-11-05, R-322) | a new full choice window from the restore, A and L read again then | the new proposal obeys the first row (C + A + L, F5), placed in a week after the last recreated session; its counter options obey the second |
| A cancellation request | until the scheduled start (FR-CANCEL-4) | no request on a session already started; the request shows its expiry at the start; no minimum notice (decision 14 (ii)) |
| A reserved proposal or counter, to others (H3) | the proposal from the offer until the remedy settles; a pending counter during its answer window, released at decline, withdrawal, freezing or the window's end | the reserved occurrences are hidden from `booking.slots`, refused by `checkout.hold`, and refused to the confirmation's new hold for a released one (new, F5's question) for the same teacher or student; a make-up's booking reads them again |

## R-321 — Locks, contracts and gates

**Decision.** T005's two rules hold (Saif reviews every lock and FK-insert path against them). `LockedTable` widens to
`sessions`, `session_remedies`, `cancellation_requests` and `disputes`, and the one order becomes: `users`,
`teacher_profiles`, the teacher's slots' key, `availability_slots`, `slot_holds`, `enrollments`, `sessions`,
`session_remedies`, `cancellation_requests`, `disputes`, `payments` (data-model §5). A path that takes more than one
teacher's slots' key takes them in ascending teacher id order, and a make-up's booking takes both its slots in one
call in id order (**Decided**, the owner, 2026-11-05, on the second analysis, L1 and L2; contracts/kernel.md). On
the third analysis (**Decided**, the owner, 2026-11-05, L-A, L-B, L-C): a dispute resolved `party_banned` against a
teacher takes `teacher_profiles` between `users` and the slots' key; the chat's two sending paths lock the sender's
`users` row, then the enrollment; and `sessions.cancel` has its own row (`enrollments`, `sessions`, `disputes`). On the decision of no automatic
termination (**Decided**, the owner, 2026-11-05; R-322): a complaint's raising locks the student's `users` row, then the
enrollment; its decision to end the enrollment takes a confirmed fault's order (`enrollments`, `sessions`,
`session_remedies`, `disputes`), to suspend the teacher a `party_suspended` resolution's, to close it `enrollments`
then `disputes`; a restore takes `sessions.cancel`'s order widened by both accounts, the teacher's slots' key and the
slot before it and `session_remedies` within it. On the fourth analysis (**Decided**, the owner, 2026-11-06, L1): the
two sweeps that insert a `session_events` row, whose foreign key takes a key-share lock on the enrollment, lock the
enrollment first: `expire-cancellation-requests` `enrollments`, `sessions`, `cancellation_requests`, and
`reresolve-session-instants` `enrollments`, `sessions` (contracts/kernel.md; T022, T014, each with a probe). On the
fifth analysis (**Decided**, the owner, 2026-11-06, L2), one general rule, reworded on the sixth analysis
(**Decided**, the owner, 2026-11-06, M2): a path that locks, updates or inserts a row referencing a `sessions` row (a
foreign key's key-share included) takes, before any session, every lock earlier in the one order that it will take. A
path inserting a `session_events` row always takes the enrollment. No path waits on a lock earlier in the order while
holding a session. A cancellation request and its decline take `users` (both), `enrollments`, `sessions`,
`cancellation_requests` (T021, with a probe against an administrator's `sessions.cancel`). On the sixth analysis
(**Decided**, the owner, 2026-11-06, H1 and M2): `sessions.join` locks the two accounts only and writes no session;
`POST /webhooks/video` takes the participant's `users` row `FOR KEY SHARE` before it inserts a participant's event
(`keyShareRows`, a new helper in `platform/db/row-lock.ts`, R-API-6), since the insert's foreign keys
(`20261101050220_append_only_foreign_keys_restrict`) key-share the session first and the account second, and a path
holding the account `FOR UPDATE` that then locks the session (a teacher's suspension, a cancellation's decline) would
deadlock with it; it takes no enrollment, since it inserts no `session_events` row, and `room_ended`, with no user,
takes nothing before its insert (contracts/kernel.md; T012, with a probe against both paths). A counter-proposal's
`counter_slot_id` key-shares its `availability_slots` row while its path holds the session, safely: every path that
locks an `availability_slots` row `FOR UPDATE` takes the slot's teacher's `users` row first, which that path already
holds (L2).

*The deferred overlap check and a deadlock* (**Decided**, the owner, 2026-11-06, the sixth analysis's L5). The two
overlap exclusions, `sessions_teacher_no_overlap` and `sessions_student_no_overlap`, are `DEFERRABLE INITIALLY
IMMEDIATE` (`prisma/migrations/20261007000400_booking_overlap/migration.sql`); only `reresolve-session-instants` defers
them (`withDeferredSessionConstraints`, `apps/api/src/platform/db/deferred-constraints.ts`), so its commit checks every
session it moved at once and can wait on another transaction's uncommitted insert of an overlapping session. A make-up's
booking (T029) and an administrator's restore (T061) insert sessions, so either can meet that commit in a deadlock,
and Postgres refuses one of the two with `40P01`. The job's side is unchanged: its comment
(`apps/api/src/jobs/reresolve-session-instants.ts:119`) leaves such a refusal to the queue's retry. On the other side
the victim would answer a generic 500 today, since nothing in `apps/api/src/platform/db/` recognises `40P01`
(`row-lock.ts`, `transaction.repository.ts`, `db-errors.ts`). T002 adds `isDeadlock` to `db-errors.ts` and
`runRetryingDeadlockOnce` to `transaction.repository.ts` (contracts/kernel.md): the transaction is retried once; a
second deadlock answers a clear refusal, `MAKEUP_REFUSED` for T029 (the remedy left open, as an exclusion refusal
leaves it) and `RESTORE_REFUSED` with `details.cause` `time_taken` for T061 (the cause an exclusion refusal of its
recreated sessions already answers), each with a spec forcing the deadlock. B33 stays at six tasks.

Every procedure declares
`.output(schema)`; the contract snapshot is additive and passes `pnpm contract:snapshot --check --base origin/develop`
(R-API-9). The boundary rule `boundaries/no-money-vocabulary` already covers `modules/sessions` and is extended to
`modules/chat`; a CI test proves no `_piasters`, price or payment reference in either (FR-497, SC-409). R-SESS-2, R-SESS-4
and R-SESS-5's CI tests land with the code they hold (the constitution's enforcement map, "Phase 3"). The coverage floor
widens to `modules/chat`. The adversarial suite gains every procedure of this phase that issues a token or reads a
session, its chat or its counterparty (FR-496), and the video stand-in harness is the only producer of video events in
the suite, as the gateway's is (contracts/video.md).

*The signed-in rate limits* (**Decided**, the owner, 2026-11-05: «Decisions of 2026-11-05, the administrator's control
and the rate limits», plan.md; SRS NFR-SEC-12; spec FR-470). Today `adminProcedure`
(`apps/api/src/surfaces/procedures.ts`, line 508) takes `{ input, output }` only and opens its transaction at line 527
(`transactions.run`); the user kinds accept an optional `rateLimit` and apply `throttle` after the input
(`signedIn`, `teacherProcedure`); a signed-in procedure that declares none is not counted
(`platform/guards/rate-limit.guard.ts`, lines 19 and 20). The design:

1. **The administrator kind's declaration.** `adminProcedure` gains an optional `rateLimit`, a `RateLimitDeclaration` over the administrator's context
   once `requireAdministrator` has admitted the caller (so `ctx.administrator.adminId` can be the subject), applied
   by `throttle` after `requireAdministrator` and the input schema and before the `.use` that opens the transaction, so a
   refused call opens none and writes nothing; `AdminMeta.rateLimit` stamps its key, as the anonymous kind's does.
   `disputes.revise` declares `rate_limit_dispute_revision` and `sessions.restore` `rate_limit_enrollment_restore`
   (and, on the decisions of 2026-11-05 answering R-323, `sessions.review.revise` `rate_limit_outcome_correction` and
   `cases.openManual` `rate_limit_manual_compensation_case`, R-326),
   each with `subject: 'caller'`, which the administrator kind fills with `ctx.administrator.adminId` (item 6), apart from the `idempotencyKey`: a repeat with the
   same key is counted as a call, a refusal by the limit claims no key.
2. **The default limit.** Every signed-in kind (`studentProcedure`, `userProcedure`, `teacherProcedure`,
   `adminProcedure`) that is given no `rateLimit` applies a second middleware, `throttleDefault`, at the same place
   (after the input; for the administrator kind before the transaction): one key, `rate_limit_signed_in_default`, the
   subject `user:<userId>` for a user kind and `admin:<adminId>` for the administrator kind, so the two principals' ids
   never share a counter. A procedure that declares a limit is counted by it only. The public and administrator-public
   kinds are unchanged (each already declares its own).
3. **Its setting, held for 60 s.** The limiter reads `rate_limit_signed_in_default` through the `SettingsReader` and keeps
   the parsed value in process memory for up to 60 s, re-reading it once that has passed; a read that throws
   (`SettingError`: the row missing or invalid) is never kept and refuses the call, the internal error, as FR-034 says.
   No other key is held: every other limit and every other setting is read on every use, as the guard's header
   (lines 5 and 6) and `settings-reader.ts` say, and the header gains the one exception.
4. **Fast failure.** `createRateLimiter`'s client (line 223: `lazyConnect: true`, `maxRetriesPerRequest: 1`) waits out
   a reconnection before a count fails, which is right for a limit that refuses on failure and too slow for one that
   lets the call through. The default limit counts on a **second client** of its own, built beside the first in
   `createRateLimiter`: `new Redis(redisUrl, { enableOfflineQueue: false, maxRetriesPerRequest: 0, commandTimeout: 100 })`
   (ioredis 5.11.1's options: a command sent while the connection is down fails at once instead of queueing, none is
   retried, and none waits more than 100 ms), connected when the limiter is built, since every process that builds one
   serves signed-in calls. The guard also races its `hit` against a 100 ms timer it clears, so the bound holds for any
   `RateLimitCounter` (the spec's fake that never answers included). On a failure or a timeout the call goes through
   uncounted and the limiter opens a **breaker**: until 10 s have passed on the process's monotonic clock no count is
   attempted for the default key, every call goes through, and one warning is logged when the breaker opens (the key,
   no subject), so a Redis outage logs one line per 10 s, not one per request. The first count after the 10 s closes it
   or opens it again. The declared limits keep the first client and fail closed, as now (lines 41 and 42): the counter's
   failure is the internal error.
5. **The numbers.** The default's limit is its setting, **150 per 60 s** per R-325 (the owner's decision of
   2026-11-06 on the fifth analysis; 160 per 60 s, the owner's decision of 2026-11-05, until then). The reason is the owner's rule of 2026-11-05: the larger of 120 per 60 s and the heaviest minute of
   normal use times 2 to 3, so that a normal user is never refused; a result above **200** sets no number, the screen
   that calls that often going back to the owner to be fixed instead of the limit being raised. R-325 finds 48 calls (a
   student's minute; the teacher's, 37 once the name searches `rate_limit_search` counts are left out), × 3 = 144, so
   150; the panel's heaviest minute (45 × 3 = 135) needs no value of its own. The seed plants 150 per 60 s and SRS §3.14
   says so. 60 s (the cache), 100 ms (the timeout) and 10 s (the breaker) are the
   owner's figures for the limiter's own operation and are kept in the kernel's guard as named constants, as the queue's
   retry and backoff numbers are (`apps/api/src/jobs/README.md`, "Retry, bounded failure and concurrency": the
   magic-number gate governs `modules/`, where every operational number is a setting). **Why none is a setting**
   (**Decided**, the owner, 2026-11-06, the fourth analysis's C1; R-MONEY-12 (as amended, constitution 2.6.0)):
   an administrator changing one from the panel could break every signed-in call (a long timeout holds each call on a
   failing counter, a short breaker hammers it, a long cache keeps a changed limit unseen); the queue's fixed retry
   numbers are the precedent; and the magic-number gate covers `apps/api/src/modules/` only. The limits themselves stay
   settings.
6. **The first refusal logged** (**Decided**, the owner, 2026-11-05, for every limit: sign-in, the one-time code, search,
   payment initiation, chat, uploads, the complaint, the administrator's actions and the default; SRS NFR-SEC-12; it
   replaces R-323's GAP-9 proposal of a line per refusal). `RateLimiter.check` already has the count (`hit` answers how
   many calls the window holds, this one included) and refuses past the limit; it logs exactly when
   `count === limit + 1`, the first refusal of that subject in that window, and nothing at limit + 2 and after, so a
   flood writes one record per subject per window. How `check` learns what to log without the subject leaking:
   - **The subject's kind comes from the caller kind, never from the endpoint.** `check`'s second argument becomes a
     `RateLimitSubject`: `{ kind: 'user', userId }`, `{ kind: 'administrator', adminId }`, `{ kind: 'identifier', value }`
     or `{ kind: 'budget' }`, counted under `user:<userId>`, `admin:<adminId>`, the value and `*`, each hashed into the
     counter's key as today. A declaration names its subject either as `subject: 'caller'`, accepted by the signed-in
     kinds only, which fill it from the context they authenticated (`ctx.caller.userId`, `ctx.administrator.adminId`),
     or as `subjectOf`, whose string is always an `identifier`. An endpoint therefore cannot have a phone number logged
     as a user id: the `user` and `administrator` kinds are reached only through the kind's own context. The per-user
     declarations that exist move to `subject: 'caller'` (`booking.slots` in `modules/booking/booking.router.ts`, the
     three in `modules/booking/discovery.router.ts`, `modules/identity/account.router.ts`'s and
     `modules/payments/checkout.router.ts`'s); the default (item 2) passes the caller kind's subject; a budget passes
     `{ kind: 'budget' }`; the upload route passes its authenticated uploader as a `user`.
   - **The procedure's name.** `check`'s third argument, `procedure: string`, required, so the compiler finds every
     caller. `throttle` and `throttleDefault` pass tRPC's `path`, which every middleware receives (the procedure's
     dotted name, e.g. `sessions.complaint.raise`); the three callers outside tRPC pass their route's fixed name:
     `platform/guards/upload.middleware.ts` (line 231), `platform/web/route.ts` (line 252) and
     `modules/identity/web/delete-account.controller.ts` (lines 366 to 379).
   - **The record.** One `warn` line, message `rate limit refused`, through a logger the limiter is now given
     (`RateLimiterDependencies.log`; `createRateLimiter` already holds one), its fields exactly `{ procedure, userId }`
     for a user, `{ procedure, adminId }` for an administrator, `{ procedure, subjectDigest }` for an identifier
     (`subjectDigest` the HMAC-SHA256 hex `counterKey` already computes for the counter's key, never the value) and
     `{ procedure, budget }` for a budget (its key). Nothing else: not a per-subject limit's key, the limit, the count,
     an address or the input; the identifier's value never reaches the logging branch, which reads only the kind's own
     fields. No database row: a flood would write a flood. The default limit's breaker keeps its own one warning per
     period (item 4), which names the key and no subject.
7. **Tests** (`platform/guards/rate-limit.spec.ts`, `surfaces/procedures.spec.ts`, `surfaces/admin-procedure.spec.ts`): a procedure with no limit refused `RATE_LIMITED` after
   the default's limit as its setting holds it; a procedure with its own limit not counted by the default; the default letting the call
   through when the counter rejects and when it never answers within 100 ms, and the breaker skipping the counter until
   10 s have passed with one warning; a declared limit refusing the call when the counter rejects; the default's missing
   row refusing the call, never letting it through; the administrator kind refusing over its declared limit with no
   transaction opened and nothing written; and `tests/seed/seed.spec.ts` asserting the seed plants the five rows (the default's and the four administrator limits': T062). For item 6, for each kind of subject
   (user, administrator, identifier, budget): the first refusal writes exactly one record whose fields are exactly the
   allowed ones; a second refusal in the same window writes nothing; a call within the limit writes nothing; and an
   identifier's record, serialised, never contains the raw subject (a phone number and an email address as subjects).

**Window rule (R-320).** None of this offers a time.

## R-322 — No automatic termination: the repeated-absence mark, the student's complaint, an administrator's restore

**Decided**, the owner, 2026-11-05 (plan.md, «Decisions of 2026-11-05, no automatic termination»; SRS FR-NOSHOW-3,
FR-NOSHOW-4, FR-CANCEL-8; [ADR 0023](../../docs/adr/0023-no-automatic-termination-complaint-and-restore.md)).

**Decision.**

*No count ends an enrollment.* Each Teacher-No-Show owes its remedy (R-311) and the enrollment continues. No path
counts absences toward an end: the evaluation, a review or dispute resolution, an outage reclassification and a
ruling's revision check no count (R-306, R-308, R-309). The setting `teacher_no_show_threshold` is removed: the first
batch's migration deletes its `settings` row and `prisma/seed.ts` stops writing it. Plan decision 7 (a disputed absence
not counted until resolved) served only the threshold and is removed with it.

*The mark.* An enrollment's Teacher-No-Show count is read when shown, never stored (R-DB-4): its `sessions` rows whose
`status` is `teacher_no_show`, since the enrollment began, so each session counts by its final status. Both-No-Show and
Cancelled-By-Agreement are other statuses; an absence a dispute's resolution or a ruling's revision removed has another
status; a session under dispute is `disputed` and counts once it is resolved. Sessions' entry answers
`teacherNoShowCountsOf(tx, enrollmentIds)` (one grouped count over its own table) and
`markedEnrollmentsOfTeacher(tx, teacherUserId)` (the teacher's enrollments whose count is at least
`repeated_absence_flag_count`, grouped over `sessions.teacher_user_id`, the cached column of ADR 0010). The monitor
(`sessions.monitor.list/get`), `cases.list`, `cases.get` and `disputes.list` show each enrollment's count and the mark;
verification's `users.get` lists a teacher's marked enrollments (the edge verification → sessions exists, R-301). No
index is added (R-DB-9): each read is bounded by one page of enrollments or by one teacher's sessions. No path reads the
mark to change anything.

*The complaint.* A `disputes` row of a new kind, `absence_complaint`: the enrollment, the student as
`raised_by_user_id`, the student's text in `reason`, no session. Not a compensation case: a compensation case's
`reason` is a closed list, and Phase 2's covering rule (FR-362, `caseInstantsAmong`) reads `compensation_case` rows,
which a complaint must not move; not a table of its own: `disputes` already holds the enrollment, the raiser, the text,
the status, the resolution, the note, the administrator and the closing instant (a forty-fifth table would repeat it).
One open per enrollment, held by the database: the partial unique `disputes_one_open_complaint_per_enrollment_key`
(rule 46), so two raised at once leave one, and the second answers `COMPLAINT_OPEN` (`isUniqueViolation` names the
key). `sessions.complaint.raise` (the student kind, `{ enrollmentId, reason }`) declares `rateLimit: { key:
'rate_limit_absence_complaint', subject: 'caller' }`, the per-user form `booking.slots`
(`modules/booking/booking.router.ts`) and `checkout.*` (`modules/payments/checkout.router.ts`) take in T062 (R-321, item 6), applied by the kind
after the input is validated (`surfaces/procedures.ts`), so a call over the limit is refused `RATE_LIMITED` before any
transaction; the limit is apart from the one-open rule, which the database holds. Moderation gains
`openAbsenceComplaint(tx, enrollmentId, studentUserId, reason)`; the raising locks the student's `users` row (the row
references it), then the enrollment, reads it again (`confirmed`, the caller its student), inserts, and writes one
`session_events` row `complaint_raised` (no session, `case_id` the complaint). `enrollments.get` (booking, which imports
moderation) gains `complaintOpen`, so the button reads «شكوتك قيد المراجعة» while one is open.

*The decision* (`cases.decideComplaint`, `{ caseId, decision: 'end_enrollment' | 'suspend_teacher' | 'close', note }`,
an `adminProcedure`, audited `complaint.decided` with the decision and the note):

- **(a) `end_enrollment`**, only while the enrollment is `confirmed` (else `CONFLICT`, `details.cause`
  `enrollment_not_confirmed`): every remaining `scheduled` session, make-ups included, `cancelled_by_admin` through
  `cancelRemainingSessions` with the new case's id on each event; every open remedy, `frozen` included, handed to the
  new case; the enrollment `terminated_no_show` through `EnrollmentSide.terminateNoShow`; one compensation case
  `absence_termination` through `openCompensationCase`, its `covers` as every enrollment's end's (R-312); the complaint
  closed `resolved`, `enrollment_ended`, through `closeCase`, which takes the resolution as an argument. Locks: a
  confirmed fault's order, `enrollments`, `sessions`, `session_remedies`, `disputes`.
- **(b) `suspend_teacher`**: `StandingService.suspend` on the decision's transaction (FR-421), whose consequences end the
  teacher's confirmed enrollments as R-313's row says (this one with them, `teacher_suspended`, a `teacher_ended` case);
  the complaint closed `resolved`, `party_suspended`. Locks: a `party_suspended` resolution's against a teacher: the
  teacher's `users` row first (`lockAccount`), the slots' key, the enrollments (the complaint's and the teacher's
  confirmed ones, one call), `sessions`, `session_remedies`, `disputes`. `StandingService.suspend` locks the account
  only (`modules/identity/standing.service.ts`), so no `teacher_profiles` row is taken, as for a dispute's
  `party_suspended` (only a ban takes it, L-A).
- **(c) `close`**: the complaint closed `dismissed` with the note; nothing else. Locks: `enrollments`, then `disputes`.

Each writes one `session_events` row `complaint_decided` (`case_id` the complaint). `cases.resolve` and `cases.dismiss`
answer `NOT_FOUND` for a complaint, so a complaint is decided only here.

*The restore* (`sessions.restore`, `{ enrollmentId, reason, idempotencyKey }`, an `adminProcedure`, audited
`enrollment.restored` with the reason). Keyed as `disputes.revise` is: `IdempotencyService.run`
(`platform/idempotency/idempotency.service.ts`), the scope `sessions.restore` added to
`packages/contracts/src/idempotent-procedures.ts`, the actor the administrator's id; a repeat with the same key returns
the first answer and writes nothing, the same key with another input `CONFLICT`.

Locks, `sessions.cancel`'s order widened: both accounts (`users`, one call; the sessions it inserts reference both),
`lockKey('teacher-slots', teacher)`, the enrollment's slot (`availability_slots`, as a hold and `slotInUse` lock it,
FR-423), `enrollments`, `sessions`, `session_remedies`, `disputes`. Under them, read again:

1. *(Widened 2026-11-12, SRS DEC-66, DEC-68 and DEC-69: also a ban's, a revocation's and an administrator's direct end's closing; never a gender correction's; T073, T082.)* The closing: the enrollment `terminated_no_show` with an open `absence_termination` case, or `cancelled` with
   `admin` and an open `student_fault_confirmed` case; else `RESTORE_REFUSED` `not_restorable` (a ban's
   `student_banned`, a deletion, a teacher's end, a completion, an enrollment not closed), or `case_closed` when the
   closing's case was resolved or dismissed.
   *Since T073 (2026-11-13; the note under T073, Q4 (a)):* the closing is read by T070's one closing rule
   (`sessions/restore-window.ts`, `closingOf`) over the enrollment's status, its last cancellation's reason and its
   latest end case (`END_REASONS`, the cases read through moderation's entry): `terminated_no_show` with
   `absence_termination`; `cancelled` `admin` with `student_fault_confirmed` or a student's ban's `student_banned`;
   `cancelled` `teacher_suspended` with a teacher's ban's or revocation's `teacher_ended`. The case open, else
   `case_closed`; any other closing `not_restorable`: a deletion's (`account_deleted`, whatever its case), a gender
   correction's (`gender_correction`, Q10 (a)), a completion, an enrollment not closed. A ban's closing is admitted
   here and refused `party_restricted` at step 3 while the ban stands. The monitor's `restorableUntil` and
   `slotHeldUntil` read the closing the same way (`closingCaseReason`), so the panel and the restore cannot disagree.
   `admin_ended` is T082's.
2. *(Retired 2026-11-12, SRS DEC-69, for every closing step 1 admits: no restore is refused for its time, `window_closed` no longer produced; the setting holds the slot, T070, T073.)* The window: the case's `created_at`, written in the closing's own transaction, plus `enrollment_restore_window_days`,
   compared with the database's clock; else `window_closed`. No column stores the closing's instant (R-DB-4).
   *Since T073:* not checked. `window_closed` stays in `restoreRefusalCause`, `@deprecated` and never produced
   (R-API-9); the monitor's `restorableUntil` stays, `@deprecated`, answered with the hold's end (a past instant, the
   restore still admitted); the window's setting of the closing's kind only holds the slot (T070, FR-503).
   *The ninth cause, `refunded` (T073; FR-507; SRS FR-CANCEL-8 as amended, DEC-66; Q4 (a)):* checked after step 1,
   before step 3: any gateway order of the enrollment `refunded` refuses `RESTORE_REFUSED` `refunded`, writing
   nothing: a refund and the sessions are never both given back, the administrator may open a manual case (FR-493).
   Read through the `EnrollmentPayments` port (`sessions/enrollment-payments.port.ts`, `refundedOf(tx,
   enrollmentId)`), which payments implements and the admin module hands in, so sessions reads no payment table
   (R-301); read with no lock (N3), every order move taking the enrollment's lock before the order's
   (`payments/order-events.service.ts`), the restore holding it.
3. The accounts: both `active`, the teacher's approval standing, as the join reads them (FR-432); else
   `party_restricted`.
4. The count K of sessions to create: `snapshot_session_count` less the sessions consumed (`done`, `student_no_show`,
   make-ups included, `progress.ts`), less every session not consumed that is owed or settling on its own path: a
   session whose remedy is `refund_case` (offered again below, or refunded through its own case), a session owed a
   remedy never offered (`teacher_no_show`, `both_no_show` or `cancelled_by_agreement` with no remedy row, which
   `advance-remedies` offers once the enrollment is `confirmed` again), and a session not yet settled (`disputed`,
   `under_threshold`, `provider_outage`). A make-up the closing cancelled, its original's remedy `booked`, is among
   the K, so no session is owed twice. *(T073, 2026-11-13; SRS FR-CANCEL-8 as amended, FR-507; PR #134's Minor 1:)*
   less each `cancelled_by_admin` session whose `session_events` row names an `admin_cancellation` case (an
   administrator's `sessions.cancel` before the closing, the case read through moderation's entry), already owed
   through that case; never one the closing cancelled, nor one a suspension cancelled before a fault (their rows name
   the closing's or the suspension's case), which the K recreate.
5. The dates: the enrollment's weekly slot (catalog's entry, under its lock; `slot_inactive` if the slot is no longer
   active), in `snapshot_slot_timezone`, K consecutive weekly occurrences from the first that starts at least
   `first_session_lead_hours` after the restore's instant (`firstOccurrenceAfter`, as generation does). For each week:
   the slot held by another student's open hold, or occupied by another enrollment (`EnrollmentSide.slotWeekTaken`), is
   `slot_taken`; an occurrence overlapping a session, an open hold (`EnrollmentSide.heldTimesOf`) or a reservation
   (`reservedTimesOf`, R-311) of either party is `time_taken`.
6. **The slot unchanged** (the owner's decision of 2026-11-05: an eighth cause; rejected: recreating at the slot's new
   time). Checked before step 5's weeks, under the slot's lock. The student enrolled on the old time, so the restore is
   refused `slot_changed` when the slot's `day_of_week`, `start_time_local` or `timezone` differ from the enrollment's
   own: the weekday of `scheduled_date_local`, the `scheduled_start_time_local` and the `timezone` of its lowest-numbered
   session that is not a make-up (`makeup_for_session_id` NULL), and `snapshot_slot_timezone` for the zone. Those
   columns are what the ERD keeps of the slot as it was: each generated session holds the local date, start and zone it
   was asked for, never where a DST gap moved it (ERD §5, ADR 0009 D1), and the slot keeps no history of its own
   (`availability_slots` has no earlier values, ERD §4; its `updated_at` would also move on a deactivation and a
   reactivation, which change no time). A slot cannot change while its enrollment holds it in use (`SLOT_IN_USE`, Phase
   2's R-207), so a difference arose between the closing and the restore. A slot cannot be deleted (no path does, and
   the enrollment's foreign key would refuse it), so a removed slot is a deactivated one, `slot_inactive` (step 5).
   Today the slot's zone never changes (`modules/catalog/slots.service.ts`: an update never writes it); the check holds
   should it ever. A length change alone is not `slot_changed`: the recreated sessions take the snapshot's length, and
   their overlap is step 5's.

The restore declares its own rate limit, `rate_limit_enrollment_restore` (10 per 60 s), the administrator as subject,
apart from the key and checked before the transaction opens (R-321). Every refusal writes nothing. Then, in the same
transaction: `EnrollmentSide.restore(tx, id)` (`confirmed`,
`cancellation_reason` NULL, `confirmed_at` untouched, *(T073, T070's follow-up 2)* `slot_released_at` NULL so a later
closing holds the slot again, one `enrollment_events` row `restored`); the K sessions inserted
by the generation service widened additively with a count and a first sequence number (numbered after the last, FR-424:
nothing assumes every session was generated at once; the database's exclusions the second line, an exclusion refusal
rolling back as `time_taken`); each remedy whose `case_id` is the closing's case (`refund_case`, kind `makeup`) offered
again as a frozen remedy is at reinstatement (R-311, «Frozen»): `offered_at` the restore's instant, a full
`choice_closes_at`, A and L read again, a new proposal placed by R-311's rule after the recreated sessions, `case_id`
and `decided_at` cleared, `awaiting_choice` or `proposed` by its debt, one `remedy_offered` row each; the closing's case
closed `dismissed` with the note `restored` through `closeCase` (FR-422). The cancelled sessions, the complaint and the
events of the closing stay as they are. Restored, the enrollment's chat is writable again (FR-488); the purge cannot
have run, since it waits for the closing's case.

**Window rule (R-320).** Two new rows: the recreated sessions (the lead from the restore; holds and reservations of
either party) and a remedy offered again (H1 with F5 and the lead, after the recreated sessions). The complaint offers
no time.

**Rationale.** SRS FR-NOSHOW-3, FR-NOSHOW-4 and FR-CANCEL-8 as written on 2026-11-05; ADR 0023 records the two exits
from a final state (an enrollment's, a remedy's `refund_case`), beside ADR 0010 D5's.

**Alternatives considered.** The complaint as a compensation case with a reason: its text would have no column, and
Phase 2's covering rule would read it. A stored no-show count or closing instant: derived values with no ADR (R-DB-4).
Recreating the package count less the consumed sessions without the owed ones: a session owed through a remedy offered
again would be owed twice. Skipping a week blocked by a hold or a reservation, as the make-up proposal does: the owner's
rule refuses a restore over a taken slot, and a refusal tells the administrator why.

## R-323 — Admin control inventory

**Decided**, the owner, 2026-11-05 (plan.md, «Decisions of 2026-11-05, the administrator's control and the rate limits»,
items 7 and 8; SRS FR-ADMIN-20; spec FR-471). Every automatic or final action of Phase 3, and of Phase 2 where one
exists, is listed below with what the administrator has of it: **evidence** (the table, row and event that record what
happened, when and why, and the panel page and procedure that show it), a **fix** while the state can still change, a
**restore-the-right** path once it cannot, and the **evidence erased automatically**. The procedures named are those of
contracts/admin-surface.md and of the earlier phases as they stand; the pages are the panel's (R-318; `/payments` and
`/audit` exist, the second listing every administrator's audit entry with its reason through `audit.list/get`). A cell
that has nothing is a **GAP**, numbered and answered after the table; **M** is the manual compensation case of FR-471
(c), `cases.openManual` (R-326, spec FR-493; designed on 2026-11-05, its task T064), and **M only** marks a row where it is the one restore-the-right path. This inventory
writes no task. The owner answered every gap on 2026-11-05 (plan.md, «Decisions of 2026-11-05, the administrator's
control inventory answered»): each answer is under the table, and the table's cells keep the gap they found.

| # | Action and its trigger | Evidence (what, when, why; the panel) | Fix while it can change | Restore the right | Erased automatically |
|---|---|---|---|---|---|
| P2-1 | A hold released without conversion: past its expiry by `expire-holds` (every minute, no enrollment yet), or before a new hold on the same slot or by the same student (ADR 0010 D3) | `slot_holds.released_at` (when); why: **GAP-8** (no reason is kept, read only from `expires_at` against `released_at`); panel: **GAP-8** (no procedure reads holds) | None needed: a release is final at once, and the student checks out again (FR-BOOK-12) | Nothing was paid; nothing is owed | Nothing (the row stays) |
| P2-2 | A pending payment's window ends (`expire-pending-payments`, every minute): the hold released, the enrollment `cancelled` `payment_expired` (FR-PAYG-6) | `enrollments.status`, `cancellation_reason`; one `enrollment_events` row `cancelled` with its reason and `occurred_at`; `payments.status` from the gateway's `expired` event; panel: `/payments` (`payments.get`: the order, its event timeline, its enrollment), `/sessions` (`sessions.monitor.list/get`: the status); the `enrollment_events` rows: **GAP-1** | Automatic: a paid event that still arrives is confirmed by the late branch (ADR 0010 D5) or opens a case (FR-PAYG-19, P2-5); no administrator path | The late branch or its case (P2-5); with nothing paid, nothing is owed | `payments.checkout_url_encrypted` set NULL once the order leaves `created` (ERD §7); the `checkout.*` idempotency rows after `idempotency_key_ttl_hours` (24 h) |
| P2-3 | A gateway webhook moves an order (`POST /webhooks/payment`): `paid`, `failed` (one `order_failed` outcome), `expired`, `refunded` | `payment_events` (provider event id, type, `signature_verified_at`, `payload_hash`, `received_at`), `payments.status`, `enrollment_events` `order_failed`; panel: `/payments` (`payments.list/get`) | None: the gateway's signed record, written by no administrator (FR-ADMIN-18) | Through the case it opens where one applies (P2-5, P2-6); otherwise **M only** | The body is never stored, only its hash (R-SEC-2); a forged or unsigned event is written nowhere and logged at warn |
| P2-4 | `confirm-enrollment` confirms an enrollment on a paid event, or confirms a `cancelled` one by the late branch (ADR 0010 D5); a lost enqueue recovered by `expire-pending-payments` after `checkout_confirmation_timeout_seconds` | `enrollments.confirmed_at` (R-HONEST-1), one `enrollment_events` row `confirmed` with its `payment_id`; the generated `sessions` rows; panel: `/sessions` (the status and the sessions), `/payments`; the outcome rows: **GAP-1** | `sessions.cancel` per session not yet settled (FR-460); no path reverses a confirmation (R-HONEST-1) | Not needed: the paid sessions are delivered; **M** if an administrator finds otherwise | The `idempotency_keys` rows of the checkout after 24 h |
| P2-5 | The refusal branch: the database refuses a paid order's confirmation, or a party is restricted (`slot_unavailable`, `party_restricted`; FR-362) | The hold released, `enrollment_events` `cancelled` (`slot_unavailable`), one compensation case (`disputes`: `reason`, `created_at`); panel: `/cases` (`cases.list/get`), `/payments` | The case, open: `cases.resolve` or `cases.dismiss` with a note | The case | Nothing |
| P2-6 | A second paid order on a confirmed enrollment (`duplicate_payment`, FR-375) | One `duplicate_payment` case, joined while open; the orders on `/payments`; panel: `/cases` | The case | The case | Nothing |
| P2-7 | A pending enrollment cancelled by the student's own new checkout (`checkout_abandoned`, FR-BOOK-12) or by an account's end (R-219: `admin`, `teacher_suspended`, `account_deleted`) | `enrollment_events` `cancelled` with its reason, `slot_holds.released_at`; panel: `/sessions` (the status); the outcome row: **GAP-1** | None: final at once | A paid event after it takes the refusal branch and opens a case (FR-362); with nothing paid, nothing is owed | Nothing |
| P2-8 | `reresolve-session-instants` (at the worker's start and daily): every scheduled session's cached instants recomputed after a time zone data change; a moved session that would overlap kept at its old instants and reported | **GAP-6**: `scheduled_start_at` and `scheduled_end_at` are overwritten with no earlier value and no event; the kept-back sessions go to error tracking only; panel: the new instants on `/sessions`, the change itself nowhere | `sessions.cancel` of a moved session (FR-460); nothing re-places one | The `admin_cancellation` case `sessions.cancel` opens | The run's `tzdata-reresolve` marker (an `idempotency_keys` row) after 24 h |
| P3-1 | `evaluate-sessions` settles a session (every minute, from `scheduled_end_at` + `session_evaluation_delay_minutes`): Done, Student-, Teacher- or Both-No-Show, Under-Threshold, Provider-Outage | `sessions.status`, `evaluated_at`, `simultaneous_connected_seconds` (the figure decided on, ADR 0022); one `session_events` row `settled`; the inputs kept: `session_participant_events` (append-only) and `provider_outages`; the settings it read are not on the row, their values at that instant recoverable from the settings' audit entries (ERD §12: changes audit-logged); panel: the status on `sessions.monitor.get`; the telemetry only through `sessions.review.get` (Under-Threshold, Provider-Outage) and `disputes.get` (a disputed session): for an undisputed Done or No-Show, **GAP-2** | Inside the dispute window: a participant's dispute (T026), then `disputes.resolve` and `disputes.revise`; an outage window (`sessions.outages.record`) sends it to the review queue; an administrator's own correction of an outcome nobody disputed: **GAP-3** | A no-show's remedy (T028); otherwise, after the window, **M only** | No database row; the provider's room state (no recording is made): the room ends `video_empty_timeout_seconds` (300 s) after the last leave or at `endRoom` |
| P3-2 | The evaluation's run ends the room of a cancelled session still inside its join period (`endRoom`; `removeParticipant` first where T009's fallback exists) | The cancellation's own rows (P3-10, P3-12 to P3-16); the room's end only as the provider's `room_ended` participant event, when delivered: the platform's own call writes nothing, **GAP-7**; panel: the telemetry where P3-1 shows it | None needed: the session is already cancelled | The cancellation's case | The provider's room state; the join token was valid only until the scheduled end and is never stored or logged (R-SEC-2) |
| P3-3 | A remedy offered once the dispute window has closed (`advance-remedies`, every minute; in an accepted cancellation's transaction; a `frozen` remedy offered again after a reinstatement) | `session_remedies` (`offered_at`, `choice_closes_at`, the two snapshots, the proposal), one `session_events` row `remedy_offered`; panel: `cases.get`'s `covers` once a case names the remedy; an open remedy on `/sessions`: **GAP-4** | The parties' own paths (choose, accept, counter, answer); an administrator's: **GAP-5** | The remedy itself; a case after its windows (P3-4 to P3-7) | Nothing |
| P3-4 | A counter-proposal's answer window ends unanswered: a refund case `counter_unanswered` (`advance-remedies`) | The remedy `refund_case` with `case_id` and `decided_at`, one `session_events` row `remedy_handed_to_case`, the case; panel: `/cases` (`cases.get`'s `covers`) | The case (`cases.resolve`, `cases.dismiss`) | The case | Nothing |
| P3-5 | The choice window ends with no counter pending and no acceptance, or a counter is declined after it: the system's proposal booked (H5) | The new `sessions` row with `makeup_for_session_id`, the remedy `booked` with `decided_at`, one `session_events` row `makeup_booked`; panel: the make-up on `sessions.monitor.get` (`makeupFor`); the remedy's history: **GAP-4** | `sessions.cancel` of the make-up while not settled (FR-460) | The `admin_cancellation` case it opens | Nothing |
| P3-6 | A booking of the proposal the database refused, retried each run while it starts at least L ahead, then handed to a `makeup_refused` case (A3) | The final hand-off: the remedy `refund_case`, `remedy_handed_to_case`, the case; each refused attempt is reported to error tracking only, its state derivable (`proposed` past `choice_closes_at`): **GAP-4** shows it | The case; while retrying, **GAP-5** | The case | Nothing |
| P3-7 | The student's refund choice: a `refund_choice` case (T030) | The remedy `refund_case`, `remedy_handed_to_case`, the case; panel: `/cases` | The case | The case | Nothing |
| P3-8 | A cancellation request expires at the session's start (`expire-cancellation-requests`, every minute) | `cancellation_requests.status = 'expired'`, one `session_events` row `cancellation_expired`; panel: `sessions.monitor.get`'s `cancellationRequests` | None needed: the session stands; `sessions.cancel` while not settled | Nothing is lost: the session stands | Nothing |
| P3-9 | A cancellation accepted: Cancelled-By-Agreement, final at acceptance (FR-CANCEL-2) | The request `accepted` with `responded_at`, the session's status, one `session_events` row `cancellation_accepted`, its remedy (P3-3); panel: `sessions.monitor.get` | None: final, the parties' agreement | The make-up or refund it owes (T028) | Nothing |
| P3-10 | An administrator's session cancellation (`sessions.cancel`, FR-460) | The status, one `session_events` row `cancelled_by_admin` naming its case, the `admin_cancellation` case, audit `session.cancelled` with the reason; panel: `/sessions`, `/cases`, `/audit` | None: final | The `admin_cancellation` case | Nothing |
| P3-11 | Completion (`advance-remedies`): every session settled and not frozen, the last window closed, nothing owed | `enrollments.status = 'completed'`, one `enrollment_events` row `completed`; panel: the status on `/sessions`; the outcome row: **GAP-1** | None: final, and not restorable (FR-454) | **M only** | The chat, by P3-26's rule |
| P3-12 | A student's suspension (`students.suspend`): upcoming sessions cancelled, open remedies frozen, one `student_suspended` case per confirmed enrollment | `session_events` `cancelled_by_admin` (naming the case), `remedy_frozen`, `counter_withdrawn`; the cases; `users.account_status`; audit `student.suspend`; panel: `/cases` (first in the queue), `/sessions`, `/users`, `/audit` | `students.reinstate`, then `cases.resolve` (cleared: the cancelled sessions owed as a Teacher-No-Show) or `cases.dismiss` (P3-13) | The case cleared | The student's sign-in sessions ended, then deleted by `purge-expired-sessions` after `session_purge_after_days` (30) |
| P3-13 | A suspended student's fault confirmed (`cases.dismiss` of a `student_suspended` case): the enrollment `cancelled` `admin`, a new `student_fault_confirmed` case | `enrollment_events` `cancelled` (`admin`), the make-ups' `cancelled_by_admin` rows naming the new case, the remedies handed to it, audit `case.dismissed`; panel: `/cases`, `/sessions` (`restorableUntil`) | `sessions.restore` within `enrollment_restore_window_days` (7) | The new case | The chat, by P3-26's rule, once the case closes |
| P3-14 | A student's ban (`students.ban`): enrollments `cancelled` `admin` at once, one `student_banned` case each | `enrollment_events`, `session_events` `cancelled_by_admin`, the cases, audit `student.ban`; panel: `/cases`, `/sessions`, `/users`, `/audit` | None for the enrollments: not restorable (FR-454) | The `student_banned` case | Sign-in sessions ended; the chat by P3-26's rule |
| P3-15 | A teacher's end: suspension, revocation or ban (`teachers.*`), a complaint's decision (b), a dispute's `party_suspended` or `party_banned`: confirmed enrollments `cancelled` `teacher_suspended`, one `teacher_ended` case each | `enrollment_events`, `session_events` `cancelled_by_admin` naming the case, the cases, audit (`teacher.suspend` and the rest, `complaint.decided`, `dispute.resolved`); panel: `/cases`, `/sessions`, `/users`, `/audit` | The account's reinstatement (`teachers.reinstate`) restores the account only; the enrollments are not restorable (FR-454) | For the student, the `teacher_ended` case; for the teacher, **M only** | Sign-in sessions ended; the chat by P3-26's rule *(Amended 2026-11-12, DEC-66 and DEC-69: a teacher's suspension now pauses the enrollments; a ban's or a revocation's closing is restorable at any time while its case is open, by the lift or `sessions.restore`, its slot held for the ban restore window.)* |
| P3-16 | *(Amended 2026-11-14, B42c, T081; Q-O6 (a): since T080 refuses a person's own deletion over an ongoing enrollment (FR-511), the trigger is an administrator's deletion at the owner's request, `users.delete`, FR-512; its evidence adds the audit entry `user.deleted_by_admin` with its reason, beside the `enrollment_events` rows and the cases; fix none, final ⚠️)* A student's deletion: sessions cancelled, enrollments `cancelled` `account_deleted` with no case, open remedies `lapsed` (FR-484) | `enrollment_events`, `session_events` `cancelled_by_admin` (no case) and `remedy_lapsed`; panel: `/sessions` and `/users` with the stand-in (FR-426); the deleted person's held files (R-327), readable by an administrator only inside an open dispute, case or complaint of that enrollment, on `/disputes` and `/cases` (`disputes.heldFiles`, metadata; `disputes.heldFileLink`, a signed link per press for `document_link_ttl_seconds`, each audited `held_file.view`; the owner's decision of 2026-11-06) | None: final | A refund already chosen keeps its case; otherwise, for the teacher, **M only** | The person's files at once and by `erase-deleted-files` (ADR 0015 D3), never while the person is a party to an enrollment with an open dispute, case or complaint (R-327); sign-in sessions; the chat by P3-26's rule |
| P3-17 | *(Amended 2026-11-14, B42c, T081; Q-O6 (a): the trigger `users.delete`, as P3-16's amendment says; evidence the audit entry `user.deleted_by_admin` with its reason, the `enrollment_events` rows and the cases; fix none, final ⚠️; the restore of the right unchanged, the `teacher_ended` cases)* A teacher's deletion: as P3-15, with one `teacher_ended` case per enrollment (T004) | As P3-15 | None: final | The `teacher_ended` case | As P3-16 |
| P3-18 | A complaint decided (a), the enrollment ended (`cases.decideComplaint`): `terminated_no_show`, an `absence_termination` case | The complaint `resolved` `enrollment_ended` with its note, one `session_events` row `complaint_decided`, `enrollment_events` `terminated_no_show`, the case, audit `complaint.decided`; panel: `/cases`, `/sessions` (`restorableUntil`) | `sessions.restore` within the restore window | The `absence_termination` case | The chat by P3-26's rule, once the case closes *(Amended 2026-11-12, DEC-69: restorable at any time while the closing's case is open; the window only holds the slot, FR-CANCEL-9)* |
| P3-19 | A complaint closed (c) (`cases.decideComplaint`, `close`) | The complaint `dismissed` with its note, `complaint_decided`, audit; panel: `/cases` | None: final; the student may complain again, one open at a time | **M only** | Nothing |
| P3-20 | A dispute resolved (`disputes.resolve`) | The dispute's `resolution`, `resolution_notes`, `resolved_by_admin_id`, `resolved_at`; the session's status, `settled_by_admin_id`, `admin_settled_at`; `dispute_resolved`; audit `dispute.resolved`; panel: `/disputes`, `/audit` | `disputes.revise` while the window is open and no remedy exists (FR-472) | The remedy the final outcome owes; otherwise **M only** | Nothing |
| P3-21 | A ruling revised (`disputes.revise`) | `dispute_revised` with `outcome_before` and `outcome_after`, audit `dispute.revised`; panel: `disputes.get`'s `revisions`, `/audit` | Another revision under the same conditions | The remedy the revised outcome owes; otherwise **M only** | The stored idempotent answer after 24 h (the event and the audit entry stay) |
| P3-22 | A review resolved (`sessions.review.resolve`): an Under-Threshold or Provider-Outage outcome chosen | The status, `settled_by_admin_id`, `admin_settled_at`, `review_resolved`, audit `session.review_resolved`; panel: `/review`, `/audit` | A participant's dispute inside the window; an administrator's own: **GAP-3** | The remedy it owes; otherwise **M only** | Nothing |
| P3-23 | An outage window recorded (`sessions.outages.record`): settled sessions inside their dispute window reclassified | The `provider_outages` row (never edited), `outage_reclassified` per session, audit `provider_outage.recorded`; panel: `/outages`, `/review` | `sessions.review.resolve` of each reclassified session | The remedy each resolution owes | Nothing |
| P3-24 | A compensation case closed (`cases.resolve`, `cases.dismiss`; a restore's closing `restored`) | `disputes.status`, `resolution`, `resolution_notes`, `resolved_by_admin_id`, `resolved_at` (`clock_timestamp()`), audit `case.resolved`, `case.dismissed`; panel: `/cases`, `/audit` | None: a closed case is never reopened | **M only** | The chat by P3-26's rule, once nothing is open |
| P3-25 | The restore window ends (no job: `restorableUntil` passes) | Derived, never stored (R-DB-4): the closing case's `created_at` plus `enrollment_restore_window_days`; panel: `sessions.monitor.get`'s `restorableUntil` | None: the restore is refused `window_closed` | The closing's case, still open | Nothing *(Amended 2026-11-12, DEC-69: no restore is refused for its time; the window only holds the slot, and the hourly `close-slot-holds` sweep records its end as `slot_hold_ended`, T074.)* |
| P3-26 | `purge-chat` (daily): an ended enrollment's messages after the last session's end + `dispute_window_hours` + `chat_retention_days`, nothing open | `chat_messages.purged_at` on each row kept; panel: none needed (the chat is read only while a dispute is open) | None: the rule waits for every open dispute and case (FR-492) | Nothing is owed | The message bodies, the attachment fields and the stored files (FR-492, ERD §15 rule 8) |
| P3-27 | A video webhook refused (no or wrong signature, 401) or unattributable (no such session, not a participant: 200, written nowhere) | **GAP-10**: no row; a refusal logged at warn with its code, an unattributable event reported to error tracking; panel: none | None needed | Nothing is owed | The body and the header are never stored or logged |
| P3-28 | A call refused by a rate limit (`RATE_LIMITED`), and the default limit's breaker opening (R-321) | **GAP-9**: no durable record; the first refusal of a subject in a window logged (R-321, item 6: a user or administrator by id and the procedure, any other subject by the procedure and its keyed digest, a budget by the procedure and its key); the Redis counter expires with its window; the breaker's one warning per period in the logs; panel: none | The caller's next window | Nothing is owed | The counters, by each limit's `window_seconds`; the breaker's state in process memory after 10 s |
| P3-29 | A teacher's acceptance of a counter-proposal that the database refuses (`sessions.remedy.answerCounter`, FR-468, A3): `MAKEUP_REFUSED`, then the counter released as at a decline in a second transaction (added on the fourth analysis, the owner's decision of 2026-11-06) | The `counter_*` columns cleared, the remedy `proposed` (or the proposal booked once the choice window has closed, P3-5); one `session_events` row `counter_booking_refused`, its kind the reason (the owner's decision of 2026-11-06, A1: was `counter_withdrawn`, the row a student's acceptance of the proposal writes, so the two were indistinguishable); one `warn` log line `{ sessionId, enrollmentId, constraint }`, the overlap constraint the database named (the fifth analysis, A7); panel: the timeline and the remedy on `sessions.monitor.get` (GAP-1, GAP-4) | The student's own paths again while the choice window is open (accept, counter-propose from options read again, H4); `cases.openManual` with `remedyId` (GAP-5) | The make-up booked later, or the case | Nothing |
| P3-30 | An administrator's restore (`sessions.restore`, FR-454, R-322; added on the fourth analysis, A3) | `enrollments.status` back to `confirmed`, one `enrollment_events` row `restored`, the recreated `sessions` rows, one `remedy_offered` row per remedy offered again, the closing's case `dismissed` with the note `restored`, audit `enrollment.restored` with the reason; panel: `/sessions` (the timeline, GAP-1), `/cases`, `/audit` | `sessions.cancel` of a recreated session while not settled (FR-460); the remedies' own paths | `cases.openManual` (M) | The stored idempotent answer after 24 h (the rows and the audit entry stay) |
| P3-31 | An administrator's correction of an outcome nobody disputed (`sessions.review.revise`, FR-439, GAP-3; added on the fourth analysis, A3) | The session's `status`, `settled_by_admin_id`, `admin_settled_at`; one `session_events` row `outcome_corrected` with `outcome_before` and `outcome_after`; audit `session.outcome_corrected` with the reason; panel: `/sessions` (the timeline), `/review`, `/audit` | Another correction under the same conditions; a participant's dispute inside the window (T026) | The remedy the corrected outcome owes; otherwise **M only** | The stored idempotent answer after 24 h |
| P3-32 | A student's complaint of the teacher's absence raised (`sessions.complaint.raise`, FR-452, R-322; added on the fourth analysis, A3) | One `disputes` row of kind `absence_complaint` with its text, `raised_by_user_id` and `created_at`; one `session_events` row `complaint_raised`; panel: `/cases` (`cases.list/get`) | The decision (`cases.decideComplaint`, P3-18, P3-19, and (b), P3-15) | The decision; otherwise **M** | Nothing |
| P3-33 | A held closing's hold ends by its date (`close-slot-holds`, hourly; T074, FR-505, DEC-69): one row per closing the one closing rule admits, its case open, its slot not released, the database's clock at or after `restorableUntil`, not yet recorded since its latest closing | One `enrollment_events` row `slot_hold_ended` (`occurred_at` the database's instant), on `/sessions`' timeline (`sessions.monitor.get`) and the payments history (`payments.get`); one info line `{ enrollmentId, kind }`; panel: `/sessions`, `/payments` | None needed: the restore stays admitted at any time while the case is open (DEC-69); the hold itself is derived from the date and the setting, so the row changes no answer (A1 not adopted, Q-R2) | The closing's case | Nothing |
| P3-34 | An administrator's release of a held slot (`enrollments.releaseSlot`; T070, FR-503, SRS FR-CANCEL-9) | `enrollments.slot_released_at`, one `enrollment_events` row `slot_released`, audit `enrollment.slot_released` with the reason; panel: `/sessions` (`sessions.monitor.get`'s `slotReleasedAt` and `slotHeldUntil`), `/audit` | None once released: irreversible (no un-release); a restore after it succeeds only while the slot and the times stay free (`slot_taken`, `time_taken`), and the restore clears `slot_released_at` | The closing's case | The stored idempotent answer after 24 h (the column, the row and the audit entry stay) |
| P3-35 | A student's ban lifted (`students.liftBan`; T072, FR-502, SRS FR-ADMIN-5 as amended) | `users.account_status` back to `active` (`verification_required` with an identity request open) and `banned_at` NULL; each enrollment the ban closed restored (`enrollments.status` `confirmed`, one `enrollment_events` row `restored`, the recreated `sessions`, its `student_banned` case `dismissed` with the note `restored`) or left ended with its case open; audit `student.ban_lifted` with the reason, the standing before and after and each enrollment's `{ enrollmentId, restored, cause? }`; the live events `account` and `enrollment`; panel: `/users` (`users.get`), `/sessions`, `/cases`, `/audit` | `students.ban` again; a restored enrollment's recreated sessions through `sessions.cancel` while not settled (FR-460); an enrollment left ended through `sessions.restore` once its cause is gone, or `enrollments.releaseSlot` | For the student, each restored enrollment; one left ended keeps its `student_banned` case | The stored idempotent answer after 24 h; `banned_at` cleared (the audit entries hold both moves) |
| P3-36 | A teacher's or an applicant's ban lifted (`teachers.liftBan`; T072, FR-502) | `users.account_status` back to `active` and `banned_at` NULL; `teacher_profiles.verification_status` and `application_status` back to the values T069's two columns kept, the columns cleared, the ban's note and decision instant left as history; each enrollment the ban closed restored (as P3-35, its `teacher_ended` case `dismissed` `restored`) or left ended with its case open (`party_restricted`, `slot_taken`, `gender_mismatch` and the rest); audit `teacher.ban_lifted` with the reason, the standing and each enrollment's result; panel: `/users`, the applicant's page, `/sessions`, `/cases`, `/audit` | `teachers.ban` (or `applications.ban`) again; as P3-35 for the enrollments | For the students, each restored enrollment; one left ended keeps its `teacher_ended` case | The stored idempotent answer after 24 h; `banned_at` and the two kept statuses cleared (the audit entries hold the moves) |
| P3-37 | A teacher's revocation lifted (`teachers.liftRevocation`; T072, FR-502) | `teacher_profiles.verification_status` and the application back to `approved`, the subjects of the approved credentials granted again (`teacher_subjects`); each enrollment the revocation closed restored or left ended with its case open, as P3-36; the account moved by none (a suspended teacher stays suspended, the follow-up under T072); audit `teacher.revocation_lifted` with the reason, the standing and each enrollment's result; panel: `/users`, the applicant's page, `/sessions`, `/cases`, `/audit` | `teachers.revokeApproval` again; as P3-35 for the enrollments | For the students, each restored enrollment; one left ended keeps its `teacher_ended` case | The stored idempotent answer after 24 h (the rows and the audit entry stay) |
| P3-38 | A deleted teacher's kept data erased on its date (`erase-kept-data`, daily at 04:25; T077, FR-509, SRS FR-ADMIN-21, DEC-67) ⚠️ automatic and final: each kept profile whose `kept_erase_at` passed, read again under its locks | `teacher_profiles.kept_erased_at` (when), the payout columns blank, each kept document's `erased_at` (`kept_at` NULL), the audit entry `teacher.kept_data.erase_date_set` that set the date with its reason (why, who), and one info line `{ userId, reason: 'erase_date_reached', documents, payout }`; panel: `/users` (`users.get`'s `keptData`: `eraseAt`, `erasedAt`, the documents left), `/audit` | The date cleared or moved before it passes (`teachers.keptData.setEraseDate`, `eraseAt` null or later), audited `teacher.kept_data.erase_date_cleared` or `.erase_date_set` | None: final (DEC-67, FR-ADMIN-21) | The kept documents' files, by `erase-deleted-files` once no open dispute, case or complaint holds them; the payout reference at once |
| P3-39 | An administrator erases a deleted teacher's kept data now (`teachers.keptData.eraseNow`; T077, FR-509, SRS FR-ADMIN-21) ⚠️ final | The audit entry `teacher.kept_data.erased` with its reason and what it erased (`documents`, `payout`), `teacher_profiles.kept_erased_at`, each kept document's `erased_at`, and one info line `{ userId, reason: 'erase_now', documents, payout }`; panel: `/users` (`users.get`'s `keptData.erasedAt`), `/audit` | None | None: final (DEC-67) | As P3-38; the stored idempotent answer after 24 h (the columns, the rows and the audit entry stay) |
| P3-40 | An administrator's direct end of an enrollment (`sessions.endEnrollment`; T082, FR-513, SRS FR-CANCEL-10, DEC-68): the enrollment `cancelled` `admin` with the reason both parties are shown, its remaining sessions `cancelled_by_admin`, every open remedy handed to one `admin_ended` case, the slot held through `enrollment_restore_window_days` or released at once | The `admin_ended` case (`disputes`: `reason`, `created_at`, its `covers` on `cases.get`); the `cancelled` row (`enrollment_events` with `admin`) and `enrollments.admin_end_reason`; audit `enrollment.ended_by_admin` with both texts and the slot's choice; with `release`, `slot_released_at` and one `slot_released` row; one info line `{ adminId, enrollmentId, caseId, slot, cancelledSessions, handedRemedies }`, never either text; the live event `enrollment` to both parties; panel: `/sessions` (`sessions.monitor.get`), `/cases`, `/audit`; the parties: `endedByAdmin` on `enrollments.get/list` and `teacher.students.get/list` | `sessions.restore` at any time while the case is open (DEC-69), clearing the reason; after a release, only while the slot and the times stay free (`slot_taken`, `time_taken`) | The `admin_ended` case | The stored idempotent answer after 24 h (the rows, the column and the audit entry stay) |

**The gaps and their answers** (**Decided**, the owner, 2026-11-05: plan.md, «Decisions of 2026-11-05, the
administrator's control inventory answered»). The table keeps each gap's number where it was found; the answer below
fills it. No answer offers a time (R-320).

1. **GAP-1, the outcome rows not in the panel** (P2-2, P2-4, P2-7, P3-11). **Answered.** `sessions.monitor.get` gains
   `events`, the enrollment's timeline, newest first: its `enrollment_events` through `EnrollmentSide`'s new
   `eventsOf(tx, enrollmentId)` (booking's rows, each `{ kind, cancellationReason?, occurredAt }`; sessions reads no
   booking table, R-301, and no `payment_id` crosses, FR-497: the orders stay on `/payments`) and its `session_events`
   (each with its kind, session, case, instant and, where its kind has them, `outcomeBefore`, `outcomeAfter` and
   `previousStartAt`), shown as a timeline on `/sessions` (contracts/admin-surface.md).
2. **GAP-2, the telemetry of an undisputed settled session** (P3-1, P3-2). **Answered.** `sessions.review.get` admits
   every session that is no longer `scheduled`: each settled status, a disputed one, and a cancelled one, whose room's
   `room_ended` event is P3-2's evidence; a `scheduled` session is refused `CONFLICT` (`details.cause` `not_settled`).
   Each session on `/sessions` links to it; its audit entry stays `sessions.review.viewed`.
3. **GAP-3, no administrator correction of an outcome nobody disputed** (P3-1, P3-22). **Answered** with a procedure of
   its own, `sessions.review.revise` `{ sessionId, outcome, reason, idempotencyKey }` (spec FR-439), rather than
   folded into `disputes.revise`, whose input, refusals and event name a dispute that an undisputed session does not
   have; the two share the service that writes a session's outcome. `disputes.revise`'s conditions: the session
   `done`, `student_no_show`, `teacher_no_show` or `both_no_show`, its dispute window open and no remedy offered
   (`RULING_FINAL`, `details.cause` `window_closed` or `remedy_offered`); never disputed (an open dispute answers
   `DISPUTE_OPEN`, a resolved one `CONFLICT`, `details.cause` `ruled` with the dispute's id: its ruling is revised by
   `disputes.revise`); under review answers `SESSION_UNDER_REVIEW`; `scheduled` or cancelled `CONFLICT`
   (`not_settled`). Its own `rateLimit`, `rate_limit_outcome_correction` (10 per 60 s, the administrator as subject, a
   new §3.14 row; R-321), checked before the transaction; idempotent through `IdempotencyService.run`, scope
   `sessions.review.revise`. It writes the session's `status`, `settled_by_admin_id` and `admin_settled_at` and one
   `session_events` row of a new kind, `outcome_corrected`, with `outcome_before` and `outcome_after` (rule 43
   widened: both set exactly on `dispute_revised` and `outcome_corrected`; `case_id` NULL); audit
   `session.outcome_corrected` with the reason. Locks: `enrollments`, `sessions` (the session's disputes and remedy
   read under them, nothing of `disputes` written), the order a revision takes without its dispute. The remedy the
   corrected outcome owes comes at FR-462's moment, never in this transaction; a participant may still dispute the
   corrected outcome inside the window (FR-473). A button on `/sessions` and `/review`.
4. **GAP-4, an open remedy not in the panel** (P3-3, P3-5, P3-6). **Answered.** Each session of
   `sessions.monitor.get` gains `remedy?`: `remedyId`, `kind`, `status`, `offeredAt`, `choiceClosesAt`, the proposal
   (local date, start, zone, instant), a pending counter-proposal with its `answerClosesAt` (computed when read, D1),
   `caseId`, `decidedAt`, and `bookingRetriedUntil`, derived, never stored (R-DB-4): for a remedy `proposed` or
   `awaiting_choice` past `choice_closes_at`, its booking refused and retried (A3, FR-468), the proposal's start less
   `snapshot_first_session_lead_hours`, after which `advance-remedies` hands it to a `makeup_refused` case; the page
   reads it «booking refused, retried until …».
5. **GAP-5, no administrator path on an open remedy** (P3-3, P3-6). **Answered** by the manual case (R-326):
   `cases.openManual` with `remedyId` hands an open or `frozen` remedy to the student's manual case, releasing its
   reserved times (H3). No sibling procedure and no new reason beyond the manual case's two.
6. **GAP-6, the time zone re-resolution leaves no record** (P2-8). **Answered.** A new `session_events` kind
   `instants_reresolved` with a new nullable column `previous_start_at` (timestamptz), set exactly on that kind (rule
   43), written by `reresolve-session-instants` through sessions' `reresolveScheduledSessions`, in the run's one
   transaction (a refused commit writes none): one row per kept-back session, its `previous_start_at` the start it
   keeps, and one per session the run moved, its `previous_start_at` the start before the run (the session's row holds
   the new one), so the panel tells them apart by whether the session still starts at `previous_start_at`. A run after
   the version marker's expiry that keeps the same session back again writes another row, as it reports it again.
   Shown by GAP-1's timeline.
7. **GAP-7, the sweep's room end writes nothing of its own** (P3-2). **Answered.** `evaluate-sessions` writes one
   structured `info` log line per `endRoom` and per `removeParticipant` call, message `video room ended` or `video
   participant removed`, its fields exactly `{ sessionId }` and, for a removal, the participant's `userId`: never a
   token, a name or an address. No row: the provider's `room_ended` participant event stays the durable record
   (contracts/video.md).
8. **GAP-8, a hold's release has no reason and no page** (P2-1). **Answered.** `slot_holds.release_reason`, a new
   nullable enum `hold_release_reason` written with `released_at` by every path that writes it, the reasons the code's
   release paths have: `converted` (`convertHoldOf`, `modules/booking/confirmation.repository.ts`, the confirmation);
   and booking's one release (`releaseHolds`, `releaseExpiredHolds`, `reholdEnrollment` in
   `modules/booking/holds.service.ts`, through `markReleased`) under its `ReleaseReason`: `expired` (the
   `expire-holds` and `expire-pending-payments` sweeps, and the expired holds released before a new hold on the slot or
   by the student and before a late payment's new hold, ADR 0010 D3), `checkout_abandoned` (the student's own new
   checkout, `checkout-holds.service.ts`, FR-BOOK-12), `slot_unavailable` (the refusal branch,
   `confirmation.service.ts`, FR-PAYG-19), and `admin`, `teacher_suspended` and `account_deleted` (an account's end,
   `termination.subscriber.ts`). Check (rule 48): `release_reason IS NULL OR released_at IS NOT NULL`; a hold released
   before the migration keeps NULL, read as «not recorded». No index (R-DB-9). The panel: Phase 2's admin read
   `payments.get` lists the enrollment's holds (`slot_holds.enrollment_id`) on its enrollment summary through booking's
   `monitoredEnrollmentOf`, each `{ holdId, placedAt, expiresAt, releasedAt?, releaseReason? }`, additively (R-API-9);
   a hold that never reached Pay has no enrollment and no order, and stays only in the table.
9. **GAP-9, a rate-limit refusal leaves no record** (P3-28). **Answered**: no panel page reads the refusals. The first
   refusal of a subject in a window, logged as R-321 item 6 says, is the evidence; no database row, since a flood would
   write a flood. A panel page over the logs is **Not scheduled**.
10. **GAP-10, a refused or unattributable video event** (P3-27). **Answered.** Error tracking (an unattributable
    event) and the warn log (a refusal, with its code) stay its evidence, and `docs/RUNBOOK.md`'s incident «A video
    event refused or not attributed» names where to look. No row, since a forger could fill a table.

**The rows M alone answers:** P3-1 and P3-22 (an outcome past its window; inside it, GAP-3's correction), P3-11 (a completion), P3-15
(the teacher's side of a teacher's end), P3-16 (the teacher's side of a student's deletion), P3-19 (a closed
complaint), P3-20 and P3-21 (a ruling past its window), P3-24 (a closed case), and P2-3 (an order event no case
covers).

**What is erased automatically, and by what** (the last column, gathered): the chat's bodies, attachment fields and
files, by `purge-chat` daily, after the last session's end + `dispute_window_hours` (72) + `chat_retention_days` (30,
the owner's decision of 2026-11-05: was 0),
never while a dispute, a case or a complaint of the teacher's absence (from Phase 4, a report) is open (FR-492); idempotency rows, the stored answers of
`disputes.revise`, `sessions.restore`, `sessions.review.revise` and `cases.openManual` and the time zone marker included, by `expire-idempotency-keys` hourly after
`idempotency_key_ttl_hours` (24) (ADR 0008 D2); the rate-limit counters in Redis, each at its limit's `window_seconds`,
and the default limit's cached setting (60 s) and breaker (10 s) in process memory (R-321); finished queue jobs at once
and failed ones beyond the last 1000 (`jobs/queue.ts`' `defaultJobOptions`, T171); sign-in sessions, expired ones at
once and revoked ones after `session_purge_after_days` (30), by `purge-expired-sessions` hourly; one-time codes after
`otp_purge_after_hours` (24); push tokens unused for `push_token_stale_days` (90); uploads no submission points at after
`document_unreferenced_purge_after_hours` (72); a deleted person's files at the deletion and by `erase-deleted-files`
hourly (ADR 0015 D3), held while the person is a party to an enrollment with an open dispute, case or complaint (R-327); the order's encrypted checkout address once the order leaves `created` (ERD §7); webhook bodies,
never stored (a payment event keeps its hash only); the video room's state at the provider, ended
`video_empty_timeout_seconds` (300) after the last leave or by `endRoom`, with no recording made and the join token
valid only until the scheduled end and never stored; logs and error-tracking reports, by the hosting's retention, which
no setting here governs. No job deletes an audit entry, an `enrollment_events`, `session_events`, `payment_events` or
`session_participant_events` row, a dispute or case, a session or an enrollment (ERD §15 rules 10 and 21; the same revokes on `enrollment_events` and `session_events`, Phase 2's R-216 and data-model §2.4).

**Window rule (R-320).** Nothing here offers a time; GAP-3's correction leaves the remedy to T028's offer after the
window, and GAP-5's hand-off offers none.

## R-324 — The live channel

**Decided**, the owner, 2026-11-05 (spec FR-427 to FR-429, FR-437 and FR-438; SRS §3.14, NFR-SEC-12 and §4.4 as
amended). Read against this branch at `9159cec`; the versions in the repository: `@trpc/server` and `@trpc/client`
11.19.0, `@nestjs/platform-express` 12.1.2, `expo` 58.0.14, `react-native` 0.88.0, `ioredis` 5.11.1.

1. **Transport: Server-Sent Events through tRPC 11.19's subscriptions; no WebSocket server.** A subscription is an
   ordinary `GET /trpc/live.events` through the existing `createHTTPHandler` mounts (`apps/api/src/app.module.ts`,
   `surfaceHandler`), so the same context, bearer resolution, standing read, caller kind, limiter, security headers,
   CORS and logging apply, and nothing new is mounted. tRPC serves a `subscription` on GET as SSE by default, with
   `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`
   (`@trpc/server`'s `http/resolveResponse.ts` and `stream/sse.ts`). `refusalOf` keeps refusing `connectionParams`
   (`app.module.ts`), so the bearer token travels in the `Authorization` header and never in a URL. tRPC recommends SSE,
   "easier to setup and doesn't require setting up a WebSocket server" (https://trpc.io/docs/server/subscriptions). A
   WebSocket server would need an upgrade path outside every Express middleware, a second context factory reading
   `connectionParams` and a context built once per connection, so a suspension would be invisible to it until closed
   (https://trpc.io/docs/server/websockets, https://trpc.io/docs/client/links/wsLink).
2. **The phone's EventSource is ours.** React Native has none; the ponyfills tRPC names are unmaintained or XHR-based,
   and those "fail to reconnect after the app has been in the background"
   (https://trpc.io/docs/client/links/httpSubscriptionLink); the maintained `eventsource` needs `Event`, `MessageEvent`
   and `EventTarget`, which Hermes does not expose (https://github.com/facebook/react-native/issues/38004,
   https://github.com/cloudflare/partykit/issues/401, https://github.com/EventSource/eventsource). So a small EventSource
   in the app, tRPC's `EventSourceLike`, over `expo/fetch`, which streams response bodies on Android and iOS
   (https://docs.expo.dev/versions/v58.0.0/sdk/expo/), and `eventsource-parser` 4.1.2 (2026-10-12, a pure parser, no
   globals). It never goes through `timed()` in `apps/mobile/src/lib/client.ts`, which reads the whole body and aborts
   after `CALL_TIMEOUT_MS`. It never reconnects by itself: the channel's wrapper reopens it, so a reopening always
   reads the current token. A refusal at the open arrives inside the stream as a serialized error; on `UNAUTHENTICATED`
   the phone calls `account.me` once through the normal client, which refreshes or signs out as it does today, and
   then reopens.
3. **One channel per signed-in device**, `live.events`, a user-kind subscription with no input: the client chooses no
   topic, and there is no per-enrollment subscription to check (no forged-topic surface). It declares its own limit,
   `rate_limit_live_channel` (10 per 60 s, the user as subject, failing closed as every declared limit does; a backoff
   of 1, 2, 4, 8, 16, 30 s is six opens a minute), and an account holds at most `live_channel_max_connections_per_user`
   (3) streams, the **oldest** ended when one more opens, since a half-open connection left by a network switch would
   otherwise lock the phone out for minutes. tRPC's `.output()` does not validate what a subscription yields ("you have
   to go through the iterator to validate the output", https://trpc.io/docs/server/subscriptions), so every yielded
   event is parsed by the event schema, and `scripts/contract-snapshot.ts` learns to record a subscription's event
   schema, so R-API-9's gate covers it.
4. **Four events** (`packages/contracts/src/live.ts`), a discriminated union on `type`:
   - `session { sessionId, enrollmentId }`: something about this session changed; read it again;
   - `enrollment { enrollmentId }`: read the enrollment's screens again;
   - `chat { enrollmentId, message }`: the message in `chat.list`'s item shape, `mine` computed for each recipient.
     Carried rather than signalled: a signal per message would cost a `chat.list` per incoming message, up to
     `rate_limit_chat_message` a minute, which alone would lift R-325's heaviest minute past 200;
   - `account`: read `account.me` again; the server then ends the stream.

   A signal carries nothing else: the app reads through the normal procedures, and they decide.
5. **Addressed by the server, sent after commit.** Each event is addressed to user ids read from the rows of the
   transaction that produced it (the chat send's parties under L-B's locks, a session's two participants), and sent
   only after that transaction commits, through the kernel's `LivePublisher`: the administrator kind and the user
   kinds' transactional services keep an after-commit list the kind flushes (the shape of `deletion.service.ts`'s
   `#afterCommit`); a rolled-back transaction sends nothing. A failed publish loses a hint only: logged at warn, never
   retried. No event's payload and no token is ever logged (R-SEC-2).
6. **What publishes**, every producer in the API process:

   | Trigger, after its commit | Event | To |
   |---|---|---|
   | `chat.send`, `POST /uploads/chat` | `chat` | both parties, the sender's other devices too |
   | the video webhook's `participant_joined`, `participant_left`, `participant_connection_aborted` and `room_finished` recorded (R-304) | `session` | the other participant; `room_finished` both |
   | a cancellation request; its answer | `session` | the counterparty; the requester |
   | an administrator's `sessions.cancel` | `session` | both |
   | an enrollment closed (a complaint's decision (a), a confirmed fault) or restored (`sessions.restore`); sessions cancelled by an account's end (`cancelRemainingSessions`) | `enrollment` | both; the other party |
   | `StandingService` (suspension, ban, revocation), a student's standing (`002:T144`), a deletion, a sign-out | `account`, then the streams ended | the person; a sign-out, that sign-in session's streams |

   `sessions.get` gains `counterpartyInRoom`, read from the recorded participant events by R-304's per-connection rule
   (a `joined` with no later `left` for its `connection_ref`, and no `room_ended` after it), so out-of-order or
   duplicate events do not mislead it; a hint only, LiveKit giving "no guarantees around delivery"
   (https://docs.livekit.io/home/server/webhooks/), and no provider call per read.
7. **Not live: read when the screen opens** (and on `003:T015`'s foreground re-read): remedies, disputes, complaints,
   outcomes and every administrator screen; **an enrollment's completion and a cancellation request's expiry**, both
   produced by the worker (the owner's decision: read on open); Phase 2's payment confirmation, still polled every
   `checkout_confirming_poll_seconds` (30). The phone's «expired» on a pending request, derived from its `expiresAt`, is
   display only: the server decides (SRS FR-CANCEL-4, spec FR-458), and an answer it refuses makes the screen read
   again.
8. **Resilience.** The server pings every 25 s (`sse.ping`), under nginx's 60 s default read timeout and Cloudflare's
   100 s; the client restarts a stream silent for 60 s (`sse.client.reconnectAfterInactivityMs`; tRPC refuses a ping
   above it), which catches a half-open connection after a network switch. A reopening backs off from 1 s, doubling to
   a 30 s cap, each delay × a random 0.5–1.5. **Why the ping and the backoff are not settings** (**Decided**, the
   owner, 2026-11-06, the fourth analysis's C1; R-MONEY-12 (as amended, constitution 2.6.0)): the 25 s ping is a
   kernel constant because an administrator changing it from the panel could break every stream (past the proxy's
   60 s read timeout or tRPC's 60 s inactivity restart, the streams drop); the phone's reconnect backoff (this item's
   delays, and item 9's 1 to 15 s) is a constant on the phone because the phone cannot read settings before it
   connects; the queue's fixed retry numbers are the precedent (`apps/api/src/jobs/README.md`), and the magic-number
   gate covers `apps/api/src/modules/` only. On the fifth analysis (**Decided**, the owner, 2026-11-06, C3 and C4;
   constitution 2.6.1), four more numbers are named constants, each for its reason: the 60 s inactivity restart,
   because it is tied to the ping and tRPC refuses a ping above it; the per-stream queue bound, because it protects the
   API's memory; the phone's coalescing (one re-read per query key per second), because it protects the signed-in
   default limit; and the phone's 60 s after `RATE_LIMITED`, because it is part of the phone's backoff, the phone
   cannot read settings, and an earlier retry is refused again. On the sixth analysis (**Decided**, the owner,
   2026-11-06, item 6), the server sends the time left: a refused opening, as every refusal a rate limit's counter
   makes, carries `retryAfterSeconds` (the counter key's remaining time to live, one `PTTL` on the refused path only;
   T062, contracts/kernel.md "Rate limits"), and the phone waits that long before it opens the stream again; the 60 s
   stays only as the fallback when the refusal gives no time, and is still a named constant for the same reasons
   (without a time, the phone cannot know the window's end, and an earlier retry may be refused again; T065). The ping and the restart are named in
   `apps/api/src/platform/live/live-constants.ts`, which `apps/api/src/surfaces/procedures.ts` imports, so both sit in
   the kernel the exception names. The channel's own limits, `rate_limit_live_channel` and
   `live_channel_max_connections_per_user`, stay settings. The stream closes when the app leaves the foreground and reopens when it
   returns, with one re-read of the open screens and of the chat's first page; re-reads are coalesced to at most one
   per screen per second (LiveKit can report joined, left, joined within a second). No `tracked()` replay: there is no
   per-user ordered log to replay from, and every signal means «read again». Each stream has a bounded queue, and a
   slow reader's stream is ended. Every stream ends when the access token it opened with expires (at most
   `session_access_ttl_minutes`, 15), so a lost `account` publish never leaves a revoked device streaming, with no
   periodic re-check per stream; the resolved session exposes the token's expiry, additively
   (`modules/identity/session.service.ts`' `resolveUserSession` parses it and does not return it today).
9. **Shutdown, the owner's hard condition.** The API ends every live stream **before** `application.close()` in
   `onShutdown` (`apps/api/src/main.ts`): Node's `server.close()` waits for a connection still waiting for a response
   (https://nodejs.org/api/http.html#serverclosecallback), so one open stream would hold a deploy until Docker kills
   it. A test proves shutdown never waits on an open stream. Phones reconnect after a uniform random 1 to 15 s delay,
   so 1000 phones return at about 70 a second.
10. **One process; no Redis pub/sub now.** The bus is in-process behind a `LiveBus` interface, exact while the API is
    one process and every producer runs in it. **Redis pub/sub between processes is Not scheduled** and must land
    before any of: a second API process; any worker event made live; payment confirmation made live. Forgotten, events
    from one process miss another's streams; screens still read on open, so the result is late, never wrong.

**Cost.** Assumed at most 100 KB per stream in Node and 10 to 30 KB at the proxy, not measured: the server task opens
500 streams locally and records the RSS before and after in `docs/RUNBOOK.md`. 1000 streams send 40 pings a second; an
open costs one session resolve, as any call; nothing polls per stream. The proxy, Docker and RAM notes are in PLAN.md's
Phase 6 and the RUNBOOK's «Reverse proxy and the live channel».

**Rejected.** A WebSocket server (item 1); a subscription per enrollment (a party check per subscription and a topic
to forge); `tracked()` replay (nothing to replay from); a periodic standing re-check per stream (the token's expiry and
the `account` event bound it); a third-party EventSource (item 2); live completion, request expiry and payment
confirmation (worker events, which need the bus); presence by a LiveKit call per read.

**For Phase 4 (T057's cycle).** The cancellation request is the first thing that needs push: it expires at the
session's start, so a counterparty whose app is closed never learns of it in time.

**Window rule (R-320).** Nothing here offers a time.

**Sources** (read 2026-11-05): https://trpc.io/docs/server/subscriptions ;
https://trpc.io/docs/client/links/httpSubscriptionLink ; https://trpc.io/docs/client/links/wsLink ;
https://trpc.io/docs/server/websockets ; the installed `@trpc/server` 11.19.0 (`stream/sse.ts`,
`http/resolveResponse.ts`, `middleware.ts`) and `@trpc/client` (`links/httpSubscriptionLink.ts`);
https://docs.expo.dev/versions/v58.0.0/sdk/expo/ ; https://github.com/facebook/react-native/issues/38004 ;
https://github.com/cloudflare/partykit/issues/401 ; https://github.com/EventSource/eventsource ;
https://docs.livekit.io/home/server/webhooks/ ; https://nginx.org/en/docs/http/ngx_http_proxy_module.html ;
https://caddyserver.com/docs/caddyfile/directives/reverse_proxy ; https://nodejs.org/api/http.html#serverclosecallback ;
the npm registry (`npm view <package> time`).

## R-325 — The signed-in default rate limit's value

**Decided**, the owner, 2026-11-06, on the fifth analysis (A6): `rate_limit_signed_in_default` = `{ limit: 150,
window_seconds: 60 }` (160 per 60 s, the owner's decision of 2026-11-05, until then, computed with the teacher's name
searches the default no longer counts), by the
owner's rule (SRS NFR-SEC-12, R-321 item 5): the larger of 120 per 60 s and the heaviest normal minute H times 2 to 3,
and no number at all when that product is above 200 (the screen that calls too often is fixed instead).

**Method.** Only the calls the default counts (FR-470: a procedure with its own key is counted by that key only). Not
counted: `discovery.browse/filters/teacher` and `booking.slots` (`rate_limit_search`), `checkout.hold/pay/retry`
(`rate_limit_payment_initiation`), `chat.send` (`rate_limit_chat_message`), `sessions.complaint.raise`
(`rate_limit_absence_complaint`), the uploads (`rate_limit_upload`) and the public kinds; since the owner's decision of
2026-11-06 on the fourth analysis (C2), also `teacher.students.list`, `sessions.monitor.list` and `users.list`
(`rate_limit_search`): the tables below leave them out (recomputed on the fifth analysis, the owner's decision of
2026-11-06). Counted, for example:
`account.me`, `enrollments.list/get`, `checkout.status/current/continue`, `teacher.today`, `teacher.students.get`,
`teacher.slots.*`, `teacher.packages.*`, Phase 3's `sessions.*` but the complaint, `chat.list`, `chat.attachmentLink`,
and every administrator procedure but those with their own keys (subject `admin:<id>`, apart from the users'). The
phone as it reads today: one `QueryClient` with TanStack's defaults (`apps/mobile/src/app/_layout.tsx`), so `staleTime`
0 (every mount of a screen reads again) and `retry: 3`; every mounted query reads again on the return to the foreground
(`lib/focus.ts`) and when the connection returns (`lib/online.ts`); tabs stay mounted, stack screens mount again on each
visit; searches settle 300 ms (`features/teacher/students/search.ts`, `features/student/discovery/search.ts`); a
Confirming payment is polled every `checkout_confirming_poll_seconds` (30). Phase 3's screens read what
contracts/app-surface.md lists. The panel (`apps/admin/src/App.tsx`): `retry: 1`, `refetchOnWindowFocus: false`; list
pages fresh for 30 s (`FRESH_MS`), searches settled 300 ms (`SEARCH_SETTLE_MS`).

**The student's heaviest normal minute** (a session about to start; the student moves between home, the enrollment,
the pre-session screen and the chat while the teacher's connection flaps; an older enrollment still Confirming):

| Category | Calls | Arithmetic |
|---|---|---|
| Screen opens and refreshes | 10 | foreground: `account.me`, `enrollments.list`, `checkout.status` 3; `enrollments.get` 1; `sessions.get` 1; `chat.list` 2; `chat.attachmentLink` 1; a cancellation request and its re-read 2 |
| Fast switching between screens | 12 | 12 stack screens mounted again, one read each |
| Polling (30 s) | 6 | `enrollments.list` 2, `checkout.status` 2, `enrollments.get` 2 |
| Re-reads after a change on the other side | 8 | 3 changes of the session (joined, left, joined) × (`sessions.get` + `enrollments.get`) 6; the cancellation's answer 2; incoming chat messages 0 (carried to the screen, not read again) |
| Connection restarts (Wi-Fi ↔ mobile data) | 6 | 2 × (`chat.list`, `sessions.get`, `enrollments.get`) |
| **Total** | **42** | 48 if a restart and the returning connection both read again (+6) |

**The teacher's heaviest normal minute** (between sessions: searching the students list, opening enrollments,
answering a cancellation request and a counter-proposal, chatting, waiting on a pre-session screen while the student's
connection flaps):

| Category | Calls | Arithmetic |
|---|---|---|
| Screen opens and refreshes | 11 | foreground: `account.me`, `teacher.today` 2 (`teacher.students.list`, the third read, counted by `rate_limit_search`); `teacher.students.get` 1; `sessions.get` 1; `chat.list` 2; `chat.attachmentLink` 1; the cancellation's answer and its re-read 2; `sessions.remedy.answerCounter` and its re-read 2 |
| Searching and paging the students list | 0 | 3 names × 4 settled reads, and 2 more pages: 14 `teacher.students.list` calls, counted by `rate_limit_search` (60 per 60 s) since the fourth analysis's C2, not by the default |
| Fast switching between screens | 12 | 12 mounts, one read each |
| Polling | 0 | no teacher screen polls |
| Re-reads after a change on the other side | 8 | 3 changes of the session × (`sessions.get` + `teacher.students.get`) 6; a cancellation request arriving 2 |
| Connection restarts | 6 | 2 × 3 |
| **Total** | **37** | 52 before the fifth analysis, the 15 `teacher.students.list` calls now `rate_limit_search`'s. Editing availability instead: 10 × (`teacher.slots.create` + the list's re-read) + 3 = 23 |

**The administrator's heaviest normal minute**: scanning the audit log, a page every 1.5 s, 40 `audit.list` + 5
`audit.get` = **45** (the directory: 6 `users.get`, 2 `home.summary`, 1 `auth.me` = 9, its 5 settled searches and 15
pages being `users.list`, counted by `rate_limit_search`;
dispute triage, 3 disputes × 8 + 2 = 26).

**The result.** H = max(42–48, 37) = 48, the student's; H × 2 = 96, H × 3 = 144, both at most 200, so a number is
used: H × 3 rounded up to ten, **150 per 60 s**, above 120, so 150 (the owner's decision of 2026-11-06 on the fifth
analysis, A6). The factor 3 rather than 2: a flap on mobile data reads twice;
the default fails open on a Redis failure (R-321, item 4), so its work is to stop a runaway client (a render loop or a
retry storm calls hundreds of times a minute, which 150 stops as surely as 120), not to be tight; and the fixed window
already lets up to twice the limit through at a window's edge (`platform/guards/rate-limit.guard.ts`'s header). The
panel needs no value of its own: 45 × 3 = 135 < 150, on a counter apart from the users' (R-321, item 2); the four
administrator write limits (10 per 60 s each) are unchanged. Two devices of one account share a counter: 2 × 48 = 96.

**What would push it above 200** (none does in the design as written; each named with its fix): (1) the chat read
again for every incoming message instead of the message carried to the screen: up to `rate_limit_chat_message` (30)
more a minute, H → 78, × 3 = 234; (2) re-reads after a change not coalesced: a flapping connection can report joined and
left within a second, and a cancelled read already counted is started again; one re-read per query key per second
fixes it; (3) `retry: 3` on a refusal: the phone retries every failed query three times, `RATE_LIMITED` included, so one
refusal becomes four counted calls; retrying only an error with no API code (a network failure) fixes it. A Phase 3
screen that adds a poll during the build has this arithmetic redone before its batch merges.

**Window rule (R-320).** Nothing here offers a time.

## R-326 — The manual compensation case, and an open remedy handed to it

**Decided**, the owner, 2026-11-05 (SRS FR-ADMIN-20 (c); spec FR-471 (c) and FR-493; R-323's M and GAP-5).

**Decision.** `cases.openManual`, an `adminProcedure` in the `cases` namespace of sessions' admin router (R-318):

- **Input** `{ enrollmentId, party: 'student' | 'teacher', reason: string (1 to 500 characters, not blank),
  idempotencyKey, remedyId? }`; **output** `{ caseId, enrollmentId, party, status: 'open', joined: boolean,
  handedRemedy?: { remedyId, sessionId } }`.
- **Any enrollment, in any state** (`pending_payment`, `confirmed`, `completed`, `terminated_no_show`, `cancelled`).
  The enrollment is read through `EnrollmentSide` (sessions reads no booking table, R-301).
- **The case.** Moderation's `openCompensationCase(tx, enrollmentId, reason)` with one of two new
  `COMPENSATION_REASONS`, `admin_opened_for_student` or `admin_opened_for_teacher`, by `party`: the party is the
  reason, so no column is added. One open case per enrollment and reason stays the rule, so a second opening for the same
  party while that case is open joins it (`joined: true`, no row written). The administrator's written reason is the
  audit entry's, `case.opened_manually` (the case as target, with `party`, `joined` and the remedy handed), as a
  revision's is (R-308): `disputes.reason` holds the closed list, and `resolution_notes` is the closing's note.
- **Refusals**, each writing nothing: `NOT_FOUND` (no such enrollment; a `remedyId` that is no remedy of it);
  `RATE_LIMITED` (`rate_limit_manual_compensation_case`, 10 per 60 s, `subject: 'caller'`, the administrator, checked
  before the transaction, apart from the key, R-321); `CONFLICT` (the same `idempotencyKey` with another input); and,
  for a hand-off only, `REMEDY_NOT_OPEN` (the remedy `booked`, `refund_case` or `lapsed`). A `remedyId` with `party:
  'teacher'` is refused by the input schema: a remedy is owed to the student.
- **Idempotent**: `IdempotencyService.run` (`platform/idempotency`, ADR 0008), the scope `cases.openManual` added to
  `packages/contracts/src/idempotent-procedures.ts`, the actor the administrator; a repeat with the same key returns the
  first answer and writes nothing, as `sessions.restore` does (R-322).
- **Locks** (T005). Without a remedy: `enrollments` (the case's own lock, `lockCasesOf`), then `disputes` (the insert or
  the join). With `remedyId`: the refund hand-off's order, as `sessions.remedy.choose`'s (contracts/kernel.md): the
  enrollment's parties read with no lock (they never change), then `users` (both, one call),
  `lockKey('teacher-slots', teacher)`, `enrollments`, `sessions`, `session_remedies` (the remedy read again: open, of
  this enrollment), `disputes`.

*An open remedy handed to the case* (GAP-5; the simpler of the two shapes: one procedure, one limit, one key scope, one
audit action, instead of a sibling `handToCase`). With `remedyId`, in the same transaction, the remedy, open
(`awaiting_choice`, `proposed`, `counter_proposed` or `frozen`), becomes `refund_case` with `case_id` the student's
manual case and `decided_at` now, its `kind` unchanged (the case decides what is owed, as at an enrollment's end, R-313);
a pending counter-proposal's five `counter_*` columns are cleared (rule 42) and its time released, and the proposal's
reservation (H3) ends with the open state, so both times return to booking at once; one `session_events` row
`remedy_handed_to_case`, which ends the counter-proposal's history (§2.4) and is what Phase 4's `makeup_handed_to_case`
reads. A remedy so handed is no longer owed by the enrollment (FR-449), and a restore offers again only the remedies its
closing's case holds (R-322), never one a manual case holds.

*Phase 2's covering rule reads Phase 2's three reasons only.* `caseInstantsAmong`
(`apps/api/src/modules/moderation/compensation-case.repository.ts`), and `caseInstantsOf` through it, today groups every
`compensation_case` row of an enrollment. It is narrowed to `reason IN ('slot_unavailable', 'party_restricted',
'duplicate_payment')`, the three `COMPENSATION_REASONS` of Phase 2 (FR-362 and FR-375 of `specs/003-booking/spec.md`),
named once as a constant beside `COMPENSATION_REASONS` in `compensation-case.service.ts`. Covering is about paid
orders; Phase 3's reasons (R-312's nine and the two above) are about sessions. Without it, a manual case on an
enrollment waiting for payment would change the late-payment rule: open, it would cover the on-time paid order, so
`confirm-enrollment` would do nothing for it (its step 1) and `expire-pending-payments` would not hand it on; closed, it
would make the enrollment's next paid order open a `duplicate_payment` case (step 3) instead of confirming it. One more
effect, intended: a second paid order on a confirmed enrollment whose only open case is a Phase 3 one now opens a
`duplicate_payment` case (FR-375) instead of joining a case about sessions. **Test** (`jobs/confirm-enrollment.spec.ts`,
`jobs/expire-pending-payments.spec.ts`, and a db-integrity spec over `caseInstantsAmong`): with a manual case open, and
again closed, on an enrollment awaiting payment, its paid order is confirmed (hold active) or takes the late branch as
with no case, the sweep hands an unconfirmed paid order on, and no `duplicate_payment` case opens; Phase 2's specs keep
their Phase 2 reasons, R-312's «one resolved and one dismissed case, the later closing winning» among them.

*The panel.* A dialog to open a case on `/cases` (the queue's action, its enrollment entered or taken from a case's
page) and on an enrollment in `/sessions` (pre-filled with it); beside each open remedy on `/sessions` (GAP-4), an action
to hand it to a case opens the same dialog with the remedy and `party: 'student'`. The dialog asks for the party and
the reason and sends an `idempotencyKey` minted when it opens, so a resent request joins the first answer.

*The notification's record.* The case's `disputes` row (its reason naming the party, its `created_at` the instant) and
the audit entry `case.opened_manually` are the durable record SRS FR-NOTIF-1's `compensation_case_opened` is read from;
a joined opening writes no row, so it tells nobody again.

**Window rule (R-320).** Nothing here offers a time: the hand-off releases the reserved times and books none.

## R-327 — A deleted account's files wait for its open disputes and cases

**Decided**, the owner, 2026-11-05 (SRS FR-AUTH-14 as amended; ADR 0015's amendment of 2026-11-05; ERD changelog row
24).

**Decision.** A deleted person's stored files, the profile photo (`users.photo_key`) and the verification documents
(`verification_documents`, identity and credential documents), are not removed while the person is a party (the
`student_user_id` or the `teacher_user_id`) to an enrollment with an open `disputes` row: a session dispute, a
compensation case or a complaint of a teacher's absence, the same three the chat's purge waits for (R-314, T039).
Everything else the deletion does at once is unchanged (ADR 0015 D3, FR-141 of `specs/002-identity/spec.md`): the
personal fields erased, every document marked `erased_at` in the deletion's transaction and unreadable from then on
(`readDocument` answers an erased document as none), the deleted row read by no ordinary query. Only the files and
their keys wait; rule 34 (a key never without `erased_at`) holds throughout. A held file is readable by one path only,
an administrator's inside an open matter of that enrollment (*The administrator's read*, below; **Decided**, the
owner, 2026-11-06).

*The condition, read without breaking R-API-6.* `disputes` is moderation's and `enrollments` booking's, and booking
imports moderation (ARCHITECTURE §4, Phase 3's graph). Booking's entry gains `heldFileOwnersAmong(tx, userIds)`: of
`userIds`, those who are a party to an enrollment (its own table) that moderation's entry, through a new
`enrollmentsWithOpenMatterAmong(tx, enrollmentIds)` (one read of `disputes` with `status = 'open'`, any kind), names. No
lock: the hold covers every matter open when a removal is attempted; a matter opened after a file was removed does not
bring the file back.

*The two places that remove a file ask it first.*

1. The deletion's own removal after its commit (`modules/identity/deletion.service.ts`, `#afterCommit`: the photo and
   each `FileErasure.eraseFilesOf`). Identity imports neither booking nor moderation, so it declares a port, `FileHold`
   (`filesHeld(userId): Promise<boolean>`, a new optional `DeletionDependencies` member), which `main.ts` binds to
   booking's `heldFileOwnersAmong`, as `EnrollmentSide` is bound (R-301). Held, the after-commit removes no file and
   clears no key; the Apple token's revocation and the mail go on as now. A teacher's deletion opens its
   `teacher_ended` cases in the deletion's own transaction (FR-483), so those already hold the files.
2. `apps/api/src/jobs/erase-deleted-files.ts` (hourly). `ErasedFile` gains `ownerUserId` (a document's `user_id`, the
   photo's user), and `EraseDeletedFilesOptions` gains `held(userIds): Promise<ReadonlySet<string>>`, which `worker.ts`
   builds from booking's entry: for each page, the owners held are asked once, and a held owner's files are skipped,
   neither removed nor reported (a hold is not an error); the page goes on in id order, so a held file never stalls
   the run.

*When the matters close.* No hook on the closing: the job's first run after the last open dispute, case or complaint of
the person's enrollments closes finds the owner no longer held and removes the files and clears the keys, as for a
removal that failed (within the hour). A closing that opens another matter (a dismissed `student_suspended` case opening
`student_fault_confirmed`, R-313) keeps the hold.

*The administrator's read* (**Decided**, the owner, 2026-11-06, amending the decision of 2026-11-05: SRS FR-AUTH-14,
ADR 0015's amendment, spec FR-487). Holding files nobody can read keeps personal data that serves as no evidence, so a
held file is readable by an administrator only inside an open matter of the enrollment that holds it, as the chat is
(`disputes.chat`, R-314), through a short signed link, each opening audited. Read against the code at `f905062`:

1. **One table, one key.** A session dispute, a compensation case and a complaint of a teacher's absence are all
   `disputes` rows, so the read is keyed by a `disputeId` of any kind whose `status = 'open'`, checked as
   `disputes.chat` checks it.
2. **Two administrator procedures** in sessions' admin router, beside `disputes.chat` (contracts/admin-surface.md):
   `disputes.heldFiles { disputeId }` answers metadata only, no link: per file its kind (the photo, or the document's
   `document_type`), its owner's role in the enrollment (student or teacher), its upload date where one is recorded
   (a document's `uploaded_at`; the photo records none) and a `fileRef`, `document:<documentId>` for a verification
   document or `photo:<userId>` for the deleted person's photo, stable across reads and never a storage key
   (**Decided**, the owner, 2026-11-06, on the fifth analysis, U4); only the files of a party of that
   dispute's enrollment who is deleted and whose keys are still held. A live party's documents are read through the
   existing `documents.link`. `disputes.heldFileLink { disputeId, fileRef }` mints one signed link per press, valid
   `document_link_ttl_seconds` (300, the existing setting, `prisma/seed.ts`; no new one), and is audited per press:
   the action `held_file.view`, the dispute as target, the `fileRef` in `after`, as `documents.link` records
   `document.view` (`modules/verification/documents.router.ts`). Both refuse once the dispute is not open; the link
   refuses a `fileRef` not held or not of that enrollment's deleted party (`NOT_FOUND`).
3. **The link's lifetime.** A link minted just before the matter closes lives at most `document_link_ttl_seconds`
   (300 s) after the close. Accepted: it is one administrator's audited press, and the file is removed by the
   `erase-deleted-files` run after the close (a link to a removed file answers nothing).
4. **The read, `readDocument` untouched.** `readDocument` (`modules/verification/verification.repository.ts`) stays as
   it is, so every other path still answers an erased document as none. Verification gains a separate reader for an
   erased document whose key is still held, used only by this path; identity's entry gains the same for a deleted
   person's held photo, over the repository the erase sweep already reads (`DeletedPhotosRepository`).
5. **A port, no new edge.** Sessions declares `DisputeHeldFiles` (`heldFilesOf(tx, userIds)`, `heldFileLink(tx,
   userIds, fileRef)`), bound in `main.ts` to verification's `createDisputeHeldFiles()`, which reads its own
   documents and identity's entry for the photo, as `DisputeChat` is bound to chat's (R-301, contracts/kernel.md "The
   composition root"). Sessions imports neither verification nor a table of another module (R-API-6); verification
   already imports identity (its entry) and, in this phase, sessions (R-301), and sessions imports neither, so no
   cycle forms. Sessions reads the dispute through moderation's entry and the enrollment's two parties through
   `EnrollmentSide`, and asks the port with those two ids; the port answers only a deleted owner's held files.

**Tests.** `jobs/erase-deleted-files.spec.ts`: a held owner's files are neither removed nor reported, the next page's
are; once `held` answers none, the next run removes them; the double-run spec unchanged (twice = once).
`modules/identity/deletion.service.spec.ts`: a held deletion removes nothing after its commit and still revokes and
mails; a deletion not held removes at once, as now. A db-integrity spec over the two entries: a deleted student with an
open `refund_choice` case, a deleted teacher whose deletion opened `teacher_ended` cases, a session dispute and a
complaint each hold; a closed case does not. The administrator's read (T040): `disputes.heldFiles` and
`disputes.heldFileLink` refused once the dispute is closed; a live party's file and another enrollment's refused;
one audit entry `held_file.view` per link; the metadata answers no link; the erase job's first run after the close
removes the file, and a link asked for it then answers `NOT_FOUND`.

**Risk.** A held file outlives the account by as long as its matter stays open: the retention policy (NFR-COMP-2,
OPEN-05) and the privacy policy must say so, with counsel, as ADR 0015's amendment notes.

**Window rule (R-320).** Nothing here offers a time.
