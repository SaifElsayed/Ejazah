# Research: The ijazah programme

Decisions for `plan.md`, numbered from R-501 (Phase 4's run to R-414). Each gives the decision, why, the alternatives,
and the code it stands on, read on `da98e600` (= `244096f1` + B-M4's documents).

## R-501 — One enrollment per programme; the assessment is its session 0

- **Decision.**
  - The programme is one `enrollments` row with `snapshot_track = ijazah_track`, created at the assessment's checkout
    as today (a hold, `pending_payment`, confirmed by the paid event).
  - The assessment is the enrollment's session with `sequence_number = 0`.
  - The offer's sessions are numbered 1..N.
  - Every count that decides money or completion (the half, the end, `snapshot_session_count`) counts `>= 1` only.
- **Why.**
  - The money rules already work per enrollment. DEC-85's refund sums every order of one enrollment
    (`case-amount.rules.ts:125-131`, `case-amount.repository.ts:17-39`), so the assessment fee is included with no new
    link.
  - Slot occupancy holds the weekly time while the enrollment is `confirmed` (`slot-occupancy.service.ts:4-6`), which
    is FR-BOOK-15's reservation from the assessment to the payment.
- **Alternatives.**
  - A separate assessment enrollment, then a programme enrollment: two occupancies of one weekly time, a cross-link for
    the refund and for the rate fixed at the first order. Rejected.
  - A `sessions.is_assessment` column: one more column for what sequence 0 already says.
- **Code.**
  - `generation.service.ts:83-86` already takes a `GenerationPlan {count, firstSequenceNumber}` (used by restore).
  - `share-release.rules.ts:136-138` (`halfReached`) and `completion.service.ts` read the snapshot count; both
    gain the `>= 1` filter (B-P2).

## R-502 — Every order carries its kind

- **Decision.** `payments.kind`, enum `order_kind`:
  - `package` (today's one-order purchase, the default for every existing row);
  - `assessment`;
  - `rest_in_full`;
  - `instalment`, with `payments.instalment_month` (smallint, set only for an instalment, a check).
- **The confirm step** (`jobs/confirm-enrollment.ts:229-256`) treats a paid order whose kind the programme expects as
  no second payment (FR-PAYG-19 as amended):
  - an `assessment` on a `pending_payment` enrollment;
  - a `rest_in_full` or the month's next `instalment` on an `offered` or `active` programme.
- A second paid order for a month already paid takes today's `duplicate_payment` case branch (`:242-246`). No unique
  index: the second paid event must still be recorded (FR-718).
- **Why.** FR-PAYG-19 as amended and ADR 0024 D2 name the kind. The release rules and the monitor need it to tell the
  assessment's share from the months'.
- **Code.** `payments.prisma:12-64` has no kind (the explorer, item 1); `checkout.service.ts:488-558`
  (`#createAndRecord`) writes the order.

## R-503 — An ijazah-track package sets three prices; its count, length and total come at the offer

- **Decision.**
  - `packages` gains `price_30_piasters`, `price_45_piasters` and `price_60_piasters`, all three set on an
    `ijazah_track` package and none on a recitation one (a check).
  - On an ijazah-track package, `session_count`, `session_duration_minutes` and `price_piasters` become NULL (made
    nullable, with a check that a recitation package has them).
  - Readers that assume them (discovery's lowest price, the average of DEC-88, checkout, the editor) branch on the
    track.
- **Existing ijazah-track packages** (closed-test data, DEC-87) are deactivated by the migration, their enrollments
  untouched. → plan question **P2**.
- **Why.** The owner's Q-C1 model. Three columns match the three fixed lengths (FR-PROFILE-4) better than a child
  table, and a check holds the rule in the database.
- **Alternatives.** A `package_length_prices` table: one more join on discovery for three fixed values. Keeping the old
  columns filled on ijazah packages with placeholder values: a lie in the data.
- **Code.** `catalog.prisma:43-71`; DEC-88's average is `catalog` T113's read by track and length.

## R-504 — The assessment's booking reuses today's checkout

- **Decision.**
  - For an `ijazah_track` package, the booking sheet offers the teacher's active weekly times of any length `>=` the
    assessment's length (§3.14, 30). Today it offers exactly the package's length
    (`booking-slots.service.ts:198`).
  - The hold, the checkout and the order are today's, with `kind = assessment` and the gross = the §3.14 fee.
  - The paid event confirms the enrollment and generates session 0 only, at the first weekly occurrence, for the
    assessment's length.
  - A `programmes` row starts in `awaiting_offer`.
  - The enrollment's snapshot holds, until the offer: count 0, the assessment's length, the fee.
- **Publishing:** an ijazah-track package is refused (`assessment_fee_unset`) while the fee is 0 (R-515).

## R-505 — The 48 hours run from the assessment's end (FR-BOOK-15's own words)

- **Decision.**
  - The deadline = the assessment session's scheduled end + 48 h (§3.14). The SRS words it as «after the assessment …
    within 48 hours».
  - The teacher's offer and the student's payment both fall inside it.
  - The first regular session is the first weekly occurrence of the time after the deadline, even when the student
    pays on the first day.
  - No payment by the deadline (or no offer): the enrollment is cancelled `offer_lapsed`, its weekly time is free at
    once, and the fee is kept.
  - The student's reminder shows on the programme card from the offer onward (rule 17).
- **Spec fix.** `spec.md` FR-706 said «48 hours after the offer», a drift from the SRS; it is corrected here.
- **The rare case of no offer within 48 h** is an assumption, flagged for the review session: the teacher's offer
  screen shows the deadline. It is not an owner question.

## R-506 — The offer

- **Decision.** `programme.offer` (the teacher):
  - level, readiness, expected length (texts, bounded);
  - the length, which must be `<=` the reserved weekly time's `duration_minutes`;
  - the count (bounded);
  - the total = count × the package's price for that length, read under the package's lock at the offer.
- In one transaction it writes the offer on `programmes` and the enrollment's snapshot (count, length, total), then
  moves the programme to `offered`. Count, length and total are frozen from then on.
- A later change of the package's prices reaches later offers only.

## R-507 — Months are generated one at a time; an unpaid month simply has no sessions

- **Decision.**
  - Month m holds sessions `4(m−1)+1 .. min(4m, N)`. Its amount is 4 × the session price; the last month takes the
    remainder (`packages/money`, the remainder rule of DEC-85).
  - Paying in full generates 1..N.
  - Paying a month generates that month's sessions through `GenerationPlan {count, firstSequenceNumber}`, from the
    first weekly occurrence after both the previous month's last session and the payment (with the booking lead).
- **The pause** (FR-721):
  - Since an unpaid month has no sessions, nothing is held, opened or evaluated.
  - The pause is the programme's state, set when the next weekly occurrence after the paid month's last session starts
    with the month unpaid.
  - A late payment generates the month from the next occurrence, so the sessions missed in the pause fall at the end
    by construction (FR-722), and the slot's release moves with the final session.
- **Why.** No session row to cancel or exclude from evaluation (`evaluation.repository.ts:19` reads `scheduled`,
  `disputed` only), and no special release code.

## R-508 — One sweep, `advance-programmes`, every minute

- **Decision.** A scheduled job (`defineJob`, `jobs/job.ts:16-50`, registered in `worker.ts`'s `jobs` list) does
  each step under the programme's row lock, in its own transaction, logging one line of ids and a reason per action:
  1. **lapse:** cancel `offer_lapsed` programmes past their 48 h;
  2. **due:** for each active programme whose paid month's last session has ended and whose next month is unpaid,
     mark the month due and, with a saved card, start the automatic charge (R-509);
  3. **retry:** for a soft-declined month, charge again at 1, 3, 5 and 7 days after the first failure (§3.14), at most
     4 times;
  4. **pause:** set `paused_at` when the next occurrence starts with the month unpaid.
- **Double run:** each step reads its state and writes nothing when already done (R-API-14).
- **Why.** The `advance-remedies` pattern (`jobs/advance-remedies.ts:35,100`): an every-minute sweep that catches up
  after downtime.

## R-509 — The automatic charge: a merchant-initiated charge on the saved card

- **Decision.**
  - `PaymentPort` gains `chargeSavedCard(enrollmentId, gross, currency, cardToken, payee)`. It answers a `Checkout`
    with no URL, the result arriving by the same signed webhook as every order.
  - The Paymob adapter creates an intention on the saved-card (Moto) integration with the payee split and pays it with
    the token. The fake adapter answers by its stand-in events, with a soft or hard decline on demand.
  - The `failed` event carries `declineKind: 'soft' | 'hard'`, mapped from the gateway's response code by a table.
    **An unknown code counts as hard (never retried).**
  - The live adapter stays disabled until the gateway's written answers (OPEN-11; FR-720): with no Moto integration id
    configured, no card is offered for saving and every month is manual.
- **Why.** DEC-92 (no subscription service). The webhook, its HMAC (`paymob.adapter.ts:353-362`) and `order-events`
  stay the single path.
- **Code.** The port today: `createCheckout`, `cancelCheckout`, `verifyAndParseEvent` and two recipient calls
  (`payment.port.ts:107-135`); no token support (the explorer, item 5).

## R-510 — The saved card: captured from the first card payment, kept encrypted

- **Decision.**
  - The first month's (or rest-in-full's) intention asks the gateway to save the card when the student ticked consent.
  - The adapter maps the gateway's token callback to a new `GatewayEvent` `card_saved {gatewayOrderId, token, last4,
    brand}`.
  - Payments stores it in `programme_cards`: the token encrypted with `ColumnCipher`
    (`platform/crypto/encryption.ts:167`), registered in payments' `createEncryptedColumns` so `reencrypt-columns`
    rotates it.
  - Only `last4` and the brand are shown. The token is never logged or returned.
  - The row is deleted at a close, at the programme's end, and by the account's erasure.
  - «Change card» = a manual payment of a due month with consent ticked; its `card_saved` replaces the row.
- Whether the token callback is HMAC-signed is OPEN-11. Until written, the live adapter accepts no token.

## R-511 — The rates come from the assessment's order

- **Decision.** `#createAndRecord` (`checkout.service.ts:488-558`) reads the share rate and the 25 % from settings for
  a `package` or `assessment` order, as today (`:495-505`). For `rest_in_full` and `instalment` it copies them from the
  programme's `assessment` order (ADR 0025 D6, FR-702).

## R-512 — The programme's releases

- **Decision.** `share-release.rules.ts` gains, for a programme enrollment:
  - **`assessment`** (a new milestone): the assessment order's share, due after session 0's dispute window (72 h) with
    no case open, whatever happens after, the cancelled enrollment of a lapse or a refusal included.
  - **`ijazah_half`:**
    - **Base:** 25 % × `teacherShare(offer total, rate)`, the assessment excluded (DEC-93).
    - **Cap:** the shares of the paid `rest_in_full`/`instalment` orders.
    - **Trigger:** half of sessions 1..N delivered, as today.
    - Today the base is the first paid order's share (`:246`, `shareOrdersOf`, repository `:129-156`), which for a
      programme is the assessment. That is wrong, so the change is red first.
  - **`ijazah_end`:** the shares of the paid non-assessment orders − releases − the refund share.
  - **`programme_stopped`** (a new milestone): on a close by an approved stop request, the shares of the paid months −
    releases, after the last delivered session's window, no case open (DEC-81).
- One-order ijazah packages (`package` kind) keep today's rules unchanged.

## R-513 — Stop and refusal requests

- **Decision.** `programme_requests` (booking): enrollment, teacher, kind (`stop` | `refusal`), reason (1–500), status
  (`open`, `approved`, `declined`, `withdrawn`), decided by and at.
  - A partial unique index holds one open request per enrollment and kind.
  - **`stop`:** refused before `paused_at` + 7 days (§3.14). A renewal withdraws an open one in the payment's
    transaction, with one log line.
  - **`refusal`:** allowed from the assessment's end until an offer is sent. Approval cancels the enrollment
    `assessment_refused` (the fee kept, its weekly time free).
  - The administrator's approve and decline are audited. Approving a stop closes:
    - the enrollment `cancelled`, `programme_stopped`;
    - the weekly time free at once;
    - the card row deleted;
    - R-512's release.
  - **Reopen:** the administrator returns a closed programme to `paused` (the enrollment `confirmed` again), awaiting
    a manual payment.

## R-514 — The failure's notice is today's path, by kind

- `order-events.service.ts:231-233` → `booking.recordOrderFailed` → `order_failed` → the `payment_failed` push
  (`payment-outcome-notices.port.ts:47-48`).
- For an `instalment` order the booking side **must not** cancel the enrollment. It records the event and leaves the
  programme to the sweep. Today's checkout path (`holds.service.ts:330`) is unchanged for `package` and `assessment`.

## R-515 — Settings

Six registry keys in track 2's block, seeded after `postponement_interval_weeks` (`prisma/seed.ts:185`); the count
95 → 101 (`tests/seed/seed.spec.ts:375`):

| Key | Default | Bounds | Unit | Group |
|---|---|---|---|---|
| `assessment_fee_piasters` | 0 = unset | ≥ 0 | a new unit `piasters` | `booking` |
| `assessment_duration_minutes` | 30 | list 30, 45, 60 | `minutes` | `booking` |
| `programme_pay_rest_hours` | 48 | ≥ 1 | `hours` | `booking` |
| `programme_stop_request_days` | 7 | ≥ 1 | `days` | `booking` |
| `programme_renew_early_days` | 3 | ≥ 0 | `days` | `booking` |
| `programme_charge_retry_days` | [1, 3, 5, 7] | a list of at most 4 increasing days | `days` | `booking` |

- The registry requires a default (`registry.ts:84-97`), so «no default» is 0 meaning unset. → plan question **P1**
  (the owner's figure).
- The admin catalogues gain the labels (`tests/admin-i18n/settings-labels.spec.ts`).

## R-516 — The catalogue and the editor

- Discovery shows an ijazah-track package with the fee and «lowest – highest للحصة» from its three prices.
- The editor takes three prices and shows DEC-88's average beside each, per length, over the other teachers'
  ijazah-track prices for that length (FR-704a), with `price_average_min_teachers` as today.

## R-517 — Proofs

- TDD in full (red first, named mutants) for money and time:
  - the kinds;
  - the months and their amounts;
  - the rates copied;
  - the releases;
  - the sweep's steps;
  - the retries;
  - one paid order a month;
  - the token's handling.
- DB specs on `ijazah_integrity_b` (track 2). Double-run specs for `advance-programmes`. Every new user read and
  mutation is registered in the adversarial harness, both gender directions.
