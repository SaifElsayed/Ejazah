# Implementation Plan: Phase 2 — Catalog, discovery, booking

**Branch**: `003-booking` (the cycle runs on `Ejazah_app/002-identity/T163`; the implementation batches are `Ejazah_app/003-booking/<task ids>`) | **Date**: 2026-10-31 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-booking/spec.md`, clarified 2026-10-31

## Summary

Let an approved teacher offer packages at weekly times, let a student find only the teachers the visibility predicate
allows, hold a slot, pay on the gateway's hosted page, and have the gateway's signed event alone confirm the enrollment
and generate every session at the slot's local time across Cairo's daylight-saving changes; let both people see the
enrollment, and the admin every order, with no path that moves money. One person, eight working days from 2026-11-01
(days 12 to 19), reviewed by Saif's review session; the first batches land the Phase 1 follow-ups PLAN.md carries in.

The technical approach, from [research.md](./research.md), rests on six decisions:

1. **The predicate is identity's, and everything else filters by its answer.** Its five conjuncts read only
   identity's tables, so one repository there answers "which teachers may this requester see, for discovery or for
   booking"; catalog and booking filter their own tables by those ids, so counts, cards, profiles, slots and holds are
   after the predicate by construction, and R-GENDER-5's lint rule bites where the predicate lives (R-201, R-202).
2. **Checkout is orchestrated by payments, written by booking.** The port's calls (create, cancel) happen outside any
   transaction in `payments`; every hold and enrollment write is a function of booking's entry taking the caller's
   transaction; ARCHITECTURE §8.1 is the script, step for step (R-208, R-214, R-215).
3. **Confirmation has one writer and one trigger.** A verified, persisted paid event enqueues `confirm-enrollment`,
   which confirms, converts or re-holds, and generates in one transaction, or takes the refusal branch; a CI test
   proves no other writer of `confirmed_at` exists (R-215, FR-366).
4. **The stand-in is a gateway at the boundary.** Its hosted page and its test harness send signed events over HTTP
   to the real webhook, doubled, reordered and late on command; no spec reaches the service by a side door (R-213).
5. **Time is requested local dates, resolved per occurrence.** Sessions store what was asked for and cache the
   instant; the first session starts at least the configured lead after confirmation; what the student was shown is
   kept so the success screen can say it moved (R-209, R-210, R-211).
6. **Every outcome is a row.** Confirmations, failures and cancellations are appended to `enrollment_events` in the
   transaction that made them, so Phase 4's notifications read them with no change here (R-216).

Scope is the thirty-eight SRS ids PLAN.md lists, the ADR requirements carried into them, the owner's clarifications of
2026-10-31 and the Phase 1 follow-ups timed here; nothing else. Sessions running, cancellations, make-ups, disputes,
reviews, notifications and certificates are Phases 3 and 4.

## Technical Context

**Language/Version**: TypeScript 5.x `strict` on Node 24, as Phases 0 and 1 pinned them.

**Primary Dependencies**: Everything Phases 0 and 1 chose. New: on the phone, `expo-web-browser` (the hosted
checkout, R-217) and `@react-native-community/netinfo` (offline detection for TanStack Query's `onlineManager`); in
`packages/time`, `fast-check` as a dev dependency (R-211). No new API runtime dependency. Versions pinned exactly by the
task that installs each, recorded in its note.

**Storage**: PostgreSQL 18; forty-two tables after this phase (one new, `enrollment_events`), two forward migrations
(T140's checks and the Phase 2 pass, [data-model.md](./data-model.md) §6); Redis for the limiter and the queue
(`confirm-enrollment` is queued; nothing in Redis is the only record of an outcome); the storage port for photos.

**Testing**: Vitest; the coverage floor widens to `modules/booking`, `modules/payments`, `modules/sessions` and
`modules/moderation`; `tests/db-integrity` for rules 36 to 39, the hold races (SC-306), the generation constraints and
the fold; the adversarial suite's procedure harness (R-202); the stand-in harness as the only producer of gateway
events (R-213); double-run specs for the four jobs; properties over every listed zone in `packages/time` (R-211); the
owner's device run of quickstart §3 and §4. Until T124 lands, every run is on `ijazah_integrity`.

**Target Platform**: The owner's Android phone through the development build; evergreen browsers for the panel; Linux
containers for the API and the worker; no staging (Phase 6).

**Project Type**: The three applications of Phase 0; this phase fills `catalog` (packages, slots, discovery),
`booking`, `payments` (checkout, order events, the monitor), `sessions` (generation, re-resolution) and `moderation`
(the compensation case's opening), and the student's and teacher's tabs Phase 1 left as empty states.

**Performance Goals**: Discovery's first page within two seconds on the owner's phone over 4G (SC-310); a confirmed
enrollment visible within the confirmation timeout in 95% of sandbox purchases (SC-309).

**Constraints**: No gateway credential in the suite (SC-302); no paid infrastructure; no number in module code that is
not a setting, a contract bound or a conversion (R-MONEY-12); money only in `payments` and the enrollment's snapshot
(R-MONEY-6); no piaster arithmetic outside `packages/money` (R-MONEY-5); no date arithmetic outside `packages/time`
(R-TIME-1); requirements from the SRS, not the boards (the owner's rule of 2026-10-31); eight working days for one
person, with overflow stated and sent to the descope ladder.

**Scale/Scope**: 38 SRS ids plus the ADR-carried ones; FR-301 to FR-414 and SC-301 to SC-314; 2 migrations, 1 new
table, 5 new columns, 5 settings rows; 23 user-surface procedures and 2 administrator-surface procedures
([contracts/](./contracts/)); 4 jobs; the stand-in's hosted page; about 45 drawn screens and states (screens.md §4 to
§6, §13, §14 and `/payments`).

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design._

| Rule family | This phase's own compliance | Mechanism delivered here | Gate |
|---|---|---|---|
| R-MONEY | Amounts are piasters on the wire and in the snapshot; the one division is `perSession` in `packages/money` (R-212); gross, fee and net only in `payments`, as reported; no balance, wallet, ledger, escrow, refund path or admin money action (FR-411, FR-401) | None new; the money lint rules judge the first money code | **PASS** |
| R-TIME | Slots are local time plus zone; sessions store requested local fields with the instant as a declared cache (ADR 0009); every date computation is a `packages/time` export (R-206, R-209, R-217); no client timestamp in any input | The re-resolution job ADR 0009 D3 has waited for (R-210); gap and overlap properties (R-TIME-7, R-211) | **PASS** |
| R-GENDER | The predicate lives once, takes `RequesterGender`, and every student path filters by its answer; not found is one shape; counts after the predicate (R-201, R-202) | The adversarial suite's procedure harness and its cases, blocking (FR-410, SC-304) | **PASS** |
| R-MOBILE | Every screen from its board as decided; every string from the catalogue (the Phase 2 keys already exist); every colour a token; later phases' controls absent, not disabled (R-MOBILE-13) | The primitives whose contracts already exist (`Slot`, `CategoryTabs`, `FilterChips`, `Stats`) | **PASS** |
| R-API | Thin routers, services with the rules, repositories with the queries; modules reach each other only through `index.ts` and the two inverted bindings (R-207, R-219); every procedure with both schemas; additive snapshot; the port speaks the domain | The row and key locks, the deferred constraints, the database-refusal names (contracts/kernel.md) | **PASS** |
| R-DB | Two forward migrations; one append-only table with its revoke; one encrypted column joining re-encryption; no new index (R-DB-9, analysis C1); nothing derived stored (occupancy, counts, remaining sessions) | Rules 36 to 39 | **PASS** |
| R-SEC | Rate limits on search and payment initiation; signatures verified on the raw body before any handler; the stand-in's page exists only where `fake` is allowed; the hosted URL encrypted at rest | None new | **PASS** |
| R-SESS | No session runs; generation only | None | **PASS** |
| R-HONEST | The phone renders success only from the server's confirmed row; the Confirming state and FR-384's message never claim a failure the server did not report; the teacher sees no date of birth, minor flag, document or dispute history | The R-HONEST-1 confirmation-path test assigned to Phase 2 (contracts/kernel.md, SC-307) | **PASS** |
| R-PROC | Spec, two clarification rounds and plan precede code; requirements from the SRS, board-only behaviour decided by the owner first; every batch one branch, one PR, one review | The coverage floor widened | **PASS** |

**Review-only tier.** Live in this phase: R-API-5 (the port's names stay the domain's, R-213), R-DB-9 (no new index
without a measured slow query, analysis C1), R-PROC-3 (no rule invented at the keyboard: the overlap, freeze, lead and fold rules are the
owner's), R-MOBILE-3, R-MOBILE-12 and R-MOBILE-14 (the new screens).

**Gate result: PASS.** No unjustified violation; two structural costs are recorded in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/003-booking/
├── plan.md              # This file
├── spec.md              # Feature specification, clarified 2026-10-31
├── research.md          # Phase 0 output — 22 decisions (R-201 to R-222)
├── data-model.md        # Phase 1 output — 1 table, 5 columns, the fold, rules 36–39, 5 settings rows, 2 migrations
├── quickstart.md        # Phase 1 output — validation guide, the device run marked as the owner's
├── contracts/
│   ├── README.md
│   ├── app-surface.md   # 23 user-surface procedures and the public configuration's additions
│   ├── admin-surface.md # 2 administrator-surface procedures
│   ├── gateway.md       # The port as called, the webhook's order branch, the stand-in's page and harness
│   └── kernel.md        # Locks, deferred constraints, the composition root, the jobs, the gates
├── checklists/
│   └── requirements.md  # Spec quality checklist, all items passing
└── tasks.md             # Written by /speckit-tasks
```

