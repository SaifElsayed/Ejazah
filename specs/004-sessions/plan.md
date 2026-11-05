# Implementation Plan: Phase 3 — Live sessions

**Branch**: `004-sessions` (the cycle runs on `Ejazah_app/003-booking/T106`; the implementation batches are `Ejazah_app/004-sessions/<task ids>`) | **Date**: 2026-11-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-sessions/spec.md`, approved by the owner on 2026-11-05 with its Clarifications

## Summary

Let a student and a teacher meet in a one-to-one room on their phones, with a token only the server mints, only for
them, only inside the join period; record who was connected from the provider's signed webhooks alone; settle every
session after its end by a scheduled job into one of SRS §3.7.5's outcomes; and carry what follows — the teacher's
absences and the termination at the threshold, cancellation by agreement, a make-up or a refund case for a session not
consumed, disputes, the administrator's queues, the consequences of an account's end, and the chat — with no path that
computes, holds or moves an amount. One person, seven working days from D17 (2026-11-08) to D23 (2026-11-16), reviewed
by Saif's review session; the first batch lands T059 and T107.

The technical approach, from [research.md](./research.md), rests on seven decisions:

1. **Sessions owns the machine; booking's data comes through a port.** Sessions declares `EnrollmentSide` and `main.ts`
   binds it to booking, as Phase 2 bound catalog's `CatalogUse` (R-301); booking's existing termination subscriber
   carries the account-end consequences (R-313).
2. **LiveKit behind the unchanged port.** `livekit-server-sdk` 2.19.2; room named for the session, two participants at
   most; a token per participant valid to the scheduled end; Daily renamed out everywhere ADR 0003 lists (R-302).
3. **The webhook only records.** `POST /webhooks/video` verifies LiveKit's signed JWT over the raw body before any
   handler and inserts one row per provider event id, keyed by connection so order and duplicates do not matter
   (R-303, R-304).
4. **A sweep settles, every minute, from the events.** Attendance is computed at evaluation by interval operations in
   `packages/time` and written once; the outage windows an administrator records take precedence (R-305 to R-307).
5. **A dispute freezes the outcome beside the `disputed` status** (R-308); the threshold and completion are checked by
   every path that settles (R-309).
6. **A remedy exists only once it is owed for good.** It is offered when the outcome is final, its proposal and a
   counter-proposal are reserved in code under the accounts' locks, and no time is offered that starts before the
   window it waits on (R-311, R-320, the owner's rule of 2026-11-05).
7. **Every event is a row.** `session_events` and two new kinds of `enrollment_events`, so Phase 4's notifications read
   them with no change here (R-315).

Scope is the SRS ids PLAN.md lists for Phase 3, FR-420 to FR-499 and SC-401 to SC-414 of the spec, the carried tasks
(T059, `002:T144`, T090, T107, the notes under T026 and T082), and nothing else. Reviews, reports, notifications,
reminders, certificates and gender disputes are Phase 4's; T104 and T105 are out of scope and nothing is added for them.

## Technical Context

**Language/Version**: TypeScript 5.x `strict` on Node 24, as Phases 0 to 2 pinned them.

**Primary Dependencies**: Everything Phases 0 to 2 chose. New on the API: `livekit-server-sdk` 2.19.2 (R-302). New on
the phone: `@livekit/react-native` 3.1.0, `@livekit/react-native-webrtc` 150.1.0, `livekit-client` 2.23.0,
`@livekit/react-native-expo-plugin` 1.1.0, `@config-plugins/react-native-webrtc` 15.0.2 (R-316). Each pinned exactly by
the task that installs it, at least fourteen days old on 2026-11-05. No paid service: LiveKit Cloud's free Build plan.

**Storage**: PostgreSQL 18; forty-four tables after this phase (two new: `session_events`, `provider_outages`), one
forward migration ([data-model.md](./data-model.md) §6); Redis for the limiter and the queue (four new sweeps; nothing
in Redis is the only record of an outcome); the storage port for chat documents.

**Testing**: Vitest; `tests/db-integrity` for rules 40 to 47 and every new lock path; the adversarial suite for every
procedure that issues a token or reads a session, its chat or its counterparty (FR-496); the video stand-in harness as
the only producer of video events (contracts/video.md); double-run specs for the four new jobs; properties over the
interval operations in `packages/time`; the owner's device runs (quickstart §4). **Every run is on `ijazah_integrity`
only** (both URLs checked, `IJAZAH_DB_SPECS=1`), never on `ijazah`.

**Target Platform**: Two Android phones through the development build (ADR 0003's spike phones); evergreen browsers for
the panel; Linux containers for the API and the worker; no staging (Phase 6).

**Project Type**: The three applications of Phase 0; this phase fills `sessions` (the whole machine) and `chat`, and
widens `moderation`, `booking` (the port and the subscriber), `identity` (a student's standing) and the panel.

**Performance Goals**: A participant pressing join is in the room within ten seconds in at least nine of ten attempts
on 4G (SC-414); a session with no final event settles within the evaluation delay plus one minute (SC-403).

**Constraints**: No amount anywhere in this phase (FR-497, T104, T105); every number a setting (R-MONEY-12); no date
arithmetic outside `packages/time` (R-TIME-1); attendance only from signed provider webhooks (R-SESS-1); every
suspension and ban through `StandingService` (FR-421); T005's lock rules for every lock and FK-insert path; the owner's
window rule of 2026-11-05 (R-320); requirements from the SRS, not the boards; seven working days for one person,
overflow stated when it happens and sent to the descope ladder, whose Phase 3 rung is in-session file sharing.

**Scale/Scope**: FR-420 to FR-499, SC-401 to SC-414; 1 migration, 2 new tables, 10 columns, 8 integrity rules, 5
settings rows; 13 user-surface procedures and an upload route, 19 administrator procedures and one widened
([contracts/](./contracts/)); 4 jobs; one webhook; the pre-session and room screens, the session, cancellation, remedy,
dispute and chat states on both roles' enrollment screens, and five panel pages.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design._

| Rule family | This phase's own compliance | Mechanism delivered here | Gate |
|---|---|---|---|
| R-MONEY | No amount, share, commission, refund path or balance; a refund is a case with no amount (FR-467); sessions and chat reference no payment (FR-497); every number a setting, five new rows | `no-money-vocabulary` extended to `modules/chat`; the boundary test of SC-409 | **PASS** |
| R-TIME | Make-ups store local date, start and zone and derive instants (FR-469); interval arithmetic in `packages/time` (R-305); attendance instants are the provider's; the outage window entered as local fields (R-307); every time shown twice (FR-494) | Interval operations with properties | **PASS** |
| R-GENDER | The join checks gender from the server's records under the accounts' locks; a token bound to one session and one participant (`bindJoinToken`); every refusal to a non-participant is `NOT_FOUND` | R-GENDER-7's CI gate: token replay and cross-gender cases (FR-496, SC-407) | **PASS** |
| R-MOBILE | Every screen from its board as decided; strings from the catalogue with T123's marks; later phases' controls absent (no review, no report); the components render what the server decided (R-320's windows are the server's) | None new | **PASS** |
| R-API | Thin routers; services decide; one inverted port (R-301); every procedure with both schemas; additive snapshot; the port speaks the domain (`createSessionToken`, `endRoom`) | The widened lock union and refusal names (contracts/kernel.md) | **PASS** |
| R-DB | One forward migration; two append-only tables with their revokes; checks for every cross-field rule (rules 40 to 47); no stored count; no speculative index | Rules 40 to 47 | **PASS**, with decision 3 (`simultaneous_connected_seconds` and R-DB-4) |
| R-SEC | The webhook verifies before any handler; chat documents by content, images refused by content and extension; signed expiring links; chat under a rate limit; no token, secret or body logged | The `chat` upload kind; the image corpus test (R-SEC-5) | **PASS** |
| R-SESS | Attendance from webhooks only (1); evaluation by a sweep after end + delay (2, 3); reconnection sums (4); restricted teacher refused (5); no automatic exit from review (6) | The enforcement map's Phase 3 CI tests for R-SESS-2, 4 and 5 | **PASS**; R-SESS-2's "+ 2m" becomes a setting of default 2 (proposal P2) |
| R-HONEST | No session shown done unless the job or an administrator settled it; the teacher sees none of the student's private fields; nothing implies the platform refunds (the case is Platform Administration's) | None new | **PASS** |
| R-PROC | Spec, clarification and plan precede code; every rule the spec left open is an owner decision below, not a keyboard rule (R-PROC-3) | The coverage floor widened to `modules/chat` | **PASS** |

**Review-only tier.** Live in this phase: R-API-5 (the port's widening, R-302), R-DB-4 (decision 3), R-DB-9 (two
partial uniques that are integrity rules, no other index), R-PROC-3 (the owner decisions below), R-MOBILE-3 (whether the
chat and room screens are shared between the roles), R-MOBILE-12 and R-MOBILE-14 (the new screens).

**Gate result: PASS.** No unjustified violation; four structural costs are in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/004-sessions/
├── plan.md              # This file
├── spec.md              # Feature specification, approved 2026-11-05
├── research.md          # Phase 0 output — 21 decisions (R-301 to R-321)
├── data-model.md        # Phase 1 output — 2 tables, 10 columns, rules 40–47, 5 settings rows, 1 migration
├── quickstart.md        # Phase 1 output — validation guide, the device runs marked as the owner's
├── contracts/
│   ├── README.md
│   ├── app-surface.md   # 13 user procedures, the chat upload route, Phase 2's lists widened
│   ├── admin-surface.md # 19 administrator procedures and `users.get` widened
│   ├── video.md         # The port as called, the webhook, the LiveKit adapter, the stand-in harness
│   └── kernel.md        # Locks and refusals, the composition root, the jobs, the gates
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Written by /speckit-tasks
```

