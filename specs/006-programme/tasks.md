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

- [ ] T001 The migration, the schema and the ERD (data-model.md; R-501, R-502, R-503, R-507, R-510, R-513):
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
- [ ] T002 [P] The settings and the switch (R-515; FR-732; I-3, P1 (a)):
  - `apps/api/src/platform/settings/registry.ts`:
    - a new unit `piasters`;
    - the eight keys in track 2's block, `programme_enabled` off, `assessment_fee_piasters` 0 = unset, `programme_offer_hours` 24;
    - if the bounds shapes refuse a boolean, a `count` 0/1.
  - `prisma/seed.ts` after `postponement_interval_weeks` (`:185`); `tests/seed/seed.spec.ts` 95 → 103.
  - Both admin catalogues' labels (`tests/admin-i18n/settings-labels.spec.ts`).
  - Turning the switch on deactivates every old-style ijazah-track package (`modules/catalog/packages.service.ts`, an
    audited effect of the setting's change, logged once). It gates only new programme packages and new assessments;
    turning it off stops no running programme and reactivates nothing (N-4), red first.
- [ ] T003 [P] The contracts (contracts/*):
  - `packages/contracts/src/programme.ts`, `packages/contracts/src/admin/programme.ts`;
  - the package output as a union by track (recitation and pre-switch ijazah unchanged, non-null; K-3);
  - discovery, slots, monitor and restore changes;
  - `idempotent-procedures.ts`;
  - every refusal code named;
  - the snapshot regenerated.
- [ ] T004 [US1] The three prices and the catalogue (FR-704, FR-704a; R-503, R-516), behind `programme_enabled`:
  - `modules/catalog/packages.service.ts`, `packages.repository.ts`, `packages.router.ts`: a programme package takes
    `prices {m30, m45, m60}`; publishing is refused `assessment_fee_unset` while the fee is 0.
  - Discovery: `assessmentFee`, `priceRange`.
  - DEC-88's average per length (T113's read).
  - Every reader of the three old columns branches on `is_programme`.
  - Adversarial registrations of the changed reads.
- [ ] T005 [US1] The assessment's booking and confirmation (FR-701, FR-702; R-504, R-511; U-1):
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
- [ ] T006 The confirm step by kind (FR-718; R-502; V-3), `jobs/confirm-enrollment.ts:229-284`:
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

## Phase 2: The offer, the first payment and the money (B-P2)

- [ ] T007 [US2] The offer (FR-705; R-506), `programme.offer`, in `modules/booking/programmes.service.ts`,
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
- [ ] T008 [US2] The 48 hours, the cancellation, the refusal and the missing offer (FR-706, FR-707, FR-709; R-505, R-513; I-2 (a)):
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
- [ ] T009 [US2] Paying in full or a month (FR-710 to FR-713; R-507, R-511), `programme.pay`, in
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
- [ ] T010 [US4] [US5] The completion gate and the counts (FR-712, FR-728; R-501; V-1):
  - `modules/sessions/completion.service.ts`: a programme completes only when fully paid and not `awaiting_offer`,
    `offered` or `paused`. Red first on «a paid month settled, the next unpaid, 72 h passed».
  - `share-release.rules.ts` `halfReached` over the N+1 snapshot count, the assessment counted (DEC-94: 41 → 21),
    pinned.
  - `sessions/restore.service.ts` refuses `programme_enrollment` (G-1).
- [ ] T011 [US5] The programme's releases (FR-703, FR-725, FR-728; R-512; DEC-94), `share-release.rules.ts`,
  `share-release.repository.ts`, `release-teacher-shares`:
  - `assessment` only when not continued (at the close, or at `pay_by` where an offer was sent, whichever is later, once session 1's 72 h have passed, no
    case: DEC-94); never while a `pay_blocked` item is open, the programme not being closed (FR-706b), red first on
    «the item open past `pay_by`: no `assessment` release»;
  - `ijazah_half` = 25 % × the share of the programme's price as paid (1,750 in full; 1,837.50 by months, fee 500),
    capped at the paid orders' shares − releases (red first: today's base is the first order's share, `:246`);
  - `ijazah_end` and `programme_stopped` = shares − the half released or owed − the refund share (U-4);
  - `package` orders keep today's rules.
- [ ] T012 [US5] The case amounts on a programme (FR-729, FR-730; R-512; G-3, G-4), `case-amount.rules.ts`
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

## Phase 3: Renewal, the pause and the stop (B-P3)

- [ ] T013 [US3] Saved cards and the close hook (FR-713, FR-719; R-510):
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
- [ ] T014 [US3] The automatic charge (FR-714, FR-716, FR-717; R-509):
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
    mode, the teacher's payout account is not verified (`paymob.adapter.ts:220-222`, `checkout.service.ts:507-508`; PR
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
- [ ] T017 [US4] The stop request, the close and the reopen (FR-723, FR-725, FR-727; R-513), in
  `modules/booking/programmes.service.ts`, `programme-requests.*`, `programmes.router.ts`,
  `modules/booking/enrollments-admin.router.ts` (the admin decisions):
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
- [ ] T018 [US2] [US6] The reads (FR-726, FR-727), in `modules/booking/programmes.service.ts`,
  `programmes.repository.ts`, `programmes.router.ts`, `modules/booking/enrollments-admin.router.ts`, and
  `modules/payments/payments-monitor.*`:
  - `programme.get`, the two parties only, the card to the student only, `teacherUnavailable` (FR-BOOK-19),
    `payeePending` (in live mode, the teacher's payout account not verified; false in test mode, a spec for each mode;
    PR #153 r3 Minor 1, r4 Minor 2; read through T008's payments entry) and `payBlocked` (a `pay_blocked` item is open),
    with its adversarial registration;
  - `programmes.queue` (paused, stop, refusal, no_offer, pay_blocked; oldest first, how late, the reason; a `pay_blocked` item with whether the payout account is
    verified now) and `programmes.get`
    (admin);
  - the monitor's `kind`, `instalmentMonth`, `automatic`, `declineKind` (`payments-monitor.*`).

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
- [ ] T021 [US6] The panel, `apps/admin/src/pages/programmes/`:
  - the queue (paused, stop, refusal, no_offer, pay_blocked) oldest first, decide, extend, reopen;
  - each screen explains itself: a `pay_blocked` item says why it opened, whether the payout account is verified
    now, and what each decision does (approve: the offer lapses, the fee kept; extend: 48 hours more from now);
  - the monitor's columns;
  - the `programme_enabled` setting's label explaining what flipping it does;
  - `admin.programme` i18n.
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
  ERD's numbering, the seed's counts (T001: 95 → 103) and the settings registry. `tracks-coordination.md` §2 holds: the
  numbers are agreed between the two review sessions before either merges, and both migrations are proven on one
  database at integration (PR #155's review, round 1, N1).
