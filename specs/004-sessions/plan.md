# Implementation Plan: Phase 3 — Live sessions

**Branch**: `004-sessions` (the cycle runs on `Ejazah_app/003-booking/T106`; the implementation batches are `Ejazah_app/004-sessions/<task ids>`) | **Date**: 2026-11-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-sessions/spec.md`, approved by the owner on 2026-11-05 with its Clarifications

## Summary

Let a student and a teacher meet in a one-to-one room on their phones, with a token only the server mints, only for
them, only inside the join period; record who was connected from the provider's signed webhooks alone; settle every
session after its end by a scheduled job into one of SRS §3.7.5's outcomes; and carry what follows — the teacher's
absences, marked for administrators past a configured count and never ending an enrollment by themselves, a student's
complaint an administrator decides, an administrator's restore of an enrollment it closed, cancellation by agreement, a make-up or a refund case for a session not
consumed, disputes, the administrator's queues, the consequences of an account's end, and the chat — with no path that
computes, holds or moves an amount. One person, seven working days from D17 (2026-11-08) to D23 (2026-11-16), reviewed
by Saif's review session; the first batch lands T059 (T107 was done in this cycle, `9c710e3`).

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
5. **A dispute freezes the outcome beside the `disputed` status** (R-308); completion is checked by every path that
   settles, and no path counts absences toward an end (R-309, R-322).
6. **A remedy exists only once it is owed for good.** It is offered when the outcome is final (a
   Cancelled-By-Agreement session at its acceptance), its proposal and a pending counter-proposal are reserved in code
   under the accounts' locks, and no time is offered that starts before the matter could still be decided, nor within
   the first-session lead of that decision (R-311, R-320, the owner's rules of 2026-11-05 and the decisions on the
   analysis).
7. **Every event is a row.** `session_events` and two new kinds of `enrollment_events`, so Phase 4's notifications read
   them with no change here (R-315).

Scope is the SRS ids PLAN.md lists for Phase 3, FR-420 to FR-499 and SC-401 to SC-416 of the spec, the carried tasks
(T059, `002:T144`, T090, the notes under T026 and T082; T107 was done in this cycle, `9c710e3`), and nothing else. Reviews, reports, notifications,
reminders, certificates and gender disputes are Phase 4's; T104 and T105 are out of scope and nothing is added for them.

## Technical Context

**Language/Version**: TypeScript 5.x `strict` on Node 24, as Phases 0 to 2 pinned them.

**Primary Dependencies**: Everything Phases 0 to 2 chose. New on the API: `livekit-server-sdk` 2.19.2 (R-302). New on
the phone: `@livekit/react-native` 3.1.0, `@livekit/react-native-webrtc` 150.1.0, `livekit-client` 2.23.0,
`@livekit/react-native-expo-plugin` 1.1.0, `@config-plugins/react-native-webrtc` 15.0.2 (R-316), and `eventsource-parser` 4.1.2 for the live channel (R-324). Each pinned exactly by
the task that installs it, at least fourteen days old on 2026-11-05. No paid service: LiveKit Cloud's free Build plan.

**Storage**: PostgreSQL 18; forty-four tables after this phase (two new: `session_events`, `provider_outages`), one
forward migration ([data-model.md](./data-model.md) §6); Redis for the limiter and the queue (four new sweeps; nothing
in Redis is the only record of an outcome); the storage port for chat documents.

**Testing**: Vitest; `tests/db-integrity` for rules 40 to 48 and every new lock path; the adversarial suite for every
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

**Constraints**: No amount anywhere in this phase (FR-497, T104, T105); every number of the work a setting, the kernel's and the phone's transport and protection numbers named constants (R-MONEY-12 (as amended, constitution 2.6.0, its list completed in 2.6.1); spec FR-498); no date
arithmetic outside `packages/time` (R-TIME-1); attendance only from signed provider webhooks (R-SESS-1); every
suspension and ban through `StandingService` (FR-421); T005's lock rules for every lock and FK-insert path; the owner's
window rule of 2026-11-05 (R-320); requirements from the SRS, not the boards; seven working days for one person,
overflow stated when it happens and sent to the descope ladder, whose Phase 3 rung is in-session file sharing.

**Scale/Scope**: FR-420 to FR-499, SC-401 to SC-416; 1 migration, 2 new tables, 13 columns, 9 integrity rules (40 to 48), 17
settings rows (one removed, one default changed); 15 user-surface procedures (the subscription `live.events` among them) and an upload route, 28 administrator procedures
([contracts/](./contracts/)); 4 jobs; one webhook; the pre-session and room screens, the session, cancellation, remedy,
dispute and chat states on both roles' enrollment screens, and six panel pages.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design._

| Rule family | This phase's own compliance | Mechanism delivered here | Gate |
|---|---|---|---|
| R-MONEY | No amount, share, commission, refund path or balance; a refund is a case with no amount (FR-467); sessions and chat reference no payment (FR-497); every number of the work a setting, seventeen new rows; the transport and protection numbers in the kernel (`apps/api/src/platform/**`) and on the phone named constants under R-MONEY-12 (as amended, constitution 2.6.1), each with its reason beside it: the limiter's 60 s settings cache, 100 ms counter timeout and 10 s breaker (an administrator changing one from the panel could break every signed-in call), the live channel's 25 s ping (a change could break every stream) and 60 s inactivity restart (tied to the ping; tRPC refuses a ping above it), both in `apps/api/src/platform/live/live-constants.ts`, the per-stream queue bound (it protects the API's memory), the phone's reconnect backoff (the phone cannot read settings before it connects), its 60 s after a `RATE_LIMITED` that gives no time (part of that backoff; without a time an earlier retry may be refused again; a refusal's `retryAfterSeconds` is waited out instead when given, the sixth analysis, item 6) and its coalescing of re-reads to one per query key per second (it protects the default limit); the queue's fixed retry numbers the precedent (`apps/api/src/jobs/README.md`), the magic-number gate covering `apps/api/src/modules/` only (spec FR-498; the fourth analysis, C1; the fifth analysis, C3 and C4) | `no-money-vocabulary` extended to `modules/chat`; the boundary test of SC-409 | **PASS** |
| R-TIME | Make-ups store local date, start and zone and derive instants (FR-469); interval arithmetic in `packages/time` (R-305); attendance instants are the provider's; the outage window entered as local fields (R-307); every time shown twice (FR-494) | Interval operations with properties | **PASS** |
| R-GENDER | The join checks gender from the server's records under the accounts' locks; a token bound to one session and one participant (`bindJoinToken`); every refusal to a non-participant is `NOT_FOUND` | R-GENDER-7's CI gate: token replay and cross-gender cases (FR-496, SC-407) | **PASS** |
| R-MOBILE | Every screen from its board as decided; strings from the catalogue with T123's marks; later phases' controls absent (no review, no report); the components render what the server decided (R-320's windows are the server's) | None new | **PASS** |
| R-API | Thin routers; services decide; one inverted port (R-301); every procedure with both schemas; additive snapshot; the port speaks the domain (`createSessionToken`, `endRoom`) | The widened lock union and refusal names (contracts/kernel.md) | **PASS** |
| R-DB | One forward migration; two append-only tables with their revokes; checks for every cross-field rule (rules 40 to 48); no stored count and no stored derived instant (a counter-proposal's answer deadline is computed when read, `counter_proposed_at` + the remedy's snapshot; `choice_closes_at` is the fact that fixes the choice window, not a derived value); no speculative index | Rules 40 to 48 | **PASS**, with decision 3 (`simultaneous_connected_seconds` and R-DB-4, recorded by ADR 0022, constitution 2.5.1) and the second analysis's D1 (no `counter_answer_closes_at`) |
| R-SEC | The webhook verifies before any handler; chat documents by content, images refused by content and extension; signed expiring links; chat under a rate limit; the three name searches (`users.list`, `sessions.monitor.list`, `teacher.students.list`) under `rate_limit_search`, which fails closed, never the default alone (R-SEC-6; the fourth analysis, C2); no token, secret or body logged | The `chat` upload kind; the image corpus test (R-SEC-5) | **PASS** |
| R-SESS | Attendance from webhooks only (1); evaluation by a sweep after end + delay (2, 3); reconnection sums (4); restricted teacher refused (5); no automatic exit from review (6); the video webhook's signature on the raw body (7, T107) | The enforcement map's Phase 3 CI tests for R-SESS-2, 4, 5 and 7 | **PASS**; R-SESS-2's "+ 2m" became a setting of default 2 (P2, constitution 2.5.0) |
| R-HONEST | No session shown done unless the job or an administrator settled it; the teacher sees none of the student's private fields; nothing implies the platform refunds (the case is Platform Administration's) | None new | **PASS** |
| R-PROC | Spec, clarification and plan precede code; every rule the spec left open was put to the owner and answered on 2026-11-05 ("Decisions recorded"), not a keyboard rule (R-PROC-3) | The coverage floor widened to `modules/chat` | **PASS** |

**Review-only tier.** Live in this phase: R-API-5 (the port's widening, R-302), R-DB-4 (decision 3), R-DB-9 (two
partial uniques that are integrity rules, no other index), R-PROC-3 (the owner's decisions recorded below), R-MOBILE-3 (whether the
chat and room screens are shared between the roles), R-MOBILE-12 and R-MOBILE-14 (the new screens).

**Gate result: PASS.** No unjustified violation; four structural costs are in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/004-sessions/
├── plan.md              # This file
├── spec.md              # Feature specification, approved 2026-11-05
├── research.md          # Phase 0 output — 27 decisions (R-301 to R-327)
├── data-model.md        # Phase 1 output — 2 tables, 13 columns, rules 40–48, 17 settings rows, 1 migration
├── quickstart.md        # Phase 1 output — validation guide, the device runs marked as the owner's
├── contracts/
│   ├── README.md
│   ├── app-surface.md   # 15 user procedures (the live channel's subscription among them), the chat upload route, Phase 2's lists widened
│   ├── admin-surface.md # 28 administrator procedures, the user directory's `users.list` and `users.get` among them
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
│   ├── features/shared/sessions/                            # the «expired» display, identical for both roles (T065)
│   ├── lib/livekit.ts                                       # registerGlobals, the audio session
│   └── lib/live.ts                                          # the live channel's EventSource, backoff and re-reads (T065)
├── admin/src/pages/sessions · review · outages · disputes · cases · users  # users: FR-ADMIN-4's directory
└── api/src/
    ├── modules/
    │   ├── sessions/   join, session read, video-webhook.controller, attendance.rules, evaluation,
    │   │               completion, the repeated-absence count, complaints and their decision, the restore, cancellation, remedies (offer, proposal, counter, booking), disputes, outages,
    │   │               session-events, enrollment-side.port, dispute-chat.port, dispute-held-files.port, the cancellation-request counts,
    │   │               the admin routers (monitor, review, outages, disputes, cases)
    │   ├── chat/       messages, the upload handler, attachment links, purge store, `createDisputeChat` (the port's side)
    │   ├── verification/ the user directory: `users.list` and `users.get` beside `requireIdentity`; `createDisputeHeldFiles` (the port's side)
    │   ├── moderation/ the new reasons, openSessionDispute, closeCase, resolveSessionDispute
    │   ├── booking/    createEnrollmentSide, the widened termination subscriber, reservations in the hold and slots
    │   └── identity/   StandingService.suspendStudent/banStudent/reinstateStudent, the students router
    ├── platform/
    │   ├── db/         row-lock (four tables), db-errors (five names), db-clock
    │   ├── guards/     upload kind `chat` (PDF, UTF-8 text); the signed-in default limit
    │   ├── config/     LIVEKIT_* keys, VIDEO_PROVIDER `livekit`
    │   ├── ports/video/livekit.adapter.ts; the port and stand-in widened
    │   └── live/       the live channel's registry, in-process bus, after-commit publisher and `live-constants.ts` (T063)
    ├── surfaces/       live.router.ts (`live.events`)
    └── jobs/           evaluate-sessions, advance-remedies, expire-cancellation-requests, purge-chat

packages/
├── time/src/           interval operations (R-305)
└── contracts/src/      sessions, chat, live; admin/sessions, admin/disputes, admin/cases, admin/students

prisma/schema · prisma/migrations · prisma/seed.ts   # data-model §2 and §6
tests/
├── adversarial/        Phase 3's procedures, token replay
├── db-integrity/       rules 40–48, the lock paths, reservations against holds
├── fixtures/chat-corpus/
└── support/video-stand-in.ts                         # the only producer of video events
```

**Structure Decision**: The twelve modules of Phase 0, with the graph of research R-301: `sessions` gains imports of
`identity`, `moderation` and `catalog`; `booking` of `moderation`; `chat` of `booking` and `moderation`;
`verification` of `sessions` (the user directory's cancellation-request counts, FR-481); `moderation`
still imports none, so a case's page, which names sessions and remedies, is served by sessions' admin router.
Sessions' need of booking's enrollments is a port bound in `main.ts` (`EnrollmentSide`), the fourth dependency handed
in against the arrows, after the three ARCHITECTURE §4 counts (R-207's `CatalogUse`, the `AccountConsequences`
subscribers of R-121 and R-219, R-208's `orderStandingsOf`); the dispute's chat read is the fifth, a second port
sessions declares, `DisputeChat`, which chat implements and `main.ts` binds, since sessions importing chat would close the cycle chat →
booking → sessions (the owner's decision of 2026-11-05 on the analysis, C5). The sixth is `DisputeHeldFiles`, a third
port sessions declares, which verification implements and `main.ts` binds, since sessions importing verification would
close the cycle verification → sessions (a deleted party's held files read inside an open matter; the owner's decision
of 2026-11-06, research R-327). The seventh is identity's `FileHold` (`filesHeld(userId)`), which booking implements
through `heldFileOwnersAmong` and `main.ts` binds, since identity importing booking would close the cycle booking →
identity (a deleted person's files wait while an enrollment of theirs has an open matter; the owner's decision of
2026-11-05, research R-327; counted on the fifth analysis, D1). The video webhook is sessions' raw-body route, as the
gateway's is payments'.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Two new tables (`session_events`, `provider_outages`) against ERD §0's "a table that isn't here is out of spec" | The spec names the outage window as new (FR-445); FR-495 asks a durable record of every event with its session, which `enrollment_events` (booking's, no session column) cannot hold without sessions writing booking's table | Widening `enrollment_events` through the port (decision 6); a window held in settings (an operational number, not evidence) |
| A fourth inverted dependency (`EnrollmentSide`), a fifth (`DisputeChat`), a sixth (`DisputeHeldFiles`) and a seventh (identity's `FileHold`), after the three of ARCHITECTURE §4 (the sixth and seventh counted on the fifth analysis, D1) | Sessions must read the snapshot and write two enrollment statuses, serve a dispute's chat and a deleted party's held files; identity must ask whether a deleted person's files are held; booking already imports sessions and identity, chat imports booking, and verification imports sessions | A thirteenth orchestration module; moving the machine into booking against ARCHITECTURE §4; serving `disputes.chat` from chat's own admin router (the `disputes` namespace is sessions') |
| Reservations held in code under locks, not by the database | FR-466 reserves a proposal and a counter for days; a database guard would need a reserved session row or a new instant cache (an ADR, R-DB-4) | A provisional session row (decision 2): database-enforced but visible in every list and numbering |
| `connection_ref` and a nullable `user_id` on an append-only table | LiveKit gives no ordering guarantee and may replace a connection under one identity; the room-ended event has no participant (FR-443) | Pairing by identity in arrival order: wrong under replacement and reordering |

## Batch plan (D17 to D23)

At most six items each, in the order the work depends on; one branch, one pull request, one review by Saif's review
session, which checks every lock and FK-insert path against T005's rules. The days are the phase's working days 17 to
23. The items become task ids when `/speckit-tasks` runs; carried tasks keep their ids. Inside a batch, independent
items run as parallel lanes (the owner's decision of 2026-10-26).

| Day | Batch | Items | What |
|---|---|---|---|
| D17 Sun 11/8 | B33 | T079/T080 (decision 10); the sessions pass migration and seed (ERD v1.15, amended on 2026-11-05), the schema gate's declared caches gaining `sessions.simultaneous_connected_seconds` (R-DB-4, constitution 2.5.0); the kernel's locks, refusal names and clock; `packages/time`'s interval operations; T059 with sessions' `cancelRemainingSessions` and moderation's new reasons; booking's `slot_holds.release_reason` and rule 48 (R-323, GAP-8); a deleted account's files held through identity's `FileHold` port while an enrollment of theirs has an open matter (R-327) | The carried tasks the spec puts first (FR-420; T107, the constitution before the webhook, done on 2026-11-05 in this cycle), and the foundations every later batch reads |
| D17 Sun 11/8 | B34 | `002:T144` (a student's suspension, ban and reinstatement through `StandingService`, FR-486); a teacher's end (FR-483); T090 (FR-426); the `EnrollmentSide` port; the LiveKit adapter with the Daily rename and the port's widening (FR-425, quickstart §3); the video stand-in harness | Every account's end before any session can be joined; the provider behind the port |
| D18 Mon 11/9 | B35 | `sessions.get` and `sessions.join` with their adversarial cases; `POST /webhooks/video`; the attendance rules and `evaluate-sessions`; completion and the event rows; the outage windows; the R-SESS CI tests | US1's API and US2 whole (SC-402 to SC-407) |
| D18 Mon 11/9 | B36 | The LiveKit packages and the development build on the owner's phone; the pre-session screen; the room screen; the session statuses on both roles' enrollment screens; the signed-in rate limits, the administrator kind's declaration and the default limit (T062, the decisions of 2026-11-05 on the administrator's control); the live channel's server side (T063: `live.events`, the registry, the in-process bus and the after-commit publisher, the shutdown order; research R-324) | US1 on the phone; the first device check of joining; the live channel's API |
| D19 Tue 11/10 | B37 | Cancellation requests and their expiry sweep; the administrator's cancellation and the monitor; the user record's request counts; raising a dispute | US3's API, US5's first half |
| D19 Tue 11/10 | B38 | The remedy offer and proposal; the student's choice, acceptance, counter options and counter-proposals again after a decline (R-320, decision 9); the teacher's answer and the windows' ends; the make-up's booking and the slot's release (the notes under T026); refund cases; booking's reservation reads | US4's API |
| D20 Wed 11/11 | B39 | The disputes queue and its resolution; the review queue and its resolution; the compensation-case queue and `closeCase` (the note under T082), a suspended student's case cleared or confirmed (decision 1); a ruling's revision (SRS FR-DISPUTE-7, the third analysis) and the correction of an outcome nobody disputed (`sessions.review.revise`, FR-439, R-323 GAP-3); the manual compensation case (T064, `cases.openManual`, research R-326) | US5's administrator side |
| D20 Wed 11/11 | B40 | Chat messages and the rate limit; the chat upload kind and attachment links (SC-408); `purge-chat`; the dispute's chat read; the student's complaint of the teacher's absence and its decision (T060); an administrator's restore (T061) | US7's API |
| D20 Wed 11/11 | B40a | The live channel on the phone and the pre-join presence (T065); the remaining producers: cancellation, an administrator's cancel, an enrollment closed or restored, an account's end, chat (T066) (research R-324, the owner's decision of 2026-11-05) | Live updates while the app is open (FR-427 to FR-429, FR-437, FR-438) |
| D21 Thu 11/12 | B41 | The phone: cancellation and dispute on both roles; the remedy sheets (choice, proposal, counter, the teacher's answer); chat on both roles; the ended tab's new statuses | US3, US4, US5 and US7 on the phone |
| D22 Sun 11/15 | B42 | The panel: `/sessions` with cancellation; `/review` and `/outages`; `/disputes` with the chat; `/cases`; a student's standing dialogs; `/users`, FR-ADMIN-4's directory with `users.list` and `users.get`, the request counts and a student's standing actions; the panel's `RATE_LIMITED` message on every page (T058 last) | The administrator's pages |
| D23 Mon 11/16 | B43 | The adversarial suite's completeness and the gates (FR-496, FR-497); the coverage floor; the document pass (what the build changed beyond the documents amended on 2026-11-05: the RUNBOOK's room setting from B34's check, PLAN.md's close date); quickstart §1 to §7; the owner's device run (SC-401, SC-414); the close | The proofs; the same day, Phase 4's Spec Kit cycle (PLAN.md's rule) |

The Not-scheduled row of `specs/003-booking/tasks.md` was reviewed (research R-319): it stays as it is, except T079 and
T080, timed in B33 by decision 10 (the row says so).

## Decisions recorded (the owner's answers of 2026-11-05)

The fourteen points this plan left to the owner, answered on 2026-11-05. Each research decision and data-model section
named below was brought into line with the answer the same day, and so were the spec's requirements where they read
otherwise.

1. **A student's suspension or ban: the confirmed enrollments, and reinstatement.** *Decided, mixed.* A
   **suspension** is (b): every upcoming session is still cancelled at the moment of suspension (FR-ADMIN-5), but the
   confirmed enrollment stays `confirmed`, keeps its slot, and cannot complete while its `student_suspended` case is
   open. The administrator closes that case one of two ways. The student cleared (`cases.resolve`, allowed once the
   account is active again): each session the suspension cancelled is owed the remedy FR-MAKEUP-2 gives, in the same
   enrollment; read exactly, none of them is a Teacher-No-Show, so on either track it is a make-up session, placed as
   FR-MAKEUP-3 and FR-MAKEUP-4 place every make-up, with FR-MAKEUP-2's one exception (a counter-proposal left
   unanswered becomes a refund). The fault confirmed (`cases.dismiss`): the enrollment is cancelled with the reason
   `admin` and its slot returns to booking. A **ban** is (a): the confirmed enrollments are cancelled with the reason
   `admin` at once, and the `student_banned` case owes nothing unless the administrator decides otherwise. A
   reinstatement restores the account only. Spec FR-486 and SRS FR-ADMIN-5 say so. (R-313) *Changed by the decisions
   on the analysis, items 2 and 12: a cleared student on recitation chooses a make-up or a refund, and a remedy
   already offered is frozen during the suspension. Changed by the second analysis, C1 (item 2 there): the fault
   confirmed is an enrollment's end, its make-ups still scheduled cancelled and every remedy still owed handed to a new
   `student_fault_confirmed` case; and by the third analysis, items 4 and 5: a make-up the suspension cancelled stays
   owed, and on an enrollment that ended another way the case decides only the sessions the suspension cancelled.*
2. **How a make-up proposal and a counter-proposal are reserved.** *Decided:* (a), in code: every placing path reads
   the reservations under both accounts' locks, and the database's exclusions guard the real sessions. (R-311)
3. **`sessions.simultaneous_connected_seconds` and R-DB-4.** *Decided:* (a), written once at evaluation as the figure
   the outcome was decided on; the ERD (v1.15) and R-DB-4 (constitution 2.5.0) say so. (R-305)
4. **When an enrollment completes.** *Decided:* (a), after the last session's dispute window has closed. (R-309)
5. **Is a Cancelled-By-Agreement session final at acceptance?** *Decided:* (a), yes. The make-up is offered at once,
   in the acceptance's transaction, and that session cannot be disputed: the one exception to the rule that a remedy
   waits for the dispute window. Spec FR-462 and FR-473, SRS FR-CANCEL-2, FR-DISPUTE-1 and FR-MAKEUP-1 say so. (R-311)
6. **Where the event rows live.** *Decided:* (a), a new `session_events` table, sessions'. (R-315)
7. **Does a disputed Teacher-No-Show count toward the threshold?** *Decided:* (a), no, until resolved; the resolution
   re-checks. (R-308) *Removed by the decisions of 2026-11-05, no automatic termination (item 1 there): there is no
   threshold, and this decision served only it; the repeated-absence mark reads a session by its final status (R-322).*
8. **Numbers the spec does not fix.** *Decided:* the proposed numbers, all admin settings: the chat message rate
   limit 30 messages per 60 s, the chat page size 50, the cancellation requests' «recent period» 30 days. SRS §3.14
   gains them as rows, beside the evaluation delay's. (R-317)
9. **A declined counter-proposal.** *Decided:* the owner's own rule, replacing both options:
   - **Re-proposals.** If the teacher declines a counter-proposal, the student may counter-propose again while the
     choice window is still open, with only one pending counter-proposal at a time.
   - **The answer window.** Each counter-proposal gives the teacher `makeup_counter_answer_hours` (72) from that
     counter-proposal; silence makes it a refund case with no amount, on either track.
   - **Accepting the proposal while a counter is pending.** The student may accept the system's proposal while a
     counter-proposal is pending; the pending counter-proposal is withdrawn and its time released (the owner's
     approval of this reading, 2026-11-05).
   - **The choice window closing without agreement.** If the window closes while a counter-proposal is pending, the
     teacher's answer decides: an acceptance books the counter, a decline books the system's proposal at once, and
     silence makes a refund when the answer window ends. The worst case is the choice window plus one answer window
     (7 days + 72 hours).
   - **The hide rule.** Neither the system's proposal nor any counter-proposal may start before the matter could
     still be decided:
     - (H1) The system's proposal never starts before `choice_closes_at` + the answer window, since a counter-proposal
       sent at the window's last moment can keep the matter open until then; a week before that moves to the first
       free week after it.
     - (H2) The counter-proposal options leave out every teacher occurrence starting before the later of now + the
       answer window and `choice_closes_at` (decision 14 (i) kept).
     - (H3) The system's proposal stays reserved from the offer until the remedy settles (booked, or handed to a
       case); a pending counter-proposal's time stays reserved during its answer window and is released at its
       decline, its withdrawal or the window's end. Both are hidden from `booking.slots` and refused by
       `checkout.hold`.
     - (H4) After a decline, the next counter-proposal's options are read again under H2.
     - *H1 and H2 gain the first-session lead, and the windows are fixed at the offer: the decisions on the analysis,
       items 6 and 13, give the final bounds.*
     - (H5) If the choice window ends with no counter-proposal pending and no acceptance, FR-MAKEUP-4's outcome
       applies: the proposal is booked.

   SRS FR-MAKEUP-3 and FR-MAKEUP-4, ADR 0018's amendment of 2026-11-05 and spec FR-464 to FR-467 say so;
   `session_remedies` holds the current pending counter-proposal, and `session_events` the history of every one
   (data-model §2.3, §2.4). (R-311, R-320)
10. **T079 and T080.** *Decided:* (a): one `testTimeout` and `hookTimeout` of 30 s for `tests/db-integrity`, the
    `node` project at 5 s with file-level timeouts for its three heavy specs, and a per-run prefix on each adversarial
    world's names. Timed in B33; the Not-scheduled row of `specs/003-booking/tasks.md` says so. (R-319)
11. **Chat after the enrollment ends.** *Decided:* (a), read-only until the purge. (R-314)
12. **Chat document types.** *Decided:* (a), PDF and UTF-8 text only. This is narrower than SRS FR-SESS-7's
    «document/text files», which records it: Office files can carry macros, and may be added later. (R-314)
13. **A dispute's resolution is one value.** *Decided:* (a), as the ERD has it. (R-308)
14. **The window rule, two readings.** *Decided, both as recommended:* (i) no make-up starts before the choice window
    ends, even when the teacher accepts a counter-proposal early; (ii) no minimum notice for a cancellation request.
    (R-320)

## Decisions on the analysis (the owner's answers of 2026-11-05)

`/speckit-analyze` over spec, plan and tasks found the points below (their ids are the analysis's); the owner answered
each on 2026-11-05. Where an answer changes a decision above, the answer governs, and the spec, research, data model,
contracts, quickstart, tasks, SRS, ERD and constitution were brought into line the same day.

The window rule's two bounds, final (A = the remedy's `snapshot_answer_window_hours`, default 72; L = its
`snapshot_first_session_lead_hours`, default 24, both read from the settings when the system's proposal is offered and
fixed then; C = `choice_closes_at`):

- **H1** — the system's proposal starts no earlier than **C + A + L**: the latest moment it can be booked is C + A (a
  counter-proposal sent at C, declined or left to lapse at C + A), and no make-up starts within L of its booking.
- **H2** — a counter-proposal's options start no earlier than **max(now + A + L, C)**: the teacher answers by now + A, no
  make-up starts within L of that answer, and none before the choice window ends (decision 14 (i)).

1. **A counter-proposal is the student's choice of a make-up** (kept): a recitation student has no refund after a
   decline (R-311).
2. **A suspended student cleared** is owed, for each session the suspension cancelled, what FR-MAKEUP-2 gives for a
   Teacher-No-Show, the fault not being theirs: on recitation a make-up or a refund at the student's choice
   (`awaiting_choice`), on the ijazah track a make-up (`proposed`). Cleared only once the account is reinstated, else
   `STUDENT_SUSPENDED` (kept). Replaces decision 1's "a make-up session on either track". (Spec FR-463, FR-486; SRS
   FR-ADMIN-5; R-313; T036.)
3. **A suspended enrollment keeps its slot until the case closes** (kept), and open `student_suspended` cases head the
   compensation-case queue so they are settled fast (spec FR-478; `cases.list`; T035, T050).
4. **K1.** No dispute over any cancelled session, by agreement or by an administrator (spec FR-473; SRS FR-DISPUTE-1
   amended).
5. **R-DB-4.** ADR 0022 records decision 3; R-DB-4 cites it; constitution 2.5.1, a patch, and its 2.5.0 row says so.
6. **The answer-window case is closed.** The answer window and the first-session lead are fixed on the remedy when the
   system's proposal is offered (the owner's confirmation of this reading of «وقت إرسال الاقتراح»: the system
   proposal's offer, not the counter-proposal), so a later change of either setting cannot let a counter's answer
   window run past the proposal's start. (Data model §2.3; SRS FR-MAKEUP-3.)
7. **FR-ADMIN-4, the user directory**, enters Phase 3 (PLAN.md's SRS list): the panel's `/users` with search,
   FR-ADMIN-4's details, the cancellation-request counts, and a student's suspend, ban and reinstate actions (spec
   FR-481; T058 in B42; T025 and T051 reshaped). `users.list` and `users.get` are new reads in verification's `users`
   router beside `requireIdentity`; verification gains the edge to sessions for the counts, which closes no cycle
   (sessions imports identity, moderation and catalog, none of which imports verification) (R-301, R-318).
8. **C2, a deleted student.** Every open make-up remedy lapses (`lapsed`, a final state with no case, nothing owed); a
   remedy whose refund was already chosen keeps its case open (spec FR-484; ERD rule 42; T004).
9. **F5.** The system's proposal also skips every week whose occurrence overlaps an open hold (an unexpired payment
   window) of the student or the teacher, as the counter options do (spec FR-464; R-311, R-320; T028). Phase 2's
   confirmation path places a new hold for a released one (FR-PAYG-19's late payment) without booking's overlap
   check, the database's exclusions being its only guard, and a reservation is no session row; so that branch must
   read the reservations and take its refusal branch when a generated session would overlap one (T027).
10. **C1.** A remedy is offered only on a `confirmed` enrollment; a session owed on an enrollment that ended (the
    threshold termination, since 2026-11-05 an administrator's termination on a complaint; a teacher's end, a student's
    ban) is covered by the case that ending opened, which `covers`
    lists; a student's deletion opens none, and item 8 applies (spec FR-448, FR-462, FR-478; T015, T028, T035).
11. **F3, F4.** One lock order, `users` → `enrollments` → `sessions`: a `party_suspended` or `party_banned` resolution
    locks the party's account first; an outage record locks the overlapped sessions' enrollments before the sessions
    (contracts/kernel.md; T016, T034).
12. **C3, C4.** A remedy is frozen while the student is suspended (`frozen`): at the suspension a pending counter-proposal
    is withdrawn and its time released, and the system's proposal's reserved time is released too; at reinstatement a
    new system proposal is offered with a new full choice window, A and L read again, placed under H1 with item 9 and
    item 13 (the owner's confirmation). No remedy is offered while the student is suspended; one that comes due is
    offered by the sweep after the reinstatement. A `cancelled_by_admin` event carries the case its action opened or
    joined (`session_events.case_id`), which `covers` reads (T036).
13. **F6.** No make-up starts within the first-session lead of the moment it is decided: H1 and H2 above (spec FR-464
    to FR-466; SRS FR-MAKEUP-3; R-320; T028, T031).
14. **K2.** LiveKit's `emptyTimeout` and `departureTimeout` are admin settings, `video_empty_timeout_seconds` 300 and
    `video_departure_timeout_seconds` 20 (LiveKit's own server defaults: no project document had named a value), SRS
    §3.14 rows (R-302, R-317; T001, T009, T011).
15. **K3.** If T009 finds the free plan cannot turn off a room's creation on join, the adapter removes a restricted
    participant through LiveKit's server API (`removeParticipant`) beside ending the room (R-313; T009, T014).
16. **C5.** `disputes.chat` reaches chat through a port sessions declares, `DisputeChat`, which chat implements and
    `main.ts` binds, as `EnrollmentSide` is (R-301, R-314; contracts/kernel.md; T034, T040).
17. **Text fixes.** F1 (the clarify Q5 answer marked superseded), F2 (T107 done, not pending), C6 (`users.get` is a new
    read, not a widening), F7 (a teacher's deletion cancels `account_deleted`), B1 (US4 anchored to `choice_closes_at`),
    B3 (`kind` does not say which hand-off). F8 (a cancellation accepted between B37 and B38 has no remedy):
    `advance-remedies` (T028) also offers a remedy for a Cancelled-By-Agreement session of a confirmed enrollment that
    has none, so the gap closes itself when B38 lands.

## Decisions on the second analysis (the owner's answers of 2026-11-05)

A second `/speckit-analyze` found the points below (their ids are its own); the owner answered them on 2026-11-05.
Where an answer changes a decision above, the answer governs, and the spec, research, data model, contracts,
quickstart, tasks, SRS, ERD and PLAN.md were brought into line the same day.

1. **D1, I1.** `session_remedies.counter_answer_closes_at` is not added: it was a stored derived value with no ADR
   (R-DB-4). A counter-proposal's answer window closes at `counter_proposed_at` + `snapshot_answer_window_hours`,
   computed when read through `packages/time`; the API returns it computed under the field the contracts name
   (`RemedyView.counter.answerClosesAt`), and `answerCounter` and `advance-remedies` compare with the same computation.
   `choice_closes_at` stays a column: it is what fixes the choice window, and no column holds the window's days.
   (Data model §2.3; ERD changelog row 12; R-311; T001, T031, T032.)
2. **C1, one rule.** A suspended student's fault confirmed (the `student_suspended` case dismissed) is an enrollment's
   end, beside the threshold termination (since 2026-11-05 an administrator's termination on a complaint), a teacher's end, a student's ban and a student's deletion. In the same
   transaction: (a) every make-up still scheduled on the enrollment is cancelled `cancelled_by_admin`, its event
   carrying the new case's `case_id`; (b) every remedy owed on the enrollment, other than for the sessions the
   suspension cancelled, the cancelled make-ups' included, goes to a new compensation case opened then, never to the
   case dismissed; (c) that case's `covers` lists every owed remedy, offered or not. The sessions the suspension
   cancelled are owed nothing. The new case's reason, `student_fault_confirmed`, is this cycle's reading: a case
   needs a reason of the closed list, and `student_suspended` would make it a second suspension case, which clearing
   would read. (SRS FR-ADMIN-5; spec FR-462, FR-486; R-312, R-313; contracts/kernel.md and admin-surface.md; T035,
   T036.)
3. **I5.** SRS FR-PAYG-19: where the hold was released, the confirmation also takes its refusal branch when a
   generated session overlaps a make-up's reservation (FR-MAKEUP-3), as item 9 of the analysis decided. (T027.)
4. **L1.** A path that locks more than one teacher's `lockKey('teacher-slots', …)` takes the keys in ascending teacher
   id order: a student's deletion, suspension or ban (booking's subscriber) and a dispute resolved `party_suspended` or
   `party_banned` against a student. (Contracts/kernel.md, data model §5, R-308, R-313, R-321; T002, T004, T005,
   T034; a note under `003:T005`.)
5. **L2.** A make-up's booking locks both slots it touches, the enrollment's own and, for a counter, the counter's, in
   one call in id order. (R-311; T029.)
6. **L3.** Contracts/kernel.md gains the row of `sessions.remedy.choose` and of a counter's hand-off to a case; the
   resolution row names the dispute's close and the threshold's hand-off of the open remedies (the hand-off moved to the
   complaint's decision on 2026-11-05: kernel.md's complaint rows).
7. **The other findings, as text.** I2 (R-311: a cleared suspension's session may be refunded too), I3 (T028: such a
   session is offered `awaiting_choice` on recitation), I4 (a refund opens or joins the enrollment's open case of its
   reason: FR-467, US4 acceptance 6, SC-410, quickstart §1), S1 and S2 (data model §3 and §1), S3 (R-315's list of
   kinds), S4 (T107 done, not carried), S5 (R-305 cites ADR 0022), S6 (`EnrollmentSide` and `DisputeChat` are the
   fourth and fifth dependencies against the arrows, ARCHITECTURE §4 counting three), S7 (the spec's scope list as
   PLAN.md's), U1 (FR-473's refusal of a session under review), U2 (T023's event carries its case), U3 (SRS
   FR-MAKEUP-3 names the open holds).
8. **S8.** PLAN.md's «39 for Phase 3» stays, as the history of how the days were split; a note beside it says
   FR-ADMIN-4 was added on 2026-11-05 and the days did not change.

No path that offers a time is new or changed by these answers: R-320's window rule stands as decided.

## Decisions on the third analysis (the owner's answers of 2026-11-05)

A third `/speckit-analyze` found the points below (their ids are its own); the owner answered them on 2026-11-05.
Where an answer changes a decision above, the answer governs, and the spec, research, data model, contracts,
quickstart, tasks, SRS, ERD, ADR 0018 and the note under `003:T005` were brought into line the same day.

1. **Confirmed as written.** The reason `student_fault_confirmed`; the make-ups a confirmed fault cancels carry the new
   case's id; Both-No-Show and Cancelled-By-Agreement are inside «every remedy still owed». Only the text that
   disagreed was changed (I1 below).
2. **G1, the offer waits for the dispute window.** A remedy is offered only once the session's dispute window
   (`dispute_window_hours`, 72) has closed, even when an administrator resolved its dispute earlier; a dispute raised
   inside the window, a second one included, holds the offer until it is resolved; so the remedy is offered at the
   latest of the window's end, the last dispute's resolution and the last revision (item 8). A second dispute inside
   the window stays allowed, and an outage window may reclassify a resolved session still inside its dispute window
   (T016): no remedy has been offered then, so none is withdrawn and FR-462 holds. R-307's claim, false before for a
   resolved dispute, is now true. `advance-remedies` (T028) offers once the window has closed and no dispute is open;
   no resolution offers a remedy in its own transaction. (SRS FR-MAKEUP-1, FR-DISPUTE-1; spec FR-462, FR-473; R-307,
   R-311; data model §2.3, §3; T016, T026, T028.)
3. **A2.** A review or dispute resolution never offers a remedy in its own transaction: `advance-remedies` offers it
   when item 2's time comes. (T033, T034.)
4. **U1.** On a confirmed fault the ordinary sessions the suspension cancelled are owed nothing, but every remedy owed
   for a cause that is not the student's fault goes to the new `student_fault_confirmed` case, a make-up session the
   suspension cancelled included (it was owed for the session it made up). (SRS FR-ADMIN-5; spec FR-486; R-312,
   R-313; `cases.get`'s `covers`; T035, T036.)
5. **U2.** If the enrollment ends another way (a ban, a teacher's end) while its `student_suspended`
   case is open, there is no second end: the case decides only the sessions the suspension cancelled. Cleared, they
   join the first end's case, owed as refunds; the fault confirmed, they are owed nothing and the case closes with no
   further effect. (SRS FR-ADMIN-5; spec FR-486; R-313; `cases.resolve` and `cases.dismiss`; T036.)
6. **The other findings.** L-A (a dispute resolved `party_banned` against a teacher takes `teacher_profiles` after
   `users` and before the slots' key, as `StandingService.ban`'s `lockApplication` does), L-B (`chat.send` and `POST
   /uploads/chat` lock the sender's `users` row, then the enrollment), L-C (`sessions.cancel`'s row: `enrollments`,
   `sessions`, `disputes`); contracts/kernel.md, R-308, R-314, T023, T034, T037, T038 and a note under `003:T005`.
   A1 (the cleared suspension's refund only on a recitation enrollment: T028, T031, `canChooseRefund`). F1 («open
   remedy» defined once in data model §3: `awaiting_choice`, `proposed`, `counter_proposed` or `frozen`; the ban, a
   teacher's end and a confirmed fault hand over every open remedy, `frozen` included: T005, T006; T015's text is
   left to the pass that removes the no-show threshold: that pass is the decisions of 2026-11-05 below, where F1 applies
   to the complaint's end, and T015's rewrite is in its task proposal). C2 (`session_remedies_counter_slot_id_idx`, the new foreign key's plain index, in T001). U3 (`EnrollmentSide`
   gains `enrollmentPage`, which the monitor's list reads: T008, T024; R-API-6). I1 (`covers` counts a
   Cancelled-By-Agreement session never offered a remedy beside the two no-shows: R-312, T035, `cases.get`). I2 (SRS
   FR-DISPUTE-5 names a student's ban, a confirmed fault, a counter left unanswered and a refused make-up; spec
   FR-478 too). S1 (decision 1 above and the spec's line marked as changed by C1). S2 (ADR 0018's amendment names
   the second analysis's C1). A3 (a refused make-up, below). S3 (T021's locks point at the kernel's row).
7. **A3, a refused make-up.** An acceptance of a counter-proposal that the database refuses releases the counter as a
   decline does (`counter_withdrawn`, superseded by A1 below: `counter_booking_refused`; B38's conflict check, Q13): the remedy `proposed` while the choice window is open, the proposal booked once
   it has closed. A booking of the system's proposal that the rules decided (H5, a decline after the choice window, a
   refused counter after it) and that the database refused is tried again by `advance-remedies` only while the
   occurrence starts at least L after the attempt's instant and overlaps no open hold or reservation of either party,
   both read again under the booking's locks; past that, the remedy goes to a `makeup_refused` case. (SRS FR-MAKEUP-4,
   FR-DISPUTE-5; spec FR-468; R-311, R-320; T029, T032.)
8. **A ruling's revision («مراجعة الحكم»), new.** An administrator may revise their ruling on a dispute while the
   session's dispute window is open and no remedy has been offered for it; afterwards `RULING_FINAL`. A reason is
   mandatory and audit-logged (`dispute.revised`). The revision changes the session's outcome only (upheld, consumed
   or not, whom the absence is on): never a suspension or a ban, never an enrollment the ruling ended; the response's
   `notUndone` names what the earlier ruling did that stays. The ruling's columns on `disputes` are never rewritten;
   the revision is one `session_events` row `dispute_revised` carrying `outcome_before` and `outcome_after`, its
   `case_id` naming the dispute, beside the audit entry that holds the reason and the administrator. Stored so
   because: the outcome the ruling produced is otherwise lost (the resolution clears `outcome_under_dispute`, and
   `upheld` names no status), so `outcome_before` is a fact no other row holds, not a derived value (R-DB-4); the row
   is append-only (R-DB-3, rule 43) with its checks in the database (R-DB-5, rule 43); it needs no index (R-DB-9) and
   references no account; and it is the durable event Phase 4's notifications read (FR-495), so one row is both the
   history and the notice, where a forty-fifth table would repeat `session_events`' pattern and the audit entry's
   reason. A revision counts as a resolution for item 2's timing. It is idempotent under an `idempotencyKey`, through
   the kernel's `IdempotencyService.run` as `teacher.slots.create` and `checkout.pay` are keyed (`platform/idempotency`,
   ADR 0008; the scope `disputes.revise` joins `idempotent-procedures.ts`, the actor the administrator's id): a repeat
   with the same key returns the first result and writes nothing new (the owner's decision of 2026-11-05, added to
   item 8). Its locks are a resolution's (kernel.md); it
   calls no `StandingService`. `disputes.revise` (admin-surface.md), T059 in B39, and the panel's button in T049.
   (SRS FR-DISPUTE-7; spec FR-472, FR-495; R-308; ERD changelog rows 15 and 16.)

The window rule (R-320) gains two applications: the offer itself waits for the dispute window, any dispute raised in
it and any revision (item 2), and a refused proposal is retried only while it starts at least L after the attempt
(item 7).

## Decisions of 2026-11-05, no automatic termination

The owner decided on 2026-11-05 that no count of a teacher's absences ends an enrollment
([ADR 0023](../../docs/adr/0023-no-automatic-termination-complaint-and-restore.md)). Where an answer changes a decision
above, the answer governs, and the spec, research (R-322), data model, contracts, quickstart, SRS, ERD and PLAN.md were
brought into line the same day. `tasks.md` is not changed by this pass: the tasks it adds, removes or reshapes, and any
batch it would take past six, wait for the owner's approval.

1. **No automatic termination.** Each Teacher-No-Show gets its remedy (FR-NOSHOW-2) and the enrollment continues; an
   enrollment or its sessions end only by an administrator's decision. Removed: the setting
   `teacher_no_show_threshold` (SRS §3.14's row; the seed's row, which the first batch's migration deletes), the
   threshold check in every path that settles (`termination.service.ts` is not written), every automatic path to
   `terminated_no_show`, the check on a dispute's resolution, and decision 7 above, which served only the threshold.
   (SRS FR-NOSHOW-3, FR-NOSHOW-4; spec FR-448; R-309, R-322.)
2. **A repeated-absence mark, per enrollment, for administrators only.** At `repeated_absence_flag_count` (a new §3.14
   row, default 5) Teacher-No-Shows on one enrollment since it began, the enrollment is shown marked with its count on
   the monitor, the cases and the disputes; the teacher's record in the user directory (FR-ADMIN-4, T058's `/users`)
   lists the marked enrollments. The count is read, never stored (R-DB-4), each session by its final status: no
   Both-No-Show, no Cancelled-By-Agreement, no absence a dispute's resolution or a ruling's revision removed, and a
   session under dispute once resolved. Nothing happens automatically because of the mark. (SRS FR-NOSHOW-3,
   FR-ADMIN-4; spec FR-451, FR-481; R-322.)
3. **The student's complaint.** A complaint button on a confirmed enrollment takes a mandatory written reason and opens
   a case in the administrator's queue: a `disputes` row of a new kind, `absence_complaint` (a compensation case's
   reason is a closed list, and Phase 2's covering rule reads `compensation_case` rows only). One open per enrollment,
   held by a partial unique; a second answers `COMPLAINT_OPEN`, and the button reads «شكوتك قيد المراجعة» from
   `enrollments.get`'s `complaintOpen`. `sessions.complaint.raise` declares `rate_limit_absence_complaint` with the
   student as subject, as `booking.router` and `checkout.router` declare theirs, apart from the one-open rule and
   tested over its limit; its default, 5 per 3600 s, is this cycle's reading, the limit itself the owner's decision.
   The administrator decides (`cases.decideComplaint`), each with a mandatory note, audited: (a) end the enrollment,
   `terminated_no_show` with the old termination's effects, its remaining sessions Cancelled-By-Admin and a new
   compensation case `absence_termination` (the reason that replaces `teacher_no_show_threshold`) holding every remedy
   still owed, as C1 of the second analysis decided; (b) suspend the teacher through `StandingService`; (c) close it
   with the note. Locks per `003:T005` and contracts/kernel.md's three complaint rows: the raising `users` (the
   student) then `enrollments`; (a) a confirmed fault's order; (b) a `party_suspended` resolution's (no
   `teacher_profiles` row: `StandingService.suspend` locks the account only); (c) `enrollments` then `disputes`.
   (SRS FR-NOSHOW-4, FR-DISPUTE-5; spec FR-452, FR-453; R-322.)
4. **A ruling's revision has no threshold.** It changes the session's outcome only; the mark, being read, follows it;
   nothing re-checks a count. (SRS FR-DISPUTE-7; spec FR-472; R-308.)
5. **The restore.** An administrator may restore, within `enrollment_restore_window_days` (a new §3.14 row, default 7)
   of its closing, an enrollment an administrator's decision closed: `terminated_no_show` on a complaint, or
   `cancelled` (`admin`) on a confirmed fault (`student_fault_confirmed`). Not one closed by a ban, a deletion or a
   teacher's end, nor a completed one. Both accounts active; the closing's case still open (resolved with compensation,
   or dismissed, refuses); the slot not taken by another student (a session or an open hold) in any week it would fill.
   The sessions still owed are created anew from the nearest occurrence at least the first-session lead after the
   restore, the cancelled ones kept as they are; the remedies the case held are offered again with a new choice
   window, as a frozen remedy after reinstatement (H1 with F5 and F6); the case closes «restored». A mandatory reason,
   an audit entry, an `enrollment_events` row `restored` for Phase 4's notice, idempotent under an `idempotencyKey`
   through the kernel's `IdempotencyService` (the scope `sessions.restore` joins `idempotent-procedures.ts` in the
   design; no code here). Locks: `sessions.cancel`'s order widened by both accounts, the teacher's slots' key and the
   slot before it, and `session_remedies` within it. The owner's «the admin's cancellation (FR-CANCEL-6)» is read as
   naming no closing: FR-CANCEL-6 cancels one session and leaves its enrollment `confirmed`, so nothing it does is
   restored. The state machine: the enrollment leaves a terminal state for `confirmed`, and a `refund_case` remedy
   leaves a final state; no database rule forbids either, ADR 0010 D5's late confirmation is the one earlier exit and
   was an ADR, so ADR 0023 records these. (SRS FR-CANCEL-8; spec FR-454, FR-455; R-322; ADR 0023.)
6. **Where it is written.** The SRS first (FR-NOSHOW-3/4/5, FR-CANCEL-8, FR-DISPUTE-5, FR-DISPUTE-7, FR-ADMIN-4,
   §3.14, §7, §8, UC-4, DEC-61, an amendment line); FR-ADMIN-5 names no threshold and is not edited; the constitution
   names no threshold (R-SESS's «no-show count» stays true) and is not edited. The termination was in the spec's User
   Story 2, not User Story 7 (the chat); US2 and US5 change.

The window rule (R-320) gains two applications: a restore's recreated sessions (none before the restore plus the
first-session lead, none over an open hold, a reservation or a session of either party) and a remedy a restore offers
again (H1 with F5 and the lead, after the recreated sessions). The complaint offers no time.

## Decisions of 2026-11-05, the administrator's control and the rate limits

The owner approved the task proposal of the decision of no automatic termination and decided four more points the same
day. Where an answer changes a decision above, the answer governs; the SRS (FR-CANCEL-8 as amended, NFR-SEC-12,
FR-ADMIN-20, §3.14), the ERD (changelog row 21), the spec (FR-454, FR-470, FR-471, FR-472), research (R-308, R-317,
R-321, R-322, R-323), the data model, the contracts, the quickstart and `tasks.md` were brought into line.

1. **The readings approved.** Only a termination on a complaint and a confirmed fault are restorable (FR-CANCEL-6
   cancels one session); the complaint's limit is 5 per 3600 s; a restore creates the snapshot's count less the sessions
   consumed and less those owed or settling; a restored confirmed fault recreates the sessions the suspension
   cancelled, which that count already includes; a disputed absence counts toward the mark once resolved. The text
   already said each; nothing was changed for them.
2. **A restore's eighth refusal, `slot_changed`** (rejected: recreating at the slot's new time). The enrollment's weekly
   slot changed its day, its local start or its zone between the closing and the restore: the student enrolled on the
   old time. Detected from what the ERD keeps: the enrollment's own generated sessions hold the local date, start and
   zone they were asked for (ADR 0009 D1), compared with the slot's row under its lock; no column is added. A removed
   slot is a deactivated one, `slot_inactive`, since no path deletes a slot. (R-322 step 6; spec FR-454; T061.)
3. **Rate limits on every signed-in procedure.** (a) `adminProcedure` gains an optional `rateLimit`, checked before
   it opens its transaction; (b) `disputes.revise` and `sessions.restore` declare `rate_limit_dispute_revision` and
   `rate_limit_enrollment_restore` (10 per 60 s each, the administrator as subject), apart from the
   `idempotencyKey`; (c) every signed-in procedure that declares none is counted by `rate_limit_signed_in_default`
   (150 per 60 s per research R-325, the owner's decision of 2026-11-06 on the fifth analysis, 160 until then; the owner's decision of 2026-11-05 its first value; the reason, the larger of 120 and the heaviest normal minute × 2–3, so a normal user is never refused, and above 200 no number but the screen that calls too often sent back to the owner to be fixed), the user or administrator as subject, its value held in the process for up to 60 s, its counter
   on a client of its own bounded at 100 ms, failing open behind a 10 s breaker with one warning per period, while every
   declared limit stays fail-closed and a missing row refuses; (d) T062 in B36 builds (a) and (c), T059 and T061 declare
   (b); (e) every rate limit, Phases 1 and 2's included, logs only a subject's first refusal in a window (the count
   exactly the limit plus one): a user or administrator by id and the procedure only, any other subject by the procedure
   and at most the counter's keyed digest, a budget by the procedure and its key; T062 builds it. (R-321, items 5 and 6;
   spec FR-470; SRS NFR-SEC-12.)
4. **All control in our hands** (SRS FR-ADMIN-20, spec FR-471): every automatic or final action leaves the
   administrator its evidence in the panel, a fix while the state can change, and a path to restore the right once it
   cannot, among them a manual compensation case on any enrollment, in any state, at any time, for either party, with a
   mandatory reason, audit, an `idempotencyKey` and its own limit (`rate_limit_manual_compensation_case`, 10 per 60 s,
   seeded in B33). The procedure, its contract and its task are proposed to the owner and not written here. R-323 lists
   every such action of Phases 2 and 3 with its evidence, its fix, its restore path and the evidence erased
   automatically, and ten gaps, each with a proposed solution and no task.
5. **The task changes** (`tasks.md`): T015 becomes completion and the repeated-absence count; T001, T002, T004, T008,
   T014, T024, T034, T035, T039, T042, T047, T049, T050, T052 and T058 take the decision's parts; T060 (the complaint's
   API) and T061 (the restore's) are new in B40, T062 (the signed-in rate limits) in B36. The batches: B33 6, B34 6,
   B35 6, B36 5, B37 6, B38 6, B39 5, B40 6, B41 6, B42 6, B43 5; none above six.
6. **Notification names** (the owner's item 12): SRS FR-NOTIF-1 and ERD §11's `notifications.type` name, by name only,
   fourteen Phase 3 events a party is told of: `enrollment_restored`, `dispute_ruling_revised`, `absence_complaint_decided`, `dispute_raised`, `cancellation_request_expired`, `makeup_counter_declined`, `makeup_frozen`, `makeup_lapsed`, `makeup_offered_again`, `makeup_handed_to_case`, `session_outage_reclassified`, `enrollment_completed`, `enrollment_cancelled`, `compensation_case_opened`. Their migration stays in Phase 4's notifications pass, as
   for the rest of the list; Phase 3 writes the durable record each is read from (research R-315), except
   `compensation_case_opened`, whose manual case waits for the owner. No task here.

The window rule (R-320): nothing here offers a time. A restore's `slot_changed` refusal is not a time-offering path, and
the restore's recreated sessions and re-offered remedies keep R-320's two rows of the decision of no automatic
termination.

## Decisions of 2026-11-05, the administrator's control inventory answered

The owner approved, the same day, the number research R-325 computed, an answer to each of R-323's ten gaps, the manual
compensation case's design, and three more points. Where an answer changes a decision above, the answer governs (the
default's value in item 3 (c) above; item 4's «proposed, not written here»; item 6's «except
`compensation_case_opened`»). `tasks.md` is not changed here: the task changes come in one later pass.

1. **The signed-in default limit is 160 per 60 s**, per R-325 (a teacher's heaviest normal minute, 52 calls, × 3, rounded
   up to ten; *superseded* by the fifth analysis's item 2: 150 per 60 s, the student's 48 × 3 = 144 rounded up); the rule max(120, H × 2–3) with no number above 200 stays its reason; the panel's 45 × 3 = 135 needs no
   value of its own. Written in SRS §3.14 and NFR-SEC-12, ERD §12, the spec, research R-317 and R-321, the data model,
   the contracts and the quickstart.
2. **R-323's gaps answered** (research R-323): the monitor's timeline through `EnrollmentSide.eventsOf` (GAP-1);
   `sessions.review.get` for any session no longer scheduled (GAP-2); `sessions.review.revise`, its own procedure, with
   `rate_limit_outcome_correction` (10 per 60 s, a new §3.14 row) and the kind `outcome_corrected` (GAP-3, spec
   FR-439); each session's remedy on the monitor with «booking refused, retried until …» derived (GAP-4); an open
   remedy handed to a case through the manual case (GAP-5); the kind `instants_reresolved` with `previous_start_at`
   (GAP-6); one log line per `endRoom` and `removeParticipant` (GAP-7); `slot_holds.release_reason` with the code's
   seven reasons, and the holds on `payments.get` (GAP-8); no page for rate-limit refusals, Not scheduled (GAP-9); the
   RUNBOOK's entry for a refused or unattributable video event (GAP-10).
3. **The chat's retention after the dispute window is 30 days** (was 0), still a panel setting (SRS §3.14,
   FR-SESS-13).
4. **A deleted account's files wait** while it is a party to an enrollment with an open dispute, case or complaint, and
   are removed by `erase-deleted-files` after the last closes (SRS FR-AUTH-14, ADR 0015's amendment; research R-327;
   spec FR-487).
5. **The manual compensation case**, `cases.openManual` (research R-326, spec FR-493): any enrollment, either party,
   the reasons `admin_opened_for_student` and `admin_opened_for_teacher`, joined while open, idempotent, its own limit;
   with `remedyId` it hands an open remedy to the student's case. Phase 2's covering rule (`caseInstantsAmong`) reads
   Phase 2's three reasons only. Its record is `compensation_case_opened`'s source (SRS FR-NOTIF-1).
6. **The complaint's outcome is told to both parties** (`absence_complaint_decided`; SRS FR-NOTIF-1, FR-NOSHOW-5).

The window rule (R-320): nothing here offers a time. The hand-off releases the reserved times and books none; the
correction leaves the remedy to FR-462's moment.

## Decisions of 2026-11-05, the live channel

The owner approved research R-324 the same day. Where it touches a decision above, it adds to it and changes none.

1. **Server-Sent Events through tRPC 11.19's subscriptions**, on the existing mounts; no WebSocket server. On the
   phone, an EventSource of our own over `expo/fetch` and `eventsource-parser` 4.1.2, outside `timed()`; the token
   in the `Authorization` header only; on `UNAUTHENTICATED`, `account.me` once, then the stream reopened.
2. **One channel per signed-in device**, `live.events`, no input, its own limit `rate_limit_live_channel` (10 per
   60 s) and at most `live_channel_max_connections_per_user` (3) streams, the oldest ended; four events (`session`,
   `enrollment`, `chat`, `account`), each parsed by its schema and recorded by the contract snapshot, addressed by
   the server from the producing transaction's rows and sent after it commits (spec FR-427, FR-428).
3. **Live:** chat, the counterparty's presence before joining (`sessions.get`'s `counterpartyInRoom`, a hint), a
   cancellation request and its answer, an administrator's cancellation, an enrollment closed or restored, an
   account's end and standing. **Read on open:** remedies, disputes, complaints, outcomes, the administrator's
   screens, an enrollment's completion and a request's expiry (the worker's), the payment confirmation (still polled);
   the phone's «expired» is display only, and a refused answer reads the screen again (spec FR-437, FR-438).
4. **Resilience:** a ping every 25 s, a restart after 60 s of silence, backoff from 1 s to 30 s with jitter, closed in
   the background and reopened with one re-read, re-reads coalesced, a bounded queue, every stream ended at its
   token's expiry.
5. **The hard condition:** the API ends every live stream before `application.close()` on shutdown, with a test that
   shutdown never waits on one; phones come back after 1 to 15 s (spec FR-429).
6. **No Redis pub/sub now:** Not scheduled, required before a second API process, any worker event made live or the
   payment confirmation made live. Also Not scheduled: the live payment confirmation (after the bus), and for T057's
   Phase 4 cycle, that the cancellation request is the first thing that needs push.

The tasks: T063 (the server side, B36), T065 (the phone and the presence) and T066 (the remaining producers), both in a
new batch B40a on D20, and one clause in T045 (`tasks.md`). The window rule (R-320): nothing here offers a time.

## Decisions on the fourth analysis (the owner's answers of 2026-11-06)

The fourth `/speckit-analyze` found no critical issue; the owner answered its findings on 2026-11-06. Where an answer
changes a decision above, the answer governs. No task is added and no task moves between batches.

1. **L1, two sweeps' locks.** `expire-cancellation-requests` (T022) locks `enrollments`, `sessions`, then
   `cancellation_requests`, as an accepted request does; `reresolve-session-instants` (T014) locks `enrollments`, then
   `sessions`, as the evaluation does, since each inserts a `session_events` row whose foreign key takes a key-share
   lock on the enrollment. Two new rows in contracts/kernel.md, a probe each in `tests/db-integrity/` against that path
   (data-model §5, research R-321).
2. **C2, the name searches.** `users.list` (T058), `sessions.monitor.list` (T024) and `teacher.students.list` (T007)
   declare Phase 1's `rate_limit_search` (60 per 60 s, no budget), failing closed, each with a test that a call over it
   is refused; T062 moves `teacher.students.list`'s declaration to `subject: 'caller'` with the others (spec FR-470,
   the contracts; R-SEC-6).
3. **A1, a refused counter's record.** A teacher's acceptance of a counter-proposal that the database refuses writes one
   `session_events` row of a new kind, `counter_booking_refused`, instead of `counter_withdrawn`, so it is not read as
   the student's acceptance of the proposal (spec FR-468; data-model §2.4, twenty-five kinds; ERD changelog row 29;
   research R-323 P3-29; T001, T032).
4. **An outcome's correction told.** SRS FR-NOTIF-1 and ERD §11 name a fifteenth Phase 3 event,
   `session_outcome_corrected`, to both parties, read from `outcome_corrected` (spec FR-439; ERD changelog row 30;
   T059). Its migration stays in Phase 4's notifications pass.
5. **A deleted account's held files, read inside an open matter** (amending item 4 of «Decisions of 2026-11-05, the
   administrator's control inventory answered»): while held, the photo and the verification documents are readable by
   an administrator only inside an open dispute, case or complaint of that enrollment, all `disputes` rows, keyed by
   the open `disputeId` as `disputes.chat` is: `disputes.heldFiles` (metadata, no link) and `disputes.heldFileLink`
   (one signed link per press, `document_link_ttl_seconds`, audited `held_file.view`); a link minted just before the
   close may live 300 s after it, accepted; `readDocument` unchanged, verification and identity each gaining a reader
   of their own held file; sessions' `DisputeHeldFiles` port bound in `main.ts` to verification, so no cycle forms.
   The API in T040 (B40 stays at six), the panel's «held files» section in T049 and T050 (research R-327, «The
   administrator's read»; spec FR-487; SRS FR-AUTH-14; ADR 0015's amendment).
6. **C1, R-MONEY-12's exception** (constitution 2.6.0). The transport and protection operating numbers in the
   kernel (`apps/api/src/platform/**`) and on the phone are named constants: the settings cache's 60 s, the counter's
   100 ms timeout and the 10 s breaker (T062, R-321 item 5), the live channel's 25 s ping (T063, R-324 item 8) and the
   phone's reconnect backoff (T065, R-324 items 8 and 9). The work's own windows and limits stay settings. Why each is
   not a setting: an administrator changing a ping or a timeout from the panel could break the connection; the phone
   cannot read settings before it connects; the queue's fixed retry numbers are the precedent
   (`apps/api/src/jobs/README.md`, "Retry, bounded failure and concurrency"); the magic-number gate covers
   `apps/api/src/modules/` only. Spec FR-498, the Constitution Check's R-MONEY row and the Constraints cite it.
7. **The text fixes** (S1 to S8, G1, G2, U1, U2, I1 to I4, O1, A2 to A5), as the analysis recommended; A2's
   `makeup_offered_again` stays a session's second `remedy_offered`, settled in Phase 4's cycle (T057).

The window rule (R-320): nothing here offers a time.

## Decisions on the fifth analysis (the owner's answers of 2026-11-06)

The fifth `/speckit-analyze` (at `d833159`) found no critical issue; the owner answered its findings on 2026-11-06.
Where an answer changes a decision above, the answer governs. No task is added and no task moves between batches.

1. **L2, a cancellation request's and a decline's locks.** The row "cancellation request, a decline" takes `users`
   (both parties, one call), `enrollments` (the session's), `sessions`, then `cancellation_requests`; one general rule
   in contracts/kernel.md: every path that inserts a `session_events` row, or locks a `sessions` row, locks the
   session's enrollment before any `sessions` row (*reworded* on the sixth analysis, item 3). T021 gains a probe racing a request and a decline against an
   administrator's `sessions.cancel` on the same session (data-model §5, research R-310 and R-321, quickstart).
2. **A6, the default limit is 150 per 60 s.** Research R-325 recomputed without the name searches `rate_limit_search`
   counts since the fourth analysis's C2: the teacher's heaviest minute about 37, the panel's directory about 9, the
   administrator's 45, so the heaviest is the student's 48; max(120, 48 × 3 = 144), rounded up to ten, is 150 (SRS
   §3.14 and NFR-SEC-12 with an amendment line, ERD changelog row 32, spec FR-470, data-model §4, the contracts, the
   quickstart, T001 and T062).
3. **C3 and C4, constitution 2.6.1 (PATCH).** R-MONEY-12's exception names four more numbers, each with its reason:
   the live channel's 60 s inactivity restart (tied to the ping; tRPC refuses a ping above it), the per-stream queue
   bound (it protects memory), the phone's coalescing of re-reads to one per query key per second (it protects the
   default limit) and the phone's 60 s after `RATE_LIMITED` (part of its backoff; the phone cannot read settings, and
   an earlier retry is refused again). The 25 s ping and the 60 s `reconnectAfterInactivityMs` move out of
   `apps/api/src/surfaces/procedures.ts` into `apps/api/src/platform/live/live-constants.ts`, which `procedures.ts`
   imports, so both sit in the kernel the exception names (T063, T065, research R-324 item 8, contracts/kernel.md).
4. **G3, the audit target types.** T002 (B33, still six tasks) adds `enrollment`, `dispute`, `session` and
   `provider_outage` to `AuditTargetType` (`target-label.ts`, with their kind words), `target-name.ts` (the type
   only), the contract's `auditTargetType` (an additive snapshot) and the panel's `TARGET_TEXT` with its four keys,
   which the enum types, with a spec that every target type this phase records is known, so none makes `targetLabel`
   throw. contracts/admin-surface.md states the rule (one row, its type; a list read, the administrator) and names the
   target where the action's name does not.
5. **A7, a refused counter's log line.** Where `counter_booking_refused` is written, one `warn` line
   `{ sessionId, enrollmentId, constraint }`, the constraint `sessions_teacher_no_overlap` or
   `sessions_student_no_overlap`; no new column, no personal data; a spec in T032 (research R-311 and R-323 P3-29).
6. **The `RATE_LIMITED` message on the phone** (the owner's addition). No screen maps the code today; T065 (B40a)
   adds `common.state.rateLimited` in both catalogues and `genericErrorKey` in `apps/mobile/src/lib/error-message.ts`,
   which every generic-error path uses, the screens that exist before B40a listed by file in T065, and B41's six
   tasks (T041 to T046) noting that theirs use it. (*Its text replaced* on the sixth analysis, item 6: a time when the
   server gives one, `common.state.rateLimitedIn`, and «wait a little» otherwise.)
7. **The `RATE_LIMITED` message in the panel** (the owner's addition). No page maps the code today; T058 (B42) adds
   `admin.common.rateLimited` in both catalogues and `errorMessageKey` in `apps/admin/src/lib/error-message.ts` over
   `errorCodeOf`, applied by name to every page with a rate-limited button or search, Phase 3's and the older pages
   (the sign-in, the password and the second factor under `rate_limit_admin_authentication`, the rest under T062's
   default). T058 now runs last in B42, after the five lanes T047 to T051, each of which notes it; B42 stays at six.
   (*Its text replaced* on the sixth analysis, item 6: `admin.common.rateLimitedIn` with the time when the server
   gives one, «wait a little» otherwise.)
8. **The text fixes.** D1: ARCHITECTURE §4 and an amendment line name `DisputeHeldFiles` and identity's `FileHold`,
   and the Structure Decision and Complexity Tracking count them as the sixth and seventh inverted dependencies. S9:
   SRS's 2026-11-05 «unreadable as before» marked superseded. U3: T040 names `dispute.held_files_listed` and specifies
   that `documents.link` and the other ordinary readers still answer a held erased document as none. U4: `fileRef` is
   `document:<documentId>` or `photo:<userId>`, stable, never a storage key (contracts/admin-surface.md, research
   R-327, T040). G4: T052's stamp check covers the three `rate_limit_search` declarations (T007, T024, T058).

The window rule (R-320): nothing here offers a time.

## Decisions on the sixth analysis (the owner's answers of 2026-11-06)

The sixth `/speckit-analyze` (at `e37083b`) found one high issue (H1); the owner answered its findings on 2026-11-06.
Where an answer changes a decision above, the answer governs. No task is added to a batch and no task moves between
batches; B33 stays at six.

1. **H1, the video webhook's locks.** `POST /webhooks/video` inserts a participant's event, whose two foreign keys
   (`prisma/migrations/20261101050220_append_only_foreign_keys_restrict/migration.sql`) key-share the session first and
   the participant's account second; a path that holds the account `FOR UPDATE` and then locks the session (a teacher's
   suspension, a cancellation's decline during the early-join lead) could deadlock with it. T012 takes the
   participant's `users` row `FOR KEY SHARE` before the insert, through `keyShareRows`, a new helper T002 adds to
   `apps/api/src/platform/db/row-lock.ts` (R-API-6), and never the enrollment; `room_ended` (no user) needs none.
   contracts/kernel.md gains the webhook's rows, and T012 a race probe in `tests/db-integrity/` against both paths
   (data-model §5, research R-321, quickstart).
2. **M1, `sessions.provider_room_id` is never written.** The room is named for the session's id, so T011's join
   writes nothing to `sessions`; data-model §1 and §2.1 no longer say the join writes the column; the ERD notes it
   unused (changelog row 33); its removal is item (5) of tasks.md's Not scheduled row, in no batch.
3. **M2, the general rule reworded.** contracts/kernel.md, data-model §5 and research R-321: «A path that locks,
   updates or inserts a row referencing a `sessions` row (a foreign key's key-share included) takes, before any
   session, every lock earlier in the one order that it will take. A path inserting a `session_events` row always
   takes the enrollment. No path waits on a lock earlier in the order while holding a session.» The join (`users`
   only, no session written) and the webhook are rows of their own.
4. **M3, the audit actions' names.** None of this phase's twenty-eight audit actions has an `ACTION_TEXT` entry in
   `apps/admin/src/pages/audit/actions.ts`, so `/audit` would show raw codes. T002 (B33, still six tasks) adds a name
   in Arabic and English for each, in the panel's existing wording, `ACTION_TEXT` and `admin.audit.actions.*` in both
   admin catalogues, with a spec that every one has a name (contracts/admin-surface.md, "The audit actions' names").
   Links from each entry to its target's page wait for the post-MVP review of the admin screens' clarity.
5. **The text fixes.** L1: spec.md's Assumption on the named constants lists constitution 2.6.1's four numbers beside
   2.6.0's. L4: PLAN.md's header names ERD v1.15 and constitution v2.6.1. L2: the counter's `counter_slot_id` key-share on `availability_slots` is stated safe in
   contracts/kernel.md and data-model §5 (every path that locks a slot `FOR UPDATE` takes its teacher's `users` row
   first, which the counter's path holds). L3: T002 writes the reworded general rule into `row-lock.ts`' header.
   L5, changed by the owner: `reresolve-session-instants` defers the overlap exclusions, so its commit can raise
   `40P01` against T029's make-up booking or T061's restore, whose victim would answer a generic 500. The transaction
   is retried once; a second deadlock answers a clear refusal, `MAKEUP_REFUSED` (T029) and `RESTORE_REFUSED` with
   `details.cause` `time_taken` (T061). T002 (B33, still six tasks) adds `isDeadlock` to `db-errors.ts` and
   `runRetryingDeadlockOnce` to `transaction.repository.ts`, run as that file runs every transaction; T029 and T061
   use it, each with a spec forcing the deadlock (research R-321, contracts/kernel.md and README).
6. **The `RATE_LIMITED` message says when to try again** (the owner's addition). The server sends the time left: T062
   adds `retryAfterSeconds` to a counted refusal's details, `[{ path: 'retryAfterSeconds', code: '<n>' }]` in the one
   error shape (every detail's `code` is text), the counter key's remaining time to live read by one `PTTL` on the
   refused path only, with a spec; a refusal whose `PTTL` fails or that no counter made carries none (contracts/kernel.md
   "Rate limits", README "Errors"). The phone's helper (T065) and the panel's (T058) read it through the existing
   `errorDetailsOf` of each client: with a time, «طلبات كثيرة. حاول مرة أخرى بعد {n} دقيقة.» and "Too many requests.
   Try again in {n} minutes.", n = ceil(seconds / 60), at least 1, in ICU plural forms; without one, «طلبات كثيرة.
   انتظر قليلًا ثم حاول مرة أخرى.» and "Too many requests. Wait a little and try again."; the panel keeps its
   «لم يتغيّر شيء» clause; the fifth analysis's «wait a minute» keys are replaced, with specs of both branches. The
   phone's live channel waits `retryAfterSeconds` after `RATE_LIMITED`, the fixed 60 s only the fallback when no time
   is given (T065, research R-324 item 8, spec FR-498, the R-MONEY row above). The constitution's R-MONEY-12 names
   «the phone's wait after `RATE_LIMITED` (60 s …)» as a named constant; it still reads true of the 60 s as the
   fallback when the server gives no time, so the constitution is unchanged and stays 2.6.1. T051 and the older panel
   pages keep the helper (T058).

The window rule (R-320): nothing here offers a time.

## Changes to other documents (approved on 2026-11-05, applied in this cycle)

The owner approved every row below on 2026-11-05, with the three conflicts the spec found (T107's reference, R-SESS-2's
fixed two minutes, FR-DISPUTE-1 against spec FR-473), and they were applied on `Ejazah_app/003-booking/T106` after the
decisions above. Two parts wait for what the build finds: whether a room must be kept from being created on join
(B34's check, quickstart §3; the RUNBOOK records the setting then), and PLAN.md's close date (the phase's close).

| Document | Change | Reason |
|---|---|---|
| Constitution | **P1 (T107):** a new R-SESS-7 requiring the video provider's webhook signature on the raw body before any handler, R-MONEY-9's parenthesis pointing at it; version 2.4.5 → 2.5.0 | R-MONEY-9 pointed at R-SEC-12, which is about Dependabot (T107) |
| Constitution | **P2:** R-SESS-2 "scheduled job at `scheduled_end` plus the configured evaluation delay (default 2 minutes)" | FR-441 makes the delay a setting; R-MONEY-12 |
| Constitution | **P3** (decision 3): R-DB-4 names `sessions.simultaneous_connected_seconds` as the evaluation's recorded figure | R-DB-4 lists the declared caches |
| `docs/ERD.md` | v1.15: data-model §7's amendments, as the decisions above shape them, 44 tables | The design |
| `docs/SRS.md` | §3.14 rows: "Session evaluation delay after scheduled end (minutes)" 2; "Chat message rate limit (per subject, per window)" 30 per 60 s; "Chat page size (messages)" 50; "Cancellation requests recent period (days)" 30 | FR-441, FR-491, decision 8, R-MONEY-12 |
| `docs/SRS.md` | FR-SESS-6 "from purchase" → "from confirmation", read-only once the Enrollment has ended (decision 11) | Spec FR-488 and US7 say confirmation |
| `docs/SRS.md` | FR-SESS-7: PDF and UTF-8 text only, Office files later | Decision 12 |
| `docs/SRS.md` | FR-ADMIN-5: what a student's suspension and ban do to the confirmed enrollments | Decision 1 |
| `docs/SRS.md` | FR-CANCEL-2, FR-MAKEUP-1: a Cancelled-By-Agreement session is final at acceptance | Decision 5 |
| `docs/SRS.md` | FR-DISPUTE-1: a dispute may be raised from the scheduled end, before the evaluation; never over a Cancelled-By-Agreement session | Spec FR-473 said "a settled session" while its edge case allows one before the evaluation; decision 5 |
| `docs/SRS.md` | FR-MAKEUP-3, FR-MAKEUP-4 and an amendment line | Decision 9 |
| ADR 0018 | The amendment of 2026-11-05: D3's decline and D5's slot for a suspension | Decisions 1 and 9 |
| `docs/ARCHITECTURE.md` | §3.4 the video port as it stands (no `recordParticipantEvent`), `livekit.adapter.ts`; §4 the module graph's new edges and `EnrollmentSide`; §11 the delay as a setting | R-301, R-302 |
| `docs/RUNBOOK.md` | LiveKit keys (leaked-credential entry), "Room does not open", the tunnel's second path | ADR 0003's rename list |
| `PLAN.md` | Phase 3: "Evaluation job at scheduled end plus the configured delay" | R-SESS-2's setting |
| ADR 0003 | Amended note: the rename timed in B34, LiveKit's versions | Its Consequences |
| `apps/api/src/jobs/README.md` | Phase 3's four jobs; `send-reminder` moves to Phase 4 | Spec Assumptions, contracts/kernel.md |
| `docs/SRS.md` | On the analysis: FR-DISPUTE-1 (any cancelled session), FR-MAKEUP-3 (the lead after the decision; the two windows fixed at the offer), FR-ADMIN-5 (a cleared student's remedy as for a Teacher-No-Show; a remedy frozen during a suspension), §3.14's two video timeouts, an amendment line | Decisions on the analysis 2, 4, 6, 12, 13, 14 |
| `PLAN.md` | Phase 3's SRS list gains FR-ADMIN-4 | Decision on the analysis 7 |
| `docs/ERD.md` | v1.15 amended in place: the remedy's two snapshots, `frozen`, `lapsed`, `session_events.case_id`, two settings, ADR 0022 cited | 6, 8, 12, 14, 5 |
| `docs/SRS.md` | On the second analysis: FR-PAYG-19 (a late payment refused over a make-up's reservation), FR-MAKEUP-3 (the open holds named), FR-ADMIN-5 (a confirmed fault's make-ups cancelled and its owed remedies in a new case), an amendment line | Decisions on the second analysis 2, 3, 7 (U3) |
| `docs/ERD.md` | v1.15 amended in place again: no `counter_answer_closes_at`, rule 42's five `counter_*` columns; `disputes.reason`'s `student_fault_confirmed` (changelog rows 12 and 13) | 1, 2 |
| `PLAN.md` | A note beside «39 for Phase 3»: FR-ADMIN-4 added, the days unchanged | 8 |
| `specs/003-booking/tasks.md` | A note under T005: several teachers' slots' keys in ascending teacher id order | 4 |
| Constitution, ADR 0022 | 2.5.1: R-DB-4 cites ADR 0022 | 5 |
| `docs/ARCHITECTURE.md` | §4's Phase 3 graph: `verification` → `sessions`, the `DisputeChat` port; the header names 2.5.1 | 7, 16 |
| ADR 0018 | The amendment paragraph names the analysis's changes to FR-ADMIN-5 and FR-MAKEUP-3 | 2, 12, 13 |
| `docs/SRS.md` | On the third analysis: FR-MAKEUP-1 (the offer after the dispute window, even after a resolution), FR-DISPUTE-1 (a second dispute inside the window), FR-DISPUTE-7 (new: a ruling's revision), FR-DISPUTE-5 (four more cases), FR-MAKEUP-4 (a refused booking), FR-ADMIN-5 (U1, U2), an amendment line | Decisions on the third analysis 2, 4, 5, 6 (I2), 7, 8 |
| `docs/ERD.md` | v1.15 amended in place again: `session_remedies_counter_slot_id_idx`; `offered_at` after the window; `session_events`' `dispute_revised` with `outcome_before` and `outcome_after`, rule 43; `disputes.resolution` never rewritten (changelog rows 14 to 16) | 2, 4, 5, 6 (C2), 8 |
| ADR 0018 | The amendment paragraph names the second analysis's C1 (D5's «nothing owed» narrower) | 6 (S2) |
| `specs/003-booking/tasks.md` | A note under T005: L-A, L-B, L-C and the revision's locks | 6, 8 |
| `docs/SRS.md` | No automatic termination: FR-NOSHOW-3/4/5 rewritten, FR-CANCEL-8 (new), FR-DISPUTE-5, FR-DISPUTE-7, FR-ADMIN-4, §3.14 (the threshold row removed; the flag count, the restore window and the complaint rate limit added), §7, §8, UC-4, DEC-61, an amendment line | Decisions of 2026-11-05, no automatic termination, 1 to 6 |
| ADR 0023 (new) | No automatic termination, the complaint, the restore and its two exits from a final state | 5 |
| `docs/ERD.md` | v1.15 amended in place again: changelog rows 17 to 20 | 1, 2, 3, 5 |
| `PLAN.md` | Phase 3's SRS list gains FR-DISPUTE-7 and FR-CANCEL-8; the definition of done gains the line on no automatic termination | 1, 6 |
| `docs/SRS.md` | The administrator's control and the rate limits: FR-CANCEL-8 (`slot_changed`), NFR-SEC-12 (new), FR-ADMIN-20 (new), §3.14's four rows (the default's value by NFR-SEC-12's rule, confirmed by T062 from research R-325 before B36; *superseded* the same day: research R-325 set 160 per 60 s (150 since the fifth analysis), seeded by T001, and T062 sets no value, the row of the control inventory answered below), NFR-SEC-12's first-refusal logging, an amendment line | Decisions of 2026-11-05, the administrator's control and the rate limits, 2 to 4 |
| `docs/ERD.md` | v1.15 amended in place again: changelog row 21, the four rate-limit settings, no column for `slot_changed` | 2, 3 |
| `docs/SRS.md` | The control inventory answered: §3.14 (the default 160 per 60 s, 150 since the fifth analysis, chat retention 30, «Outcome correction rate limit»), NFR-SEC-12, FR-SESS-13, FR-AUTH-14, FR-NOTIF-1 (`compensation_case_opened`'s record, `absence_complaint_decided` to both parties), four amendment lines | Decisions of 2026-11-05, the administrator's control inventory answered, 1 to 6 |
| `docs/ERD.md` | v1.15 amended in place again: changelog rows 23 to 27 (the default's value, chat retention, the deleted files held, the manual reasons and the covering rule, `outcome_corrected`, `instants_reresolved`, `previous_start_at`, `slot_holds.release_reason`, rule 48, the new setting, §11) | 1 to 6 |
| ADR 0015 | An amendment paragraph: a deleted account's files wait for its open disputes and cases | 4 |
| `docs/RUNBOOK.md` | «A video event refused or not attributed» | 2 (GAP-10) |
| `docs/SRS.md` | The live channel: §3.14's two rows, NFR-SEC-12, an amendment line naming §4.4 | Decisions of 2026-11-05, the live channel, 2 |
| `docs/ERD.md` | v1.15 amended in place again: changelog row 28, the two settings | 2 |
| `docs/ARCHITECTURE.md` | §3.2's chat row: Server-Sent Events through tRPC subscriptions; §4: the live channel in the kernel, no module edge | 1, 2 |
| `docs/RUNBOOK.md` | «Reverse proxy and the live channel» | 4, 5 |
| `PLAN.md` | Phase 3: the live channel; Phase 6: the proxy, Docker and RAM notes | 1, 5 |
| `docs/SRS.md` | On the fourth analysis: FR-NOTIF-1's `session_outcome_corrected`, an amendment line | Decisions on the fourth analysis, 4 |
| `docs/ERD.md` | v1.15 amended in place again: changelog rows 29 (`counter_booking_refused`) and 30 (§11's `session_outcome_corrected`) | 3, 4 |
| `docs/SRS.md` | FR-AUTH-14: a held file read by an administrator inside an open matter only; an amendment line | 5 |
| ADR 0015 | Its amendment paragraph: the administrator's read of a held file | 5 |
| Constitution | R-MONEY-12's exception for the kernel's and the phone's transport and protection numbers; version 2.5.1 → 2.6.0 | 6 |
| ADR 0023 | An amendment paragraph: `slot_inactive`, `slot_changed` and the restore's own rate limit in D4 | 7 (S3) |
| `docs/SRS.md`, `docs/ERD.md` | S5's superseded lines marked (the «120 seeded until T062» line; the ERD header's counts) | 7 (S5) |
| `docs/ERD.md` | v1.15 amended in place again: changelog row 31, the notes on `users.photo_key` and `verification_documents.erased_at` | 5 |
| `docs/SRS.md` | On the fifth analysis: §3.14 and NFR-SEC-12, the default 150 per 60 s; an amendment line | Decisions on the fifth analysis, 2 |
| `docs/ERD.md` | v1.15 amended in place again: changelog row 32, §12's default at 150 per 60 s | 2 |
| Constitution | R-MONEY-12's exception names four more numbers with their reasons; version 2.6.0 → 2.6.1; the ERD's and ARCHITECTURE's headers name 2.6.1 | 3 |
| `docs/ARCHITECTURE.md` | §4's Phase 3 graph: the `DisputeHeldFiles` and `FileHold` ports; an amendment line | 8 (D1) |
| `docs/SRS.md` | The 2026-11-05 amendment's «unreadable as before» marked superseded | 8 (S9) |
| `docs/ERD.md` | On the sixth analysis: v1.15 amended in place again, changelog row 33, §5's `provider_room_id` noted unused | Decisions on the sixth analysis, 2 (M1) |
| `PLAN.md` | The header names ERD v1.15 and constitution v2.6.1 (was ERD v1.14 and constitution v2.4.5) | 5 (L4) |

## Phase Outputs

- **Phase 0 — Research**: [research.md](./research.md). Twenty-seven decisions, R-301 to R-327; the owner answered
  its fourteen points on 2026-11-05 (above), the analysis's seventeen the same day, the second and third
  analyses' findings the same day, R-322 on the decisions of no automatic termination, and R-323, the administrator's
  control inventory, on the decisions of the administrator's control and the rate limits; R-323's gaps, R-325 (the
  default limit's value), R-326 (the manual case) and R-327 (a deleted account's files) on the decisions answering that
  inventory; R-324, the live channel, on its own decision the same day.
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
