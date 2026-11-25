# Data model: the ijazah programme

One forward migration in B-P1 (`<stamp>_ijazah_programme`, stamped after `20261119124112` and after any track 1
migration merged first), with the new enum values committed first (the `20261108120000_sessions_pass:19-28`
precedent). Every timestamp is `timestamptz` and ends `_at`. Owners follow `packages/config/module-tables.json`. The
ERD gains a dated block at its end, rows from 65 and §15 rules from 70 (B-M4's reservation with B50); no version line
changes. One more in B-P2 (`<stamp>_programme_card_consent`, stamped after
`20261122111346_teacher_decision_histories`; ERD row 74, §15 rule 82; Q-4 (a), 2026-11-23).

## Changed: `packages` (catalog; R-503)

- New: `price_30_piasters`, `price_45_piasters`, `price_60_piasters` (bigint, > 0).
- `session_count`, `session_duration_minutes`, `price_piasters` become NULL-able.
- Check: a recitation package, or an ijazah-track package created while `programme_enabled` is off ⇒ the three old
  columns set and the three prices NULL. A programme package ⇒ the three prices set and the three old columns NULL.
- A new column `is_programme` boolean NOT NULL DEFAULT false tells the two ijazah kinds apart, so the check reads it.
- The migration changes no existing row. Flipping `programme_enabled` on deactivates the old ijazah-track packages
  (R-503).

## Changed: `payments` (payments; R-502, R-509)

- New: `kind` `order_kind` NOT NULL DEFAULT `package` (`package` · `assessment` · `rest_in_full` · `instalment`).
- New: `instalment_month` smallint NULL. A check: set (≥ 1) exactly when `kind = 'instalment'`.
- New: `attempt` smallint NULL (an automatic charge's attempt, 0–4) and `automatic` boolean NOT NULL DEFAULT false.
- New: `decline_kind` `decline_kind` NULL (`soft` · `hard`), set on a `failed` automatic order.
- New: `confirmed_at` timestamptz NULL: the confirm step's per-order marker (V-3).
- New (B-P2, T009): `card_consent_at` timestamptz NULL: the instant `saveCard` was ticked on a programme order;
  copied into `programme_cards.consented_at` by T013.
- `gateway_order_id` becomes NULL-able, with a check: NULL only on an `automatic` order in `created` (until the
  gateway answers), `expired` (never answered), or `failed` with `decline_kind = 'hard'` (refused before the gateway,
  `no_payee`; PR #153 r3 Major 1). The unique index keeps non-NULL values unique (analyze N-3).
- An index on (`enrollment_id`, `kind`, `instalment_month`). Not unique: a second paid order for a month is recorded
  and goes to the case (FR-718).

## Changed: `sessions` (sessions; R-507)

- New: `programme_month` smallint NULL.
  - Set at generation for a programme's offer sessions (≥ 1).
  - NULL for the assessment (session 1) and for every non-programme session.
  - A make-up or a postponed session's new row copies its original's month.
- Rule 38 (`sequence_number >= 1`) is unchanged: the assessment is session 1 (R-501).

## Changed: enums

- `cancellation_reason` + `offer_declined`, `offer_lapsed`, `assessment_refused`, `programme_stopped`. Each frees the
  weekly time at once; none is in the occupancy's closing-hold list (`slot-occupancy.repository.ts:92-96`).
- `share_release_milestone` + `assessment`, `programme_stopped`.
- `enrollment_event_kind` + `programme_offered`, `programme_paused`, `programme_resumed`, `programme_reopened`.
- `payment_event_type` + `card_saved` (R-510).

## New: `programmes` (booking; one per programme enrollment)

| Column | Type | Rule |
|---|---|---|
| `enrollment_id` | uuid PK, FK → `enrollments` | an `ijazah_track` enrollment created by an assessment |
| `state` | enum `programme_state`: `awaiting_offer` · `offered` · `active` · `paused` · `closed` | |
| `offer_due_at` | timestamptz NULL | the delivered assessment's end + `programme_offer_hours` (24); derived by booking from session 1's current outcome chain (settled `done` or `student_no_show`, or its make-up's delivery) on every read while `awaiting_offer`, the column holding the last derived value (R-505, I-2 (a); B-P2, Q-3 (a) amended, 2026-11-23); an extension adds 24 h |
| `pay_by_at` | timestamptz NULL | the spec's «pay_by»: the offer's time + `programme_pay_rest_hours` (48), set at the offer (R-505); named `_at` by ERD §0 (B-P1, Q-A1 (a), 2026-11-22) |
| `level`, `readiness`, `expected_length` | text NULL (1–500) | set at the offer |
| `offered_at` | timestamptz NULL | set once; the count (N+1), length and total frozen on the enrollment then |
| `month_count` | smallint NULL | ⌈N ÷ 4⌉, set at the offer |
| `payment_plan` | enum `programme_plan`: `in_full` · `monthly`, NULL until the first payment | |
| `months_paid` | smallint, default 0 | the highest paid month; in full = `month_count` |
| `next_due_at` | timestamptz NULL | the paid month's last session's end (`lastToEnd`) |
| `first_failure_at`, `retries_done` | timestamptz NULL, smallint 0–4 | the current month's automatic attempts (R-508) |
| `paused_at` | timestamptz NULL | set by the sweep; cleared by a payment; the reopen time on a reopen |
| `closed_at` | timestamptz NULL | set by the close hook (R-510) |
| `created_at`, `updated_at` | | |

Checks:
- state ∈ {`offered`, `active`, `paused`} ⇒ `offered_at` set;
- `paused_at` set ⇔ state = `paused`;
- `closed_at` set ⇔ state = `closed`;
- `months_paid` ≤ `month_count`.

An index on (`state`, `next_due_at`) for the sweep.

## New: `programme_requests` (booking; R-513)

| Column | Type | Rule |
|---|---|---|
| `id` | uuid v7 | |
| `enrollment_id`, `teacher_user_id` | uuid FKs | from the enrollment, never the input |
| `kind` | enum `programme_request_kind`: `stop` · `refusal` · `no_offer` (I-2 (a)) · `pay_blocked` (FR-706b) · `charge_unknown` (SRS DEC-113, B-P3) | `no_offer`, `pay_blocked` and `charge_unknown` are raised by the sweep, not by the teacher; `refusal` unused since SRS DEC-112 (below) |
| `reason` | text (1–500) | mandatory for `stop` and `refusal`; on a `no_offer` item, the administrator's record of why no offer was made, written at the decision (SRS DEC-112, below) |
| `status` | enum `programme_request_status`: `open` · `approved` · `declined` · `withdrawn` · `extended` (a `no_offer` or `pay_blocked` item only) | |
| `decided_by_admin_id`, `decided_at` | | set together on approve or decline (a check) |
| `created_at`, `updated_at` | | |

A partial unique index on (`enrollment_id`, `kind`) WHERE `status = 'open'`; one on (`status`, `created_at`) for the
queue.

> *(2026-11-23, SRS DEC-112, the owner: «لا متخليش في زر رفض الطلب في التصميم / لازم بقى يخش يكلم الدعم من الاعدادات
> ومش هنوضحله ده»; «بس خلي جنب مفيش عرض السبب اللي العرض متعملش بسببه او اللي المعلم بعته يعني».)*
> - The `refusal` value is unused: `programme.request` takes `stop` only, and the refusal is an approved `no_offer`
>   item. It stays in `programme_request_kind`, with no enum migration (dropping a Postgres enum value means
>   recreating the type); no row of it is ever written.
> - The `no_offer` item's reason uses the existing `reason` column: nullable (`prisma/schema/booking.prisma:214`), and
>   rule 80's check (`20261122110318_ijazah_programme/migration.sql:258-260`) requires it only on `stop` and `refusal`
>   and bounds it to 1–500 when given, so writing it at a `no_offer` decision passes; no migration. «Mandatory when
>   deciding a `no_offer` item» is `programmes.decide`'s rule in the service, red first, not a database check (ERD §15
>   rule 80 as amended, changelog row 75).

## New: `programme_cards` (payments; R-510)

| Column | Type | Rule |
|---|---|---|
| `enrollment_id` | uuid PK, FK → `enrollments` | one card per programme |
| `token_encrypted` | bytea | `ColumnCipher`, column `programme_cards.token_encrypted`, the row id bound (R-DB-8) |
| `last4`, `brand` | text | shown to the student only |
| `consented_at` | timestamptz | the student's consent at the payment that saved it |
| `created_at`, `updated_at` | | |

The row is deleted by the close hook, at the programme's end, by the account's erasure, when the student turns the
automatic renewal off (DEC-95), and at a teacher's suspension, ban or departure (DEC-94).

## Settings (R-515)

Ten keys: the first eight with seed 95 → 103 (`programme_offer_hours` 24 among them); *(2026-11-24, B-P3, SRS
DEC-113: + `programme_charge_inquiry_tries`, 108 → 109; 2026-11-25, B-P4, SRS DEC-114: + `programme_pay_reminder_hours`,
109 → 110)*:
- `programme_enabled` (off);
- `assessment_price_piasters` (0) *(2026-11-22, B-P1 Q-B4 (a): named `_price_` because R-MONEY-6's lint refuses «fee» with an amount outside payments)*;
- `assessment_duration_minutes` (30);
- `programme_offer_hours` (24);
- `programme_pay_rest_hours` (48, from the offer);
- `programme_stop_request_days` (7);
- `programme_pay_reminder_hours` (12, 1 to 47; the student's reminder line before `payBy`, FR-708) *(2026-11-25, B-P4, SRS DEC-114)*;
- `programme_renew_early_days` (3);
- `programme_charge_retry_days` ([1,3,5,7]);
- `programme_charge_inquiry_tries` (6; unanswered asks about an automatic charge before the `charge_unknown` item) *(2026-11-24, B-P3, SRS DEC-113; listed 2026-11-25, B-P4)*.

A new registry unit `piasters`.

## State transitions (`programmes.state`)

- `awaiting_offer` →
  - `offered` (the offer, after the assessment's delivery);
  - closed by `assessment_refused` (an approved refusal), `offer_declined` (the student cancels), or an approved
    `no_offer` item;
  - closed by any of today's closings.
- `offered` →
  - `active` (the rest in full or month 1 paid by `pay_by_at`);
  - closed by `offer_declined`, `offer_lapsed` (`pay_by_at` passed unpaid; with a `pay_blocked` item open, only by its
    approval, FR-706b) or today's closings; a close withdraws an open item.
- `active` →
  - `paused` (the next month unpaid at its first occurrence);
  - `closed` (fully paid and completed through the completion gate, or today's closings).
- `paused` →
  - `active` (a month paid; an open stop request withdrawn);
  - `closed` (an approved stop, `programme_stopped`, or today's closings).
- `closed` → `paused` (an administrator's reopen of a `programme_stopped` programme).

Every close passes the close hook (R-510).
