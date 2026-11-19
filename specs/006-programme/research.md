# Research: The ijazah programme

Decisions for `plan.md`, numbered from R-501 (Phase 4's run to R-414). Each gives the decision, why, the alternatives,
and the code it stands on, read on `da98e600` (= `244096f1` + B-M4's documents). Revised after the analysis of
2026-11-19 (`ejazah-tools\track2\b-m4\analyze-triage.md`) and the owner's DEC-94.

**The owner's answers, 2026-11-19 (all settled, DEC-94):**
- the analysis's I-2 (a): the offer within 24 h of the assessment, else an Administrator item;
- the 48 hours run from the offer (R-505);
- P1 (a): the fee is seeded 0 = unset;
- P2 (a): the old ijazah packages are deactivated when `programme_enabled` is turned on, not by the migration.

Settled by the review session on recorded precedents:
- G-4 (Q-3 (a), FR-SESS-16);
- I-3 (the 12/4 fallback's mechanism);
- U-1 (the hidden-times rule);
- I-1 (A-2 (a)'s consequence);
- K-2 (Q-C3's definition).

## R-501 — One enrollment per programme; the assessment is its session 1

- **Decision.**
  - The programme is one `enrollments` row with `snapshot_track = ijazah_track`, created at the assessment's checkout
    as today (a hold, `pending_payment`, confirmed by the paid event).
  - The assessment is the enrollment's **session 1**. The offer's sessions are 2..N+1.
  - `snapshot_session_count` is 1 until the offer, then N+1.
  - The half counts all N+1 sessions, the assessment included (DEC-94: 40 + 1 = 41, the half at 21). Completion counts
    them too.
  - A student who does not continue leaves a one-session enrollment.
- **Why.**
  - The database refuses a session 0 (`sessions_sequence_number_positive_check`, `≥ 1`,
    `20261101083800_column_checks/migration.sql:36-37`), and the contracts parse `positive()`
    (`packages/contracts/src/sessions.ts:85,87`). Session 1 needs neither changed.
  - DEC-94 counts the assessment toward the half.
  - DEC-85's refund already sums every order of the enrollment (`case-amount.rules.ts:125-131`).
  - Slot occupancy holds the weekly time while the enrollment is `confirmed` (`slot-occupancy.service.ts:4-6`).
- **Alternatives.**
  - Session 0, which needs rule 38 relaxed and the contracts widened (analyze V-2).
  - A separate assessment enrollment, which means two occupancies and a cross-link for the refund.
- **Completion gate (analyze V-1).** `completion.service.ts:172-186` completes a `confirmed` enrollment once the
  rows that exist are settled and 72 h have passed, with no count check. Under month-by-month generation that would
  complete a programme between months. A programme completes only when it is fully paid (`months_paid` = the month
  count, or in full) and not `awaiting_offer`, `offered` or `paused`; the existing checks follow. Red first on «a paid
  month settled, the next unpaid».

## R-502 — Every order carries its kind; the confirm step knows each order

- **Decision.** `payments.kind`, enum `order_kind`: `package` (today's, the default for existing rows) · `assessment`
  · `rest_in_full` · `instalment`, with `payments.instalment_month` (set only for an instalment, a check).
- **The confirm step** (`jobs/confirm-enrollment.ts:229-256`; analyze V-3):
  - A per-order marker `payments.confirmed_at`, set by the step for the order it processed; a replayed event finds it
    and does nothing. Today's single `enrollments.confirming_payment_id` is not enough for several orders.
  - An order of an expected kind skips today's cover and case gates (`cases !== null`, `covers()`,
    `compensation-case.service.ts:99-103`), so month m+1 paid while month m's `duplicate_payment` case is open still
    opens its month. Expected means:
    - an `assessment` on `pending_payment`;
    - a `rest_in_full`, or the next `instalment`, on `offered`, `active` or `paused`.
  - `rest_in_full` and `instalment` take a confirm path with **no hold**: generation only, under the enrollment's
    lock. The hold path (`:257-284`) stays for `package` and `assessment`.
  - A second paid order for a month already paid takes the `duplicate_payment` case. There is no unique index, because
    the second paid event must be recorded (FR-718).
- **Specs:** a replay, «m+1 paid while m's case is open», and two paid events for one month (DB race).

## R-503 — An ijazah-track package sets three prices; its count, length and total come at the offer

- **Decision.**
  - `packages` gains `price_30_piasters`, `price_45_piasters`, `price_60_piasters`: all three on an `ijazah_track`
    package, none on a recitation one (a check).
  - On an ijazah-track package, `session_count`, `session_duration_minutes` and `price_piasters` are NULL (made
    nullable, with the track check).
  - The package's contract output becomes a union by track; recitation's fields stay non-null (R-API-9; analyze K-3).
- **The switch (I-3, DEC-94): a setting `programme_enabled`, off by default**, an Administrator's, turned on when B-P4
  lands.
  - While it is off, an ijazah-track package is created and sold as today (one order, B-M2's rule).
  - Turning it on makes new ijazah-track packages programme packages, so DEC-92's fallback «sold as today until it
    lands» holds whatever date B-P4 merges.
  - The switch gates only new programme packages and new assessments (analyze N-4). Turning it off again stops no
    running programme (its offer, payments, renewals and requests go on) and reactivates no old package.
- **The old ijazah packages (P2 (a)).**
  - Turning the switch on deactivates every old-style ijazah-track package (closed-test data); their enrollments are
    untouched and keep B-M2's one-order rule. The migration changes no row, so they are sold as today until then.
  - `packages.is_programme` tells a programme package from a pre-switch ijazah-track one; the check and every reader
    branch on it, not on the track alone.
- **Why.** The owner's Q-C1 model; three columns for three fixed lengths.

## R-504 — The assessment's booking reuses today's checkout

- **Decision.**
  - For a programme package, the booking sheet and the hold offer the teacher's active weekly times of length `>=` the
    assessment's (§3.14, 30). Two places compare exactly today: `booking-slots.service.ts:198` and
    `holds.service.ts:505` (analyze I-1).
  - FR-PROFILE-8 («shall equal») is amended for the programme as A-2 (a)'s consequence, recorded in DEC-94: the
    length fits inside the slot.
  - The hold, the checkout and the order are today's, with `kind = assessment` and the gross = the fee.
  - The paid event confirms the enrollment and generates session 1 only, at the first weekly occurrence, for the
    assessment's length.
  - A `programmes` row starts in `awaiting_offer`. The snapshot holds count 1, the assessment's length and the fee.
- **Readers of the snapshot** (analyze U-8): every reader of `snapshot_session_count`, `snapshot_duration_minutes` and
  `snapshot_price_piasters` is listed in T005 and checked for a one-session enrollment and for one whose snapshot
  changes at the offer:
  - the half and end rules;
  - completion;
  - restore;
  - remaining-sessions;
  - certification eligibility;
  - the phone's «x of N».
- Publishing is refused (`assessment_fee_unset`) while the fee is 0 (R-515).

## R-505 — The offer within 24 hours of the assessment; the 48 hours from the offer (DEC-94)

- **Decision.**
  - **The offer's window (I-2 (a)):** `offer_due_at` = the end of the assessment session as delivered + 24 h
    (§3.14, `programme_offer_hours`).
    - It is set when session 1 is settled `done` or `student_no_show` (consumed: the student missed it, the fee kept).
      A teacher's no-show, a both-no-show, a cancellation by agreement or a postponement is made up (DEC-84, DEC-86),
      and the window follows the make-up's delivery (analyze U-2).
    - Any other end of session 1 with no make-up pending (a remedy that lapses, a dispute unresolved past 24 h after
      its scheduled end) opens the `no_offer` Administrator item at its scheduled end + 24 h, so the weekly time is
      never reserved for ever (analyze N-2).
    - The offer is refused `assessment_not_delivered` before.
  - **No offer by `offer_due_at`:** the sweep opens a `no_offer` Administrator item. It never lapses automatically,
    and the weekly time stays reserved. The Administrator decides:
    - a refusal (as R-513: the fee kept, the assessment's share released);
    - or an extension, giving the teacher `programme_offer_hours` more: the item is closed `extended`, and a new item may
      open at the new deadline (analyze N-10). A `no_offer` item has no «decline».
  - **The 48 hours (the owner: «ال 48 ساعة دي بتبدأ من وقت عرض الباقة»):** `pay_by` = the offer's time + 48 h
    (§3.14). The first regular session is the first weekly occurrence after `pay_by`, with no booking lead (analyze
    U-5; FR-BOOK-15's «first weekly occurrence after»).
  - **The student's own cancellation** records `offer_declined`; no payment by `pay_by` records `offer_lapsed`. Either
    frees the weekly time at once and keeps the fee. The assessment's share falls due per DEC-94 (R-512).

## R-506 — The offer

- **Decision.** `programme.offer`:
  - level, readiness, expected length (texts, 1–500);
  - the length, `<=` the reserved weekly time's;
  - the count N, 1–200 (a contract constant, a definition; analyze U-6);
  - the total = N × the package's price for that length, read under the package's lock.
- Paying in full requires the total > the fee (U-6).
- In one transaction it writes the offer and the enrollment's snapshot (count N+1, the length, the total), then moves
  the programme to `offered`. All are frozen after.
- The amounts come from `packages/money` through payments' entry (R-MONEY-6, the boundary lint; analyze K-5).

## R-507 — Months are generated one at a time; each session knows its month

- **Decision.**
  - Month m holds 4 of the offer's sessions; the last month the remainder.
  - A new column `sessions.programme_month` (smallint, NULL for the assessment and for non-programme enrollments)
    records each session's month at generation. A make-up or a postponement takes its original's month (analyze V-4).
  - Generation always starts from max(`sequence_number`) + 1, since a make-up takes max + 1 today
    (`makeup-booking.service.ts:376`; `@@unique([enrollmentId, sequenceNumber])`, `sessions.prisma:85`). It writes
    `programme_month`.
  - Paying in full generates all N; a paid month generates its 4, from the first weekly occurrence after both the
    paid month's last session and the payment.
- **Month 1's amount:** 4 × the session price. The last month takes the remainder (`packages/money`).
- **«4 sessions a month»** is a definition by DEC-93, not an operational number (R-MONEY-12; analyze K-2, settled).
- **The paid month's last session** (analyze I-4) is the latest end among the sessions of that `programme_month`,
  make-ups included (`lastToEnd`, B-M2's precedent).
- **The pause:** an unpaid month has no sessions, so nothing is held or evaluated. The pause is the programme's state,
  set when the next weekly occurrence after the paid month's last session starts unpaid. A late payment generates the
  month from the next occurrence, so the paused weeks fall at the end.
- **The student's own weekly time (U-1, settled by the hidden-times rule).** The student's booking of another teacher refuses
  a weekly time overlapping their active programme's (discovery and holds, FR-BOOK-5's axis (b) on the reservation).
  Without it, a month's generation could be refused and today's refusal branch would cancel the whole enrollment.
  - An active programme is one `awaiting_offer`, `offered`, `active` or `paused`.
  - The same weekly time is excluded from the make-up times offered (FR-MAKEUP-3, `remedy-offer.service.ts` proposal and
    counter options) and from the postponement's placement (DEC-86) of the student's other enrollments (analyze N-12).
  - Defence in depth either way: a refused month's generation never cancels a programme enrollment. It keeps the
    order paid, opens a case and logs.

## R-508 — One sweep, `advance-programmes`, every minute

- **Decision.** A scheduled job (`jobs/job.ts:16-50`), registered by the integration's `006:` block in `worker.ts`.
  - It acts only on a programme whose enrollment is `confirmed` (analyze G-5).
  - Each step runs under the programme's row lock, in its own transaction, with one log line of ids and a reason:
    1. **windows:** `awaiting_offer` past `offer_due_at` → the `no_offer` Administrator item (once; R-505);
       `offered` past `pay_by` with no payment → cancel `offer_lapsed`.
    2. **due:** mark the next month due at the paid month's last session's end; with a saved card, record the
       automatic order (R-509).
    3. **retry:** for a soft-declined month, record a new automatic order at 1, 3, 5 and 7 days after the first failure,
       at most 4, only while a saved card exists; with none (turned off, or deleted at a suspension), the month is by
       hand (PR #153 r2 Minor 1).
    4. **pause:** set `paused_at` when the next occurrence starts with the month unpaid; a live `enrollment` signal to
       both parties after commit (analyze N-15).
  - **«Pending» (analyze A-1)** is an automatic order of the month in `created` and unexpired. Steps 2 and 3 skip while
    a manual order of the month is `created` and unexpired. A manual payment is refused (`charge_pending`) while an
    automatic one is.
  - **Double run:** each step reads the state it moves from (R-API-14).
- **A teacher suspended, banned or gone (G-4, settled by Q-3 (a) and FR-SESS-16; analyze N-1).**
  - As for any enrollment today: a suspension **pauses** (the remaining sessions `cancelled_by_admin`, the enrollment
    stays `confirmed`, a `teacher_suspended` case open; `termination.subscriber.ts:347-349`). A ban or a departure ends
    it, and so does an Administrator ending a suspended enrollment.
  - The sweep skips a programme with an open `teacher_suspended` or `student_suspended` case: no due, no charge, no
    retry, no pause.
  - At a teacher's suspension, ban or departure the saved card is deleted at once (DEC-94: «the automatic charges stop
    at once and the token is deleted»), through payments' `deleteProgrammeCard` called from booking's termination
    subscriber. After a reinstatement the student renews by hand.
  - DEC-85's full refund is shown only once the enrollment is ended. A ban, a revocation or a departure already opens
    the case `teacher_ended` (the enrollment cancelled `teacher_suspended`, `termination.subscriber.ts:352`). The
    closing the set lacks is an Administrator's end of a suspended programme: the case `admin_ended` that covered the
    open `teacher_suspended` case (`enrollment-end.service.ts`, `closePausedCaseOnEnd`). On a programme it joins the
    dropout set only then; a direct end of an unsuspended programme stays outside (T012; PR #153 r2 Minor 3).
  - A restore after a suspension on a programme is a rare edge, deferred; restore stays refused on a programme
    (R-513).

## R-509 — The automatic charge: recorded first, charged after commit

- **Decision.**
  - The sweep's transaction records an `instalment` order in `created`:
    - its `gateway_order_id` NULL until the gateway answers (a check: NULL only on an `automatic` order in `created`;
      analyze N-3); its merchant reference = the payment's id;
    - its `expires_at` = now + `slot_hold_ttl_minutes` (FR-PAYG-6's checkout TTL, §3.14, 10 minutes).
  - After commit it calls `PaymentPort.chargeSavedCard(paymentId, gross, currency, cardToken, payee)`, which answers
    `{ gatewayOrderId }`; the result arrives by the same signed webhook as every order.
  - **Never called twice.** A crash between commit and call leaves the order `created` with no gateway id. It is never
    called again: at its `expires_at` it is `expired`, and the next retry is a new order. If the call had reached the
    gateway, its webhook is matched by the merchant reference (the payment's id) and an expired-then-paid order is
    FR-PAYG-19's (analyze G-6, N-3). No double charge rests on the gateway refusing a duplicate.
  - **An automatic order that expires with no answer** counts as a soft decline (PR #153 r1 Minor 1): `first_failure_at`
    is set, the student is shown «pay now», and the retry schedule starts. Otherwise a card holder would have no button
    and the programme would pause with no way to pay.
  - **Manual programme orders** (`programme.pay`, `programme.renew`; analyze G-7, N-11) have no hold. They expire at
    min(`slot_hold_ttl_minutes`, `pay_by` for the first payment). FR-BOOK-12's one checkout per student applies: while
    a programme order of the student is `created` and unexpired, no other checkout starts, and vice versa;
    `checkout.current` and «continue» show it as today.
  - The Paymob adapter creates an intention on the saved-card (Moto) integration with the split and pays it with the
    token. The fake answers paid, soft or hard on demand.
  - The `failed` event carries `declineKind` from a code table; an unknown code counts as hard (never retried).
  - **Off in live** until the gateway's written answers (OPEN-11; FR-720): with no Moto integration id configured, no
    card is offered for saving and every month is manual.
  - **The payee guard (PR #153 r1 Major 3):** in live mode `chargeSavedCard` refuses a charge that names no payee, as
    `createCheckout` does (`paymob.adapter.ts:220-222`), and the Moto intention carries `split_amounts`. The sweep
    records the refusal as a `failed` order with `declineKind` `hard`: no gateway call, no retry. The month pauses
    until the teacher's payout account is verified, since a manual payment is refused the same way
    (`checkout.service.ts:507-508`; PR #153 r2 Minor 2). Without it, a live 1,000 EGP month with no split
    would settle whole into the platform's account, the teacher's 700 with it (R-MONEY-6).
  - No gateway call while holding a database lock.
- **R-514 corrected (analyze I-6).** `booking.recordOrderFailed` never cancels today. `holds.service.ts:330` only picks
  the reason when a hold is released, so a failed instalment needs no change there. The failure's `payment_failed`
  push is today's path (`order-failed.repository.ts:19-31` → `payment-outcome-notices.port.ts:47-48`).

## R-510 — The saved card

- **Decision.**
  - The first payment's intention asks to save the card when the student ticked consent.
  - The gateway's token callback becomes `GatewayEvent.card_saved {gatewayOrderId, token, last4, brand}`.
  - It is recorded with a new `payment_event_type` member `card_saved` and the provider event id
    `paymob:<txId>:token` (R-MONEY-8 replay; analyze G-9).
  - `programme_cards` keeps the token encrypted by `ColumnCipher` (`platform/crypto/encryption.ts:167`). That is
    R-DB-8, with the `payments.checkout_url_encrypted` precedent (`payments.prisma:50-53`); R-DB-7's hashing cannot
    serve a token that must be used again (analyze K-4).
  - It is registered in payments' `createEncryptedColumns` (`index.ts:113`) for `reencrypt-columns`.
  - **Where the token is written (PR #153 r1 Minor 3):** encrypted and written to `programme_cards` in the webhook's own
    transaction, beside the `payment_events` row. It never travels in a job payload (the jobs README's identifiers-only
    payloads), and a spec asserts the enqueued payload carries ids only.
  - **Turning the automatic renewal off (PR #153 r1 Major 4 (a), DEC-95):** `programme.autoRenewOff`, the student only,
    at any time, deletes the card row under the programme's row lock, the lock the sweep's due step reads the card
    under, so an «off» that has answered is never followed by a charge (r2 Minor 1). Later months renew by hand under
    the same due point, early renewal and pause rules. A charge already recorded `created` stays as it is (settled by the review session as the reading of the owner's (a): a charge already sent cannot be recalled),
    and the screen says so while `chargePending` is true. The consent words at the first payment say it can be turned
    off.
- **«Card detail»** (analyze I-5) = the token, the PAN, the expiry: never in a log, an audit entry or a response.
  `last4` and the brand may be returned, to the student only.
- **One close hook** (analyze G-5, N-6): booking's cancel path, for every closing reason (today's and the programme's),
  sets `programmes.state = closed` and `closed_at` on its own table, then calls payments' entry `deleteProgrammeCard`
  only to delete the card row (R-API-6: each module writes its own tables).
- **Erasure:** the card row is deleted by the account's erasure (`identity/deletion.service.ts`,
  `identity/consequences.ts`, `jobs/erase-kept-data.ts`; `main.ts` wiring is the integration's; analyze G-10).
- «Change card» = a manual payment of a due month with consent ticked; its `card_saved` replaces the row.
- A token callback the live adapter cannot verify is refused.

## R-511 — The rates come from the assessment's order

`#createAndRecord` (`checkout.service.ts:488-558`) reads the share rate and the 25 % from settings for a `package` or
`assessment` order (`:495-505`). For `rest_in_full` and `instalment` it copies them from the programme's `assessment`
order (ADR 0025 D6, FR-702).

## R-512 — The programme's releases (DEC-94)

- **The student does not continue** (`offer_declined`, `offer_lapsed`, `assessment_refused`): a new milestone
  `assessment`, the assessment order's share (350 of 500). It falls due once the programme has
  closed, its 48 hours have ended where an offer was sent (DEC-94: «once the 48 h have ended»), and session 1's
  dispute window has passed with no case open.
- **The student continues:** no `assessment` milestone.
  - **`ijazah_half`:**
    - Base: 25 % × `teacherShare(the programme's price as paid, rate)`, where the price is the offer's total in full
      (the fee inside it) or the total + the fee by months. That gives 1,750 / 1,837.50.
    - Cap: the shares of the programme's paid orders, the assessment included, minus releases.
    - Trigger: half of the N+1 sessions delivered, the assessment counted (41 → 21), as `halfReached` does today on the
      snapshot count.
    - Today the base is the first paid order's share (`share-release.rules.ts:246`; `shareOrdersOf`, repository
      `:129-156`). For a programme that order is the assessment, so the change is red first.
  - **`ijazah_end`:** the shares of all the programme's paid orders − the half released or owed − the refund share
    (analyze U-4).
  - **`programme_stopped`** (a new milestone, an approved stop): the shares of the paid orders − the half released or
    owed − the refund share, after the last delivered session's window, no case open.
- **The closes' amounts per session** (analyze G-3): DEC-86 and DEC-91's refunds and `student_complaint_close`'s
  release value a session by **its own order**: the assessment = the fee; a month's session = the month's order ÷ its
  sessions; in full = (total − fee) ÷ N. Today they take the first order ÷ the count (`case-amount.rules.ts:121,137-168`;
  `share-release.rules.ts:277-291`), which on a programme would be fee ÷ N.
- One-order packages (`package` kind) keep today's rules.

## R-513 — Stop and refusal requests; reopen

- **Decision.** `programme_requests` (booking): kind `stop` | `refusal` | `no_offer` (I-2 (a), raised by the sweep), reason
  (1–500), status `open`/`approved`/`declined`/`withdrawn`/`extended` (`no_offer` only).
  - A partial unique index holds one open request per enrollment and kind.
  - **`stop`:** refused before `paused_at` + 7 days. A renewal withdraws an open one in the payment's transaction, with
    one log line.
  - **`refusal`:** from the assessment's delivery until an offer is sent. Approval cancels `assessment_refused`.
  - The administrator's decisions are audited.
  - **An approved stop:** the enrollment `cancelled` `programme_stopped`, the weekly time free at once, the close hook
    (R-510), R-512's release.
- **Reopen** (analyze G-2, U-3):
  - Only a `programme_stopped` programme.
  - Under the slot's lock, with restore's refusals: `slot_taken`, `party_restricted`, `gender_mismatch`.
  - The enrollment `confirmed`, the programme `paused` with `paused_at` = the reopen time, so a new stop request waits
    7 days.
- **Restore** (ADR 0023, `restore.service.ts:559-564`) is refused on a programme enrollment
  (`programme_enrollment`); reopen is its path (analyze G-1).

## R-514 — (merged into R-509)

## R-515 — Settings

Eight registry keys in track 2's block, seeded after `postponement_interval_weeks` (`prisma/seed.ts:185`); the count
95 → 103 (`tests/seed/seed.spec.ts:375`). «4 sessions a month» is not among them: it is DEC-93's definition of a
month, not an operational number (K-2, settled).

| Key | Default | Bounds | Unit | Group |
|---|---|---|---|---|
| `programme_enabled` (I-3) | false | boolean | — | `booking` |
| `assessment_fee_piasters` | 0 = unset (P1 (a)) | ≥ 0 | a new unit `piasters` | `booking` |
| `assessment_duration_minutes` | 30 | list 30, 45, 60 | `minutes` | `booking` |
| `programme_offer_hours` (I-2 (a)) | 24 | ≥ 1 | `hours` | `booking` |
| `programme_pay_rest_hours` | 48, from the offer | ≥ 1 | `hours` | `booking` |
| `programme_stop_request_days` | 7 | ≥ 1 | `days` | `booking` |
| `programme_renew_early_days` | 3 | ≥ 0 | `days` | `booking` |
| `programme_charge_retry_days` | [1, 3, 5, 7] | a list of at most 4 increasing days | `days` | `booking` |

The admin catalogues gain their labels. A boolean setting is new to the registry: if the bounds shapes
(`registry.ts:66-74`) refuse it, `programme_enabled` is a `count` 0/1 (decided in T002).

## R-516 — The catalogue and the editor

Discovery shows a programme package with the fee and «lowest – highest للحصة». The editor takes three prices and shows
DEC-88's average beside each, per length (FR-704a).

## R-517 — Proofs

- TDD in full (red first, named mutants) for money and time.
- DB specs on `ijazah_integrity_b`.
- Double-run specs for `advance-programmes`.
- **Adversarial (analyze K-1):** every new user procedure is registered in the harness, both gender directions, in the
  batch that adds it (R-PROC-5). The gate `procedure-harness.spec.ts:137-141` sees only what a student can reach: a
  `teacher`-kind procedure is outside its reach unless its router is in `SESSION_ROUTERS` (`procedure-harness.ts:268`,
  `:305`, `:333-342`). So every programme procedure, the teacher's offer and requests included, lives under one
  `programme` router, and T007 adds `programme` to the routers reached whatever the caller kind and to the never-exempt
  `ATTACKED_ROUTERS` (`:287-291`), red first with an unregistered fixture (#142 r1 Major 1's precedent; PR #153 r1
  Major 2). T022 is only the final reach check.
- No card detail asserted in logs, audits and responses (SC-707).
- A kernel.md row for the lock order programme → enrollment → payment (T006, T015, T016, T017; analyze U-7).
