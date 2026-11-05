# Data model: Phase 3 — Live sessions

**Date**: 2026-11-05 · **Spec**: [spec.md](./spec.md) · **Research**: [research.md](./research.md)

Phase 0 modelled every table this phase writes (ERD v1.3 and its addenda through v1.14). Phase 1 added
`sessions.makeup_for_session_id` and `session_remedies` as columns only; Phase 2 wrote `sessions` (generation and
re-resolution), `disputes` (compensation cases) and `enrollment_events`. This phase writes `sessions`' whole machine,
`session_participant_events`, `cancellation_requests`, `session_remedies`, session disputes and `chat_messages` for the
first time. The pass below is what it adds: two tables, eleven columns, one nullability change, five enum values, eight
integrity rules and seven settings rows, in one forward migration in the first batch. The ERD was amended on 2026-11-05 with the owner's decisions,
ahead of that batch (changelog v1.14 → v1.15, 44 tables; §7), and again the same day with the owner's decisions on the
analysis (plan.md, "Decisions on the analysis") and on the second analysis (plan.md, "Decisions on the second
analysis"). Nothing here carries an amount (FR-497, ADR 0007).

## 1. Who writes what

| Table | Owner (R-API-6) | Written in this phase by |
|---|---|---|
| `sessions` | sessions | the evaluation sweep (outcome, simultaneous seconds, `evaluated_at`); a review, dispute or outage resolution (`settled_by_admin_id`, `admin_settled_at`); a cancellation (accepted request, admin, termination, an account's end, the make-ups still scheduled when a suspended student's fault is confirmed); a dispute's raising (`disputed`, `outcome_under_dispute`); a make-up's booking (insert); the join (`provider_room_id`) |
| `session_participant_events` | sessions | the video webhook only (R-SESS-1) |
| `cancellation_requests` | sessions | `sessions.cancellation.request/answer`; the expiry sweep |
| `session_remedies` | sessions | the `advance-remedies` sweep (offer, windows ending); an accepted cancellation request (the offer, decision 5); a suspended student's case closed as cleared (the offer, decision 1); `sessions.remedy.*`; a termination, an account's end or a suspended student's fault confirmed (handed to a case); a student's suspension (frozen) and deletion (lapsed), through booking's subscriber and the sessions entry; a `frozen` remedy offered again by `advance-remedies`' first run after the reinstatement, never on the reinstatement's transaction (R-311) |
| `session_events` (new) | sessions | every transaction that produces an event FR-495 names (R-315) |
| `provider_outages` (new) | sessions | `sessions.outages.record` (admin) |
| `disputes` | moderation | `openCompensationCase` (the new reasons, R-312); `openSessionDispute`; `closeCase`, `resolveSessionDispute` (the admin's resolutions, FR-422) |
| `enrollments` | booking | `EnrollmentSide.terminateNoShow`, `.complete` and `.cancel` (`admin`, a suspended student's fault confirmed), bound to booking (R-301); the termination subscriber (`account_deleted`, `teacher_suspended`, and `admin` for a student's ban) |
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
(written once by the evaluation, the figure its outcome was decided on, R-305; the owner's decision 3 of 2026-11-05,
which R-DB-4 names),
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
| `offered_at` | timestamptz, NOT NULL | The moment the outcome became final and the remedy was offered (FR-462): the dispute window's close or a dispute's resolution; a Cancelled-By-Agreement session's acceptance (decision 5); a suspended student's case closed as cleared (decision 1). The row is inserted then (R-311), only on a `confirmed` enrollment and never while the student is suspended. Written again when a `frozen` remedy is offered again at the reinstatement |
| `choice_closes_at` | timestamptz, NOT NULL | `offered_at` + `makeup_choice_window_days`, fixed at the offer so a later change of the setting is prospective (§3.14) |
| `snapshot_answer_window_hours` | integer, NOT NULL | `makeup_counter_answer_hours` at the offer (A): every counter-proposal of this remedy is answered within it and H1 and H2 read it, so a later change of the setting cannot let an answer window run past the proposal's start (the owner's decision of 2026-11-05 on the analysis) |
| `snapshot_first_session_lead_hours` | integer, NOT NULL | `first_session_lead_hours` at the offer (L): no make-up starts within it of the moment it is decided (H1, H2; the same decision) |
| `counter_slot_id` | FK → `availability_slots`, nullable | The teacher's active slot of the pending counter-proposal (FR-465). A reference only: sessions reads the slot through catalog's entry |
| `counter_start_time_local` | time, nullable | The counter-proposal's time of day, the slot's `start_time_local` when proposed (the ERD's "Phase 3's pass to add") |
| `counter_timezone` | text (IANA), nullable | The zone of `counter_date` and `counter_start_time_local`: the slot's own zone, which may differ from the enrollment's (T077); R-TIME-3's gate asks a zone beside a `_local` column |
| `counter_proposed_at` | timestamptz, nullable | When the student made the pending counter-proposal |

No column holds the counter-proposal's answer deadline (the owner's decision of 2026-11-05 on the second analysis,
D1): it is `counter_proposed_at` + `snapshot_answer_window_hours`, computed when read by one sessions function over
`packages/time`'s `addHours` (R-TIME-1), and `RemedyView.counter.answerClosesAt`, `sessions.remedy.answerCounter`'s
refusal and `advance-remedies`' window's end all read that function, so no stored value can disagree with its inputs
(R-DB-4). It also reads the snapshot, never the live `makeup_counter_answer_hours` (I1). `choice_closes_at` stays a
column: it is what fixes the choice window, and no column holds the window's number of days, so it is not derived.

The row holds **the current pending counter-proposal only** (the owner's decision 9 of 2026-11-05): a student may
counter-propose again after a decline while the choice window is open, one pending at a time, so the `counter_*` columns
are set when a counter-proposal is made and cleared at its decline, its withdrawal (the student accepts the system's
proposal) or its hand-off to a case. The history of every counter-proposal, with its slot, date, time and zone, is in
`session_events` (§2.4).

Existing columns: `kind` (`makeup`, or `refund` once a refund is chosen or a counter goes unanswered), `status` (§3;
the enum gains `frozen`, a suspended student's remedy, and `lapsed`, a deleted student's open remedy closed with
nothing owed and no case: the owner's decisions of 2026-11-05 on the analysis),
`proposed_date` (the system's proposal, a date in the enrollment's snapshot zone at the enrollment's slot's local start),
`counter_date`, `decided_at` (booked, or handed to a case), `case_id`. Checks (rule 42): the five `counter_*` columns
(`counter_date` and the four above) all NULL or all set, and set exactly when `status = 'counter_proposed'`;
`(status = 'refund_case') = (case_id IS NOT NULL)`, so a `lapsed` remedy has no case; `choice_closes_at > offered_at`;
`snapshot_answer_window_hours > 0` and `snapshot_first_session_lead_hours >= 0`. `status = 'refund_case'` means
"handed to a compensation case": a refund choice, an unanswered counter, a termination, an account's end, or a
suspended student's fault confirmed (R-309, R-313); the case's `reason` says which (`kind` is `refund` only for a
refund choice or an unanswered counter, and stays `makeup` for a remedy handed over by an enrollment's end).

### 2.4 `session_events` — new, owned by `sessions` (R-315)

Append-only record of each event a later notification needs (FR-495).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `enrollment_id` | FK → enrollments | Plain index (FR-035 of Phase 0) |
| `session_id` | FK → sessions, nullable | NULL for none of today's kinds but kept nullable for an enrollment-wide one; plain index |
| `kind` | enum `session_event_kind` | `settled` · `cancellation_requested` · `cancellation_accepted` · `cancellation_declined` · `cancellation_expired` · `cancelled_by_admin` · `remedy_offered` · `counter_proposed` · `counter_accepted` · `counter_declined` · `counter_withdrawn` · `remedy_frozen` · `makeup_booked` · `remedy_handed_to_case` · `remedy_lapsed` · `dispute_raised` · `dispute_resolved` · `review_resolved` · `outage_reclassified` (nineteen) |
| `case_id` | FK → disputes, nullable | On a `cancelled_by_admin` row only: the compensation case the cancelling action opened or joined (an administrator's cancellation, a threshold termination, a teacher's end, a student's suspension or ban; a suspended student's fault confirmed, whose make-ups name the new
`student_fault_confirmed` case, the second analysis's C1); NULL for a student's deletion, which opens none. `cases.get`'s `covers` and a cleared suspension read it (the owner's decision of 2026-11-05 on the analysis, C4); plain index |
| `counter_slot_id` | FK → `availability_slots`, nullable | The counter-proposal's slot, on a `counter_proposed` row only; plain index |
| `counter_date` / `counter_start_time_local` / `counter_timezone` | date / time / text (IANA), nullable | The counter-proposal's local date, start and zone, on a `counter_proposed` row only (R-TIME-3: the zone beside the `_local` column) |
| `occurred_at` | timestamptz | The transaction's instant |
| `created_at` | timestamptz | |

**The history of counter-proposals lives here** (the owner's decision 9 of 2026-11-05): `session_remedies` keeps only
the pending counter-proposal (§2.3), so each `counter_proposed` row copies the counter-proposal's slot, date, start and
zone, and its end is the next `counter_accepted`, `counter_declined`, `counter_withdrawn` or `remedy_handed_to_case` row
of the same session. Rule 43 adds the check that the four `counter_*` columns are all set exactly when
`kind = 'counter_proposed'`, and `case_id IS NULL OR kind = 'cancelled_by_admin'`.

Every other detail (who requested, which outcome) is read from the rows the event names, so the row holds no personal
field and references no account (T005 rule 2's last clause holds for every termination path that writes one). Rule 43:
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

No column. `reason` keeps the closed list of `COMPENSATION_REASONS` for a compensation case (nine new values, R-312; `student_fault_confirmed` the second analysis's C1)
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
derived; nor a counter-proposal's answer deadline, computed when read (§2.3). No new index beyond the two partial uniques of rules 45 and 46, which are integrity rules, and the FK indexes
of the two new tables (R-DB-9).

## 3. State machines

### Session (`sessions.status`)

| From | To | By | Writes |
|---|---|---|---|
| `scheduled` | `done` · `student_no_show` · `teacher_no_show` · `both_no_show` · `under_threshold` · `provider_outage` | `evaluate-sessions` only, after end + delay (R-SESS-2, R-SESS-3) | `simultaneous_connected_seconds`, `evaluated_at`; `session_events(settled)`; threshold and completion checks |
| `scheduled` | `cancelled_by_agreement` | an accepted request, before the start | the request `accepted`; the remedy offered at once (final at acceptance, never disputed, decision 5); events |
| `scheduled` | `cancelled_by_admin` | an admin's cancellation (FR-460), a threshold termination (FR-448), an account's end (FR-483, FR-484, FR-486), a suspended student's fault confirmed (its make-ups still scheduled, FR-486) | events; a case per R-312; for a student's suspension, if the case clears the student, what a Teacher-No-Show owes, on recitation a make-up or a refund (`awaiting_choice`), on the ijazah track a make-up (decision 1 as changed on the analysis, item 2), and nothing if the case confirms the fault |
| `scheduled` (past its end, unevaluated) · `done` · `*_no_show` | `disputed` | a participant's dispute, from the scheduled end to the window's close; never a cancelled session | `outcome_under_dispute`; the dispute; events |
| `disputed` | `done` · `student_no_show` · `teacher_no_show` · `both_no_show` | the administrator's resolution (R-308) | `settled_by_admin_id`, `admin_settled_at`; the dispute closed; events |
| `under_threshold` · `provider_outage` | `done` · `student_no_show` · `teacher_no_show` · `both_no_show` | the review resolution only (R-SESS-6) | the same |
| `done` · `*_no_show` · `under_threshold` (inside the dispute window, not disputed) | `provider_outage` | an outage window recorded over it (FR-445) | events |

No automatic transition leaves `under_threshold`, `provider_outage` or `disputed` (R-SESS-6, FR-474). A `scheduled`
session is never moved to another time (FR-461); a make-up is a new row.

### Remedy (`session_remedies.status`)

The owner's decision 9 of 2026-11-05 (plan.md): re-proposals while the choice window is open, one pending at a time,
each answered within its own answer window.

| From | To | By |
|---|---|---|
| — | `awaiting_choice` (recitation: a Teacher-No-Show, or a session a cleared student's suspension cancelled) · `proposed` | the offer, when the outcome is final (FR-462), on a `confirmed` enrollment of a student not suspended: `advance-remedies`; an accepted cancellation request (decision 5); a suspended student's case closed as cleared (decision 1) |
| `awaiting_choice` | `proposed` · `refund_case` (kind `refund`) | the student's choice |
| `awaiting_choice` · `proposed` | `booked` (the proposal) | the student's acceptance, or `choice_closes_at` passing with no counter-proposal pending (FR-466, H5) |
| `awaiting_choice` · `proposed` | `counter_proposed` | the student's counter-proposal, before `choice_closes_at` (a counter-proposal is the choice of a make-up) |
| `counter_proposed` | `booked` (the counter) | the teacher's acceptance, before the answer window closes (`counter_proposed_at` + A, computed, §2.3) |
| `counter_proposed` | `proposed` | the teacher's decline while the choice window is open: the counter's time released; the student may accept or counter-propose again (H4) |
| `counter_proposed` | `booked` (the proposal) | the teacher's decline once the choice window has closed; or the student's acceptance of the proposal, which withdraws the pending counter-proposal and releases its time (the owner's approval of 2026-11-05) |
| `counter_proposed` | `refund_case` (kind `refund`) | the answer window's close (the same computation) passing with no answer, on either track (FR-465) |
| `awaiting_choice` · `proposed` · `counter_proposed` | `frozen` | the student's suspension: a pending counter-proposal withdrawn and its time released, the proposal's time released (the owner's decision of 2026-11-05 on the analysis, C3) |
| `frozen` | `awaiting_choice` · `proposed` | `advance-remedies`' first run after the student's reinstatement: a new offer, `offered_at`, a full `choice_closes_at`, the two snapshots read again, a new proposal under H1 |
| any open (`frozen` included) | `refund_case` | a threshold termination, a teacher's end, a student's ban, or a suspended student's fault confirmed |
| any open (`frozen` included) | `lapsed` | the student's deletion: nothing owed, no case; a remedy already `refund_case` keeps its case (C2) |

### Cancellation request

`pending → accepted | declined` by the counterparty before the start; `pending → expired` at the start (read so at once,
written by the sweep).

### Enrollment (`enrollments.status`), this phase's moves

| From | To | By |
|---|---|---|
| `confirmed` | `terminated_no_show` | the threshold (FR-448) |
| `confirmed` | `completed` | FR-449, after the last dispute window (the owner's decision 4), and never while a `student_suspended` case is open on it (decision 1) |
| `confirmed` | `cancelled` (`account_deleted` · `teacher_suspended` · `admin`) | an account's end (R-313): `admin` for a student's ban, at once (decision 1 (a)); a student's suspension leaves the enrollment `confirmed` (decision 1 (b)) |
| `confirmed` | `cancelled` (`admin`) | a suspended student's `student_suspended` case dismissed, the fault confirmed (decision 1): in the same transaction its make-ups still scheduled `cancelled_by_admin` and every remedy owed on it handed to a new `student_fault_confirmed` case, never to the case dismissed (the second analysis, C1) |

### Dispute and case (`disputes.status`)

`open → resolved | dismissed`, by an administrator, the enrollment's row locked first and `resolved_at =
clock_timestamp()` in the same update (FR-422).

## 4. Settings rows (seeded by `prisma/seed.ts`; SRS §3.14 rows since 2026-11-05, the owner's decision 8)

| Key | Default | Governs |
|---|---|---|
| `session_evaluation_delay_minutes` | 2 | FR-441 (the spec's new row) |
| `rate_limit_chat_message` | `{ limit: 30, window_seconds: 60 }` (the owner's decision 8) | FR-491 (the spec's new row) |
| `makeup_counter_answer_hours` | 72 | FR-465 (SRS §3.14, 2026-11-05) |
| `chat_page_size` | 50 (the owner's decision 8) | FR-488's list |
| `cancellation_requests_recent_days` | 30 (the owner's decision 8) | FR-459's "recent period" |
| `video_empty_timeout_seconds` | 300 (LiveKit's own default; the owner's decision on the analysis, K2) | the room's `emptyTimeout` (R-302) |
| `video_departure_timeout_seconds` | 20 (the same) | the room's `departureTimeout` (R-302) |

Existing keys this phase reads: `first_session_lead_hours` (fixed on each remedy at its offer), `early_join_lead_minutes`, `join_window_minutes`, `minimum_connection_seconds`,
`attendance_threshold_pct`, `teacher_no_show_threshold`, `dispute_window_hours`, `makeup_choice_window_days`,
`slot_release_buffer_weeks`, `chat_retention_days`, `upload_max_bytes`, `rate_limit_upload`,
`document_link_ttl_seconds`, `admin_list_page_size`.

## 5. Integrity rules and the lock order

New ERD §15 rules: 40 (`sessions`' two checks), 41 (`session_participant_events`' two checks), 42
(`session_remedies`' checks), 43 (`session_events` append-only, and its counter-proposal columns set exactly on `counter_proposed` rows), 44 (`provider_outages`' check and revokes), 45
(`cancellation_requests`), 46 (`disputes`), 47 (`chat_messages`' attachment checks).

T005's lock order, widened (`platform/db/row-lock.ts`, contracts/kernel.md): `users` → `teacher_profiles` →
`lockKey('teacher-slots', …)` → `availability_slots` → `slot_holds` → `enrollments` → `sessions` → `session_remedies` →
`cancellation_requests` → `disputes` → `payments`; rows of one table in id order in one statement. What the database
cannot express stays with the service under those locks and a probe each: the reservation of a proposal and a counter
(R-311), one remedy offer per session (the unique on `session_id` is its second line), the threshold count. Two paths
named by the analysis (F3, F4) keep the order: a dispute resolved `party_suspended` or `party_banned` locks the party's
`users` row first; an outage record locks the overlapped sessions' `enrollments` before the `sessions`. Beside them (the owner's decision
of 2026-11-05 on the second analysis, L1): a path that takes more than one teacher's `lockKey('teacher-slots', …)` —
a student's deletion, suspension or ban through booking's subscriber, and a dispute resolved `party_suspended` or
`party_banned` against a student — takes the keys in ascending teacher id order, as rows of one table are taken in id
order. A make-up's booking locks both slots it touches, the enrollment's own and, for a counter, the counter's, in one
call in id order (L2).

## 6. The migration

One forward, additive migration in the first batch, `20261108120000_sessions_pass`: §2.1 to §2.9, the enum values, the
two tables with their revokes and indexes, the checks, and the seven settings rows in the seed. Probes in
`tests/db-integrity` for rules 40 to 47. Before it runs on `ijazah` (the owner's rule of B26): count `disputes` rows
that rule 46 would refuse, and `session_participant_events` rows (none expected).

## 7. ERD amendments (v1.14 → v1.15)

Applied to `docs/ERD.md` on 2026-11-05 with the owner's decisions (plan.md, "Decisions recorded"), ahead of the first
batch's migration, which builds them.


1. `sessions`: `outcome_under_dispute`, `admin_settled_at` (§2.1); the note on `simultaneous_connected_seconds` as the
   evaluation's recorded figure (the owner's decision 3; R-DB-4 names it).
2. `session_participant_events`: `room_ended`, nullable `user_id`, `connection_ref` (§2.2).
3. `session_remedies`: the offer state (`offered_at`, `choice_closes_at`), the pending counter-proposal's slot, time of
   day, zone and instant, cleared when it ends (§2.3, the owner's decision 9); the meaning of `refund_case`.
4. `session_events` (§2.4, with the counter-proposals' history) and `provider_outages` (§2.5): two tables, 44 in all; the domain map, §13.2's diagram and
   `module-tables.json`.
5. `enrollment_events.kind`: `completed`, `terminated_no_show` (§2.8).
6. `disputes`: the compensation reasons, the frozen outcome's place, `resolved_at` by `clock_timestamp()` (§2.7, R-312).
7. §15 rules 40 to 47; §14 the two partial uniques; §0's T090 stand-in: a deleted party is named by a stand-in text
   in the apps, never by a stored value (FR-426).
8. On the analysis (the owner's decisions of 2026-11-05; the ERD's changelog rows 8 to 11): `session_remedies`'
   two snapshots, `frozen`, `lapsed`, the offer only on a confirmed enrollment, the B3 correction of `kind`;
   `session_events.case_id` and the kinds `remedy_frozen` and `remedy_lapsed`; the two video settings; ADR 0022 cited
   for `simultaneous_connected_seconds`.
9. On the second analysis (the owner's decisions of 2026-11-05; the ERD's changelog rows 12 and 13): no
   `counter_answer_closes_at`, the answer deadline computed when read (D1), rule 42's five `counter_*` columns;
   `disputes.reason`'s `student_fault_confirmed` and what dismissing a `student_suspended` case does (C1).