### Source Code (repository root)

Only what this phase adds or first fills.

```text
apps/
├── mobile/src/
│   ├── app/(student)/
│   │   ├── (tabs)/index · discovery · enrollments   # filled from their empty states
│   │   ├── discovery/[teacherId].tsx                 # the profile; the booking sheet over it
│   │   ├── checkout/index · processing · confirmed · failed · expired · previous · slot-unavailable
│   │   └── enrollments/[id].tsx · enrollments/ended.tsx
│   ├── app/(teacher)/
│   │   ├── (tabs)/index · students · availability · packages   # filled
│   │   ├── packages/[id].tsx · profile.tsx
│   │   └── students/[enrollmentId].tsx · students/ended.tsx
│   ├── features/student/discovery · booking · checkout · enrollments · home
│   ├── features/teacher/packages · availability · students · home · profile
│   ├── design/primitives/        # Slot, CategoryTabs, FilterChips, Stats (contracts exist), a countdown line
│   └── lib/                      # formatPounds, the onlineManager over netinfo, the AppState refetch
│
├── admin/src/pages/payments/     # AdminPayments: list, detail, timeline; AdminNav entry
│
└── api/src/
    ├── modules/
    │   ├── identity/             # visible-teachers.repository (the predicate), teacher-profile router, the folded-name search entry
    │   ├── catalog/              # packages, slots (the overlap check under the key lock), discovery.service (cards)
    │   ├── booking/              # holds, enrollments, enrollment_events, offerable slots, discovery and lists routers, termination subscriber
    │   ├── payments/             # checkout router and service, order-events service, payments-admin router
    │   ├── sessions/             # generation.service, lastSessionDateOf
    │   └── moderation/           # openCompensationCase
    ├── platform/
    │   ├── db/                   # row-lock.ts, deferred-constraints.ts, db-errors.ts
    │   ├── ports/payment/        # the stand-in's hosted page and configurable cancel
    │   └── web/                  # the stand-in page's route (development and test only)
    └── jobs/                     # confirm-enrollment, expire-pending-payments, expire-holds, reresolve-session-instants

packages/
├── time/src/                     # firstOccurrenceAfter, requested fields on Occurrence, weeklyIntervalsOverlap, secondsUntil (calendar)
├── money/src/                    # perSession, lowest
└── contracts/src/                # teacher-profile, packages, slots, discovery, booking, checkout, enrollments; admin/payments

prisma/schema · prisma/migrations # data-model §2 and §6
tests/
├── adversarial/                  # the procedure harness and Phase 2's cases
├── db-integrity/                 # rules 36–39, the hold races, generation, the fold
└── support/gateway-stand-in.ts   # the only producer of gateway events
```

