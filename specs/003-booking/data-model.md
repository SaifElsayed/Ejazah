# Data model: Phase 2 — Catalog, discovery, booking

**Date**: 2026-10-31 · **Spec**: [spec.md](./spec.md) · **Research**: [research.md](./research.md)

Phase 0 modelled every table this phase writes (ERD v1.3 and its addenda through v1.10); Phase 1 wrote none of them
except `subjects` (seeded), `teacher_subjects` (granted by approval) and the recipient events of `payment_events`.
This phase writes them for the first time. The pass below is what it adds: one table, four columns, one function,
no index, the column checks T140 carries, and five settings rows. The ERD is amended in the same batch as each
migration (ERD changelog v1.10 → v1.11), as Phase 1 did.

## 1. Who writes what

| Table | Owner (R-API-6) | Written in this phase by |
|---|---|---|
| `teacher_profiles` (`bio`, `qualification_summary`) · `users` (`photo_key`, `display_name`) | identity | `teacher.profile.update`, `account.updateProfile` (T158) |
| `packages` | catalog | `teacher.packages.create/update` |
| `availability_slots` | catalog | `teacher.slots.create/update` |
| `slot_holds` | booking | `checkout.hold`, `checkout.pay` (link), the confirm job, the sweeps, the termination subscriber (R-219) |
| `enrollments` | booking | `checkout.pay` (create), the confirm job (confirm), every release without conversion (cancel) |
| `enrollment_events` (new) | booking | every transaction that confirms, fails an order, or cancels (R-216); `payments` appends `order_failed` through booking's entry `recordOrderFailed` |
| `sessions` | sessions | `generateForEnrollment` in the confirm job; the re-resolution job (R-210) |
| `payments` | payments | `checkout.pay`, `checkout.retry`, the order-event handler, the sweeps, a new checkout's cancellation |
| `payment_events` | payments | the webhook (order events, as recipient events since Phase 1) |
| `disputes` (`kind = compensation_case`) | moderation | `openCompensationCase` in the confirm job's refusal branch |

## 2. Changes

### 2.1 Column checks (T140, Phase 2's first batch)

T140's migration, amended by the owner's decisions of 2026-10-31 (R-222):

| Table | Check | Source |
|---|---|---|
| `packages` | `session_count >= 1` | ERD ("> 0"), FR-311 |
| `packages` | `price_piasters > 0` | FR-311, FR-PROFILE-2 as amended (T140 said `>= 0`) |
| `packages` | `session_duration_minutes IN (30, 45, 60)` | FR-PROFILE-2 as amended 2026-10-31 |
| `availability_slots` | `day_of_week BETWEEN 0 AND 6` | ERD, T140 |
| `availability_slots` | `duration_minutes IN (30, 45, 60)` | FR-PROFILE-4 as amended 2026-10-31 |
| `sessions` | `sequence_number >= 1` | ERD, T140 |

T140's other items (`isnad_entries.position >= 1`, the audit label, the `previous_refresh_token_hash` index) are its own.

### 2.2 The folded name (R-203)

