---
description: 'Task list for the ijazah programme — the assessment and prepaid monthly instalments'
---

# Tasks: The ijazah programme — the assessment and prepaid monthly instalments

> **Amended 2026-11-21 (the owner's decisions on the full-codebase review; SRS DEC-100 and DEC-92 as amended; PLAN.md).** The programme ships in the first release, built before the design week and the store's preparation, its screens on today's design. The lines below that say «beside the design week», «the screens after it, on the new design» or «merged by 12/4, else v1.1» are replaced by this; the fallback to v1.1 is removed.

**Input**: Design documents from `/specs/006-programme/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Included.
- **Full TDD** (each spec red first on its own, negatives red under a named mutant, every mutant restored and
  `cmp`-checked) for money and time: T001, T002, T004, T005, T006, T007, T008, T009, T010, T011, T012, T013, T014, T015, T016,
  T017.
- **Lighter specs** (a render or behaviour spec per screen, Arabic and English) for T019, T020, T021.
- `advance-programmes` and the changed jobs have their double-run specs (R-API-14).
- **Adversarial (R-PROC-5):** every task that adds a user procedure registers it in `tests/adversarial`, both gender
  directions, in its own batch; T022 is only the final reach check.
- DB specs run on `ijazah_integrity_b` only (track 2).

**Organization**: the foundations, then the stories of spec.md in priority order, then the screens and the proofs,
in the batches B-P1 to B-P4. DEC-92: the server beside the design week, the screens after it; all merged by 12/4,
else v1.1. At most six tasks a batch, a task in at most two lanes. Revised after the analysis of 2026-11-19
(`ejazah-tools\track2\b-m4\analyze-triage.md`) and DEC-94.

**The owner's answers (all settled, 2026-11-19).** DEC-92 (Q-1 to Q-4), DEC-93 (clarify), and DEC-94:
- the assessment's share;
- the 48 hours from the offer;
- the offer within 24 hours, else an Administrator item (I-2 (a));
- the fee seeded 0 (P1 (a));
- the old ijazah packages deactivated when `programme_enabled` is turned on (P2 (a), T002);
- the switch (I-3);
- the student's own weekly time protected (U-1);
- FR-PROFILE-8 for the programme (I-1);
- a teacher suspended, banned or gone handled as today (G-4): a suspension pauses (no due, no charge, no retry, no pause; the card deleted); a ban, a departure or an Administrator's end of a suspended programme ends it, with DEC-85's full refund;
- PR #153's review, round 1 (the owner's «Approve all», 2026-11-20): every finding fixed, and the student can turn the
  automatic renewal off (Major 4 (a), DEC-95).

No open question remains.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on incomplete work).
- **[Story]**: US1–US6 of spec.md.
- A task of another file is written `003:T105`; a bare id is this file's. Every task names its file paths.

## Path Conventions

`apps/api/src/` (`modules/<module>/`, `platform/`, `surfaces/`, `jobs/`, `main.ts`, `worker.ts`), `apps/mobile/src/`,
`apps/admin/src/`, `packages/contracts/src/`, `packages/money/src/`, `prisma/`, `tests/`.
- Batches are cut from `develop` after `003:T108`'s PR merges, as `Ejazah_app/006-programme/<ids>`.
- The integration owns, each in a `006:` block:
  - `main.ts`, `worker.ts` (the new job's registration);
  - `surfaces/context.ts`, `app.router.ts`, `admin.router.ts`;
  - `packages/contracts/src/index.ts`;
  - the snapshot.

## Phase 1: Foundations (B-P1)

- [x] T001 The migration, the schema and the ERD (data-model.md; R-501, R-502, R-503, R-507, R-510, R-513):
  - A forward migration stamped after the latest merged one, the enum values committed first:
    - `order_kind`, `decline_kind`, `programme_state`, `programme_plan`, `programme_request_kind`,
      `programme_request_status`;
    - `cancellation_reason` + 4, `share_release_milestone` + 2, `enrollment_event_kind` + 4,
      `payment_event_type` + `card_saved`.
  - Then:
    - `payments.kind`, `instalment_month`, `attempt`, `automatic`, `decline_kind`, `confirmed_at`, and
      `gateway_order_id` made NULL-able under its check (automatic `created`, `expired`, or `failed` with
      `decline_kind = 'hard'` only; N-3, PR #153 r3 Major 1);
    - `packages.is_programme` and the three prices, with the three old columns made nullable under the check;
    - `sessions.programme_month`;
    - `programmes`, `programme_requests`, `programme_cards` with their checks and indexes.
  - No existing row is changed (P2 (a): the old ijazah packages are deactivated by turning the switch on, T002).
  - `prisma/schema/{base,booking,catalog,payments,sessions}.prisma`; `packages/config/module-tables.json`.
  - `docs/ERD.md`: a dated block at its end, rows from 65 and §15 rules from 70.
  - `tests/seed/seed.spec.ts` table count 45 + 3.
  - A migration spec red under a mutant migration.
  > **B-P1's conflict check, Q-2 (a) (the owner, 2026-11-22, «موافق على س2 وس3 وس4 (أ)»).** `gateway_order_id`
  > NULL-able as written; the reads that need a string (`modules/payments/checkout.repository.ts`,
  > `payments-monitor.repository.ts`) refuse a NULL with an invariant error until T014 writes one; the monitor's contract
  > stays `string` (T014/T018 widen it). ERD rows 65–73 and §15 rules 70–81 (R1a: rows 62–64, rules 67–69, agreed
  > 2026-11-22); the ERD footer, `module-tables.json`, `tests/seed/seed.spec.ts:346` 45 → 48 and
  > `tests/seed/migrate-from-empty.spec.ts:96` 48 → 51 (50 and 53 at the second merge with R1a).
  > **Done (B-P1, 2026-11-22).** Migration `20261122110318_ijazah_programme` (the enum values first): `payments`'
  > six columns with `gateway_order_id` NULL-able under rule 72, `packages.is_programme` and the three prices (rules
  > 73–74), `sessions.programme_month`, `programmes`, `programme_requests`, `programme_cards`; ERD rows 65–73, rules
  > 70–81, the footer 51; `module-tables.json`; the seed spec 48 tables, `migrate-from-empty` 51. `programmes.pay_by_at`
  > (Q-A1 (a): ERD §0's `_at`), `month_count` kept as a snapshot (Q-A2 (a), `schema-check.ts`). The two Q-2 readers refuse
  > a NULL gateway id. `ijazah_integrity_b` rebuilt from empty on the owner's word (2026-11-22). The migration spec: 61
  > cases, each red against the base and under 19 mutants.
- [x] T002 [P] The settings and the switch (R-515; FR-732; I-3, P1 (a)):
  - `apps/api/src/platform/settings/registry.ts`:
    - a new unit `piasters`;
    - the eight keys in track 2's block, `programme_enabled` off, `assessment_price_piasters` 0 = unset, `programme_offer_hours` 24;
    - if the bounds shapes refuse a boolean, a `count` 0/1.
  - `prisma/seed.ts` after `postponement_interval_weeks` (`:185`); `tests/seed/seed.spec.ts` 95 → 103.
  - Both admin catalogues' labels (`tests/admin-i18n/settings-labels.spec.ts`).
  - Turning the switch on deactivates every old-style ijazah-track package (`modules/catalog/packages.service.ts`, an
    audited effect of the setting's change, logged once). It gates only new programme packages and new assessments;
    turning it off stops no running programme and reactivates nothing (N-4), red first.
  > **B-P1's conflict check, Q-3 (a)(a) and Q-6 (the owner, 2026-11-22; SRS DEC-110).** The switch's effect is a
  > catalog entry called by `settings.update` on its transaction, its own audit entry `packages.retired_by_switch` with
  > the count, and one log line `{ adminId, count }`. While the switch is on, `teacher.packages.update` refuses
  > reactivating an old-style ijazah package with a named code, red first; turning it off reactivates none. Q-6 («تظهر
  > جنيه فقط»): the unit `piasters` is shown and typed in pounds only, with no «قرش» label, and stored in piasters:
  > `apps/admin/src/pages/settings/words.ts` `boundsText`, `draftOf` and `parsedDraft` convert it, the value shown
  > through `formatPounds` (`lib/format.ts`), typed with at most 2 decimals and × 100 to whole piasters; a spec in
  > `pages/settings/settings.spec.tsx` red first («150» typed stores 15000), and a negative under a mutant. Outside
  > files: `modules/admin/settings.service.ts`, `admin/index.ts`, `admin/settings.router.ts`, `modules/catalog/index.ts`,
  > `apps/admin/src/pages/audit/actions.ts`, `packages/contracts/src/admin/settings.ts`,
  > `apps/admin/src/pages/settings/words.ts`, `apps/admin/src/pages/settings/settings.spec.tsx`. Settings 95 → 103 (107
  > at the second merge with R1a).
  > **Done (B-P1, 2026-11-22).** The eight keys (`assessment_price_piasters` by Q-B4 (a), R-MONEY-6), the seed 103,
  > both catalogues; the switch's turn-on deactivates the old ijazah packages on its own transaction (audit
  > `packages.retired_by_switch` with the count, one log line); `programme_switch_on` refuses a reactivation while it is
  > on; the fee shown and typed in pounds only (`packages/money`'s `piastersOfPoundsText`/`poundsText`, Q-B1 (a)); kernel.md's
  > `006:T002` row.
- [x] T003 [P] The contracts (contracts/*):
  - `packages/contracts/src/programme.ts`, `packages/contracts/src/admin/programme.ts`;
  - the package output as a union by track (recitation and pre-switch ijazah unchanged, non-null; K-3);
  - discovery, slots, monitor and restore changes;
  - `idempotent-procedures.ts`;
  - every refusal code named;
  - the snapshot regenerated.
  > **B-P1's conflict check, Q-4 (a) (the owner, 2026-11-22).** The union's discriminant is `isProgramme`; the mobile
  > readers the type check names narrow to today's member until B-P4's screens (T019, T020).
  > **Done (B-P1, 2026-11-22).** `programme.ts`, `admin/programme.ts`, the package union on `isProgramme`, the enum
  > members, the monitor's optional fields, `idempotent-procedures.ts`'s eight mutations, the snapshot. The money names
  > carry `_piasters` (R-MONEY-2; the fee `assessmentPrice_piasters`, R-MONEY-6 (b); Q-C1). Six phone readers narrow to
  > today's member until B-P4.
- [x] T004 [US1] The three prices and the catalogue (FR-704, FR-704a; R-503, R-516), behind `programme_enabled`:
  - `modules/catalog/packages.service.ts`, `packages.repository.ts`, `packages.router.ts`: a programme package takes
    `prices {m30, m45, m60}`; publishing is refused `assessment_fee_unset` while the fee is 0.
  - Discovery: `assessmentFee`, `priceRange`.
  - DEC-88's average per length (T113's read).
  - Every reader of the three old columns branches on `is_programme`.
  - Adversarial registrations of the changed reads.
  > **B-P1's conflict check, Q-5 (a) (the owner, 2026-11-22, «س5 (أ) تمام»).** A programme package is created or
  > activated only while the fee is above 0 (`assessment_fee_unset`; a draft allowed); discovery and `booking.slots`
  > show none while the fee is 0 or the switch is off. Platform-funded promotions are v1.1.
  > **Done (B-P1, 2026-11-22).** Packages by shape (`PackageRow`, `BookablePackage` unions), `programmeAvailabilityOf`,
  > `priceForLength`; the create/update rules (`programme_switch_on`, `programme_disabled`, `assessment_fee_unset`, a draft
  > allowed); discovery's `prices`, `priceRange`, `assessmentPrice_piasters`, none shown while closed; DEC-88's programme
  > pool (kept counting while the switch is off, the owner's (a)); the nearest slot at the assessment's length. Q-D1 (a):
  > one advisory key `programme-switch` taken by an old-style create or edit and by the turn-on (kernel.md `006:T004`).
  > **Follow-up (PR #156 r1 nit, 2026-11-22).** `catalog/discovery.service.ts` `highestOf` compares piasters beside
  > `packages/money`'s `lowest`; a `highest` in `packages/money` keeps the pair together. A file outside B-P1's list,
  > so it waits for the batch that next touches discovery's price range, red first on its own spec.
- [x] T005 [US1] The assessment's booking and confirmation (FR-701, FR-702; R-504, R-511; U-1):
  - **Slots:** `modules/booking/booking-slots.service.ts:198` and `holds.service.ts:505` take a weekly time of length ≥
    the assessment's for a programme package, and refuse one overlapping the student's own active
    programme's weekly time (active = `awaiting_offer`, `offered`, `active`, `paused`). The same time is excluded from
    the make-up proposal and counter options and the postponement's placement of the student's other enrollments
    (`modules/sessions/remedy-offer.service.ts`, `remedy.service.ts`, `postponement.service.ts`; sessions' area,
    coordinated; N-12).
  - **The order:** `modules/payments/checkout.service.ts` `#createAndRecord` writes an `assessment` order, gross = the
    fee, with the rate and 25 % read as today.
  - **Confirmation:** `jobs/confirm-enrollment.ts` generates session 1 only, at the assessment's length
    (`sessions/generation.service.ts`, `GenerationPlan {count: 1, firstSequenceNumber: 1}`).
  - **The programme row:** `modules/booking/programmes.*` writes it `awaiting_offer`; the snapshot holds count 1, the
    assessment's length and the fee.
  - **Snapshot readers:** the inventory of `snapshot_session_count`/`duration`/`price` readers is written and each is
    tested for a one-session enrollment (U-8).
  - Adversarial registrations.
  > **B-P1's conflict check, Q-7 (a) (the owner, 2026-11-22, «س7 أ»).** The outside files of T005 and T006 named in the
  > conflict check are approved; any further one is batched at the lane's end.
  > **Done (B-P1, 2026-11-22).** `booking/programmes.*`; a programme package booked as its assessment (one session at
  > `assessment_duration_minutes`, the fee) on the sheet, the hold, the summary, current, pay and retry; the student's
  > active programme time busy everywhere (U-1) and for the make-ups (N-12, `EnrollmentSide.programmeTimesOf`); the order
  > `kind = 'assessment'`; session 1 only and the row `awaiting_offer`. A closed programme answers an empty slot list (the
  > hidden-times rule, Q-5 (a)). The U-8 inventory: `ejazah-tools\track2\runs\b-p1\lane-e\u8-inventory.md` (21 readers).
- [x] T006 The confirm step by kind (FR-718; R-502; V-3), `jobs/confirm-enrollment.ts:229-284`:
  - the per-order marker `payments.confirmed_at`;
  - expected kinds skip the cover and case gates; one paid during an open `teacher_suspended` or `student_suspended`
    case opens a case instead of generating (PR #153 r1 Minor 2);
  - a no-hold path for `rest_in_full` and `instalment` (generation only, under the enrollment's lock, from max+1 with
    `programme_month`);
  - a second paid order for a paid month → `duplicate_payment`;
  - a refused generation never cancels a programme (the order stays paid, a case, a log line);
  - `package` orders unchanged.
  - Specs: a replay; month m+1 paid while m's case is open; two paid events for one month (DB race).
  - The kernel.md row for programme → enrollment → payment (`specs/004-sessions/contracts/kernel.md`, coordinated with
    track 1).
  > **Follow-up (PR #153's review, round 3, outside the round; the review session's word, 2026-11-20).** Unverified: the
  > close hook (R-510) sets `programmes.state` from booking's cancel path, and the termination subscriber reaches that
  > path holding the enrollment's lock, which would be enrollment → programme, the reverse of kernel.md's programme →
  > enrollment. T006's kernel.md row states where the close hook takes the programme's lock (before the enrollment's,
  > or a key-share that cannot deadlock), with a DB race spec of a termination against the sweep. Passed to the
  > money-lane review. Not scheduled apart from T006.
  > **B-P1's conflict check (2026-11-22).** The close hook's lock order stays with the 11/30 money review; T006's
  > `kernel.md` row states the confirm step's own order only.
  > **B-P2 (the owner, 2026-11-23, «موافق على الكل (أ)», Q-2 (a)).** The close hook's lock order is settled in T008
  > (the programme before the enrollment on every cancel path), with its race spec; the 11/30 money review checks it.
  > **Done (B-P1, 2026-11-22).** The per-order `confirmed_at`; the expected kinds skip the cover and case gates; a month
  > paid during an open suspension case opens `party_restricted` (PR #153 r1 Minor 2's precedent); the no-hold path from
  > max+1 with `programme_month`; a second paid month → `duplicate_payment`; a refused generation opens a case and cancels
  > nothing; the programme row locked by `enrollment_id` (`row-lock.ts`); kernel.md's T006 row (T008's close hook takes
  > the same order).
  > **Integration note (B-P1, 2026-11-22).** `specs/004-sessions/contracts/kernel.md:9`'s one-order list does not name
  > `programmes`; T006's row states it. The shared line is track 1's too, so it is amended at an integration both
  > tracks agree.

## Phase 2: The offer, the first payment and the money (B-P2)

- [x] T007 [US2] The offer (FR-705; R-506), `programme.offer`, in `modules/booking/programmes.service.ts`,
  `programmes.repository.ts`, `programmes.router.ts`:
  - **The harness first (PR #153 r1 Major 2):** `tests/adversarial/procedure-harness.ts` adds `programme` to the routers
    reached whatever the caller kind (beside `SESSION_ROUTERS`, `:268`) and to the never-exempt `ATTACKED_ROUTERS`
    (`:287-291`), red first with an unregistered `programme.*` fixture of each caller kind (#142 r1 Major 1).
  - the length ≤ the reserved time's;
  - the count 1–200;
  - the total = N × the price for that length, under the package's lock;
  - the offer and the snapshot (N+1, length, total) in one transaction, frozen after.
  - Refusals red first: `assessment_not_delivered`, `not_awaiting_offer`, `offer_due_passed`, `length_exceeds_slot`,
    `count_out_of_bounds`, `teacher_not_active`.
  - The amounts from `packages/money` through payments' entry (K-5).
  - A live `enrollment` signal after commit; adversarial registration.
  > **B-P2's conflict check (the owner, 2026-11-23, «موافق على الكل (أ)»).** `programme` is a list of its own beside
  > `SESSION_ROUTERS`, read by the reach and spread into `ATTACKED_ROUTERS`, not inside `SESSION_ROUTERS` (whose FR-496
  > kinds do not apply). «Under the package's lock» is the teacher's `users` row, the lock every price writer takes
  > (kernel.md, the `006:T002` row), then `programmes`, then `enrollments`. The amounts come from a payments function
  > exported from `payments/index.ts` (K-5).
  > **PR #156 r2 Minor 2 (carried, Q-6 (a)).** The offer's snapshot price is written from
  > `booking/programmes.repository.ts`, so `tests/pipeline/admin-writes-no-money.spec.ts`'s `allowedBecause` names it
  > with `006:T007`; in the same change it names `price30Piasters`, `price45Piasters` and `price60Piasters` for
  > `catalog/packages.repository.ts` with `006:T004`, the scanner reads those keys inline or follows a same-file
  > function's returned object, and the listing pins `insertPackage` and `changePackage` again; red first on M-G7 (a
  > price written from an admin file through a helper's return).
  > **Done (B-P2, 2026-11-23).** The harness reach (`PROGRAMME_ROUTERS`); `programme.offer` under users → programmes →
  > enrollments, the snapshot frozen, six refusals; the amounts from `packages/money` (K-5); one `programme_offered`
  > event; the money guard follows a same-file helper (Minor 2); attacks in both gender directions.
- [x] T008 [US2] The 48 hours, the cancellation, the refusal and the missing offer (FR-706, FR-707, FR-709; R-505, R-513; I-2 (a)):
  - `offer_due_at` = the delivered assessment's end + 24 h (set when session 1 is `done`; a make-up moves it); `pay_by` = the offer + 48 h;
  - no offer by `offer_due_at` → the `no_offer` Administrator item (never a lapse; the weekly time stays reserved); `programmes.decide` approve (a refusal) or extend (`programme_offer_hours` more, counted from the decision);
  - `programme.cancel` (`offer_declined`);
  - `programme.request` `refusal` and `programmes.decide` approving it (`assessment_refused`);
  - session 1's outcomes: `done` or `student_no_show` start the offer window; a no-show of the teacher, a both-no-show,
    a cancellation by agreement or a postponement wait for the make-up; any other end with no make-up pending opens
    the `no_offer` item 24 h after its scheduled end (analyze N-2);
  - the `no_offer` item's decisions: approve (a refusal) or extend (closed `extended`, a new item at the new
    deadline); no decline (N-10);
  - the lapse (`offer_lapsed`), the `pay_blocked` item and the `no_offer` item as pure functions for T015;
  - **`pay_blocked` (FR-706b, SRS DEC-101; PR #153 r4 follow-up 2):** `offered` past `pay_by` unpaid while, in live
    mode, the teacher's payout account is not verified at that instant raises the item, once per deadline, in place of
    the lapse; the weekly time stays reserved. `programmes.decide` on it: approve (the lapse, `offer_lapsed`) or extend
    (`pay_by` = the decision + `programme_pay_rest_hours`; closed `extended`); no decline.
    - «Unverified in live mode» is one payments entry, built here and read by T016 and T018: the payment mode is live
      and `payoutRecipient(teacherUserId)` answers none (`modules/payments/checkout.service.ts:508`) (PR #155's review, round 1, N4).
    - While the item is open the lapse never runs, also not once the account is verified; `programme.pay` answers
      `pay_by_passed`; only `programmes.decide` ends it, or a close (the student's `programme.cancel`, a ban, a
      departure, a deletion), which sets the item `withdrawn` in the close hook (Major 1).
    - `programmes.decide` takes the programme's row lock, the lock of the sweep's step.
    - Red first: «unverified in live mode: no lapse, one item», «the same in test mode lapses», «verified while the
      item is open: no lapse», «the student's cancellation withdraws the item», and a race spec of the decision
      against the sweep;
  - each close through booking's close hook (programme state and `closed_at` set by booking; the card deleted by
    T013's payments entry; until T013, a stub whose call the specs assert), freeing the weekly time at once
    (`slot-occupancy.repository.ts`).
  - Live signals; adversarial registrations.
  > **B-P2's conflict check (the owner, 2026-11-23, «موافق على الكل (أ)»; Q-3 amended, «موافق على التعديل»).**
  > - Q-2 (a): the close hook is built here and wired into every cancel path that can close a programme today (the
  >   termination subscriber's `cancelConfirmed`; booking's `cancel`, `terminateNoShow` and `complete`), each taking
  >   the programme's row before the enrollment's (kernel.md's order), with a kernel.md row and a DB race spec of a
  >   termination against `programmes.decide`; T013 replaces only the card stub. This closes the follow-up under T006.
  > - Q-3 (a), amended: while the programme is `awaiting_offer`, booking derives `offer_due_at` from session 1's
  >   current outcome chain on every read (in `programme.offer` and in the window function T015 runs) and writes the
  >   derived value: session 1's, or its delivered make-up's, scheduled end + `programme_offer_hours`. It is never set
  >   once at the first read; the column holds the last derived value, because session 1's outcome can change after it
  >   settles (`reresolution.repository.ts:90`, `admin-outcome.repository.ts:33`, `dispute-raise.repository.ts:33`).
  >   Example: done Mon 18:00 → due Tue 18:00; re-resolved Tue as a teacher's no-show, the make-up delivered Thu 18:00
  >   → due Fri 18:00. Red first on that case: a re-resolution to a make-up moves the deadline, and no `no_offer` item
  >   opens at the old one. No sessions writer changes.
  > - Q-7 (a): `programmes.decide` lives in `modules/booking/programmes-admin.router.ts`, mounted as `programmes` in
  >   `admin.router.ts`'s `006:` block.
  > - «Unverified in live mode» reads `payoutRecipient` (`checkout.service.ts:243`, called at `:561` on `34744575`)
  >   and the payment mode handed to payments by `main.ts`'s `006:` block. «Once per deadline» = no item of the kind
  >   created at or after the current deadline.
  > **Not scheduled, a rare case (PR #155's review, round 1, the reviewer's question; the owner, 2026-11-22, «موافق على التلاتة»).** FR-706b reads the
  > payout account when the 48 hours end. An account unverified for most of them and verified shortly before the end
  > leaves the student little time, and the offer lapses as FR-706 says (fee 200 EGP: the teacher's 140 released). Left
  > as it is (the owner again, 2026-11-22, on PR #155's review, round 2, Major 1: «حاول تقفلها بدون ضرر»). A lapsed offer has
  > no reopen (`programmes.reopen` takes a `programme_stopped` programme only, R-513; T017 is not widened): the student
  > reaches support and books a new assessment, and an Administrator may open a manual compensation case for the fee
  > (SRS FR-ADMIN-20 (c)). The wider rule (an item whenever payment was
  > closed at any time inside the 48 hours) needs a recorded instant of the closing; recorded for later.
  > **Not scheduled, a rare case (B-P2 lane b, 2026-11-23; the review session).** An offer accepted while a `no_offer`
  > item is open, after session 1's outcome chain moved the deadline later (a re-resolution or a dispute's outcome),
  > leaves that item open in the queue. The administrator's side is guarded: `programmes.decide` approving it is refused
  > `offer_sent`, so nothing is ended; the item closes with the programme (the close hook withdraws it).
  > **The owner, 2026-11-23, «لا متخليش في زر رفض الطلب في التصميم / لازم بقى يخش يكلم الدعم من الاعدادات ومش هنوضحله
  > ده» (SRS DEC-112).** The bullet «`programme.request` `refusal` and `programmes.decide` approving it» above no longer
  > holds: the teacher's app has no refusal request.
  > - `programme.request` takes `stop` only (T017's): the `refusal` kind leaves its input
  >   (`packages/contracts/src/programme.ts:182`), its refusals `assessment_not_delivered` and `offer_sent` (`:198-199`),
  >   the service branch, its attacks and its specs; the snapshot regenerated. The `programme_request_kind` value
  >   `refusal` stays in the database, unused (no migration; data-model.md, ERD changelog row 75).
  > - The refusal is the `no_offer` path built here: the teacher tells support and sends no offer; at `offer_due_at` the
  >   item opens; `programmes.decide`'s approve is the refusal (`assessment_refused`, the fee kept, the weekly time freed
  >   at once through the close hook, the assessment's share per DEC-94). `programmes.decide` loses its `refusal` branch.
  > **The owner, 2026-11-23, «بس خلي جنب مفيش عرض السبب اللي العرض متعملش بسببه او اللي المعلم بعته يعني» (SRS
  > DEC-112).** `programmes.decide` on a `no_offer` item (approve or extend) requires `reason` (1–500), the
  > administrator's record of what the teacher sent to support, written to `programme_requests.reason` in the decision's
  > transaction (nullable, `prisma/schema/booking.prisma:214`; rule 80's check,
  > `prisma/migrations/20261122110318_ijazah_programme/migration.sql:258-260`, lets it through; no migration). Not
  > `note` (`adminReason`, 1–1000, `packages/contracts/src/admin/admins.ts:10`). Without it the decision is refused
  > with a cause of `programmesDecideRefusal`, writes nothing and logs ids and the cause, never the text. «Required» is
  > the service's rule, not a database check. Red first: «a `no_offer` decision without a reason is refused», «the
  > reason is written on the item».
  > **The owner, 2026-11-23, «موافق عالكل» (SRS DEC-112; Q-B5 (a)).** `programmes.decide` refuses approving a
  > `no_offer` item while session 1's make-up is pending; the cause joins `programmesDecideRefusal`, red first.
  > **The owner, 2026-11-23, «موافق عالكل» (SRS DEC-112; the three audit labels, as proposed).** Written to
  > `apps/admin/src/pages/audit/actions.ts` and both catalogues (`apps/admin/src/i18n/ar.json`, `en.json`):
  > `programme_request.approved` «اعتماد طلب في برنامج الإجازة» / "Programme request approved";
  > `programme_request.declined` «رفض طلب في برنامج الإجازة» / "Programme request declined";
  > `programme_request.extended` «تمديد مهلة في برنامج الإجازة» / "Programme deadline extended".
  > **Done (B-P2, 2026-11-23).** `offer_due_at` from session 1's outcome chain on every read; the windows as pure
  > functions and `createProgrammeWindows` for T015; «unverified in live mode»; the close hook, the programme before the
  > enrollment on every cancel path (race spec against `programmes.decide`); `programme.cancel`; `programme.request` `stop`
  > only (DEC-112); `programmes.decide` with `reason_required` and `makeup_pending`; the three labels.
  > **PR #158 r1 Follow-up 1 (a) (the owner, 2026-11-23, «صلح ومتابعة أ»; FR-BOOK-15, «after the assessment»).**
  > `programme.cancel` is refused `assessment_not_settled` (a new cause of `programmeCancelRefusal`, additive, the
  > snapshot regenerated) until session 1's outcome chain (sessions' `assessmentOutcome`) is consumed, `done` or
  > `student_no_show`: still to come, waiting for its make-up, or ended with no assessment held. Nothing is written;
  > one line of ids and the cause. Red first in `tests/db-integrity/programme-windows.spec.ts` («still to come»,
  > «waits for its make-up», «ended with no assessment held»), then under M-F1.
- [x] T009 [US2] Paying in full or a month (FR-710 to FR-713; R-507, R-511), `programme.pay`, in
  `modules/booking/programmes.service.ts`, `programmes.router.ts`, `modules/payments/checkout.service.ts`,
  `checkout.repository.ts`:
  - no hold; expiry = min(`slot_hold_ttl_minutes`, `pay_by`); FR-BOOK-12's one checkout per student;
  - refused `party_suspended` while a `teacher_suspended` or `student_suspended` case is open (PR #153 r1 Minor 2);
  - `rest_in_full` = total − fee (refused `rest_not_positive` if ≤ 0), or `instalment` month 1 = 4 × the session price (with N < 4, the whole N: the remainder rule of FR-711);
  - the rate and 25 % copied from the assessment order;
  - the confirm step (T006) generates sessions 2..N+1, or month 1's 4, from the first weekly occurrence after `pay_by`
    (no lead), with `programme_month`;
  - `saveCard` records the consent.
  - Adversarial registration.
  > **PR #156 r2 Follow-up 1 (carried, Q-6 (a); first, before any `instalment` order).** `payments.confirmed_at` is the
  > worker's clock read before the locks (`jobs/confirm-enrollment.ts:581`, handed on at `:427-428`), so the walk
  > (`confirmed_at`, `id`) can differ from the order the months were settled in (PROBE-R2a: month 3 opened
  > `duplicate_payment`). `markOrderConfirmed` (`payments/payments.repository.ts:161-170`) takes the instant from the
  > database under the locks (`clockTimestamp`, `clock_timestamp()`), red first on PROBE-R2a.
  > **PR #156 r2 Minor 1 (carried, Q-6 (a)).** The marker's two allowances (`tests/pipeline/confirmation-path.spec.ts`,
  > `admin-writes-no-money.spec.ts`) also require the written delegate to be `payment`, red first on M-G11 (an
  > enrollment's `confirmedAt` inside `markOrderConfirmed`).
  > **B-P2's conflict check (the owner, 2026-11-23, «موافق على الكل (أ)»).** Month 1 and the rest start from the
  > first weekly occurrence after `pay_by_at` with no lead, in the confirm step (`jobs/confirm-enrollment.ts`,
  > booking's `lockForConfirmation` carrying `pay_by_at`). FR-BOOK-12 holds both ways: a payable programme order
  > refuses a new hold and a payable checkout refuses `programme.pay`; `checkout.current` and `continue` show it
  > (R-509). Q-4 (a): `saveCard` is recorded as `payments.card_consent_at` on the order, one migration (ERD row 74,
  > rule 82), copied into `programme_cards.consented_at` by T013.
  > **B-P2 lane c (the owner, 2026-11-23, «موافق على الاتنين (أ)», Q-C1 (a)).** No task wrote the programme on a
  > payment (data-model.md's `offered` → `active`, `payment_plan`, `months_paid`). The confirm step's path with no
  > hold, under the programme's lock, records every awaited payment through one booking entry
  > (`recordProgrammePaid`): `offered` → `active` with its plan, and `months_paid` = `month_count` in full, else the
  > month paid; a duplicate records nothing. Red first on «a second first payment is not taken as a fresh one» and
  > «the state after one payment». T016 keeps clearing `paused_at`. **Q-C2 (a):** `checkout.current` answers an
  > optional `programmeOrder: { enrollmentId, expiresAt, canContinue }` (`packages/contracts/src/checkout.ts`,
  > additive, the snapshot regenerated): not a hold, only the student's payable programme order; `continue` with its
  > enrollment hands its page back.
  > **The owner, 2026-11-23, «موافق عالكل» (SRS DEC-112; Q-C5 (a)).** FR-BOOK-12 with a bare hold: `checkout.pay`
  > refuses `PREVIOUS_CHECKOUT` while a programme order of the student is payable, as a payable checkout refuses
  > `programme.pay` (`modules/booking/programmes.service.ts:673-680`; the error built at `checkout-holds.service.ts:139`),
  > red first.
  > **Done (B-P2, 2026-11-23).** FU1 (the marker's instant from the database) and Minor 1 first; `programme.pay` in full
  > or month 1, no hold, expiry min(TTL, `pay_by`), rates copied; `card_consent_at` (migration `20261123104538`);
  > sessions from after `pay_by_at`; `active` with its plan and `months_paid` (Q-C1); `checkout.current.programmeOrder`
  > (Q-C2); FR-BOOK-12 every way (Q-C5).
- [x] T010 [US4] [US5] The completion gate and the counts (FR-712, FR-728; R-501; V-1):
  - `modules/sessions/completion.service.ts`: a programme completes only when fully paid and not `awaiting_offer`,
    `offered` or `paused`. Red first on «a paid month settled, the next unpaid, 72 h passed».
  - `share-release.rules.ts` `halfReached` over the N+1 snapshot count, the assessment counted (DEC-94: 41 → 21),
    pinned.
  - `sessions/restore.service.ts` refuses `programme_enrollment` (G-1).
  > **Follow-up (PR #156 r1 Follow-up 1, 2026-11-22).** Three make-up writers read no programme time:
  > `remedy.service.ts:1152-1157` (the choice-end sweep books the proposal after `heldTimesOf` only),
  > `makeup-booking.service.ts:358-366` and `restore.service.ts:472-474`. A make-up placed before the programme existed
  > is then booked onto its weekly time, and a later month's generation meets the session exclusion: the whole month is
  > refused (`slot_unavailable` case, the order paid). Each reads `EnrollmentSide.programmeTimesOf` as T005's searches
  > do, red first on «a make-up booked onto the student's programme time», with T010's restore refusal.
  > **B-P2's conflict check (the owner, 2026-11-23, «موافق على الكل (أ)»).** The note above is in T010's scope; its
  > first line is at `remedy.service.ts:1156-1161` on `34744575`. The gate reads the programme through
  > `EnrollmentSide.enrollmentFor`'s terms (the port and booking's `enrollmentTermsById`, Q-8 (a)).
  > **Done (B-P2, 2026-11-23).** The gate (fully paid, not `awaiting_offer`/`offered`/`paused`); `halfReached` pinned
  > over N+1; restore refuses `programme_enrollment`; the three make-up writers read `programmeTimesOf`; a counter refused
  > `programme_time` released at once (Q-D1); the race spec against a payment (Q-D2), the gate waiting on the programme row.
- [x] T011 [US5] The programme's releases (FR-703, FR-725, FR-728; R-512; DEC-94), `share-release.rules.ts`,
  `share-release.repository.ts`, `release-teacher-shares`:
  > **Follow-up (B-P1's lane e, 2026-11-22).** Today `share-release.rules.ts` would list `ijazah_half` at session 1 for
  > an assessment-only enrollment (count 1, half reached). The rules branch on the `assessment` kind (FR-703, R-512)
  > before the switch is turned on (B-P4); red first on «an assessment-only enrollment lists no `ijazah_half`».
  - `assessment` only when not continued (at the close, or at `pay_by` where an offer was sent, whichever is later, once session 1's 72 h have passed, no
    case: DEC-94); never while a `pay_blocked` item is open, the programme not being closed (FR-706b), red first on
    «the item open past `pay_by`: no `assessment` release»;
  - `ijazah_half` = 25 % × the share of the programme's price as paid (1,750 in full; 1,837.50 by months, fee 500),
    capped at the paid orders' shares − releases (red first: today's base is the first order's share, `:246`);
  - `ijazah_end` and `programme_stopped` = shares − the half released or owed − the refund share (U-4);
  - `package` orders keep today's rules.
  > **B-P2's conflict check (the owner, 2026-11-23, «موافق على الكل (أ)»).** `ijazah_half` is owed only once the
  > student continued (a `rest_in_full` or month 1 paid; R-512's two branches). Q-5 (a): `ijazah_end` and
  > `programme_stopped` subtract every release written and the half owed, as today's `share-release.rules.ts` does, so
  > a reopened programme's end never pays a first stop's release again. Worked: 10,000 offer, fee 500, 70 %, 25 %: the
  > half 1,750 in full, 1,837.50 by months; the end 5,250 and 5,512.50 with no refund; today's base gives 87.50.
  > **Not scheduled, should not happen (B-P2 lane e, 2026-11-23; the review session).** A programme enrollment with no programme row gives no half and logs one warn line; T005 writes both rows in one transaction.
  > **The owner, 2026-11-23, «موافق» (FU-E2 (a), B-P2 lane e).** programme_stopped falls due after the window of the last consumed session (done or student_no_show), not the last done one.
  > **Done (B-P2, 2026-11-23).** Every paid order with its kind in the facts; `assessment` only when not continued and
  > never while a `pay_blocked` item is open; the half on the price as paid, capped; the end and the stop subtract every
  > release written (Q-5); the stop after the last consumed session (FU-E2); a missing programme row warned (FU-E3, Q-E4).
  > **PR #158 r1 Follow-up 1 (a) (the owner, 2026-11-23, «صلح ومتابعة أ»).** Where the assessment was never held
  > (session 1's chain consumed by neither `done` nor `student_no_show`, e.g. an approved `no_offer` item after the
  > teacher's no-show whose remedy lapsed), no `assessment` release is owed to the teacher (`assessmentHeld`, over the
  > release facts' sessions; no new read); the fee is left to the administrator's compensation case. Fee 500 EGP: the
  > teacher's 350 not owed. Red first in `share-release.rules.spec.ts`, then under M-F2.
- [x] T012 [US5] The case amounts on a programme (FR-729, FR-730; R-512; G-3, G-4), `case-amount.rules.ts`
  (+ spec), `share-release.rules.ts:277-291`:
  - each session valued by its own order (the assessment = the fee; a month's session = the month ÷ its sessions; in
    full = (total − fee) ÷ N), red first: today it is the first order ÷ the count;
  - the dropout set for a programme: the case `teacher_ended` (a teacher's ban, revocation or departure, the enrollment
    cancelled `teacher_suspended`, `termination.subscriber.ts:352`), `absence_termination`, and the case `admin_ended`
    only when it covered an open `teacher_suspended` case (an Administrator's end of a suspended programme,
    `sessions/enrollment-end.service.ts`'s `closePausedCaseOnEnd`); a direct end of an unsuspended programme is not in
    the set. Each refunds everything (DEC-85). An open `teacher_suspended` case is a pause and is never in the set (PR
    #153 r1 Major 1, r2 Minor 3), red first on «a suspension shows no refund» and on «an administrator's end of a
    suspended programme shows it»;
  - the dropout amount shown only once the enrollment is ended (cancelled `teacher_suspended`, `teacher_ended`); an
    open suspension case is a pause and shows none (analyze N-1);
  - at a teacher's suspension, ban or departure, booking's `termination.subscriber.ts` calls payments'
    `deleteProgrammeCard` at once (DEC-94); a spec red first that asserts the call (until T013, against T008's stub);
  - a restore after a suspension on a programme is deferred (restore refused, T010).

  > **Amended 2026-11-21 (SRS DEC-96; `specs/003-booking/tasks.md` T125; the owner's decision on the full-codebase review, Q2).** A direct end of an unsuspended programme at the Student's choice is in the set: `admin_ended` releases the share of the sessions consumed, each valued by its own order, what was already released taken off, and the case shows the untaken value; nothing is executed until an Administrator resolves the case. Example: 10,000 EGP paid in full, 10 sessions, share 7,000, 6 delivered with the half (1,750) released → the teacher 4,200 in all (2,450 more), the student 4,000, the platform 1,800. T125 builds it with this task's set.
  > **B-P2's conflict check (the owner, 2026-11-23, «موافق على الكل (أ)»).** The student-chosen direct end of the
  > amendment above is T125's (R1b, after B-P2), built on this task's set; B-P2 adds `admin_ended` only where it covered
  > an open `teacher_suspended` case.
  > **Not scheduled, a rare case (B-P2 lane e, 2026-11-23; the review session).** A rest paid in full whose sessions were never generated (`slot_unavailable`, T006) has no sessions to value, so a complaint close refunds nothing for that order; the refused generation's compensation case (T006) already covers the paid order, so nothing is counted twice.
  > **Done (B-P2, 2026-11-23).** Each session valued by its own order (`programmePlaces`, `sumByOrder`) in the case
  > amounts and in `student_complaint_close`'s release (Q-T12-1); the dropout set with `admin_ended` only over an open
  > suspension (`ended_meanwhile`); `deleteProgrammeCard` at a teacher's suspension (T008's stub until T013).

## Phase 3: Renewal, the pause and the stop (B-P3)

- [x] T013 [US3] Saved cards and the close hook (FR-713, FR-719; R-510):
  - **The port:** `platform/ports/payment/payment.port.ts` `createCheckout`'s `saveCard` and the `card_saved` event.
  - **Paymob:** `paymob.adapter.ts` takes the token callback (`payment_event_type` `card_saved`, id
    `paymob:<txId>:token`), refused unless verified; off without the saved-card integration id.
  - **The fake:** `fake.adapter.ts`.
  - **Where the token is written:** encrypted into `programme_cards` in the webhook's own transaction, beside the
    `payment_events` row, never in a job payload; a spec asserts the enqueued payload carries ids only (PR #153 r1
    Minor 3).
  - **The card store:** `modules/payments/programme-cards.*`, the token through `ColumnCipher` in
    `createEncryptedColumns`.
  - **The close hook:** booking's cancel path, for every reason, sets the programme `closed` and `closed_at` on its own
    table, then calls payments' entry `deleteProgrammeCard` (R-API-6; analyze N-6).
  - **Erasure:** the card deleted by `identity/deletion.service.ts`, `identity/consequences.ts`,
    `jobs/erase-kept-data.ts`, with `main.ts`'s wiring by the integration.
  - **Specs:** no card detail in any log, audit entry or response (SC-707).
  > **Follow-up (B-P2 lane b, T008, 2026-11-23).** T008's close hook calls payments' `deleteProgrammeCard` (a stub)
  > where `main.ts` builds it: the termination subscriber, `EnrollmentSide` and `programmes.decide`. Two builders
  > outside lane b's files take booking's `noProgrammeCardYet` default (no card exists before T013, and the stub
  > deletes none): `worker.ts:231`'s `createEnrollmentSide` (its closes also write no line, no log bound) and
  > `createBookingServices` (`booking-slots.service.ts`) for `programme.cancel`. T013 binds payments' entry and the
  > log in both when the card becomes real.
  > **The owner, 2026-11-23, «موافق عالكل» (SRS DEC-112; Q-B2 (a)).** T013 binds payments' `deleteProgrammeCard` and the
  > log into booking's close hook where it is built: in `worker.ts`'s `createEnrollmentSide` (`apps/api/src/worker.ts:231`)
  > and in `createBookingServices` (`apps/api/src/main.ts:398`), replacing T008's stub. A close the worker runs then
  > writes its log line as the API's does (ids and a reason only), red first.
  > **B-P3's conflict check (the owner, 2026-11-24, «موافق على الكل (أ) مع تحسين س٢»).** Line drift: `createBookingServices` is `main.ts:410`. Q-4 (a): no edit
  > to `deletion.service.ts`, `consequences.ts` or `erase-kept-data.ts`: an account's erasure reaches the card through
  > the close hook (an administrator's deletion → `onAccountTerminated` → the termination subscriber →
  > `closeProgrammes`), proved by a DB spec; a student's own deletion is refused while a programme is live, and
  > `erase-kept-data` erases teachers' kept profiles only. A `card_saved` for a closed programme writes no card (R-510),
  > red first. The token column is registered in payments' `createEncryptedColumns` for `reencrypt-columns`.
  > **Done in part (B-P3 lane a, 2026-11-24).** The port's optional `saveCard` and `card_saved`; Paymob's `TOKEN`
  > callback (its eight signed fields, `paymob:<obj.id>:token`, the holder and the expiry never read; off without
  > `savedCardIntegrationId`); the fake's `cardSavedEvent`; the card written on the webhook's transaction only for an
  > order carrying `card_consent_at` and a programme not closed, the token under `ColumnCipher`, nothing enqueued;
  > the real `deleteProgrammeCard`; the column in `createEncryptedColumns`; `worker.ts`'s `createEnrollmentSide` and
  > the webhook's cipher bound in `006:` blocks; DB specs for Q-4 (a) and the close race
  > (`tests/db-integrity/programme-cards.spec.ts`).
  > **Follow-up (B-P3 lane a, 2026-11-24): waiting for approval.** (1) `createBookingServices`
  > (`apps/api/src/modules/booking/booking-slots.service.ts:270`) takes no `deleteProgrammeCard`, so `main.ts:410`
  > cannot bind it for `programme.cancel` without that file. (2) `checkout.service.ts:652-658` does not hand
  > `saveCard` to the port yet. (3) Paymob's switch: `platform/ports/payment/index.ts` `paymobFrom` and the env
  > schema need `PAYMENT_GATEWAY_SAVED_CARD_INTEGRATION_ID`; until then the token callback stays off.
  > **Follow-up (B-P3 lane a, 2026-11-24).** `tests/support/gateway-stand-in.ts` has no `card_saved` builder: the DB
  > spec signs it by hand in the stand-in's shape. Paymob's token message keeps three open boundaries (`id` |
  > `masked_pan`, `masked_pan` | `merchant_id`, `merchant_id` | `order_id`): check the merchant id against the
  > account's at the closed test. A kernel.md row for the webhook's card write (enrollment, payment, then
  > `programme_cards`, the programme's state read with no lock under the enrollment's) when the review agrees.
  > **Follow-up (B-P3 lane a, 2026-11-24): a failing test that is not T013's.**
  > `tests/db-integrity/ijazah-programme.spec.ts:196` («adds the members of share_release_milestone at its end»)
  > fails on `ijazah_integrity_b`: its enum lacks `direct_end`, so
  > `20261123174326_r1b_release_refund_and_encryption_events` seems not deployed there (its deploy needs the owner's word).
  > **Settled (B-P3 lane a, 2026-11-24; the owner, «موافق على الملفات برا المهام», «موافق على الاتنين»).** Follow-up
  > (1): `createBookingServices` takes `deleteProgrammeCard`, bound at `main.ts:410`, so the API's `programme.cancel`
  > deletes the card (`programme-windows.spec.ts`, `programme-cards-binds.spec.ts`, red first). (2): the checkout asks
  > `saveCard` exactly when the order carries the consent (`checkout.service.spec.ts`, red first). The harness has
  > `cardSaved` (`gateway-stand-in.fixtures.ts`, `tests/support/gateway-stand-in.ts`), which the DB spec now uses. The
  > failing test: R1b's two migrations deployed on `ijazah_integrity_b`, and `ijazah-programme.spec.ts` is green.
  > Follow-up (3) waits for the review sessions to agree the env hunk with R2.
  > **Settled (B-P3 lane a, 2026-11-24; the env hunk agreed by the review session for R2).** Follow-up (3):
  > `PAYMENT_GATEWAY_SAVED_CARD_INTEGRATION_ID` (optional in both modes, a provider key, a whole number) in the env
  > schema and `.env.example`, and `paymobFrom` hands it to the adapter as `savedCardIntegrationId` (`config.spec.ts`,
  > `index.spec.ts`, red first). `PAYMENT_GATEWAY_API_KEY` already exists (`env.schema.ts:205`), so Q-11 (a) needs no
  > new key: T014 reads it in `paymobFrom` and changes only its `.env.example` comment.
  > **Follow-up (B-P3 lane a, 2026-11-24).** `docs/RUNBOOK.md:319` lists the keys set at contracting; it should name
  > `PAYMENT_GATEWAY_SAVED_CARD_INTEGRATION_ID` too (not edited here).
  > **Settled (B-P3, 2026-11-24; the owner, «Approve all», typed in the review session).** kernel.md's 006:T013 row
  > (`specs/004-sessions/contracts/kernel.md`): the webhook's card write under `lockOrder` (the enrollment, then the
  > order), after the event's row; the delete on the close hook's transaction. Left to the closed-test checklist:
  > Paymob's token message's three open boundaries, and the merchant id against the account's.
- [x] T014 [US3] The automatic charge (FR-714, FR-716, FR-717; R-509):
  - **The port:** `PaymentPort.chargeSavedCard(paymentId, …)`; Paymob on the Moto integration with the split, off until
    configured; the fake's paid, soft and hard answers.
  - **Declines:** `GatewayEvent.failed.declineKind` from a code table, unknown → hard; persisted in
    `payments.decline_kind` (`order-events.service.ts`, `payments.repository.ts`).
  - **Order before call:** recorded `created` with `gateway_order_id` NULL and `expires_at` = now +
    `slot_hold_ttl_minutes`, then called once after commit, never under a lock and never again; an order left with no
    gateway id expires, and a late webhook is matched by the merchant reference (the payment id), the order's
    `gatewayOrderId` written from the event then (PR #153 r4, the money-lane note), and handled as
    FR-PAYG-19 (analyze N-3), red first on «crash between commit and call». An automatic order that expires with no
    answer counts as a soft decline (`first_failure_at` set, «pay now» shown, the retries start; PR #153 r1 Minor 1),
    red first.
  - **The payee guard (PR #153 r1 Major 3):** in live mode `chargeSavedCard` refuses a charge naming no payee
    (`paymob.adapter.ts`, as `createCheckout` does at `:220-222`) and the Moto intention carries `split_amounts`. The
    sweep records the refusal as a `failed` order with `declineKind` `hard`, with no gateway call and no retry; the
    month pauses until the teacher's payout account is verified, since a manual payment is refused the same way
    (`checkout.service.ts:507-508`) (PR #153 r2 Minor 2). A spec red first for each, and one (PR #153 r3 Major 1)
    in which the `no_payee` refusal is recorded `failed`/`hard` with `gateway_order_id` NULL under T001's check, is
    never expired, and is never retried.
  - **The failure's push:** `payment_failed` through today's path, unchanged, except on a `no_payee` refusal: no push,
    and neither «pay now» nor «change card» while `payeePending` is true; once the payout account is verified both are
    shown and the student pays by hand, with no retry (PR #153 r3 Minor 1, r4 Minor 1, R-HONEST), red first.
  > **The owner, 2026-11-22, B-P1's conflict check, Q-2 (SRS DEC-110): never charge again while an earlier attempt's
  > status is unknown.** (1) Before an automatic order is expired and before any retry, the gateway is asked by the
  > merchant reference (the payment's id): a new `PaymentPort` method, the fake answering paid, none and no answer.
  > (2) Paid → recorded paid, no new charge. (3) No transaction → failed (the soft decline above), the retries go on.
  > (4) No answer → no new charge, asked again later; still none → an Administrator item. (5) A second paid order for a
  > month stays T006's `duplicate_payment` case. This replaces this task's «an order left with no gateway id expires»
  > and «an automatic order that expires with no answer counts as a soft decline». The asking interval, the count
  > before the item and the item's kind are B-P3's conflict check. Paymob's inquiry: research.md R-509. Each step red
  > first.
  > **Follow-up (PR #158 r1 Follow-up 4, 2026-11-23; the owner, «صلح ومتابعة أ»: a tasks.md line in B-P3).** A
  > duplicate paid programme order counts in the shares until its refund is recorded: `share-release.rules.ts:395`
  > sums every paid order, while a package reads its first order only (Q-B1-10 (a)). Month 1 paid twice (1,000 EGP
  > each): shares 350 + 700 + 700. Once the duplicate's refund is recorded it nets out (700 − 700); if its case is
  > closed with no refund recorded, the stop or the end pays 700 too much. With this task's duplicate handling, red
  > first.
  > **B-P3's conflict check (the owner, 2026-11-24, «موافق على الكل (أ) مع تحسين س٢»; SRS DEC-113).** Q-1 (a): the gateway is asked at the automatic order's
  > expiry and then every `slot_hold_ttl_minutes` (10); after `programme_charge_inquiry_tries` (6) unanswered asks an
  > Administrator item `charge_unknown` opens (one `programme_request_kind` value, ERD row 80); asking goes on while it
  > is open and an answer withdraws it; approve = no charge found in the gateway (expired, a soft decline, the retries
  > go on), extend = keep asking; while unanswered, no retry, and `charge_pending` refuses a manual payment. Example:
  > order sent Thursday 18:31, no answer from 18:41 to 19:31 → the item; «paid» at 19:45 → recorded paid, the item
  > withdrawn. Q-2 (a) amended: the automatic charge is two gateway steps, the intention, then the token payment. The
  > intention's `intention_order_id` is written to `gateway_order_id` in its own short transaction right after the
  > intention step and before the token payment. An intention with no answer means no charge was possible: a soft
  > decline at once, with no inquiry. A token payment with no answer: its late callback is matched by the signed
  > `order.id`, and Q-1's inquiry asks by that order id; the unsigned `merchant_order_id` is never trusted. The token
  > payment is sent once, never again. Both steps' shapes are verified on Paymob's developer pages before the Paymob
  > part. This replaces the note's «matched by the merchant reference, the order's `gatewayOrderId` written from the
  > event». Today's expiry sweep leaves automatic orders to the inquiry (`order-expiry.repository.ts:28-37` takes every
  > `created` order), red first. Q-5 (a): the shares read only the awaited orders (the confirm step's walk by
  > `confirmed_at`, id); a duplicate's share and its refunds are left out (the `duplicate_payment` case's). Example:
  > month 1 paid twice, 1,000 EGP each: shares 350 + 700. Line drift: `checkout.service.ts:507-508` → `:646-658`;
  > `share-release.rules.ts:395` → `:422`. The monitor's `gatewayOrderId` is nullable for an automatic order
  > (`payments-monitor.repository.ts:12-15`).
  > **Lane b's Paymob questions (the owner, 2026-11-24, «موافق على س١٠ (أ) بالتظبيطات وس١١ (أ)», typed in B-P3's review session; SRS DEC-113; `ejazah-tools\track2\b-p3\paymob-docs.md` §2).** Q-10 (a)
  > with three adjustments: (1) `declineKind`'s code table follows Visa's categories: `soft` only for the «cannot
  > approve now» codes, 51 (insufficient funds), 61 and 65 (limits), 91 and 96 (issuer unavailable) and the rest of
  > Visa's Category 2, each code cited in the table's comment; every other code, and any unknown one, is `hard`, so no
  > retry ever reaches a Category 1 card (lost, stolen, closed, invalid, expired 54, stop-recurring R0/R1/R3). (2) The
  > kind comes only from the inquiry's authenticated answer: the callback's `txn_response_code` and
  > `acq_response_code` are outside Paymob's HMAC and are never read; a signed `failed` callback records the failure
  > with no kind. (3) An answer with no code is `hard` (the month by hand). This replaces «unknown → hard» read from
  > the event. Q-11 (a): one optional env value `PAYMENT_GATEWAY_API_KEY` (`config/env.schema.ts`, `.env.example`),
  > the inquiry's auth token taken from it; with no value the live inquiry is off (the owner sets it at contracting);
  > the hunk agreed with R2's review session before lane b commits it. Closed-test checklist: whether the inquiry's
  > answer carries `data.txn_response_code` and `acq_response_code`. Red first, each.
  > **Done in part (B-P3 lane b, 2026-11-24; stop 1's answers, the owner's «Approve all», Q-b1 (a) adjusted, Q-b2 (a),
  > Q-b3 (a); Q-b4 settled by the Generate Auth Token page).**
  > - **The port:** `chargeSavedCard` runs two steps through the caller's `recordOrder`: the payment is sent only
  >   after the gateway's order id is recorded, once. `inquireOrder` answers `transaction`, `none` or `no_answer`.
  >   `failed.declineKind` is set only from the inquiry.
  > - **Paymob:**
  >   - The Moto intention carries the split and `special_reference`, then `payments/pay` with the token.
  >   - `charge_off` unless both `PAYMENT_GATEWAY_MOTO_INTEGRATION_ID` and `PAYMENT_GATEWAY_API_KEY` are set;
  >     `no_payee` in live mode.
  >   - The inquiry makes a fresh auth token from the API key, then asks by the order id. Anything not final or
  >     unreadable is `no_answer`; Paymob's adapter never answers `none`.
  >   - Visa's Category 2 table (soft) is checked against Adyen's «Visa integrity fees» page; every other code is
  >     hard.
  > - **The fake:** `onCharge` and `onInquiry`.
  > - **The charge entry:** `modules/payments/automatic-charge.ts`, through payments' `createProgrammeCharges`.
  >   - `record`: on the caller's transaction, the order is `created` with no gateway id and expires in 10
  >     minutes. With no card nothing is written. In live mode with no payee the order is `failed`/`hard`.
  >   - `charge`: after commit, with no lock held, sent once. An unanswered first step is expired (a soft
  >     decline). A refusal is recorded `failed`/`hard` with no push.
  >   - `inquire`: nothing is asked before the expiry. An order with no id is expired with no question. The answer
  >     is recorded through the webhook's branch, which writes the decline kind (also on a replay). `none` expires
  >     the order.
  > - **The rest:**
  >   - `expire-pending-payments` leaves automatic orders to the inquiry.
  >   - Q-5 (a): the shares read only the awaited orders.
  >   - The migration `20261124105820_programme_charge_unknown`: the value, a `COMMIT`, then rule 80's check
  >     replaced.
  >   - The setting `programme_charge_inquiry_tries` = 6.
  >   - The contract `programmeRequestKind` gains `charge_unknown`; `ALLOWED.charge_unknown = []`.
  > - **Specs:** `paymob.charge.spec.ts`, `fake.charge.spec.ts`, `tests/db-integrity/automatic-charge.spec.ts`,
  >   `tests/seed/programme-charge-unknown.spec.ts`, red first, with named mutants.
  > **Follow-up (B-P3 lane b, 2026-11-24): waiting for a decision.** The monitor's nullable `gatewayOrderId` (settled
  > by `payments-monitor.repository.ts:12-15`) fails `contract:snapshot --check`. The gate reports
  > `admin payments.get $.gatewayOrderId`, `$.paidOrders[].gatewayOrderId` and `payments.list $.items[].gatewayOrderId`
  > as `string → null|string` (R-API-9). The change is held as a patch (`track2\runs\b-p3\lane-b\48-monitor-held.patch`),
  > so the monitor still refuses an automatic order that has no gateway id.
  > **Settled (the owner, 2026-11-24, «موافق», typed in B-P3's review session).** Option (d): the monitor's part is T018's (lane f), carried by the follow-up
  > under T018; the held patch is not used. T014 is done with it carried.
  > **Follow-up (B-P3 lane b, 2026-11-24).** «Neither "pay now" nor "change card" while `payeePending`»
  > (`tasks.md:529-531`) is `programme.get`'s (T018) and the screen's (T020). T014 builds the no-push half.
  > `share-release.rules.ts`' half base still reads `inFull` from any `rest_in_full`, a duplicate after months included
  > (rare; outside Q-5's two sums).
  > **Closed-test checklist (B-P3 lane b).**
  > - The pay call's synchronous answer and its authorisation (the secret key is sent).
  > - The Moto split's `split_payment_methods`.
  > - The inquiry: its «no transaction» answer; where it carries `acq_response_code` (`data.` or the top level); its
  >   `currency` and `created_at`.
  > - The auth token's lifetime.
  > - The Category 2 table, against Visa's own publication.
- [ ] T015 [US3] [US4] `advance-programmes` (FR-714, FR-717, FR-721; R-508), `jobs/advance-programmes.ts`:
  - only `confirmed` enrollments with no open `teacher_suspended` or `student_suspended` case (a suspension pauses;
    analyze N-1), red first;
  - the `pay_by` (the lapse, or FR-706b's `pay_blocked` item, once per deadline, and no lapse while one is open; T008's functions), due, retry (1, 3, 5, 7; at most 4; soft only; only while a saved card exists, otherwise the month is by hand) and
    pause steps, each under the programme's lock in its
    own transaction, with one log line each;
  - «pending» per A-1;
  - after commit, `chargeSavedCard` for each `created` automatic order;
  - the due time by `lastToEnd` over the month's sessions;
  - a live `enrollment` signal after the pause's commit (N-15);
  - the double-run spec; the retry and early-renewal days are whole 24-hour multiples on the instant, through
    `packages/time`, and a DST spec names the day-7 retry against the next occurrence across a DST change (PR #153 r1
    nit 5);
  - registered by the integration.
  > **The owner, 2026-11-22, Q-2 (SRS DEC-110).** The retry step asks the gateway first (T014's note);
  > `chargeSavedCard` is never called for a month whose earlier automatic order is unanswered.
  > **Follow-up (B-P2 lane a, 2026-11-23; the owner, «موافق الكل أ»).** The pause step writes the
  > `programme_paused` enrollment event (`enrollment_event_kind`, data-model.md:48), one row on the pause's
  > transaction, red first, as T007's offer writes `programme_offered` (FU-A1 (a)).
  > **Follow-up (B-P2 lane b, T008, 2026-11-23).** T008's step (`createProgrammeWindows`, booking's entry) is what
  > this sweep runs per programme; `worker.ts` binds it with payments' `createProgrammePayee({ paymentMode:
  > config.PAYMENT_MODE, cipher })` (no T008 path in `main.ts` reads the mode) and `deleteProgrammeCard`. Its live
  > signal goes on the transaction's bound publisher, none in the worker until T015 binds one. An order of
  > `programme.pay` still `created` at `pay_by_at` (A-1) is not read by T008's lapse: T015's «pending» decides it.
  > **The owner, 2026-11-23, «موافق عالكل» (SRS DEC-112; Q-B3 (a)).** T015 binds payments'
  > `createProgrammePayee({ paymentMode, cipher })` («unverified in live mode», T008's entry) in `worker.ts` for the
  > sweep's `pay_by` step; T016 and T018 bind it in `main.ts`.
  > **Follow-up (PR #158 r1 Follow-up 2, 2026-11-23; the owner, «صلح ومتابعة أ»: a tasks.md line in B-P3; rare).** A
  > programme completes with its paid sessions never generated: `completion.service.ts:178-181` counts `in_full`
  > as fully paid, so if the rest's generation was refused (`slot_unavailable`, T006) only session 1 exists, and
  > 72 h after it the enrollment moves to `completed` and the close hook closes the programme. 9,500 EGP paid, 0 of
  > 40 sessions written; `ijazah_end` (350 + 6,650 − refunds) is held only while the case is open. The gate also
  > waits for that case (or for the N + 1 rows), red first.
  > **Follow-up (PR #158 r1 Follow-up 3, 2026-11-23; the owner, «صلح ومتابعة أ»: a tasks.md line in B-P3).** A first
  > payment confirmed late generates from `pay_by_at`, which may be in the past (`jobs/confirm-enrollment.ts:509-514`,
  > `from = pay_by_at`, lead 0): a paid event processed after the first weekly occurrence past `pay_by_at` writes a
  > session already begun. With this task's «pending at `pay_by`» rule: floor at the confirm instant, red first.
  > **Follow-up (PR #158 r2 Follow-up 1, 2026-11-23; B-P3's conflict check Q-8 (a), the owner, 2026-11-24, «موافق على الكل (أ) مع تحسين س٢»).** A close ignores a
  > first payment still being processed (paid, `confirmed_at` NULL): `programme.cancel` (`programmes.service.ts:683-725`)
  > and the lapse (`:818-848`) read no order. «Pending» at `pay_by` also counts a paid, unconfirmed programme order
  > (`programmeProcessing`, `:893-900`), so the lapse waits; `programme.cancel` refuses it `payment_processing` (additive
  > in `programmeCancelRefusal`). Example: 9,500 EGP paid two minutes before `pay_by`, the worker restarting: no lapse
  > and no cancel until the confirm step runs. Red first, each.
  > **B-P3's conflict check (the owner, 2026-11-24, «موافق على الكل (أ) مع تحسين س٢»).** Q-3 (a): the sweep derives `next_due_at` under the programme's lock on every
  > step from the paid months' sessions (`lastToEnd`) and writes it when it moved (no writer exists today); a postponed
  > last session moves it. Q-6 (a): `programmeMayComplete` (`completion.service.ts:178-181`) also waits while an open
  > `slot_unavailable` or `party_restricted` case is on the enrollment. Follow-up 3 (settled by its text): the first
  > payment's sessions start after max(last end, `pay_by_at`, the confirm instant), lead 0.
  > **Lane b's Paymob questions (the owner, 2026-11-24, «موافق على س١٠ (أ) بالتظبيطات وس١١ (أ)», typed in B-P3's review session; SRS DEC-113).** The sweep asks the gateway at once after an automatic
  > order fails, on the next minute, not only before the day-1 retry, so the student sees «pay now» or «change card»
  > right away. No retry ever runs without an authenticated kind: an unanswered inquiry means no retry (DEC-110), an
  > answer with no code means `hard`. Red first.
  > **Done in part (B-P3 lane c, 2026-11-24).**
  > - The windows' step reads the suspension cases again under its locks, and past `pay_by_at` waits while a programme
  >   order is payable or paid and not yet processed (payments' `checkoutOrdersAmong`, bound as `orders`);
  >   `programme.cancel` refuses `payment_processing` then (additive in `programmeCancelRefusal`), once `orders` is bound.
  > - `programmes.rules.ts`: the due point by `lastToEnd` over the paid month's sessions (Q-3 (a)); the due, retry
  >   (1, 3, 5, 7 whole days on the instant, soft only, at most 4, only with a card, never while unanswered or with no
  >   authenticated kind), `charge_unknown` (the 6th unanswered ask, 10 minutes apart, once per order; withdrawn by an
  >   answer) and pause steps; the cadence; the DST spec of the day-7 retry against the next occurrence.
  > - `programmes.service.ts` `createProgrammeMonths`: each step its own transaction (the teacher key-shared, the
  >   programme, the enrollment), the due point written when it moved, payments' `record` on the step's transaction, the
  >   gateway's call handed back for after the commit, the pause's `programme_paused` row and live signal.
  > - `jobs/advance-programmes.ts`: the page, the suspension filter, the windows' step, the ask before the steps, the
  >   call after commit; its double-run spec over a stand-in sweep.
  > - Q-6 (a) in `completion.service.ts`; FU3 in `confirm-enrollment.ts`; kernel.md's 006:T015 row.
  > - Specs: `programmes-months.rules.spec.ts`, `programmes-months.service.spec.ts`, `advance-programmes.spec.ts`,
  >   `tests/db-integrity/advance-programmes.spec.ts`, red first, with named mutants.
  > **Follow-up (B-P3 lane c, 2026-11-24): waiting for approval (outside lane c's files).** (1) `modules/booking/index.ts`
  > exports `createProgrammeMonths`, `programmesToSweep` and their types, so the job and the DB specs reach them through
  > the entry. (2) Payments has no answer of a month's orders: a reader of the month's latest automatic order (status,
  > expiry, decline kind, attempt), whether a programme order is payable or paid unconfirmed, and whether a card is
  > saved (a boolean), with its `index.ts` export; `worker.ts` binds the job only once it exists. (3)
  > `booking-slots.service.ts` and `main.ts` hand `checkoutOrdersAmong` to `programme.cancel`, so its
  > `payment_processing` runs in the API. (4) The worker has no live channel to the API's streams: the pause's
  > `enrollment` signal goes on the transaction's publisher, which no worker binds (N-15).
  > **Follow-up (B-P3 lane c, 2026-11-24): a question.** Whether approving or extending a `charge_unknown` item
  > (approve: no charge found, the order expired as a soft decline, retries on; extend: keep asking) is T015's or
  > T021's: T015's text names the item's opening and withdrawal, not its decision. `ALLOWED.charge_unknown = []`
  > stays as lane b set it.
  > **Settled (B-P3 lane c, 2026-11-24; the owner, «موافق», typed in the review session).** (1) booking's `index.ts`
  > exports the month steps and the page. (2) payments' `programmeMonthOrdersOf` (no lock; `cardSaved` a boolean
  > only, SC-707) and its export. (3) `createBookingServices` takes `programmeOrders`, bound at `main.ts` to
  > `checkoutOrdersAmong`, so the API's `programme.cancel` refuses `payment_processing`
  > (`advance-programmes-binds.spec.ts`). Q-4: approving or extending a `charge_unknown` item is T021's;
  > `ALLOWED.charge_unknown = []` stays. Q-5: a failed automatic order with no kind is asked on the sweep minute after
  > the failure (its `updated_at`), then every `slot_hold_ttl_minutes` (10), at most `programme_charge_inquiry_tries`
  > (6) times; then asking stops and nothing is written (no item, no column): the order stays failed with no kind, is
  > never retried, and the month is paid by hand; a later authenticated soft kind starts the retries from then. The
  > job is registered in `worker.ts`'s `006:` block (`advance-programmes-binds.spec.ts`). DB specs: the double run
  > (two sweeps at once: one order, one payment, one item) and the month step's races against the webhook's paid, a
  > manual checkout of the same month and `programme.cancel` (`tests/db-integrity/advance-programmes-sweep.spec.ts`),
  > red first. The race against a stop's approval is T017's.
  > **Follow-up (B-P3 lane c, 2026-11-24).** The pause's `enrollment` signal is added on the transaction's publisher,
  > which no worker binds: the worker has no live channel to the API's streams (`main.ts` holds the only
  > `InProcessLiveBus`), so a pause reaches a client only on its next read (N-15). T008's windows' signal is the same.
- [ ] T016 [US3] Manual renewal and the automatic renewal off (FR-713a, FR-715, FR-716, FR-722, FR-724),
  `programme.renew` and `programme.autoRenewOff`, in `modules/booking/programmes.service.ts`, `programmes.router.ts`,
  `modules/payments/checkout.service.ts`, `modules/payments/programme-cards.*`:
  - `programme.autoRenewOff` (the student, at any time) deletes the card under the programme's row lock (kernel.md's
    order, programme → enrollment → payment), the lock the sweep's due step reads the card under, so the two cannot
    race; later months by hand under the same rules; a charge already `created` stays (DEC-95, settled by the review session as the reading of the owner's (a): a charge already sent cannot be recalled; PR #153 r1
    Major 4 (a), r2 Minor 1), red first, with a race spec against the due step;
  - refused `party_suspended` while a suspension case is open (PR #153 r1 Minor 2);
  - open from `programme_renew_early_days` for a student without a card; refused `charge_pending` while an automatic
    order is `created`;
  - «pay now» and «change card» after a failure;
  - `programme.pay` and `programme.renew` refuse a typed `CONFLICT` `payee_unverified` before the gateway while, in live
    mode, the teacher's payout account is not verified (read through T008's payments entry; `paymob.adapter.ts:220-222`, `checkout.service.ts:507-508`; PR
    #153 r3 Minor 1, r4 Minor 2), red first, a spec for each mode: in test mode nothing is refused and the stand-in
    charges;
  - after a `no_payee` refusal, once the payout account is verified `programme.renew` takes the month by hand («pay
    now»), red first (PR #153 r4 Minor 1);
  - the paid month generates from max+1 and the next occurrence, clears `paused_at` and withdraws an open stop request
    with one log line;
  - live signals; adversarial registration.
  > **v1.1 (PR #153's review, round 4, follow-up 1; the owner, 2026-11-21, «بعد الإطلاق v1.1»; SRS DEC-101).** A push
  > telling the student that payment has opened once the teacher's payout account is verified. Not built in the first
  > release: the screen shows «pay now» (T019). `PLAN.md`, «The first update (v1.1)».
  > **Follow-up (B-P2 lane a, 2026-11-23; the owner, «موافق الكل أ»).** The paid month that clears `paused_at`
  > writes the `programme_resumed` enrollment event, one row on its transaction, red first, as T007's offer writes
  > `programme_offered` (FU-A1 (a)).
  > **B-P3's conflict check (the owner, 2026-11-24, «موافق على الكل (أ) مع تحسين س٢»).** The paid month's resume (`active`, `paused_at` cleared, an open stop withdrawn
  > with one line, `programme_resumed`) is written by the confirm step's booking entry (`writeProgrammePaid`,
  > `programmes.repository.ts:259-277`), where every paid month lands, an automatic one after a pause included.
  > `programme.autoRenewOff` gains its refusal enum (`party_suspended`, `closed`; B-P2 Q-B1's precedent). `programme.pay`
  > gains the `payee_unverified` check with `programme.renew` (no code refuses it today).
- [ ] T017 [US4] The stop request, the close and the reopen (FR-723, FR-725, FR-727; R-513), in
  `modules/booking/programmes.service.ts`, `programme-requests.*`, `programmes.router.ts`,
  `modules/booking/programmes-admin.router.ts` (the admin decisions):
  - `programme.request` `stop` (refused before 7 days);
  - `programmes.decide` approving it → `programme_stopped` through the close hook, the time free at once, T011's
    release;
  - `programmes.reopen` under the slot's lock with `slot_taken`, `party_restricted`, `gender_mismatch`, `paused_at` =
    the reopen time;
  - audited; live signals; adversarial registration.
  > **Follow-up (PR #153's review, round 1, follow-up 1; the owner's «Approve all», 2026-11-20).** A programme stopped,
  > reopened and stopped again cannot write a second `programme_stopped` release (`@@unique([enrollmentId, milestone])`),
  > and T011's «shares − the half released or owed − the refund share» subtracts only the half, while today's code
  > subtracts every written release (`share-release.rules.ts:251-254`). With a first stop releasing 2,800, a reopen and
  > 1,000 more paid, an end built to the letter would release the 2,800 again and a second stop nothing for the new
  > month's 700. The fix: «− every release written», and a release per stop. Rare; not scheduled.
  > *(B-P2, the owner, 2026-11-23, Q-5 (a).)* The first half is closed by T011 (the end subtracts every release
  > written); «a release per stop» stays not scheduled.
  > **Follow-up (B-P2 lane a, 2026-11-23; the owner, «موافق الكل أ»).** `programmes.reopen` writes the
  > `programme_reopened` enrollment event, one row on the reopen's transaction, red first, as T007's offer writes
  > `programme_offered` (FU-A1 (a)).
  > **Follow-up (B-P2 lane b, T008, 2026-11-23).** T008's `programme.request` answers `stop` with `not_paused` while
  > the programme is not `paused` and throws on a paused one (no path pauses before T015); `programmes.decide`
  > refuses any decision on a `stop` item `decision_not_allowed`. T017 replaces both.
  > **B-P3's conflict check (the owner, 2026-11-24, «موافق على الكل (أ) مع تحسين س٢»).** `programme_stopped` joins `ProgrammeEndReason`
  > (`programme-close.service.ts:96`) and releases through its own branch (`share-release.rules.ts:565-575`); R1b's
  > `CLOSE_RELEASES` is untouched.
  > **Lane e's questions (the owner, 2026-11-24, «موافق عالكل», typed in B-P3's review session).** Q-e1 (a): the
  > reopen moves the enrollment through a third writer of the status, `reopenStoppedEnrollment`
  > (`enrollment-side.repository.ts`; `cancelled` `programme_stopped` with `confirmed_at` set → `confirmed`, the reason,
  > `slot_released_at` and `admin_end_reason` cleared, never `confirmed_at`), its one reach the reopen; the confirmation
  > gate widened. Q-e2 (a) `not_stopped`, Q-e3 (b) `slot_inactive`, Q-e6 `time_taken` (another booking of a party
  > over the weekly time's coming weeks, as restore reads it), additive in `programmesReopenRefusal`. Q-e4 (b): a stop's
  > approval refused `sessions_pending` (additive in `programmesDecideRefusal`) while a session of the programme is
  > `scheduled` or a remedy is open; example: month 1 is 4 × 250 EGP, a make-up set for 12/03, the approval on 11/30 →
  > refused. Q-e5 (a): the audit label of `programme.reopened` («إعادة فتح برنامج الإجازة» / «Programme reopened»).
  > **Done (B-P3 lane e, 2026-11-24).**
  > - `programme.request` `stop` (`programme-requests.service.ts`): `not_paused`, `too_early` (`paused_at` +
  >   `programme_stop_request_days`, whole days on the instant, the database's clock), `request_open`; the open stop
  >   with the reason, its teacher the row's; one line of ids; `enrollment` to both parties.
  > - `programmes.decide` on a stop: approve → `programme_stopped` through booking's own end and the close hook (the
  >   time free at once, the card deleted, T011's release: 17,500 + 70,000 = 87,500 pt in the DB spec); decline;
  >   `sessions_pending`; `not_open` once no longer paused; no extension.
  > - `programmes.reopen` (`programmes-admin.router.ts`, audited `programme.reopened` with the administrator's
  >   reason): users, the teacher's slots' key, the slot, the programme, the enrollment; `not_stopped`,
  >   `party_restricted`, `gender_mismatch` (both directions), `slot_inactive`, `slot_taken`, `time_taken`; the
  >   enrollment `confirmed`, the programme `paused` since the reopen, one `programme_reopened` row; no session.
  > - Races, red first (`tests/db-integrity/programme-stop.spec.ts`; kernel.md 006:T017): the approval against the
  >   sweep's due step (006:T015's open item), the reopen against a new booking of the same weekly time.
  > **Follow-up (B-P3 lane e, 2026-11-24).** The admin harness of `tests/adversarial` covers the user surface only:
  > `programmes.reopen`'s gender refusal is asserted both ways in the unit and DB specs, not by the harness.
  > `programme.request`'s registration is unchanged (both directions, `not_paused`).
- [ ] T018 [US2] [US6] The reads (FR-726, FR-727), in `modules/booking/programmes.service.ts`,
  `programmes.repository.ts`, `programmes.router.ts`, `modules/booking/programmes-admin.router.ts`, and
  `modules/payments/payments-monitor.*`:
  - `programme.get`, the two parties only, the card to the student only, `teacherUnavailable` (FR-BOOK-19),
    `payeePending` (in live mode, the teacher's payout account not verified; false in test mode, a spec for each mode;
    PR #153 r3 Minor 1, r4 Minor 2; read through T008's payments entry) and `payBlocked` (a `pay_blocked` item is open),
    with its adversarial registration;
  - `programmes.queue` (paused, stop, refusal, no_offer, pay_blocked; oldest first, how late, the reason; a `pay_blocked` item with whether the payout account is
    verified now) and `programmes.get`
    (admin);
  - the monitor's `kind`, `instalmentMonth`, `automatic`, `declineKind` (`payments-monitor.*`).
  > **The owner, 2026-11-23, «بس خلي جنب مفيش عرض السبب اللي العرض متعملش بسببه او اللي المعلم بعته يعني» (SRS
  > DEC-112).** The queue offers no `refusal` filter (the value at `packages/contracts/src/admin/programme.ts:31` is
  > kept, unused, as the next note says; R-API-9; PR #158 r1 nit): no new refusal item can exist (T008's note). `programmes.queue` and the admin `programmes.get` (the
  > programme's history) read a `no_offer` item's `reason`, the administrator's record written by `programmes.decide`
  > (T008), beside the item; `programmeRequestItem.reason`'s comment (`:48-49`) says so.
  > **B-P2 (2026-11-23; R-API-9, the review session's Q-B6 (a)).** The `refusal` value is not removed from
  > `programmesQueueFilter` (`packages/contracts/src/admin/programme.ts`): R-API-9 keeps a published enum value
  > (additive only; deprecate, then remove after a minimum client version), and `contract:snapshot --check` refuses the
  > removal. It stays, marked unused since SRS DEC-112, and the queue never offers it, as `programmeRequestRefusal`'s
  > `assessment_not_delivered` and `offer_sent` stay unused since T008.
  > **The owner, 2026-11-23, «موافق» (B-P2 lane e's FU-E1 (a)).** On the payouts screen («تحويلات المعلمين»), every
  > programme release lists the paid orders it draws from, with the amount from each, before the switch is turned on
  > (B-P4). Today `payouts.service.ts` `releaseLinesOf` shows `order.paymentId`, which for a programme is the
  > assessment's order for every release (T011 keeps `ReleaseFacts.order` as the first paid order and adds `orders`).
  > Built here, with the reads (`modules/payments/payouts.*`, the admin payouts page). Example: offer 10,000 EGP by
  > months, fee 500: `ijazah_half` 1,837.50 lists the assessment (350) and the months it draws from (700 each, capped).
  > **The owner, 2026-11-23, «ايوة الادمن ساعتها بقا بتقرر اننا نديها للطالب بطريقة ما» (PR #158 r1 Q-R1 (b)).**
  > `programmes.queue` and the admin `programmes.get` carry, on a `no_offer` item, whether the assessment was held
  > (session 1's outcome chain, T008's read), so T021 can show «the assessment was not held; the fee is unreleased».
  > **Follow-up (PR #158 r2 Follow-up 2, 2026-11-23; the owner, 2026-11-24, «موافق على الكل (أ) مع تحسين س٢»).** «The fee is unreleased» is reachable only from the
  > `no_offer` decision. The admin `programmes.get` carries «the assessment was not held» on any closed programme with no
  > `assessment` release (`assessmentHeld`, `share-release.rules.ts:463-467`), so T021 shows it on the programme's page
  > too. Example: fee 500 EGP; cancelled Monday; a dispute upheld Wednesday as the teacher's no-show → the 500
  > unreleased, the page says so. Red first.
  > **B-P3's conflict check (the owner, 2026-11-24, «موافق على الكل (أ) مع تحسين س٢»).** Q-9 (a): the admin `programmes.get` gains `cardSaved` (a boolean, never a card
  > detail). Under Q-1 (a) the queue offers `charge_unknown` beside `pay_blocked` (T021 shows it). FU-E1:
  > `payoutRelease` gains `orders: [{ paymentId, amount_piasters }]` (additive).
  > **Follow-up (carried from T014 (the owner, 2026-11-24, «موافق», typed in B-P3's review session); option (d)).** The admin monitor and an automatic order with no
  > gateway id (its first step unanswered, or refused before it was sent): the contract keeps `gatewayOrderId:
  > z.string()`, with no snapshot change and no new field. `payments-monitor.repository.ts` drops the refusal in
  > `withGatewayOrderId` (today one such order fails the whole list page); the rows keep `string | null` inside, the
  > search compares the inner value (`adminSearch` is `min(1)`, so `''` never matches), and only the contract's edge
  > maps NULL to `''`. The admin pages (`AdminPayments.tsx:148`, `PaymentPanel.tsx:84`, `:170`, `:242`; outside
  > files, approved) show «—» for `''` with a short ar/en line saying the order has no Paymob number (refused before
  > it was sent, or Paymob gave none); `check:i18n:admin`. No nullable field until a page needs one (R-API-9 keeps a
  > published field forever). Example: a 1,000 EGP automatic order whose intention got no answer is listed with
  > «—», and every other order on its page is listed too. Red first: the list page, `payments.get` and the
  > enrollment's `paidOrders`.

## Phase 4: Screens and proofs (B-P4, on today's design; amended 2026-11-21)

- [ ] T019 [US1] [US2] [US3] The student's phone, `apps/mobile/src/features/student/programme/`:
  - the range and the fee on the profile;
  - the assessment's booking (each time's length, «sessions up to this long»);
  - the offer with its total, its months and the 48 h deadline (a reminder before it, FR-708);
  - pay in full or monthly with the consent line;
  - months paid and next due;
  - «renew now», «pay now», «change card»;
  - while `payeePending` is true, a line that payment opens once the teacher's payment details are verified, and no
    «pay now» or «change card»; once it is false, both again, the student paying the month by hand (PR #153 r3 Minor 1,
    r4 Minor 1);
  - on the offer: while `payeePending` is true, the same line and neither «pay in full» nor «pay monthly»; while
    `payBlocked` is true, a line that payment is stopped until the administration decides, no pay button, the
    cancellation still offered (FR-706b; PR #155's review, round 1, N3);
  - turn the automatic renewal off (shown while a card is saved; `programme.autoRenewOff`, FR-713a), and after it,
    the month's renewal by hand; while `chargePending` is true, a line that this month's charge is already under way
    (PR #153 r2 Major 1, Minor 1);
  - paused;
  - «the teacher is unavailable» (FR-BOOK-19).
  - i18n in a `programme` group.
- [ ] T020 [US2] [US4] The teacher's phone:
  - `apps/mobile/src/features/teacher/packages/` (the three prices with the average per length);
  - `teacher/programme/` (the offer with the deadline, «late since», the stop and refusal requests; while `payBlocked`
    is true, a line that the offer is with the administration because the payout account was not verified, FR-706b).
  > **The owner, 2026-11-23, «لا متخليش في زر رفض الطلب في التصميم / لازم بقى يخش يكلم الدعم من الاعدادات ومش هنوضحله
  > ده»; «طلب الايقاف يفضل زرار بس بيظهر بعد ال 7 ايام» (SRS DEC-112).** No refusal request and no refusal button: a
  > teacher who wants to refuse contacts support from settings, and the app does not explain this (no line, no hint).
  > The stop request stays a button, shown only from `paused_at` + 7 days (`programme_stop_request_days`, §3.14); the
  > server's `too_early` stays the guard (FR-723).
- [ ] T021 [US6] The panel, `apps/admin/src/pages/programmes/`:
  - the queue (paused, stop, refusal, no_offer, pay_blocked) oldest first, decide, extend, reopen;
  - each screen explains itself: a `pay_blocked` item says why it opened, whether the payout account is verified
    now, and what each decision does (approve: the offer lapses, the fee kept; extend: 48 hours more from now);
  - the monitor's columns;
  - the `programme_enabled` setting's label explaining what flipping it does;
  - `admin.programme` i18n.
  > **The owner, 2026-11-23, «بس خلي جنب مفيش عرض السبب اللي العرض متعملش بسببه او اللي المعلم بعته يعني» (SRS
  > DEC-112).** The queue has no `refusal` filter (T018's note). Beside a `no_offer` item the panel shows why the offer
  > was not made, i.e. what the teacher sent to support, as recorded; deciding the item (approve, the refusal; or
  > extend) asks for that reason (1–500, mandatory, T008's note), and the dialog explains itself: approve closes the
  > programme as refused, the fee kept, the weekly time freed; extend gives the teacher 24 hours more from now.
  > **The owner, 2026-11-23, «ايوة الادمن ساعتها بقا بتقرر اننا نديها للطالب بطريقة ما» (PR #158 r1 Q-R1 (b)).** Deciding a
  > `no_offer` item whose assessment was never held (session 1's chain ended with no `done` or `student_no_show`; no
  > `assessment` release is owed, T011's note), the panel shows «the assessment was not held; the fee is unreleased» and
  > offers opening a compensation case for the student (FR-ADMIN-20 (c)); no case opens by itself. Example: fee 500 EGP,
  > the teacher absent and the remedy lapsed: the 500 goes back to the student by the Administrator's decision.
- [ ] T022 The final adversarial reach: no user procedure unregistered (`procedure-harness.spec.ts`, with `programme`
  in the both-directions reach and the never-exempt routers since T007, so teacher-kind procedures count), and the
  card-detail assertions across the suite.
- [ ] T023 The close:
  - quickstart.md §1–§3 on the last batch's commit, each run's output in its own file;
  - SC-703 and SC-706 timed by hand;
  - `docs/ARCHITECTURE.md`'s module graph;
  - the switch left off for the owner to flip (I-3).

## Dependencies and Execution Order

- **B-P1:** T001 first; T002 and T003 in parallel lanes; T004 and T005 after T001 and T003; T006 after T005.
- **B-P2:** T007 after T006; T008 and T009 after T007 (T009 after T006's no-hold path); T010 and T011 after T009; T012
  after T011.
- **B-P3:** T013 first; T014 after T013; T015 after T014 and T008; T016 after T015; T017 after T015, T011 and T013;
  T018 after T017.
- **B-P4:** T019 to T021 after their procedures; T022 after every procedure; T023 last.
- **Two tracks:** this file is track 2's (`tracks-coordination.md` §2). Shared with track 1 (sessions' area,
  coordinated as T112 was):
  - `kernel.md` (T006's row);
  - `jobs/confirm-enrollment.ts`;
  - `sessions/generation.service.ts`, `completion.service.ts`, `restore.service.ts`.

## Batches

| When | Batch | Tasks | What |
|---|---|---|---|
| 11/21–11/22 | B-P1 | T001, T002, T003, T004, T005, T006 | Schema, settings and the switch, contracts, prices, the assessment, the confirm step by kind |
| 11/23–11/24 | B-P2 | T007, T008, T009, T010, T011, T012 | The offer, the 48 hours and the refusal, the first payment, the completion gate, the releases, the case amounts |
| 11/25–11/26 | B-P3 | T013, T014, T015, T016, T017, T018 | Saved cards and the close hook, the automatic charge, the sweep, renewal, the stop and the reopen, the reads |
| 11/27–11/29 | B-P4 | T019, T020, T021, T022, T023 | The phone, the panel, the adversarial reach, the close |
| 11/30–12/1 | — | — | The programme's own money review, at the full review's depth, and its fixes (`PLAN.md`, «The calendar to the closed test», 2026-11-21; the fallback to v1.1 is removed, DEC-92 as amended). It checks, among the rest (PR #153's review, round 4): the close hook's lock order (the follow-up under T006), and that the webhook matched by merchant reference writes `gatewayOrderId` (T014) |

- **B-P1 is cut from `develop` after PR #155 merges** (T001's `programme_request_kind` carries `pay_blocked`).
- **Shared with R1a on the same days** (`specs/002-identity/tasks.md`, T174's two tables): the migration order, the
  ERD's numbering, the seed's counts (T001: tables 45 → 48; T002: settings 95 → 103) and the settings registry.
  `tracks-coordination.md` §2 holds: the numbers are agreed between the two review sessions before either merges, and
  both migrations are proven on one database at integration (PR #155's review, round 1, N1).
  > **W5 note (B-P1, 2026-11-22).** At the second merge with R1a: `CheckoutSteps.currentHold`'s type
  > (`payments/checkout.service.ts` ~`:208`, R1a's region) names `programme` beside `now` and `leadHours` (B-P1's
  > `checkout.current` reads it through `HoldTerms` meanwhile); the counts become tables 50, settings 107,
  > `migrate-from-empty` 53, the ERD footer and `module-tables.json` 53.
