# Data model: Phase 3 — Live sessions

**Date**: 2026-11-05 · **Spec**: [spec.md](./spec.md) · **Research**: [research.md](./research.md)

Phase 0 modelled every table this phase writes (ERD v1.3 and its addenda through v1.14). Phase 1 added
`sessions.makeup_for_session_id` and `session_remedies` as columns only; Phase 2 wrote `sessions` (generation and
re-resolution), `disputes` (compensation cases) and `enrollment_events`. This phase writes `sessions`' whole machine,
`session_participant_events`, `cancellation_requests`, `session_remedies`, session disputes and `chat_messages` for the
first time. The pass below is what it adds: two tables, ten columns, one nullability change, three enum values, eight
integrity rules and five settings rows, in one forward migration in the first batch. The ERD is amended in the same batch (changelog
v1.14 → v1.15, 44 tables), as each earlier phase did. Nothing here carries an amount (FR-497, ADR 0007).

## 1. Who writes what

| Table | Owner (R-API-6) | Written in this phase by |
|---|---|---|
| `sessions` | sessions | the evaluation sweep (outcome, simultaneous seconds, `evaluated_at`); a review, dispute or outage resolution (`settled_by_admin_id`, `admin_settled_at`); a cancellation (accepted request, admin, termination, an account's end); a dispute's raising (`disputed`, `outcome_under_dispute`); a make-up's booking (insert); the join (`provider_room_id`) |
| `session_participant_events` | sessions | the video webhook only (R-SESS-1) |
| `cancellation_requests` | sessions | `sessions.cancellation.request/answer`; the expiry sweep |
| `session_remedies` | sessions | the `advance-remedies` sweep (offer, windows ending); `sessions.remedy.*`; a termination or an account's end (handed to a case) |
| `session_events` (new) | sessions | every transaction that produces an event FR-495 names (R-315) |
| `provider_outages` (new) | sessions | `sessions.outages.record` (admin) |
| `disputes` | moderation | `openCompensationCase` (the new reasons, R-312); `openSessionDispute`; `closeCase`, `resolveSessionDispute` (the admin's resolutions, FR-422) |
| `enrollments` | booking | `EnrollmentSide.terminateNoShow` and `.complete` (bound to booking, R-301); the termination subscriber (`account_deleted`, `teacher_suspended`, `admin`) |
| `enrollment_events` | booking | the same transactions (`completed`, `terminated_no_show`, `cancelled`) |
| `chat_messages` | chat | `chat.send`, `POST /uploads/chat`, the purge job |
| `audit_logs` | admin | every administrator action and read of this phase (FR-480) |
| `users` | identity | `StandingService.suspendStudent/banStudent/reinstateStudent` (R-313) |

## 2. Changes

### 2.1 `sessions`

| Column | Type | Notes |
|---|---|---|
| `outcome_under_dispute` | `session_status`, nullable | The outcome frozen while `status = 'disputed'` (FR-DISPUTE-4): copied when the dispute is raised, or written by the evaluation when the dispute came before it; cleared by the resolution, which writes the final `status` (R-308). Check (rule 40): NULL unless `status = 'disputed'`, and when set one of `done`, `student_no_show`, `teacher_no_show`, `both_no_show`, `under_threshold`, `provider_outage` |
| `admin_settled_at` | timestamptz, nullable | When an administrator settled it (a review, dispute or outage resolution), beside the existing `settled_by_admin_id` (FR-450). Check (rule 40): both NULL or both set |

Existing columns this phase writes for the first time: `status` (the whole machine, §3), `simultaneous_connected_seconds`
(written once by the evaluation, the figure its outcome was decided on, R-305; **owner decision 3** on R-DB-4),
`evaluated_at` (the evaluation's instant), `settled_by_admin_id`, `provider_room_id` (the session's id: the room is
named for it), `makeup_for_session_id` (a make-up's original, FR-469).

### 2.2 `session_participant_events`

| Change | Notes |
|---|---|
| `event_type` gains `room_ended` | The provider's room-ended event, which closes every connection still open (FR-443, R-304) |
| `user_id` becomes nullable | NULL exactly for `room_ended`: check (rule 41) `(event_type = 'room_ended') = (user_id IS NULL)` |
| `connection_ref` text, nullable | The provider's id of one connection (LiveKit's participant `sid`), so a reconnection or a replaced identity is its own interval (R-304). Check (rule 41): `(event_type = 'room_ended') = (connection_ref IS NULL)` |

The table stays append-only (ERD §15 rule 21, `ON UPDATE RESTRICT`); `provider_event_id` is already unique and NOT NULL
(`prisma/schema/sessions.prisma`). A migration that alters a column of a revoked table runs as the owner role, as
Phase 1's did.

### 2.3 `session_remedies`

The table holds no row (Phase 1 created it; nothing has written it), so the NOT NULL columns cost nothing.

| Column | Type | Notes |
|---|---|---|
| `offered_at` | timestamptz, NOT NULL | The moment the outcome became final and the remedy was offered (FR-462); the row is inserted then (R-311) |
| `choice_closes_at` | timestamptz, NOT NULL | `offered_at` + `makeup_choice_window_days`, fixed at the offer so a later change of the setting is prospective (§3.14) |
| `counter_slot_id` | FK → `availability_slots`, nullable | The teacher's active slot the student counter-proposed (FR-465). A reference only: sessions reads the slot through catalog's entry |
| `counter_start_time_local` | time, nullable | The counter-proposal's time of day, the slot's `start_time_local` when proposed (the ERD's "Phase 3's pass to add") |
| `counter_timezone` | text (IANA), nullable | The zone of `counter_date` and `counter_start_time_local`: the slot's own zone, which may differ from the enrollment's (T077); R-TIME-3's gate asks a zone beside a `_local` column |
| `counter_proposed_at` | timestamptz, nullable | When the student counter-proposed |
| `counter_answer_closes_at` | timestamptz, nullable | `counter_proposed_at` + `makeup_counter_answer_hours`, fixed then (FR-465) |

Existing columns: `kind` (`makeup`, or `refund` once a refund is chosen or a counter goes unanswered), `status` (§3),
`proposed_date` (the system's proposal, a date in the enrollment's snapshot zone at the enrollment's slot's local start),
`counter_date`, `decided_at` (booked, or handed to a case), `case_id`. Checks (rule 42): the five `counter_*` columns
all NULL or all set, and set whenever `status = 'counter_proposed'`; `(status = 'refund_case') = (case_id IS NOT NULL)`;
`choice_closes_at > offered_at`. `status = 'refund_case'` means "handed to a compensation case": a refund choice, an
unanswered counter, a termination, or an account's end (R-309, R-313); `kind` says which.

### 2.4 `session_events` — new, owned by `sessions` (R-315)

Append-only record of each event a later notification needs (FR-495).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `enrollment_id` | FK → enrollments | Plain index (FR-035 of Phase 0) |
| `session_id` | FK → sessions, nullable | NULL for none of today's kinds but kept nullable for an enrollment-wide one; plain index |
| `kind` | enum `session_event_kind` | `settled` · `cancellation_requested` · `cancellation_accepted` · `cancellation_declined` · `cancellation_expired` · `cancelled_by_admin` · `remedy_offered` · `counter_proposed` · `counter_accepted` · `counter_declined` · `makeup_booked` · `remedy_handed_to_case` · `dispute_raised` · `dispute_resolved` · `review_resolved` · `outage_reclassified` |
| `occurred_at` | timestamptz | The transaction's instant |
| `created_at` | timestamptz | |

The details (who requested, which outcome) are read from the rows the event names, so the row holds no personal field
and references no account (T005 rule 2's last clause holds for every termination path that writes one). Rule 43:
UPDATE, DELETE and TRUNCATE revoked from the application role, foreign keys `ON UPDATE RESTRICT` (rule 21's pattern).
`packages/config/module-tables.json` gives it to `sessions`.

### 2.5 `provider_outages` — new, owned by `sessions` (R-307)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `starts_at` / `ends_at` | timestamptz | Resolved on the server from the administrator's local date, time and zone (R-TIME-6) |
| `reason` | text | Mandatory, bounded in the contract |
| `recorded_by_admin_id` | FK → admin_users | Plain index |
| `created_at` | timestamptz | |

Rule 44: `ends_at > starts_at`; UPDATE, DELETE and TRUNCATE revoked (a window is evidence; a wrong one is answered by
resolving its sessions).

### 2.6 `cancellation_requests`

No column. Rule 45: one pending request per session, a partial unique index `cancellation_requests_one_pending_key`
on `(session_id) WHERE status = 'pending'` (FR-456); `(status IN ('accepted', 'declined')) = (responded_at IS NOT NULL)`;
`length(btrim(reason)) > 0`.

### 2.7 `disputes`

No column. `reason` keeps the closed list of `COMPENSATION_REASONS` for a compensation case (eight new values, R-312)
and the participant's text for a session dispute. Rule 46: one open session dispute per session, a partial unique
index `disputes_one_open_per_session_key` on `(session_id) WHERE kind = 'session_dispute' AND status = 'open'`
(FR-473); `(kind = 'session_dispute') = (session_id IS NOT NULL)`; `(status = 'open') = (resolved_at IS NULL)`;
`status = 'open' OR (resolution_notes IS NOT NULL AND resolved_by_admin_id IS NOT NULL)`. Every existing row is an open
compensation case with no session, which the checks admit (to be counted on `ijazah` before the migration, as B26's
were).

### 2.8 `enrollment_events`

`enrollment_event_kind` gains `completed` and `terminated_no_show`. Rule 39's checks are unchanged (neither carries a
reason or a payment).

### 2.9 `chat_messages`

No column. Rule 47: `attachment_mime IS NULL OR attachment_mime IN ('application/pdf', 'text/plain')`; the attachment's
three columns all NULL or all set unless `purged_at` is set (beside rule 8).

### 2.10 Nothing else

No amount, share, commission, balance, ledger or escrow column or table (FR-497, R-MONEY-6; T104 and T105 are out of
scope). No stored count of no-shows, remaining or completed sessions, or cancellation requests (R-DB-4): each is
derived. No new index beyond the two partial uniques of rules 45 and 46, which are integrity rules, and the FK indexes
of the two new tables (R-DB-9).

## 3. State machines

### Session (`sessions.status`)

| From | To | By | Writes |
|---|---|---|---|
| `scheduled` | `done` · `student_no_show` · `teacher_no_show` · `both_no_show` · `under_threshold` · `provider_outage` | `evaluate-sessions` only, after end + delay (R-SESS-2, R-SESS-3) | `simultaneous_connected_seconds`, `evaluated_at`; `session_events(settled)`; threshold and completion checks |
| `scheduled` | `cancelled_by_agreement` | an accepted request, before the start | the request `accepted`; events |
| `scheduled` | `cancelled_by_admin` | an admin's cancellation (FR-460), a threshold termination (FR-448), an account's end (FR-483, FR-484, FR-486) | events; a case per R-312 |
| `scheduled` (past its end, unevaluated) · `done` · `*_no_show` | `disputed` | a participant's dispute, inside the window | `outcome_under_dispute`; the dispute; events |
| `disputed` | `done` · `student_no_show` · `teacher_no_show` · `both_no_show` | the administrator's resolution (R-308) | `settled_by_admin_id`, `admin_settled_at`; the dispute closed; events |
| `under_threshold` · `provider_outage` | `done` · `student_no_show` · `teacher_no_show` · `both_no_show` | the review resolution only (R-SESS-6) | the same |
| `done` · `*_no_show` · `under_threshold` (inside the dispute window, not disputed) | `provider_outage` | an outage window recorded over it (FR-445) | events |

No automatic transition leaves `under_threshold`, `provider_outage` or `disputed` (R-SESS-6, FR-474). A `scheduled`
session is never moved to another time (FR-461); a make-up is a new row.

### Remedy (`session_remedies.status`)

| From | To | By |
|---|---|---|
| — | `awaiting_choice` (recitation, Teacher-No-Show) · `proposed` | `advance-remedies`, when the outcome is final (FR-462) |
| `awaiting_choice` | `proposed` · `refund_case` (kind `refund`) | the student's choice |
| `awaiting_choice` · `proposed` | `booked` | the student's acceptance, or `choice_closes_at` passing (FR-466) |
| `awaiting_choice` · `proposed` | `counter_proposed` | the student's counter-proposal, before `choice_closes_at` |
| `counter_proposed` | `booked` (the counter) · `booked` (the proposal, **owner decision 9**) | the teacher's acceptance or decline |
| `counter_proposed` | `refund_case` (kind `refund`) | `counter_answer_closes_at` passing (FR-465) |
| any open | `refund_case` | a threshold termination or an account's end |

### Cancellation request

`pending → accepted | declined` by the counterparty before the start; `pending → expired` at the start (read so at once,
written by the sweep).

### Enrollment (`enrollments.status`), this phase's moves

| From | To | By |
|---|---|---|
| `confirmed` | `terminated_no_show` | the threshold (FR-448) |
| `confirmed` | `completed` | FR-449, after the last dispute window (**owner decision 4**) |
| `confirmed` | `cancelled` (`account_deleted` · `teacher_suspended` · `admin`) | an account's end (R-313) |

### Dispute and case (`disputes.status`)

`open → resolved | dismissed`, by an administrator, the enrollment's row locked first and `resolved_at =
clock_timestamp()` in the same update (FR-422).

## 4. Settings rows (seeded by `prisma/seed.ts`; SRS §3.14 gains them in the document pass)

| Key | Default | Governs |
|---|---|---|
| `session_evaluation_delay_minutes` | 2 | FR-441 (the spec's new row) |
| `rate_limit_chat_message` | `{ limit: 30, window_seconds: 60 }` (proposed; **owner decision 8**) | FR-491 (the spec's new row) |
| `makeup_counter_answer_hours` | 72 | FR-465 (SRS §3.14, 2026-11-05) |
| `chat_page_size` | 50 (proposed; **owner decision 8**) | FR-488's list |
| `cancellation_requests_recent_days` | 30 (proposed; **owner decision 8**) | FR-459's "recent period" |

Existing keys this phase reads: `early_join_lead_minutes`, `join_window_minutes`, `minimum_connection_seconds`,
`attendance_threshold_pct`, `teacher_no_show_threshold`, `dispute_window_hours`, `makeup_choice_window_days`,
`slot_release_buffer_weeks`, `chat_retention_days`, `upload_max_bytes`, `rate_limit_upload`,
`document_link_ttl_seconds`, `admin_list_page_size`.

## 5. Integrity rules and the lock order

New ERD §15 rules: 40 (`sessions`' two checks), 41 (`session_participant_events`' two checks), 42
(`session_remedies`' checks), 43 (`session_events` append-only), 44 (`provider_outages`' check and revokes), 45
(`cancellation_requests`), 46 (`disputes`), 47 (`chat_messages`' attachment checks).

T005's lock order, widened (`platform/db/row-lock.ts`, contracts/kernel.md): `users` → `teacher_profiles` →
`lockKey('teacher-slots', …)` → `availability_slots` → `slot_holds` → `enrollments` → `sessions` → `session_remedies` →
`cancellation_requests` → `disputes` → `payments`; rows of one table in id order in one statement. What the database
cannot express stays with the service under those locks and a probe each: the reservation of a proposal and a counter
(R-311), one remedy offer per session (the unique on `session_id` is its second line), the threshold count.

## 6. The migration

One forward, additive migration in the first batch, `20261108120000_sessions_pass`: §2.1 to §2.9, the enum values, the
two tables with their revokes and indexes, the checks, and the five settings rows in the seed. Probes in
`tests/db-integrity` for rules 40 to 47. Before it runs on `ijazah` (the owner's rule of B26): count `disputes` rows
that rule 46 would refuse, and `session_participant_events` rows (none expected).

## 7. ERD amendments (v1.14 → v1.15)

1. `sessions`: `outcome_under_dispute`, `admin_settled_at` (§2.1); the note on `simultaneous_connected_seconds` as the
   evaluation's recorded figure (**owner decision 3**).
2. `session_participant_events`: `room_ended`, nullable `user_id`, `connection_ref` (§2.2).
3. `session_remedies`: the offer state (`offered_at`, `choice_closes_at`), the counter-proposal's slot, time of day,
   zone, instant and answer deadline (§2.3); the meaning of `refund_case`.
4. `session_events` (§2.4) and `provider_outages` (§2.5): two tables, 44 in all; the domain map, §13.2's diagram and
   `module-tables.json`.
5. `enrollment_events.kind`: `completed`, `terminated_no_show` (§2.8).
6. `disputes`: the compensation reasons, the frozen outcome's place, `resolved_at` by `clock_timestamp()` (§2.7, R-312).
7. §15 rules 40 to 47; §14 the two partial uniques; §0's T090 stand-in: a deleted party is named by a stand-in text
   in the apps, never by a stored value (FR-426).