No column (PR #109's review, M5; the owner's decision of 2026-11-01): a stored fold is a derived value R-DB-4 does not list. The fold
runs inside one kernel query, `idsWithFoldedNamePrefix(tx, candidateIds, typed)` in
`apps/api/src/platform/db/folded-name.ts`: `ijazah_fold(display_name) LIKE ijazah_fold($typed) || '%' ESCAPE '\'`,
the one function on both sides, the typed text's `%`, `_` and `\` escaped by `like-literal.ts` before the LIKE; a spec
that a typed `%` or `_` matches only itself. Read by discovery's name search and «طلابي»'s student search.

`ijazah_fold(text) RETURNS text IMMUTABLE PARALLEL SAFE`: `lower`, then `translate` of `أإآ` → `ا`, `ىئ` → `ي`,
`ؤ` → `و`, `ة` → `ه`, then `regexp_replace` removing U+064B–U+065F, U+0670 and U+0640. Declared in the migration (raw
SQL in a migration is allowed, R-DB-1); the application's queries call it through the kernel's raw-SQL helpers only.

No index (analysis C1, R-DB-9): an index beyond ERD §14 needs a measured slow query first. At the launch cohort's size
the prefix match reads the visible set, already one indexed read (R-201). T057 measures SC-310 on the phone; a slow
search found there becomes a follow-up with its measured query, and only then the index.

### 2.3 `enrollments` — what the student was shown (R-209)

| Column | Type | Notes |
|---|---|---|
| `quoted_first_session_local_date` | date | The first session's local date the checkout showed, computed at Pay by FR-368's rule; compared with session 1 to say the first session moved (FR-386). NOT NULL (no row exists yet) |

### 2.4 `payments` — the order's expiry and its hosted page

| Column | Type | Notes |
|---|---|---|
| `expires_at` | timestamptz | The order's expiry as created: no later than the hold's expiry minus the grace (FR-355). Read by Retry (can an order still be created) and by FR-BOOK-12's "still payable" |
| `checkout_url_encrypted` | bytea, nullable | The hosted checkout's address, encrypted (R-DB-8: it may carry a payment token), kept so that FR-BOOK-12 (c) can offer "continue the previous payment"; set to NULL when the order leaves `created`. Joins `reencrypt-columns`' list. Read back only by `checkout.continue`, only for the student who owns the order's enrollment, and only while the order is `created` and `expires_at` is in the future; never written to a log (the owner's decision of 2026-11-01, §2.4.1) |

#### 2.4.1 Who reads the address back

The owner's decision of 2026-11-01. `checkout.pay` and `checkout.retry` return the address the gateway gave to the
student who asked for it, in the same call. Afterwards only `checkout.continue` decrypts it, and only when all three
hold: the enrollment is the caller's (another student's id answers `NOT_FOUND`, as R-202's no-existence rule says), the
order is `created`, and its `expires_at` is after now. Otherwise it answers `ORDER_NOT_PAYABLE` and decrypts nothing.
The address is never logged: `apps/api/src/platform/logging/logger.ts`'s redaction list gains `url`, `uri` and `link`
with `checkout` (`checkoutUrl` is not covered today), error reports go through the same list, and a spec logs a response
and an error carrying it and finds it redacted. Specs cover the other student, a `paid`, `failed` and `expired` order,
and a `created` order past `expires_at`.

### 2.5 `enrollment_events` — new, owned by `booking` (R-216)

Append-only record of each outcome a later notification needs (FR-385).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `enrollment_id` | FK → enrollments | Plain index (FR-035 of Phase 0) |
| `kind` | enum `enrollment_event_kind`: `confirmed` · `order_failed` · `cancelled` | |
| `cancellation_reason` | enum `cancellation_reason`, nullable | Set exactly when `kind = 'cancelled'` (check constraint) |
| `payment_id` | FK → payments, nullable | Set for `order_failed`, the order that failed; payments' id is a reference, not a read of the row (booking never reads `payments`, R-API-6) |
| `occurred_at` | timestamptz | The transaction's instant |