### Source Code (repository root)

Only what this phase adds or first fills.

```text
apps/
├── mobile/src/
│   ├── app/(student)/sessions/[id].tsx · room.tsx         # pre-session, room
│   ├── app/(teacher)/sessions/[id].tsx · room.tsx
│   ├── app/(student)/enrollments/[id]/chat.tsx · app/(teacher)/students/[enrollmentId]/chat.tsx
│   ├── features/student/sessions · remedies · chat         # cancellation, dispute, choice, counter
│   ├── features/teacher/sessions · chat                     # cancellation answer, counter answer, dispute
│   ├── features/shared/room/                                # only if identical for both roles (R-MOBILE-3)
│   └── lib/livekit.ts                                       # registerGlobals, the audio session
├── admin/src/pages/sessions · review · outages · disputes · cases  # and the user record's counts
└── api/src/
    ├── modules/
    │   ├── sessions/   join, session read, video-webhook.controller, attendance.rules, evaluation, termination,
    │   │               completion, cancellation, remedies (offer, proposal, counter, booking), disputes, outages,
    │   │               session-events, enrollment-side.port, the admin routers (monitor, review, outages, disputes, cases)
    │   ├── chat/       messages, the upload handler, attachment links, purge store, the dispute read
    │   ├── moderation/ the new reasons, openSessionDispute, closeCase, resolveSessionDispute
    │   ├── booking/    createEnrollmentSide, the widened termination subscriber, reservations in the hold and slots
    │   └── identity/   StandingService.suspendStudent/banStudent/reinstateStudent, the students router
    ├── platform/
    │   ├── db/         row-lock (four tables), db-errors (four names), db-clock
    │   ├── guards/     upload kind `chat` (PDF, UTF-8 text)
    │   ├── config/     LIVEKIT_* keys, VIDEO_PROVIDER `livekit`
    │   └── ports/video/livekit.adapter.ts; the port and stand-in widened
    └── jobs/           evaluate-sessions, advance-remedies, expire-cancellation-requests, purge-chat

packages/
├── time/src/           interval operations (R-305)
└── contracts/src/      sessions, chat; admin/sessions, admin/disputes, admin/cases, admin/students

prisma/schema · prisma/migrations · prisma/seed.ts   # data-model §2 and §6
tests/
├── adversarial/        Phase 3's procedures, token replay
├── db-integrity/       rules 40–47, the lock paths, reservations against holds
├── fixtures/chat-corpus/
└── support/video-stand-in.ts                         # the only producer of video events
```

