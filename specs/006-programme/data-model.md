# Data model: the ijazah programme

One forward migration in B-P1 (`<stamp>_ijazah_programme`, stamped after `20261119124112`), the new enum values
committed first (the `20261108120000_sessions_pass:19-28` precedent). Every timestamp is `timestamptz` and ends `_at`.
Owners follow `packages/config/module-tables.json`. The ERD gains a dated block at its end: rows from 65 and §15
rules from 70 (B-M4's reservation with B50). No version line changes.

## Changed: `packages` (catalog; R-503)

- New: `price_30_piasters`, `price_45_piasters`, `price_60_piasters` (bigint, > 0).
- `session_count`, `session_duration_minutes`, `price_piasters` become NULL-able.
- Check: `track = 'recitation'` ⇒ the three old columns set and the three prices NULL; `track = 'ijazah_track'` ⇒ the
  three prices set and the three old columns NULL.
- The migration first deactivates every existing `ijazah_track` package (P2 (a)).

## Changed: `payments` (payments; R-502)

- New: `kind` `order_kind` NOT NULL DEFAULT `package` (`package` · `assessment` · `rest_in_full` · `instalment`).
- New: `instalment_month` smallint NULL; a check that it is set (≥ 1) exactly when `kind = 'instalment'`.
- New: `decline_kind` `decline_kind` NULL (`soft` · `hard`), set on a `failed` automatic charge.
- An index on (`enrollment_id`, `kind`, `instalment_month`). Not unique: a second paid order for a month is recorded
  and goes to the case (FR-718).

## Changed: enums

- `cancellation_reason` + `offer_lapsed`, `assessment_refused`, `programme_stopped` (each frees the weekly time at once;
  not in the occupancy's closing-hold list, `slot-occupancy.repository.ts:92-96`).
- `share_release_milestone` + `assessment`, `programme_stopped`.
- `enrollment_event_kind` + `programme_offered`, `programme_paused`, `programme_resumed`, `programme_reopened`.

## New: `programmes` (booking; one per programme enrollment)

| Column | Type | Rule |
|---|---|---|
| `enrollment_id` | uuid PK, FK → `enrollments` | an `ijazah_track` enrollment created by an assessment |
| `state` | enum `programme_state`: `awaiting_offer` · `offered` · `active` · `paused` · `closed` | |
| `pay_by` | timestamptz | session 0's scheduled end + `programme_pay_rest_hours` (R-505) |
| `level`, `readiness`, `expected_length` | text NULL (1–500) | set at the offer |
| `offered_at` | timestamptz NULL | set once; the count, length and total frozen on the enrollment then |
| `payment_plan` | enum `programme_plan`: `in_full` · `monthly`, NULL until the first payment | |
| `months_paid` | smallint, default 0 | the highest paid month; in full = the month count |
| `next_due_at` | timestamptz NULL | when the next month falls due (the paid month's last session's end) |
| `first_failure_at`, `retries_done` | timestamptz NULL, smallint 0–4 | the current month's charge attempts (R-508) |
| `paused_at` | timestamptz NULL | set by the sweep; cleared by a payment |
| `closed_at` | timestamptz NULL | |
| `created_at`, `updated_at` | | |

Checks: state ∈ {`offered`, `active`, `paused`} ⇒ `offered_at` set; `paused_at` set ⇔ state = `paused`;
`closed_at` set ⇔ state = `closed`. An index on (`state`,
`next_due_at`) for the sweep.

## New: `programme_requests` (booking; R-513)

| Column | Type | Rule |
|---|---|---|
| `id` | uuid v7 | |
| `enrollment_id`, `teacher_user_id` | uuid FKs | from the enrollment, never the input |
| `kind` | enum `programme_request_kind`: `stop` · `refusal` | |
| `reason` | text (1–500) | mandatory |
| `status` | enum `programme_request_status`: `open` · `approved` · `declined` · `withdrawn` | |
| `decided_by_admin_id`, `decided_at` | | set together on approve or decline (a check) |
| `created_at`, `updated_at` | | |

A partial unique index on (`enrollment_id`, `kind`) WHERE `status = 'open'`; one on (`status`, `created_at`) for the
queue.

## New: `programme_cards` (payments; R-510)

| Column | Type | Rule |
|---|---|---|
| `enrollment_id` | uuid PK, FK → `enrollments` | one card per programme |
| `token_encrypted` | bytea | `ColumnCipher`, column `programme_cards.token_encrypted`, the row id bound |
| `last4`, `brand` | text | shown on «change card»; nothing else of the card is kept |
| `consented_at` | timestamptz | the student's consent at the payment that saved it |
| `created_at`, `updated_at` | | |

Deleted at a close, at the programme's end, and by the account's erasure (payments' erasure entry). Registered in
payments' `createEncryptedColumns` (`modules/payments/index.ts:113`).

## Settings (R-515)

Six keys, seed 95 → 101: `assessment_fee_piasters` (0), `assessment_duration_minutes` (30),
`programme_pay_rest_hours` (48), `programme_stop_request_days` (7), `programme_renew_early_days` (3),
`programme_charge_retry_days` ([1,3,5,7]). A new registry unit `piasters`.

## State transitions (`programmes.state`)

- `awaiting_offer` →
  - `offered` (the offer);
  - closed by `offer_lapsed` (48 h passed) or `assessment_refused` (an approved refusal).
- `offered` →
  - `active` (the rest in full or month 1 paid);
  - closed by `offer_lapsed` (48 h passed unpaid).
- `active` →
  - `paused` (the next month unpaid at its first occurrence);
  - `closed` (all sessions paid and the enrollment completed, or any of today's closings).
- `paused` →
  - `active` (a month paid; an open stop request withdrawn);
  - `closed` (an approved stop, `programme_stopped`).
- `closed` → `paused` (an administrator's reopen, awaiting a manual payment).