Rules: `CHECK ((kind = 'cancelled') = (cancellation_reason IS NOT NULL))`; `CHECK ((kind = 'order_failed') = (payment_id IS NOT NULL))`;
UPDATE, DELETE and TRUNCATE revoked from the application role (ERD §15 rule 21's pattern). `packages/config/module-tables.json`
gives it to `booking`.

### 2.6 Nothing else

`slot_holds`, `sessions`, `payment_events` and `disputes` are written as the ERD defines them. The exclusion constraints
and the two partial unique indexes on `slot_holds` exist since Phase 0 (migrations `20261007000200`, `20261007000400`).
No `booked` flag on a slot, no stored "sessions remaining" (R-DB-4): occupancy and counts are derived (R-205).

## 3. State machines

### Enrollment (`enrollments.status`)

| From | To | By | Writes |
|---|---|---|---|
| — | `pending_payment` | `checkout.pay` | the snapshot, `quoted_first_session_local_date`, `purchased_at`; the hold's `enrollment_id` |
| `pending_payment` | `confirmed` | `confirm-enrollment` only (R-HONEST-1) | `confirmed_at`; the hold converted; sessions; an event `confirmed` |
| `cancelled` | `confirmed` | `confirm-enrollment`, late branch (FR-PAYG-19) | the same, after a new hold |
| `pending_payment` | `cancelled` | hold expiry (`payment_failed` / `payment_expired`), new checkout (`checkout_abandoned`), refusal (`slot_unavailable`), termination (R-219) | `cancellation_reason`; the hold released in the same transaction; an event `cancelled` |
| `cancelled` (late, refused) | stays `cancelled` | refusal branch | reason `slot_unavailable`; one compensation case; an event `cancelled` |
| `cancelled` by a termination (R-219) | stays `cancelled` | `confirm-enrollment` on a late paid event (FR-362) | its reason kept; one compensation case |
| `confirmed` | stays `confirmed` | `confirm-enrollment` on a second paid order (FR-375) | one compensation case |

`completed` and `terminated_no_show` are Phase 3's.

### Gateway order (`payments.status`)

`created → paid | failed | expired`; `paid → refunded` (Phase 3's compensation, learned from the gateway). Monotonic: an
event that would move a `paid` order elsewhere than `refunded` is recorded in `payment_events` and changes nothing
(FR-373). A Retry is a new row. Nothing stops a second order of one enrollment from reaching `paid` (the student paid twice): the
webhook records it, and the confirm job opens a compensation case on the enrollment and leaves it as it is (FR-375,
the owner's decision of 2026-11-01).

### Slot hold

Active (`released_at IS NULL`) → released, by: conversion (enrollment confirmed), expiry (the sweeps, or before a new
hold on the slot or by the student), the student's new checkout, the refusal branch, a termination. A failed order does
not release it.

## 4. Settings rows (seeded by `prisma/seed.ts`; SRS §3.14 gains them in the document pass)

| Key | Default | Governs |
|---|---|---|
| `first_session_lead_hours` | 24 | FR-368, FR-386 |
| `checkout_processing_poll_seconds` | 2 | FR-383 |
| `checkout_confirming_poll_seconds` | 30 | FR-383 |
| `checkout_confirming_poll_window_minutes` | 10 | FR-383, FR-384 |
| `discovery_page_size` | 20 | FR-332 to FR-335 |

Existing keys this phase reads: `slot_hold_ttl_minutes` (also the order's TTL, FR-PAYG-6), `slot_hold_grace_minutes`,
`checkout_confirmation_timeout_seconds`, `slot_release_buffer_weeks`, `rate_limit_search`,
`rate_limit_payment_initiation`, `idempotency_key_ttl_hours`, `admin_list_page_size`.

## 5. Integrity rules the database enforces (ERD §15, new numbers)

36. `packages`: `session_count >= 1`, `price_piasters > 0`, `session_duration_minutes IN (30, 45, 60)` (T140, as amended).
37. `availability_slots`: `day_of_week BETWEEN 0 AND 6`, `duration_minutes IN (30, 45, 60)` (T140, as amended).
38. `sessions.sequence_number >= 1` (T140).
39. `enrollment_events`: the two kind checks of §2.5, and no UPDATE, DELETE or TRUNCATE for the application role.

What the database cannot express stays with the service and a probe: a package's subject is one of the teacher's
`teacher_subjects` (FR-311); a teacher's slots do not overlap on the week (R-206, under the advisory lock, the session
exclusion constraints as second line); a slot in use keeps its day, time and length (R-207).

## 6. Migrations

1. **T140's checks** (first batch): §2.1, with probes in `tests/db-integrity`.
2. **The Phase 2 pass**: `ijazah_fold` (no column, no index, §2.2); `enrollments.quoted_first_session_local_date`;
   `payments.expires_at` and `checkout_url_encrypted`; `enrollment_event_kind` and `enrollment_events` with its rule;
   the five settings rows in the seed. Probes for rule 39 and for the fold's equivalences (SC-314's data).

Both are forward-only and additive (R-DB-1, R-API-9).
