---
description: 'Task list for the ijazah programme — the assessment and prepaid monthly instalments'
---

# Tasks: The ijazah programme — the assessment and prepaid monthly instalments

**Input**: Design documents from `/specs/006-programme/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Included.
- **Full TDD** (each spec red first on its own, negatives red under a named mutant, every mutant restored and
  `cmp`-checked) for money and time: T001, T003, T005, T006, T007, T008, T009, T010, T011, T013, T014, T015, T016,
  T017.
- **Lighter specs** (a render or behaviour spec per screen, Arabic and English) for T019, T020, T021.
- `advance-programmes` and the changed jobs have their double-run specs (R-API-14).
- Every new user procedure is in the adversarial harness both ways (T022).
- DB specs run on `ijazah_integrity_b` only (track 2).

**Organization**: the foundations, then the stories of spec.md in priority order, then the screens and the proofs,
in the batches B-P1 to B-P4 (DEC-92: the server beside the design week, the screens after it; all merged by 12/4,
else v1.1). At most six tasks a batch, a task in at most two lanes.

**The owner's answers**: DEC-92 (Q-1 to Q-4 of B-M4's conflict check) and DEC-93 (the clarify answers). Plan
questions P1 (the fee's amount) and P2 (existing ijazah packages) are pending: they change only T001's seed value and
its migration step.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on incomplete work).
- **[Story]**: US1–US6 of spec.md.
- A task of another file is written `003:T105`; a bare id is this file's. Every task names its file paths.

## Path Conventions

`apps/api/src/` (`modules/<module>/`, `platform/`, `surfaces/`, `jobs/`, `main.ts`, `worker.ts`), `apps/mobile/src/`,
`apps/admin/src/`, `packages/contracts/src/`, `packages/money/src/`, `prisma/`, `tests/`.
- Batches are cut from `develop` after T108's PR (`003:T108`) merges, as `Ejazah_app/006-programme/<ids>`.
- The integration owns `main.ts`, `worker.ts`, `surfaces/context.ts`, `app.router.ts`, `admin.router.ts`,
  `packages/contracts/src/index.ts` and the snapshot, each in a `006:` block.

## Phase 1: Foundations (B-P1)

- [ ] T001 The migration, the schema and the ERD (data-model.md; R-501, R-502, R-503, R-510, R-513):
  - a forward migration stamped after `20261119124112`, the enum values committed first:
    - `order_kind`, `decline_kind`, `programme_state`, `programme_plan`, `programme_request_kind`,
      `programme_request_status`;
    - `cancellation_reason` + `offer_lapsed`, `assessment_refused`, `programme_stopped`;
    - `share_release_milestone` + `assessment`, `programme_stopped`;
    - `enrollment_event_kind` + four members.
  - Then:
    - `payments.kind`, `instalment_month`, `decline_kind`;
    - `packages.price_30/45/60_piasters`, the three old columns made nullable, the track check;
    - `programmes`, `programme_requests`, `programme_cards` with their checks and indexes.
  - Existing `ijazah_track` packages deactivated first (P2 (a); a SELECT counts them before).
  - `prisma/schema/{base,booking,catalog,payments}.prisma`; `packages/config/module-tables.json`.
  - `docs/ERD.md`: a dated block at its end, rows from 65 and §15 rules from 70.
  - `tests/seed/seed.spec.ts` table count 45 + 3.
  - A migration spec red under a mutant migration.
- [ ] T002 [P] The settings (R-515; FR-732):
  - `apps/api/src/platform/settings/registry.ts`:
    - a new unit `piasters`;
    - the six keys in track 2's block, with schema, bounds, group `booking` and their SRS rows (§3.14, DEC-92 and
      DEC-93).
  - `prisma/seed.ts` after `postponement_interval_weeks` (`:185`), `assessment_fee_piasters` 0 (P1 (a)).
  - `tests/seed/seed.spec.ts` 95 → 101.
  - Both admin catalogues' labels (`tests/admin-i18n/settings-labels.spec.ts`).
- [ ] T003 [P] The contracts (contracts/app-surface.md, admin-surface.md, gateway.md):
  - `packages/contracts/src/programme.ts`, `packages/contracts/src/admin/programme.ts`;
  - the changed package, discovery, slots and monitor schemas;
  - `idempotent-procedures.ts`;
  - every refusal code named;
  - the snapshot regenerated.
- [ ] T004 [US1] The three prices and the catalogue (FR-704, FR-704a; R-503, R-516):
  - `modules/catalog/packages.service.ts`, `packages.repository.ts`, `packages.router.ts`:
    - an ijazah-track package takes `prices {m30, m45, m60}` and no count, length or total;
    - publishing is refused `assessment_fee_unset` while the fee is 0.
  - Discovery adds `assessmentFee` and `priceRange`.
  - DEC-88's average per length on the ijazah track (T113's read).
  - Every reader of the three old columns branches on the track; the explorer's list (discovery's lowest price,
    checkout, the editor) is re-read first.
- [ ] T005 [US1] The assessment's booking and confirmation (FR-701, FR-702, FR-703; R-504, R-511):
  - `modules/booking/booking-slots.service.ts:198`: an ijazah-track package offers active weekly times of length ≥
    the assessment's.
  - `modules/payments/checkout.service.ts` `#createAndRecord`:
    - an `assessment` order, gross = the fee;
    - the rate and 25 % read as today.
  - `jobs/confirm-enrollment.ts`: an `assessment` paid event confirms the enrollment and generates session 0 only
    (`sessions/generation.service.ts`, `GenerationPlan {count: 1, firstSequenceNumber: 0}`, the assessment's length).
  - `modules/booking/` writes the `programmes` row `awaiting_offer` with `pay_by`.
  - The enrollment's snapshot: count 0, the assessment's length, the fee.
- [ ] T006 The confirm step by kind (FR-718; R-502): `jobs/confirm-enrollment.ts:229-256`:
  - a paid order of an expected kind (`assessment` on `pending_payment`; `rest_in_full` or the next `instalment` on
    `offered`/`active`/`paused`) is not a second payment;
  - a second paid order for a month already paid takes the `duplicate_payment` case.
  - `package` orders are unchanged.
  - A DB race spec: two paid events for one month.

## Phase 2: The offer, the first payment and the money (B-P2)

- [ ] T007 [US2] The offer (FR-705; R-506): `teacher.programme.offer`.
  - The length must be ≤ the reserved weekly time's; the total = count × the package's price for that length, read
    under the package's lock.
  - The offer and the enrollment's snapshot are written in one transaction; frozen after.
  - Refusals: `not_awaiting_offer`, `pay_by_passed`, `length_exceeds_slot`, `count_out_of_bounds`,
    `teacher_not_active`, each red first.
  - `modules/booking/programmes.*`; `packages/money` the session price and month amounts (the last the remainder).
- [ ] T008 [US2] The 48 hours, the cancellation and the refusal request (FR-706, FR-707, FR-709; R-505, R-513):
  - `programme.cancel`;
  - `teacher.programme.request` kind `refusal`;
  - `programmes.decide` approving it → `assessment_refused`;
  - the lapse at `pay_by` (`offer_lapsed`) as a pure function used by T015's sweep;
  - each close frees the weekly time at once; the fee is kept.
  - `modules/booking/programme-requests.*`, `slot-occupancy.repository.ts` (the three new reasons free at once).
- [ ] T009 [US2] Paying in full or a month (FR-710, FR-711, FR-712, FR-713; R-507, R-511): `programme.pay`.
  - `checkout.service.ts`: `rest_in_full` = total − fee, or `instalment` month 1 = 4 × the session price; the rate and
    25 % copied from the assessment order.
  - The confirm step generates sessions 1..N, or month 1's 4, from the first weekly occurrence after `pay_by`.
  - `saveCard` records the consent (the card itself is T013's).
- [ ] T010 [US5] The counts from session 1 (R-501):
  - `share-release.rules.ts:136-138` (`halfReached`), `completion.service.ts` and the delivered counts read
    `sequence_number ≥ 1`;
  - session 0 is never counted toward the half or the end;
  - red first with a delivered assessment.
- [ ] T011 [US5] The programme's releases (FR-703, FR-725, FR-728; R-512), `share-release.rules.ts`,
  `share-release.repository.ts`, `release-teacher-shares`:
  - `assessment` after session 0's 72 h, no case open, even when the enrollment was cancelled;
  - `ijazah_half` = 25 % × `teacherShare(offer total, rate)` capped at the paid months' shares (red first: today's
    base is the first order's share, `:246`);
  - `ijazah_end` over the non-assessment orders;
  - `programme_stopped`;
  - the worked examples: 350, 1,750, the rest.
  - `package` orders keep today's rules.
- [ ] T012 [P] [US5] The case amounts on a programme (FR-729, FR-730): `case-amount.rules.spec.ts`:
  - a dropout refunds every order, the assessment included (already summed, `case-amount.rules.ts:125-131`), pinned;
  - DEC-86/DEC-91 closes on a programme pinned;
  - a teacher suspended, banned or gone opens the case (DEC-92).

## Phase 3: Renewal, the pause and the stop (B-P3)

- [ ] T013 [US3] Saved cards (FR-713, FR-719; R-510; contracts/gateway.md):
  - `platform/ports/payment/payment.port.ts` `createCheckout`'s `saveCard` and the `card_saved` event;
  - `paymob.adapter.ts`:
    - the token callback, refused unless verified;
    - off without the saved-card integration id;
  - `fake.adapter.ts`;
  - `modules/payments/programme-cards.*`:
    - the token through `ColumnCipher`, registered in `createEncryptedColumns`;
    - never logged (a log spec);
    - deleted at a close, at the end and by the account's erasure.
- [ ] T014 [US3] The automatic charge (FR-714, FR-716, FR-717; R-509, R-514):
  - `PaymentPort.chargeSavedCard`, with the Paymob intention on the Moto integration with the split, off until
    configured;
  - the fake's paid, soft and hard answers;
  - `GatewayEvent.failed.declineKind` from a code table, unknown → hard;
  - `booking.recordOrderFailed` for an `instalment` records without cancelling;
  - the `payment_failed` push as today.
- [ ] T015 [US3] [US4] `advance-programmes` (FR-714, FR-717, FR-721; R-508; contracts/jobs.md): `jobs/advance-programmes.ts`, registered in `worker.ts`.
  - The lapse, due, charge, retry (1, 3, 5, 7; at most 4; soft only) and pause steps.
  - Under the programme's row lock, one transaction each, one log line each, no card detail.
  - The double-run spec; DST at the boundary (`packages/time`).
- [ ] T016 [US3] Manual renewal (FR-715, FR-716, FR-722, FR-724): `programme.renew`.
  - Open from `programme_renew_early_days` before the month's end for a student without a card; never while a charge
    is pending; «pay now» and «change card» after a failure.
  - The paid month generates its sessions from the next occurrence, clears `paused_at` and withdraws an open stop
    request with one log line.
- [ ] T017 [US4] The stop request, the close and the reopen (FR-723, FR-725, FR-727; R-513):
  - `teacher.programme.request` kind `stop` (refused before 7 days);
  - `programmes.decide` approving → the enrollment `cancelled` `programme_stopped`, the time free at once, the card
    deleted, T011's release;
  - `programmes.reopen` → `paused`;
  - audited; the locks named in `specs/004-sessions/contracts/kernel.md` (a new row, coordinated).
- [ ] T018 [US6] The administrators' queue and reads (FR-727): `programmes.queue` and `programmes.get`.
  - Oldest first, how late, the reason.
  - The monitor's `kind` and `instalmentMonth` (`payments-monitor.*`).

## Phase 4: Screens and proofs (B-P4, after the design week, on the new design)

- [ ] T019 [US1] [US2] [US3] The student's phone, `apps/mobile/src/features/student/programme/`:
  - the range and the fee on the profile;
  - the assessment's booking (each time's length, «sessions up to this long»);
  - the offer with its total and months;
  - pay in full or monthly with the consent line;
  - months paid and next due;
  - «renew now», «pay now», «change card»;
  - paused.
  - i18n in a `programme` group.
- [ ] T020 [US2] [US4] The teacher's phone:
  - `apps/mobile/src/features/teacher/packages/` (the three prices with the average per length);
  - `teacher/programme/` (the offer, «late since», the stop and refusal requests).
- [ ] T021 [US6] The panel, `apps/admin/src/pages/programmes/`:
  - the queue (paused, stop, refusal) oldest first, decide, reopen;
  - each screen explains itself;
  - the monitor's kind column;
  - `admin.programme` i18n.
- [ ] T022 The adversarial reach: every new user procedure in `tests/adversarial`, both gender directions;
  `procedure-harness.ts`'s routers.
- [ ] T023 The close: quickstart.md §1–§2 on the last batch's commit, each run's output in its own file;
  `docs/ARCHITECTURE.md`'s module graph; the programme's close recorded in `PLAN.md`'s road (track 2's line).