**Structure Decision**: The twelve modules of Phase 0, filled where this phase's stories land, with one rule for the
graph: `identity` imports none; `catalog` imports `identity`; `sessions` and `moderation` import none; `booking`
imports `identity`, `catalog` and `sessions`; `payments` imports `booking`, `identity` and `moderation`; `admin`
imports any. Catalog's need to know whether a slot or package is in use is a port bound in `main.ts` (R-207); booking
reacts to account terminations by subscribing to identity's registry (R-219). Discovery's procedures live on booking's
router because the card's nearest slot needs holds and enrollments, which catalog cannot read (R-205).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| A two-step read for every student path (identity's visible ids, then the module's own tables) rather than one SQL join | R-API-6 gives `users` and `teacher_profiles` to identity, and R-GENDER-5's rule judges the repository that returns teachers; the two-step read is the only shape that keeps both, and at the launch cohort's size it is one indexed read more | A join across modules or a view over identity's tables: one query, but a back door the module-tables gate cannot see, and the predicate would then exist in two places |
| A new table, `enrollment_events`, for outcomes the enrollment row already reflects | A late payment reverses a cancellation (FR-PAYG-19), so the current row loses the history a notification needs; the owner asked for the outcomes to be recorded so Phase 4 changes nothing here (FR-385) | Reading `enrollments`' columns, or the queue: the first loses history, the second is lost with Redis |