**Structure Decision**: The twelve modules of Phase 0, with the graph of research R-301: `sessions` gains imports of
`identity`, `moderation` and `catalog`; `booking` of `moderation`; `chat` of `booking` and `moderation`; `moderation`
still imports none, so a case's page, which names sessions and remedies, is served by sessions' admin router.
Sessions' need of booking's enrollments is a port bound in `main.ts` (`EnrollmentSide`), the third inverted dependency
after R-207's `CatalogUse` and R-219's subscriber. The video webhook is sessions' raw-body route, as the gateway's is
payments'.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Two new tables (`session_events`, `provider_outages`) against ERD §0's "a table that isn't here is out of spec" | The spec names the outage window as new (FR-445); FR-495 asks a durable record of every event with its session, which `enrollment_events` (booking's, no session column) cannot hold without sessions writing booking's table | Widening `enrollment_events` through the port (decision 6); a window held in settings (an operational number, not evidence) |
| A third inverted dependency (`EnrollmentSide`) | Sessions must read the snapshot and write two enrollment statuses; booking already imports sessions | A thirteenth orchestration module; moving the machine into booking against ARCHITECTURE §4 |
| Reservations held in code under locks, not by the database | FR-466 reserves a proposal and a counter for days; a database guard would need a reserved session row or a new instant cache (an ADR, R-DB-4) | A provisional session row (decision 2): database-enforced but visible in every list and numbering |
| `connection_ref` and a nullable `user_id` on an append-only table | LiveKit gives no ordering guarantee and may replace a connection under one identity; the room-ended event has no participant (FR-443) | Pairing by identity in arrival order: wrong under replacement and reordering |

## Batch plan (D17 to D23)

At most six items each, in the order the work depends on; one branch, one pull request, one review by Saif's review
session, which checks every lock and FK-insert path against T005's rules. The days are the phase's working days 17 to
23. The items become task ids when `/speckit-tasks` runs; carried tasks keep their ids. Inside a batch, independent
items run as parallel lanes (the owner's decision of 2026-10-26).

| Day | Batch | Items | What |
|---|---|---|---|
| D17 Sun 11/8 | B33 | T107; T079/T080 (decision 10); the sessions pass migration, seed and ERD v1.15; the kernel's locks, refusal names and clock; `packages/time`'s interval operations; T059 with sessions' `cancelRemainingSessions` and moderation's new reasons | The carried tasks the spec puts first (FR-420; the constitution before the webhook), and the foundations every later batch reads |
| D17 Sun 11/8 | B34 | `002:T144` (a student's suspension, ban and reinstatement through `StandingService`, FR-486); a teacher's end (FR-483); T090 (FR-426); the `EnrollmentSide` port; the LiveKit adapter with the Daily rename and the port's widening (FR-425, quickstart §3); the video stand-in harness | Every account's end before any session can be joined; the provider behind the port |
| D18 Mon 11/9 | B35 | `sessions.get` and `sessions.join` with their adversarial cases; `POST /webhooks/video`; the attendance rules and `evaluate-sessions`; the threshold, completion and event rows; the outage windows; the R-SESS CI tests | US1's API and US2 whole (SC-402 to SC-407) |
| D18 Mon 11/9 | B36 | The LiveKit packages and the development build on the owner's phone; the pre-session screen; the room screen; the session statuses on both roles' enrollment screens | US1 on the phone; the first device check of joining |
| D19 Tue 11/10 | B37 | Cancellation requests and their expiry sweep; the administrator's cancellation and the monitor; the user record's request counts; raising a dispute | US3's API, US5's first half |
| D19 Tue 11/10 | B38 | The remedy offer and proposal; the student's choice, acceptance and counter options (R-320); the teacher's answer and the windows' ends; the make-up's booking and the slot's release (the notes under T026); refund cases; booking's reservation reads | US4's API |
| D20 Wed 11/11 | B39 | The disputes queue and its resolution; the review queue and its resolution; the compensation-case queue and `closeCase` (the note under T082) | US5's administrator side |
| D20 Wed 11/11 | B40 | Chat messages and the rate limit; the chat upload kind and attachment links (SC-408); `purge-chat`; the dispute's chat read | US7's API |
| D21 Thu 11/12 | B41 | The phone: cancellation and dispute on both roles; the remedy sheets (choice, proposal, counter, the teacher's answer); chat on both roles; the ended tab's new statuses | US3, US4, US5 and US7 on the phone |
| D22 Sun 11/15 | B42 | The panel: `/sessions` with cancellation; `/review` and `/outages`; `/disputes` with the chat; `/cases`; a student's standing and the request counts | The administrator's pages |
| D23 Mon 11/16 | B43 | The adversarial suite's completeness and the gates (FR-496, FR-497); the coverage floor; the document pass (ERD, SRS §3.14, ARCHITECTURE, RUNBOOK, jobs README); quickstart §1 to §7; the owner's device run (SC-401, SC-414); the close | The proofs; the same day, Phase 4's Spec Kit cycle (PLAN.md's rule) |

The Not-scheduled row of `specs/003-booking/tasks.md` was reviewed (research R-319): it stays as it is; T079 and T080
are timed by decision 10.

## Decisions for the owner

Ranked by how much of the plan they move. The plan is written on each recommendation; a different answer changes the
named research decision and data-model section only.

1. **A student's suspension or ban: the confirmed enrollments, and reinstatement.** FR-486 cancels the sessions and
   opens a case but says nothing of the enrollment, and FR-ADMIN-5 says "suspend or reinstate". Left `confirmed` with
   every session cancelled, the enrollment would become `completed` (FR-449). *Recommend:* (a) enrollments `cancelled`
   with the reason `admin`, a reinstatement restoring the account only, the case deciding what a cleared student gets.
   (b) Enrollments left `confirmed` and excluded from completion while a `student_suspended` case is open. (c) No
   reinstatement of a student in this phase. (R-313)
2. **How a make-up proposal and a counter-proposal are reserved.** *Recommend:* (a) in code, every placing path reading
   the reservations under both accounts' locks, the database's exclusions guarding real sessions. (b) A provisional
   session row (a new status) that the exclusions guard: database-enforced, but visible in every list and numbered.
   (R-311)
3. **`sessions.simultaneous_connected_seconds` and R-DB-4.** The ERD has the column; R-DB-4 lists no such cache.
   *Recommend:* (a) write it once, at evaluation, as the figure the outcome was decided on, and say so in the ERD and
   R-DB-4. (b) Store nothing; compute on every read (the admin's figure then moves with late events). (R-305)
4. **When an enrollment completes.** *Recommend:* (a) after the last session's dispute window has closed, so a dispute
   cannot reopen what a completed enrollment owes. (b) At the last settlement, as FR-449 reads literally, a later
   dispute owing a remedy on a completed enrollment. (R-309)
5. **Is a Cancelled-By-Agreement session final at acceptance?** FR-462 offers a remedy once the dispute window closes.
   *Recommend:* (a) yes: both agreed, nothing can be disputed, the make-up is offered at once. (b) The literal reading:
   the make-up waits until the scheduled end plus 72 hours (the plan's current text). (R-311)
6. **Where the event rows live.** *Recommend:* (a) a new `session_events` table, sessions'. (b) `enrollment_events`
   widened with a `session_id` and the kinds, written by sessions through the port. (R-315)
7. **Does a disputed Teacher-No-Show count toward the threshold?** *Recommend:* (a) no, until resolved; the resolution
   re-checks. (b) Yes, as frozen (a termination a later resolution cannot undo). (R-308)
8. **Numbers the spec does not fix.** The chat message rate limit's default (FR-491 names the row), the chat page size,
   and FR-459's "recent period". *Recommend:* 30 messages per 60 s, 50 messages a page, 30 days. Options: other values;
   for the page size, reuse `admin_list_page_size`. (R-317)
9. **A declined counter-proposal.** *Recommend:* (a) the system's proposal is booked at once (ADR 0018 D3 "falls back").
   (b) The student keeps the rest of the choice window to accept or counter again. (R-311)
10. **T079 and T080.** *Recommend:* (a) `tests/db-integrity` takes one `testTimeout` and `hookTimeout` of 30 s (the
    `rule-sets.spec.ts` precedent), the `node` project keeps 5 s with file-level timeouts for its three heavy specs, and
    each adversarial world's names carry a per-run prefix so worlds never match each other's excluded names (T079's
    first cause). (b) The timeout only. (c) Leave both Not scheduled. (R-319)
11. **Chat after the enrollment ends.** *Recommend:* (a) read-only until the purge. (b) Sending allowed until the purge
    (FR-SESS-6 "until the chat retention expires"). (R-314)
12. **Chat document types.** *Recommend:* (a) PDF and UTF-8 text only. (b) Also Office files, with a check that the
    container holds no image. (R-314)
13. **A dispute's resolution is one value.** `disputes.resolution` holds one of six; an administrator who wants to
    re-mark and suspend does the second from the user's page. *Recommend:* (a) as the ERD has it. (b) A resolution
    with an optional party action beside the outcome (a schema change). (R-308)
14. **The window rule, two readings** (the owner's rule of 2026-11-05, R-320): (i) may a make-up start before the
    choice window ends when the teacher accepts a counter early? *Recommend:* no (FR-466's text); option: yes, from the
    teacher's answer. (ii) A cancellation request just before the start: *recommend* no minimum notice (the SRS has
    none; the request shows that it expires at the start); option: a new setting refusing requests within it.

## Proposed changes to other documents (not applied in this step)

| Document | Change | Reason |
|---|---|---|
| Constitution | **P1 (T107):** a rule requiring the video provider's webhook signature on the raw body before any handler — a new R-SESS-7, R-MONEY-9's parenthesis pointing at it; version 2.4.5 → 2.5.0 | R-MONEY-9 points at R-SEC-12, which is about Dependabot (T107) |
| Constitution | **P2:** R-SESS-2 "scheduled job at `scheduled_end` plus the configured evaluation delay (default 2 minutes)" | FR-441 makes the delay a setting; R-MONEY-12 |
| Constitution | **P3** (if decision 3 is (a)): R-DB-4 names `sessions.simultaneous_connected_seconds` as the evaluation's recorded figure | R-DB-4 lists the declared caches |
| `docs/ERD.md` | v1.15: data-model §7's seven amendments, 44 tables | The design |
| `docs/SRS.md` | §3.14 rows: "Session evaluation delay after scheduled end (minutes)" 2; "Chat message rate limit (per subject, per window)"; the chat page size and the recent period of decision 8 | FR-441, FR-491, R-MONEY-12 |
| `docs/SRS.md` | FR-SESS-6 "from purchase" → "from confirmation" | Spec FR-488 and US7 say confirmation |
| `docs/SRS.md` | FR-ADMIN-5: what a student's suspension does to the confirmed enrollments | Decision 1 |
| `docs/SRS.md` | FR-DISPUTE-1: a dispute may be raised from the scheduled end, before the evaluation | Spec FR-473 says "a settled session" while its edge case allows one before the evaluation |
| `docs/ARCHITECTURE.md` | §3.4 the video port as built (no `recordParticipantEvent`), `livekit.adapter.ts`; §4 the module graph's new edges and `EnrollmentSide`; §11 the delay as a setting | R-301, R-302 |
| `docs/RUNBOOK.md` | LiveKit keys (leaked-credential entry), "Room does not open", the tunnel's second path, the room auto-creation setting | ADR 0003's rename list |
| `PLAN.md` | Phase 3: "Evaluation job at scheduled end plus the configured delay"; the close date at the end | R-SESS-2's setting |
| ADR 0003 | Amended note: the rename done, LiveKit's versions | Its Consequences |
| `apps/api/src/jobs/README.md` | `send-reminder` moves to Phase 4 | Spec Assumptions |

## Phase Outputs

- **Phase 0 — Research**: [research.md](./research.md). Twenty-one decisions, R-301 to R-321; fourteen points await
  the owner (above).
- **Phase 1 — Design**: [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md).
- **Phase 2 — Tasks**: `tasks.md`, written by `/speckit-tasks`.

## Post-Design Constitution Re-Check

Re-evaluated after the design artefacts were written. No gate changed from PASS; the design surfaced five points worth
recording:

1. **The outage window is an administrator's statement of time.** `time/no-client-timestamp` refuses an absolute
   instant in an input schema; the window enters as local date, time and zone and is resolved on the server (R-307).
   The administrator is the only witness of an outage, so R-TIME-6's "server clock only" holds for what the server
   decides: the evaluation compares the provider's instants with the recorded window.
2. **Every admin read writes an audit entry**, as Phase 2's monitor does (`adminProcedure` refuses a call that records
   none); the dispute's chat read writes one per page (FR-475).
3. **The phase widens Phase 2's contract** (T090's nullable name). If the contract gate reads a nullable output as a
   change, B34 adds a new field and deprecates the old one (R-API-9).
4. **The reservations are review-tier.** No constraint holds them; a db-integrity probe races a hold against a
   proposal for the same teacher and student, and Saif's review checks each placing path reads them under the locks.
5. **No code of this phase reads a price.** The refund case's page links to the payments monitor for the orders; the
   amount is Platform Administration's, outside the code path (FR-467, ADR 0018 D4).

**Re-check result: PASS.**