## Dependencies and Execution Order

- **B-P1:** T001 first. Then T002 and T003 in parallel lanes, then T004 and T005 (both need T001 and T003), then T006
  (after T005).
- **B-P2:** T007, then T008 and T009; T010 before T011; T012 in parallel.
- **B-P3:** T013, then T014; T015 after T014 and T008; T016 after T015; T017 after T015 and T011; T018 after T017.
- **B-P4:** T019 to T021 after their procedures; T022 after every procedure; T023 last.
- **Two tracks:** this file is track 2's (`tracks-coordination.md` §2). Shared with track 1: `kernel.md` (T017's row),
  `jobs/confirm-enrollment.ts`, `sessions/generation.service.ts` and `completion.service.ts` (sessions' area,
  coordinated as T112 was).

## Batches

| When | Batch | Tasks | What |
|---|---|---|---|
| 11/20–11/22 | B-P1 | T001, T002, T003, T004, T005, T006 | Schema, settings, contracts, prices, the assessment, the confirm step by kind |
| 11/22–11/24 | B-P2 | T007, T008, T009, T010, T011, T012 | The offer, the 48 hours and the refusal, the first payment, the counts, the releases, the case amounts |
| 11/24–11/26 | B-P3 | T013, T014, T015, T016, T017, T018 | Saved cards, the automatic charge, the sweep, renewal, the stop and the reopen, the queue |
| 11/26–12/3 | B-P4 | T019, T020, T021, T022, T023 | The phone, the panel, the adversarial reach, the close |
| 12/4 | — | — | Whatever is not merged and green moves to v1.1 (DEC-92) |