## Phase Outputs

- **Phase 0 — Research**: [research.md](./research.md). Twenty-two decisions, R-201 to R-222; none awaits the owner —
  the owner's decisions of 2026-10-31 were taken at specification and clarification.
- **Phase 1 — Design**: [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md).
- **Phase 2 — Tasks**: `tasks.md`, written by `/speckit-tasks`.

## Post-Design Constitution Re-Check

Re-evaluated after the design artefacts were written. No gate changed from PASS; the design surfaced five points
worth recording, and the owner's review of 2026-11-01 a sixth and two conditions:

1. **T140's line changes.** It says `price_piasters >= 0` and leaves the lengths open; the owner's decisions of
   2026-10-31 make the check `> 0` and the lengths `IN (30, 45, 60)`. The line in `specs/002-identity/tasks.md` is
   amended in this cycle so that the task is implemented as written.
2. **Every admin read writes an audit entry.** `adminProcedure` refuses a call that records none
   (`surfaces/procedures.ts` line 535), so the monitor's two reads write `payments.listed` and `payments.viewed`, as
   Phase 1's reads do. The monitor still writes nothing else.
3. **The hosted checkout's address is kept, encrypted.** FR-BOOK-12 (c) offers "continue the previous payment", which
   needs the address the gateway returned; it may carry a payment token, so it is a secret column (R-DB-8) cleared
   when the order is no longer payable. The owner's conditions of 2026-11-01: it is read back only for the student who
   owns the order, only while the order is `created` and before its `expires_at`, and never logged (data-model
   §2.4.1).
4. **Account deletion now reaches holds and pending enrollments** (R-219). Phase 1's deletion writes no enrollment.
   FR-AUTH-14's remaining part (a deleted student's sessions `cancelled_by_admin` and confirmed enrollments
   `account_deleted` with no compensation case; a deleted teacher with FR-SESS-16's effect) needs this phase's
   enrollments and Phase 3's session cancellation, so it is a task of `tasks.md` timed Phase 3's first batch (the
   owner's decision of 2026-11-01).
5. **`packages/money` gains its first operation.** Its header says none is added until a requirement names it; FR-337
   names the per-session price, rounded half up to the piaster, for display only.
6. **Discovery's order is total** (R-204, the owner's decision of 2026-11-01). `average_rating DESC NULLS LAST`, then
   the review count, the name, and the id last, in the ORDER BY and the keyset condition alike, so a teacher with no
   review never tops the list and a page boundary between two teachers of one name neither repeats nor skips a card.
   The keys are identity's columns, so identity's `visibleTeacherPage` orders and pages through Prisma, and catalog
   passes only candidate ids (analysis C2, R-API-6). Three specs: the unrated teacher last, the same-name boundary, and a
   page ending on an unrated teacher followed by a page that repeats and skips no one. Ranking a lone 5-star review above 4.9 from a hundred is a follow-up for later.

**Re-check result: PASS.**
