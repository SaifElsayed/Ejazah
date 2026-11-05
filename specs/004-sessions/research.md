# Research: Phase 3 — Live sessions

**Date**: 2026-11-05 · **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

Each decision below resolves a question the specification leaves to the plan. Numbered R-301 to R-321 so that a
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
| moderation | none |
| admin | any |

Sessions needs booking's enrollments (the snapshot's track, zone, length and count, the slot, the status) and must
write an enrollment's `completed` and `terminated_no_show`, but booking imports sessions. As Phase 2 did for catalog
(R-207), sessions declares the port it needs, `EnrollmentSide` (`sessions/enrollment-side.port.ts`), and `main.ts`
binds it to booking's `createEnrollmentSide()`: `enrollmentFor(tx, id)`, `lockEnrollments(tx, ids)`,
`terminateNoShow(tx, id)`, `complete(tx, id)`, `cancel(tx, id, 'admin')` (a suspended student's fault confirmed,
R-313), `slotWeekTaken(tx, slotId, localDate)` (held, or occupied by another
enrollment under R-205's release). Every function takes the caller's transaction and takes no lock it does not name.

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
| `createRoom(sessionId)` | `RoomServiceClient.createRoom({ name: sessionId, maxParticipants: 2, emptyTimeout, departureTimeout })` — idempotent (an existing room is answered); `maxParticipants: 2` holds FR-436 at the provider |
| `createSessionToken(sessionId, userId, { validUntil })` (widened) | `AccessToken` with `identity = userId` (an opaque UUID: LiveKit records identities in its logs, so no name), `ttl` ending at `validUntil`, grant `{ roomJoin: true, room: sessionId, canPublish: true, canSubscribe: true, canPublishData: false }`; no `roomCreate`, no `roomAdmin` |
| `endRoom(sessionId)` | `RoomServiceClient.deleteRoom(room)`, which disconnects both participants (FR-482, R-313); an ended room is not an error |
| `verifyAndParseParticipantEvent(rawBody, headers)` | R-303 |

`validUntil` is the session's scheduled end: LiveKit checks a token's expiry "only [on] the initial connection, and
not subsequent reconnects", and sends connected clients refreshed tokens itself, so the TTL bounds when a leaked token
can open a connection, and no number is added (R-MONEY-12). `emptyTimeout` and `departureTimeout` are the adapter's
own operation, kept in the kernel as the queue's retry numbers are (the magic-number gate covers `modules/`).

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

Ties at one second (LiveKit's resolution) sort `joined` before `left` for different connections and `left` before
`joined` for the same one. Properties (fast-check, as `packages/time` already uses): the result does not depend on the
events' order or on a duplicate; a reconnection never lowers simultaneous time; a left lost changes nothing past the
end. SC-402 is the spec that a disconnect and reconnection yields the sum of the overlaps.

The result is written once, by the evaluation, to `sessions.simultaneous_connected_seconds` as the figure the outcome
was decided on (**Decided**, the owner, 2026-11-05, plan.md decision 3; R-DB-4 names it, constitution 2.5.0).

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
`simultaneous_connected_seconds`, `evaluated_at`, one `session_events` row, and then the threshold and completion
checks (R-309). Run twice equals once (R-API-14). The same run ends the rooms of cancelled sessions still inside their
join period (R-313). R-SESS-3: the guard compares with the database's clock and never settles before the end plus the
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
session. In the same transaction as the record, each session the window overlaps that is already settled
(`done`, `*_no_show`, `under_threshold`), still inside its dispute window and not disputed moves to `provider_outage`
with one `session_events` row (FR-445); a session whose remedy was already offered is outside its dispute window, so
none is withdrawn (FR-462). A recorded window is not edited; a wrong one is answered by resolving its sessions.

**Rationale.** FR-445 and the owner's decision of 2026-11-05.

**Alternatives considered.** Inferring an outage from both participants dropping at once: a guess the SRS does not
allow (R-PROC-3).

## R-308 — A dispute freezes the outcome, which is kept beside the `disputed` status

**Decision.** `sessions.outcome_under_dispute` (new, nullable, data-model §2.1): raising a dispute moves `status` to
`disputed` and copies the outcome there in the same update; a dispute raised between the scheduled end and the
evaluation (the spec's edge case) leaves it NULL and the evaluation writes the automatic outcome into it rather than
into `status`. What counts while frozen reads `outcome_under_dispute`: progress counts it consumed when it is `done` or
`student_no_show` (`sessions/progress.ts` widens its `CONSUMED` read); no remedy is offered for it (R-311). The
threshold counts only settled `teacher_no_show` sessions, so a disputed absence never terminates an enrollment until
it is resolved (**Decided**, the owner, 2026-11-05, plan.md decision 7). Resolution writes the final status, clears the column, writes
`settled_by_admin_id` and `admin_settled_at`, and the dispute's `resolution`, `resolution_notes`, `resolved_by_admin_id`
and `resolved_at` (the database's `clock_timestamp()`, FR-422's rule).

The resolution maps to the session's final status:

| `disputes.resolution` | Final session status |
|---|---|
| `upheld` | the frozen outcome |
| `re_marked` | consumed → `done`; not consumed → `both_no_show` (no attribution, a make-up owed) |
| `no_show_recorded` | against the student → `student_no_show`; against the teacher → `teacher_no_show` |
| `compensation_ordered` | the frozen outcome; the decision recorded, no money moved (FR-DISPUTE-6) |
| `party_suspended`, `party_banned` | the frozen outcome; `StandingService` on the same transaction (FR-421) |

A dispute is raised over a session whose status is `done`, `student_no_show`, `teacher_no_show` or `both_no_show`, or
still `scheduled` past its end and unevaluated; one under review (`under_threshold`, `provider_outage`) is already
frozen for an administrator and answers `SESSION_UNDER_REVIEW`; a cancelled session answers `NOT_DISPUTABLE`, a
Cancelled-By-Agreement one being final at its acceptance (**Decided**, the owner, 2026-11-05, plan.md decision 5). A
dispute may be raised from the scheduled end, before the evaluation too (SRS FR-DISPUTE-1 as amended on 2026-11-05).
At most one open dispute per session (a partial unique, data-model §2.7).

**Rationale.** FR-DISPUTE-3, FR-DISPUTE-4, FR-473 to FR-476. The ERD's status enum keeps `disputed`; without a column
the frozen outcome would be lost.

**Alternatives considered.** Leaving `status` as the outcome and marking the dispute by its row: contradicts the ERD's
`disputed` status and the spec ("marks the session Disputed").

## R-309 — The threshold termination, and an enrollment's completion

**Decision.** After each settlement that can change it (the evaluation, a review or dispute resolution, an outage
reclassification), on the same transaction: count the enrollment's `teacher_no_show` sessions (derived, R-DB-4); at
`teacher_no_show_threshold`, cancel every remaining `scheduled` session `cancelled_by_admin` (make-ups included), hand
every open remedy to the case (`status = 'refund_case'`, its `case_id` the termination's case), set the enrollment
`terminated_no_show` through `EnrollmentSide.terminateNoShow` (an `enrollment_events` row `terminated_no_show`), and open
one compensation case `teacher_no_show_threshold` (FR-448).

Completion (FR-449) is checked by the same paths and by the remedy sweep (R-311): an enrollment is `completed` when
every session is settled and not frozen, no remedy is owed (none awaiting its offer, none open), and the last session's
dispute window has closed, and no `student_suspended` case is open on it (FR-486) (**Decided**, the owner, 2026-11-05,
plan.md decisions 4 and 1: otherwise a dispute could reopen what a completed enrollment
owes). Booking's occupancy then frees its slot from the week after the final session plus `slot_release_buffer_weeks`
(FR-423): R-205's rule reads `confirmed` only, so T026's nit 6 is fixed by counting `completed` with the same release
rule.

**Rationale.** FR-NOSHOW-3/4, FR-449, the notes under T026.

## R-310 — Cancellation requests

**Decision.** `sessions.cancellation.request` (either participant, a `scheduled` session whose start is in the future,
a reason of bounded length, idempotent), `.answer` (the counterparty, accept or decline), each deciding under the
session's lock (rule 1). At most one pending request per session: a partial unique index on `(session_id) WHERE status
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
(`teacher_no_show`, `both_no_show`), that has no remedy yet, is not disputed, and whose outcome is final: its dispute
window (`dispute_window_hours` after the scheduled end) has closed with no dispute, or an administrator resolved its
dispute (FR-462). A Cancelled-By-Agreement session is final at its acceptance and cannot be disputed, so its remedy is
offered in the acceptance's own transaction, not by the sweep: the one exception to the wait for the dispute window
(**Decided**, the owner, 2026-11-05, plan.md decision 5). The sessions a student's suspension cancelled are offered
theirs when the administrator closes the `student_suspended` case as cleared, in that transaction (R-313). The
`session_remedies` row is inserted at that moment (unique on `session_id`, so "recorded once"), with `offered_at` and
`choice_closes_at = offered_at + makeup_choice_window_days` fixed then, so a later change to the setting applies
prospectively (§3.14). Because no row exists before the offer, nothing is ever offered and withdrawn.

*The proposal* (FR-464, FR-466): the enrollment's weekly slot, in the snapshot's zone, in the first week after its last
session (make-ups and reservations included) whose occurrence starts no earlier than `choice_closes_at` +
`makeup_counter_answer_hours` (H1 of the owner's rule of 2026-11-05, R-320: a counter-proposal sent at the choice
window's last moment keeps the matter open until then), is not held or occupied by another enrollment
(`EnrollmentSide.slotWeekTaken`), and overlaps no session or reservation of the teacher or the student. Resolved per
occurrence by `packages/time` (R-TIME-2). Fixed at the offer and never moved: no counter-proposal's answer window ends
after it. Recitation after a Teacher-No-Show: `status = 'awaiting_choice'`, the proposal shown with the refund;
otherwise `proposed`.

*The student* (before `choice_closes_at`): accepts the proposal → it is booked, and a counter-proposal still pending is
withdrawn and its time released (the owner's approval of 2026-11-05); chooses a refund (recitation, Teacher-No-Show
only, and only from `awaiting_choice`) → `refund_case`; counter-proposes one of the teacher's active slots of the
session's length on a date offered by `sessions.remedy.counterOptions`, which lists only occurrences starting no
earlier than the later of now + `makeup_counter_answer_hours` and `choice_closes_at` (H2; decision 14 (i)) and free for
both parties → `counter_proposed`, the `counter_*` columns and `counter_answer_closes_at` = now + the answer window
fixed. One counter-proposal pending at a time (`COUNTER_PENDING`); a counter-proposal is the student's choice of a
make-up, so after a decline the remedy is `proposed`, not `awaiting_choice`.

*The teacher* (before `counter_answer_closes_at`): accepts → the counter is booked; declines → while the choice window
is still open, the remedy returns to `proposed`, the counter's time is released and the student may accept the
proposal or counter-propose again, from options read again under H2 (H4); once the choice window has closed, the
system's proposal is booked at once (**Decided**, the owner's rule of 2026-11-05, plan.md decision 9, which replaces
both earlier options).

*Windows ending* (`advance-remedies`): `proposed` or `awaiting_choice` past `choice_closes_at`, with no counter-proposal
pending → the proposal is booked (H5, FR-MAKEUP-4); `counter_proposed` past `counter_answer_closes_at`, whether the
choice window is open or closed → refund on either track: one compensation case `counter_unanswered` with no amount
(FR-465, FR-467). A `counter_proposed` remedy past `choice_closes_at` waits for its answer window; the worst case is the
choice window plus one answer window (7 days + 72 hours).

*History.* `session_remedies` holds the current pending counter-proposal only: the `counter_*` columns are set exactly
while `status = 'counter_proposed'` and cleared at the decline, the withdrawal or the hand-off to a case. Every
counter-proposal, with its slot, date, time and zone, is kept on its `session_events` row (`counter_proposed`), and its
end on another (`counter_accepted`, `counter_declined`, `counter_withdrawn`, `remedy_handed_to_case`) (R-315).

*Reservation* (FR-466, H3). No row reserves a time: the system's proposal, from the offer until the remedy settles
(booked, or handed to a case), and a pending counter-proposal, during its answer window, are read as occupied by every
path that places a session or a hold — `checkout.hold` and `booking.slots` (booking's one overlap check), the make-up
proposal and counter options, and a make-up's booking — through `sessions`' `reservedTimesOf(tx, userIds, window)`,
each path holding both accounts' locks first (T005 rule 2), so a reservation and a hold of the same people serialise.
A counter's time is released at its decline, its withdrawal or its window's end. The database's exclusion constraints
remain the second line for every real session (FR-468). **Decided** (the owner, 2026-11-05, plan.md decision 2): in
code, not with a session row.

*Booking a make-up* (FR-469, FR-423): lock both accounts, the teacher's slots' key, the slot, the enrollment, the
session and the remedy (in that order), read again, insert one session `scheduled` with `sequence_number` = last + 1,
`makeup_for_session_id`, the local date, start and zone as the fact and the instants from `packages/time`; the
remedy `booked`, `decided_at`. An exclusion refusal (`isExclusionViolation`) rolls back, leaves the remedy open and
reports it; the sweep tries again on its next run and, past the window, the remedy waits for an administrator in the
compensation queue (`makeup_refused`, a reason the case list shows).

**Rationale.** FR-462 to FR-469, ADR 0018 D2 to D4, the clarifications and the owner's decisions of 2026-11-05.

**Alternatives considered.** A remedy row at settlement with an "awaiting offer" state: needs a withdrawal when a
dispute removes the debt, which FR-462 forbids. Reserving with session rows: database-enforced, but a provisional
session in every list, a sequence number that may be abandoned, and a new session status. Booking the proposal at once
on a decline while the choice window is open (ADR 0018 D3's first "falls back"), and keeping each counter-proposal on
the remedy row: both replaced by the owner's rule of 2026-11-05.

## R-312 — Compensation cases: the new reasons, and closing one

**Decision.** `COMPENSATION_REASONS` (`moderation/compensation-case.service.ts`) gains `teacher_no_show_threshold`,
`admin_cancellation`, `teacher_ended` (a teacher's suspension, revocation, ban or deletion), `student_suspended`,
`student_banned`, `refund_choice`, `counter_unanswered` and `makeup_refused`. One open case per enrollment and reason
stays the rule, so two refunds on one enrollment join one case; which sessions a case covers is the remedies whose
`case_id` names it, plus, for a termination or an account's end, the sessions it cancelled (read from
`session_events`). Moderation gains `closeCase(tx, caseId, { status: 'resolved' | 'dismissed', note, adminId })`: lock
the enrollment's row first (`lockRows`), then one conditional update `WHERE status = 'open'` writing `status`,
`resolution` (`compensation_ordered` for resolved), `resolution_notes`, `resolved_by_admin_id` and `resolved_at =
clock_timestamp()` together (FR-422, the note under T082), with the specs that note asks for: a race with a paid event,
and one resolved and one dismissed case on one enrollment, the later closing winning in `caseInstantsAmong`. A
`student_suspended` case's closing carries its effect on the same transaction (R-313, plan.md decision 1): resolved is
the student cleared (the make-ups offered), dismissed is the fault confirmed (the enrollment cancelled `admin`).

## R-313 — When an account ends: T059, a teacher's end and a student's (002:T144)

**Decision.** Booking's `terminationSubscriber` (already subscribed to identity's `AccountConsequences`) gains the
confirmed part, on the action's transaction, after the account's lock the action already holds:

| Cause | Account | Sessions | Confirmed enrollments | Case |
|---|---|---|---|---|
| `account_deleted` | student | remaining `cancelled_by_admin` | `cancelled`, `account_deleted` | none (T059) |
| `account_deleted` | teacher | remaining `cancelled_by_admin` | `cancelled`, `account_deleted` | one per enrollment, `teacher_ended` (T059) |
| `suspended`, `approval_revoked`, `banned` | teacher | remaining `cancelled_by_admin` | `cancelled`, `teacher_suspended` | one per enrollment, `teacher_ended` (FR-483) |
| `suspended` | student | upcoming `cancelled_by_admin` | stay `confirmed`, keep their slot, cannot complete while the case is open (**Decided**, the owner, 2026-11-05, plan.md decision 1 (b)) | one per enrollment, `student_suspended` (FR-486) |
| `banned` | student | upcoming `cancelled_by_admin` | `cancelled`, `admin`, at once (**Decided**, plan.md decision 1 (a)) | one per enrollment, `student_banned`, nothing owed by default (FR-486) |

Open remedies of the enrollments cancelled are handed to the case. Sessions are cancelled through the sessions entry
(`cancelRemainingSessions(tx, enrollmentIds, now)`), never booking's own write. Lock order: the account (held), the
teacher's slots' key, the enrollments in id order, their sessions, their remedies; no row referencing an account is
written (the case's `raised_by_user_id` is NULL, `session_events` reference the enrollment and the session).

A suspended student's enrollment stays `confirmed`. A remedy already open on it at the suspension (offered before it,
its choice window still running) is rare and is not decided here; it is listed for the owner. The `student_suspended`
case is closed by the administrator one of two ways, under FR-422's lock rule:

- **Cleared** (`cases.resolve`): allowed only once the student's account is active again (`students.reinstate`), since
  a suspended account answers no remedy; in the same transaction each session the suspension cancelled is offered the
  remedy FR-MAKEUP-2 gives. Read exactly, none of them is a Teacher-No-Show, so on either track it is a make-up
  session (`proposed`), placed as R-311 places every make-up, a counter-proposal left unanswered becoming a refund.
- **Fault confirmed** (`cases.dismiss`): the enrollment is cancelled with the reason `admin` through
  `EnrollmentSide.cancel(tx, id, 'admin')` (an `enrollment_events` row `cancelled`), its open remedies handed to the
  case, and booking's occupancy frees its slot.

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
in `docs/RUNBOOK.md`; the session being cancelled, nothing such a room records counts. A post-commit hook in identity's registry
would make it immediate but changes identity's contract for one call; the minute is the plan's reading of "removed".

## R-314 — Chat, its documents, and its purge

**Decision.** `chat.list` (newest first, keyset pages of `chat_page_size`), `chat.send` (text, `rate_limit_chat_message`,
idempotent), and the document upload as a third use of the upload route (`surfaces/upload-route.ts`), kind `chat`,
`POST /uploads/chat`, fields `enrollmentId` and `filename`, under `rate_limit_upload` and `upload_max_bytes`. Both
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
session's scheduled end + `dispute_window_hours` + `chat_retention_days` has passed, with no open dispute, compensation
case or (from Phase 4) report, null each message's body and attachment fields, set `purged_at`, and remove the stored
files after the commit (a failed removal retried, as `erase-deleted-files` does). An administrator reads the chat only
through `disputes.chat` while that dispute is open, each read audit-logged (FR-475).

**Sources.** [WHATWG MIME Sniffing, binary data byte](https://mimesniff.spec.whatwg.org/#binary-data-byte); the kernel's
sniffer (`platform/guards/upload.middleware.ts`, T104).

## R-315 — Every event is a durable row

**Decision.** A new append-only table `session_events` (sessions', data-model §2.4) records each session-level event
FR-495 names (settled, no-show recorded, cancellation requested, accepted, declined, expired, cancelled by an
administrator, remedy offered, counter-proposed, counter accepted, declined or withdrawn, make-up booked, handed to a case,
dispute raised, dispute resolved, review resolved, outage reclassified); `enrollment_events` (booking's) gains the kinds
`completed` and `terminated_no_show`. Phase 4's notifications read both and change nothing here. The screens are the
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
plan.md decision 8: every one an admin setting, SRS §3.14 rows). The rest exist (seed lines 89–147).

## R-318 — The administrator's surfaces

**Decision.** As Phase 2's monitor (R-220): each module's admin router mounted on `adminRouter`, every procedure an
`adminProcedure` (second factor), every call one audit entry, reads included. `sessions`: the enrollment and session
monitor (FR-479), the session review queue (FR-477), the cancellation of a session (FR-460), the outage windows
(FR-445), the disputes queue and its resolution (FR-475, FR-476). `chat`: `disputes.chat`'s read. `moderation`'s
primitives under an admin router in `sessions` for cases (`cases.list/get/resolve/dismiss`), since a case's page names
the sessions and remedies it covers, which moderation cannot read (R-301). `identity`: `students.*` (R-313); the
verification module's `users.get` gains the cancellation-request counts (FR-459). The panel's pages: `/sessions`,
`/review`, `/disputes`, `/cases`, `/outages`, the user record's counts.

## R-319 — What the carried tasks ask of this plan

**Decision.** T059 (FR-420) lands in the first batch with the sessions entry's `cancelRemainingSessions` it needs.
`002:T144` is named here and lands with the student's suspension, B34 (FR-421). T107 lands in the first batch, before
the video webhook (B35). T090 lands in B34: a deleted party answers `displayName: null` with `deleted: true`
additively (R-API-9) on Phase 2's lists and every Phase 3 output naming a party, and the phone shows the stand-in key
(FR-426). The notes under T026 land with the make-up booking (R-311) and completion (R-309); the note under T082 with
`closeCase` (R-312). T079 and T080 land in the first batch, B33 (**Decided**, the owner, 2026-11-05,
plan.md decision 10): one `testTimeout` and `hookTimeout` of 30 s for `tests/db-integrity`, the `node` project at 5 s
with file-level timeouts for its three heavy specs, and a per-run prefix on each adversarial world's names. The rest of the Not-scheduled row stays where it is: none of its tasks is a precondition of a
Phase 3 requirement; T099 (the booking sheet's empty-state cause) and T093 (a link to no enrollment) touch screens this
phase edits and are listed for the owner, not timed.

## R-320 — No time is offered that starts before the matter could still be decided

**Decision.** The owner's rule of 2026-11-05: wherever a choice waits on a window, no time is shown or offered that
starts before that window can end, as booking hides a slot whose first session falls within
`first_session_lead_hours`; for a make-up, neither the system's proposal nor any counter-proposal may start before the
matter could still be decided (the owner's decision 9, H1 to H5, plan.md). Applied by the server (the screens render
what it answers, R-MOBILE-12), with a spec each:

| Where | Window (setting, default) | Hidden |
|---|---|---|
| The system's make-up proposal (H1) | the choice window, `makeup_choice_window_days`, 7, plus one answer window, `makeup_counter_answer_hours`, 72 | any week whose occurrence starts before `choice_closes_at` + 72 h; the proposal is fixed at the offer and never moves |
| The counter-proposal's options (H2), read again after each decline (H4) | the answer window, 72 h from now, and the choice window | any occurrence starting before the later of now + 72 h and `choice_closes_at` |
| A refund-or-make-up choice (recitation) | the choice window, 7 days | the proposal shown beside the refund obeys the first row |
| A cancellation request | until the scheduled start (FR-CANCEL-4) | no request on a session already started; the request shows its expiry at the start; no minimum notice (decision 14 (ii)) |
| A reserved proposal or counter, to others (H3) | the proposal from the offer until the remedy settles; a pending counter during its answer window, released at decline, withdrawal or the window's end | the reserved occurrences are hidden from `booking.slots` and refused by `checkout.hold` for the same teacher or student |

## R-321 — Locks, contracts and gates

**Decision.** T005's two rules hold (Saif reviews every lock and FK-insert path against them). `LockedTable` widens to
`sessions`, `session_remedies`, `cancellation_requests` and `disputes`, and the one order becomes: `users`,
`teacher_profiles`, the teacher's slots' key, `availability_slots`, `slot_holds`, `enrollments`, `sessions`,
`session_remedies`, `cancellation_requests`, `disputes`, `payments` (data-model §5). Every procedure declares
`.output(schema)`; the contract snapshot is additive and passes `pnpm contract:snapshot --check --base origin/develop`
(R-API-9). The boundary rule `boundaries/no-money-vocabulary` already covers `modules/sessions` and is extended to
`modules/chat`; a CI test proves no `_piasters`, price or payment reference in either (FR-497, SC-409). R-SESS-2, R-SESS-4
and R-SESS-5's CI tests land with the code they hold (the constitution's enforcement map, "Phase 3"). The coverage floor
widens to `modules/chat`. The adversarial suite gains every procedure of this phase that issues a token or reads a
session, its chat or its counterparty (FR-496), and the video stand-in harness is the only producer of video events in
the suite, as the gateway's is (contracts/video.md).
