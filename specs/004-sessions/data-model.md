# Data model: Phase 3 — Live sessions

**Date**: 2026-11-05 · **Spec**: [spec.md](./spec.md) · **Research**: [research.md](./research.md)

Phase 0 modelled every table this phase writes (ERD v1.3 and its addenda through v1.14). Phase 1 added
`sessions.makeup_for_session_id` and `session_remedies` as columns only; Phase 2 wrote `sessions` (generation and
re-resolution), `disputes` (compensation cases) and `enrollment_events`. This phase writes `sessions`' whole machine,
`session_participant_events`, `cancellation_requests`, `session_remedies`, session disputes and `chat_messages` for the
first time. The pass below is what it adds: two tables, thirteen columns, one nullability change, eight enum values and one new
enum, nine integrity rules, seventeen settings rows, one settings row removed and one default changed, in one forward
migration in the first batch (the two columns, the enum, rule 48, `rate_limit_outcome_correction` and the changed
default since the owner's decisions of 2026-11-05 answering the administrator's control inventory; the live channel's
two settings since the owner's decision of 2026-11-05 on research R-324). The ERD was amended on 2026-11-05 with the owner's decisions,
ahead of that batch (changelog v1.14 → v1.15, 44 tables; §7), and again the same day with the owner's decisions on the
analysis (plan.md, "Decisions on the analysis"), on the second analysis (plan.md, "Decisions on the second
analysis"), on the third (plan.md, "Decisions on the third analysis") and on the decision of no automatic termination
(plan.md, "Decisions of 2026-11-05, no automatic termination"; ADR 0023). Nothing here carries an amount (FR-497, ADR
0007).

## 1. Who writes what

| Table | Owner (R-API-6) | Written in this phase by |
|---|---|---|
| `sessions` | sessions | the evaluation sweep (outcome, simultaneous seconds, `evaluated_at`); a review, dispute or outage resolution and a ruling's revision (`settled_by_admin_id`, `admin_settled_at`); a cancellation (accepted request, admin, an administrator's termination on a complaint, an account's end, the make-ups still scheduled when a suspended student's fault is confirmed); a dispute's raising (`disputed`, `outcome_under_dispute`); a make-up's booking (insert); an administrator's restore (insert of the sessions still owed, R-322) |
| `session_participant_events` | sessions | the video webhook only (R-SESS-1) |
| `cancellation_requests` | sessions | `sessions.cancellation.request/answer`; the expiry sweep |
| `session_remedies` | sessions | the `advance-remedies` sweep (offer, windows ending); an accepted cancellation request (the offer, decision 5); a suspended student's case closed as cleared (the offer, decision 1); `sessions.remedy.*`; an administrator's termination on a complaint, an account's end or a suspended student's fault confirmed (handed to a case); an administrator's restore (a `refund_case` remedy its closing's case held offered again, R-322); a student's suspension (frozen) and deletion (lapsed; from 2026-11-21 handed to the deletion's case, SRS DEC-96), through booking's subscriber and the sessions entry; a `frozen` remedy offered again by `advance-remedies`' first run after the reinstatement, never on the reinstatement's transaction (R-311) |
| `session_events` (new) | sessions | every transaction that produces an event FR-495 names (R-315); an administrator's correction (`outcome_corrected`) and `reresolve-session-instants` through sessions' `reresolveScheduledSessions` (`instants_reresolved`) (R-323, GAP-3 and GAP-6) |
| `slot_holds` | booking | every release and the conversion, `release_reason` with `released_at` (§2.12; R-323, GAP-8) |
| `provider_outages` (new) | sessions | `sessions.outages.record` (admin) |
| `disputes` | moderation | `openCompensationCase` (the new reasons, R-312; an administrator's manual case, `cases.openManual`, R-326); `openSessionDispute`; `openAbsenceComplaint` (a student's complaint, R-322); `closeCase`, `resolveSessionDispute` (the admin's resolutions and a complaint's decision, FR-422; a restore's closing note) |
| `enrollments` | booking | `EnrollmentSide.terminateNoShow` (an administrator's decision on a complaint), `.restore` (an administrator's restore), `.complete` and `.cancel` (`admin`, a suspended student's fault confirmed), bound to booking (R-301, R-322); the termination subscriber (`account_deleted`, `teacher_suspended`, and `admin` for a student's ban) |
| `enrollment_events` | booking | the same transactions (`completed`, `terminated_no_show`, `cancelled`, `restored`) |
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
`evaluated_at` (the evaluation's instant), `settled_by_admin_id`, `makeup_for_session_id` (a make-up's original,
FR-469). `provider_room_id` (since `20261007000000_init`) is never written: the room is named for the session's id,
so the column stays NULL and unused, and the join writes nothing to `sessions` (the owner's decision of 2026-11-06 on
the sixth analysis, M1). Its removal is a Not scheduled item of tasks.md; the ERD notes the column unused (§7, item
18).

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
| `offered_at` | timestamptz, NOT NULL | The moment the outcome became final and the remedy was offered (FR-462): the dispute window's close, or the resolution of a dispute still open at the close, never before the close even when a dispute was resolved or a ruling revised earlier (the owner's decision of 2026-11-05 on the third analysis, G1); a Cancelled-By-Agreement session's acceptance (decision 5); a suspended student's case closed as cleared (decision 1). The row is inserted then (R-311), only on a `confirmed` enrollment and never while the student is suspended. Written again when a `frozen` remedy is offered again at the reinstatement |
| `choice_closes_at` | timestamptz, NOT NULL | `offered_at` + `makeup_choice_window_days`, fixed at the offer so a later change of the setting is prospective (§3.14) |
| `snapshot_answer_window_hours` | integer, NOT NULL | `makeup_counter_answer_hours` at the offer (A): every counter-proposal of this remedy is answered within it and H1 and H2 read it, so a later change of the setting cannot let an answer window run past the proposal's start (the owner's decision of 2026-11-05 on the analysis) |
| `snapshot_first_session_lead_hours` | integer, NOT NULL | `first_session_lead_hours` at the offer (L): no make-up starts within it of the moment it is decided (H1, H2; the same decision) |
| `counter_slot_id` | FK → `availability_slots`, nullable | The teacher's active slot of the pending counter-proposal (FR-465). A reference only: sessions reads the slot through catalog's entry. Plain index `session_remedies_counter_slot_id_idx`, as every foreign key (ERD §14, FR-035 of Phase 0; the owner's decision of 2026-11-05 on the third analysis, C2) |
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
"handed to a compensation case": a refund choice, an unanswered counter, an administrator's termination on a complaint,
an account's end, a suspended student's fault confirmed (R-309, R-313, R-322), or an administrator's hand-off to a
manual case (R-326); an administrator's restore offers again
each `refund_case` remedy of kind `makeup` its closing's case held, as a new offer, `case_id` and `decided_at` cleared
(R-322, ADR 0023); the case's `reason` says which (`kind` is `refund` only for a
refund choice or an unanswered counter, and stays `makeup` for a remedy handed over by an enrollment's end or by an administrator's hand-off, R-326).

### 2.4 `session_events` — new, owned by `sessions` (R-315)

Append-only record of each event a later notification needs (FR-495).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `enrollment_id` | FK → enrollments | Plain index (FR-035 of Phase 0) |
| `session_id` | FK → sessions, nullable | NULL exactly on the two complaint kinds, enrollment-wide (rule 43); plain index |
| `kind` | enum `session_event_kind` | `settled` · `cancellation_requested` · `cancellation_accepted` · `cancellation_declined` · `cancellation_expired` · `cancelled_by_admin` · `remedy_offered` · `counter_proposed` · `counter_accepted` · `counter_declined` · `counter_withdrawn` · `remedy_frozen` · `makeup_booked` · `remedy_handed_to_case` · `remedy_lapsed` · `dispute_raised` · `dispute_resolved` · `dispute_revised` · `review_resolved` · `outage_reclassified` · `complaint_raised` · `complaint_decided` · `outcome_corrected` · `instants_reresolved` · `counter_booking_refused` · `postponed` (twenty-six; `postponed`, a session a party postponed, appended by 003:T112 (B-M3, SRS DEC-90, migration `20261119095115_session_postponements`); `counter_booking_refused`, a teacher's acceptance of a counter-proposal that the database refused, the counter released, the owner's decision of 2026-11-06 on the fourth analysis, A1; `dispute_revised` the owner's decision of 2026-11-05 on the third analysis; the two complaint kinds, rows with no session, the decision of no automatic termination, R-322; `outcome_corrected`, an administrator's correction of an outcome nobody disputed, and `instants_reresolved`, a session's instants recomputed or kept back by `reresolve-session-instants`, the decisions answering the administrator's control inventory, R-323 GAP-3 and GAP-6) |
| `case_id` | FK → disputes, nullable | On a `cancelled_by_admin` row only: the compensation case the cancelling action opened or joined (an administrator's cancellation, an administrator's termination on a complaint, a teacher's end, a student's suspension or ban; a suspended student's fault confirmed, whose make-ups name the new
`student_fault_confirmed` case, the second analysis's C1); NULL for a student's deletion, which opens none. `cases.get`'s `covers` and a cleared suspension read it (the owner's decision of 2026-11-05 on the analysis, C4). On a `dispute_revised` row: the session dispute whose ruling it revises, always set (the third analysis). On a `complaint_raised` or `complaint_decided` row: the complaint, always set (R-322); plain index |
| `counter_slot_id` | FK → `availability_slots`, nullable | The counter-proposal's slot, on a `counter_proposed` row only; plain index |
| `counter_date` / `counter_start_time_local` / `counter_timezone` | date / time / text (IANA), nullable | The counter-proposal's local date, start and zone, on a `counter_proposed` row only (R-TIME-3: the zone beside the `_local` column) |
| `outcome_before` / `outcome_after` | `session_status`, nullable | On a `dispute_revised` or an `outcome_corrected` row only, both set: the outcome the revision or the correction replaced and the one it wrote, each `done`, `student_no_show`, `teacher_no_show` or `both_no_show` (SRS FR-DISPUTE-7; research R-308 gives the storage's reasons against the R-DB rules; the correction, R-323 GAP-3) |
| `previous_start_at` | timestamptz, nullable | On an `instants_reresolved` row only, set: for a session the run moved, its `scheduled_start_at` before the run (the session's row holds the new one); for a session kept back, the start it keeps (R-323, GAP-6; the owner's decision of 2026-11-05) |
| `occurred_at` | timestamptz | The transaction's instant |
| `created_at` | timestamptz | |

**The history of counter-proposals lives here** (the owner's decision 9 of 2026-11-05): `session_remedies` keeps only
the pending counter-proposal (§2.3), so each `counter_proposed` row copies the counter-proposal's slot, date, start and
zone, and its end is the next `counter_accepted`, `counter_declined`, `counter_withdrawn`, `counter_booking_refused`,
`remedy_handed_to_case` or `remedy_lapsed` row of the same session (`remedy_lapsed`: a student's deletion lapsing a
remedy with a counter pending). `counter_withdrawn` is the student's acceptance of the system's
proposal while the counter was pending (or a suspension's freeze); `counter_booking_refused` is the teacher's acceptance
that the database refused (an overlap, FR-468), the counter released as at a decline, so the two are never read as one
another (the owner's decision of 2026-11-06 on the fourth analysis, A1). The kind is the refusal's record: the
database's refusal is the only reason that path has, and the row, like every row here, holds no personal field. Rule 43 adds the check that the four `counter_*` columns are all set exactly when
`kind = 'counter_proposed'`; `case_id IS NULL OR kind IN ('cancelled_by_admin', 'dispute_revised', 'complaint_raised', 'complaint_decided')`,
`case_id` set on every `dispute_revised`, `complaint_raised` and `complaint_decided` row; `session_id` NULL exactly on
the two complaint kinds; `outcome_before` and `outcome_after` both set exactly when `kind IN ('dispute_revised',
'outcome_corrected')`, each one of the four outcomes above; and `previous_start_at` set exactly when `kind =
'instants_reresolved'` (both widenings the owner's decisions of 2026-11-05 answering R-323). An `outcome_corrected` or
`instants_reresolved` row has a session and no `case_id`.

**A ruling's revision lives here too** (the owner's decision of 2026-11-05 on the third analysis; SRS FR-DISPUTE-7):
the dispute's `resolution`, `resolution_notes`, `resolved_by_admin_id` and `resolved_at` keep the ruling and are never
rewritten; each revision is one `dispute_revised` row beside it, and its reason and administrator are in the audit
entry `dispute.revised`. No table is added.

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

`kind` gains `absence_complaint` and `resolution` gains `enrollment_ended` (the decision of no automatic termination,
R-322); no column. `reason` keeps the closed list of `COMPENSATION_REASONS` for a compensation case (eleven new values: nine, R-312; `student_fault_confirmed` the second analysis's C1;
`absence_termination` replaces `teacher_no_show_threshold`, R-322; and `admin_opened_for_student` and
`admin_opened_for_teacher`, an administrator's manual case, its party being its reason, the owner's decision of
2026-11-05, R-326) and the participant's text for a session dispute and
for a student's complaint of the teacher's absence (`absence_complaint`: the student as `raised_by_user_id`, no session). Rule 46: one open session dispute per session, a partial unique
index `disputes_one_open_per_session_key` on `(session_id) WHERE kind = 'session_dispute' AND status = 'open'`
(FR-473); `(kind = 'session_dispute') = (session_id IS NOT NULL)`; `(status = 'open') = (resolved_at IS NULL)`;
`status = 'open' OR (resolution_notes IS NOT NULL AND resolved_by_admin_id IS NOT NULL)`; one open complaint per
enrollment, a partial unique index `disputes_one_open_complaint_per_enrollment_key` on `(enrollment_id) WHERE kind =
'absence_complaint' AND status = 'open'` (FR-452); `kind <> 'absence_complaint' OR raised_by_user_id IS NOT NULL`;
`resolution IS DISTINCT FROM 'enrollment_ended' OR kind = 'absence_complaint'`. A complaint closes `resolved`
(`enrollment_ended` or `party_suspended`) or `dismissed`; a restore closes its closing's case `dismissed` with the note
`restored` (R-322). Phase 2's covering rule (`caseInstantsAmong` in
`modules/moderation/compensation-case.repository.ts`, `caseInstantsOf` through it; FR-362 of `specs/003-booking/spec.md`)
reads only Phase 2's three reasons, `slot_unavailable`, `party_restricted` and `duplicate_payment`, never one this
phase adds, so a manual case on an enrollment waiting for payment changes nothing of its order's confirmation or late
branch (the owner's decision of 2026-11-05; R-326). A manual case's written reason is its audit entry's
(`case.opened_manually`); no column is added. Every existing row is an open
compensation case with no session, which the checks admit (to be counted on `ijazah` before the migration, as B26's
were).

`covered_by_case_id` (B39, the owner's decision (c) of 2026-11-11 on PR #133's review, round 1, Major 1; the note under
T036): FK → `disputes`, nullable, plain index. A closed `student_suspended` case names the case that owes the sessions
its suspension cancelled, written by `closeCase` in the closing's one update: dismissed on a `confirmed` enrollment, the
`student_fault_confirmed` case opened or joined then (U1, only the make-ups covered); resolved on an enrollment already
ended, that end's case (U2, every session covered). NULL otherwise. Rule 49: `covered_by_case_id IS NULL OR (kind =
'compensation_case' AND reason = 'student_suspended' AND status <> 'open' AND covered_by_case_id <> id)`. `cases.get`'s
`covers` reads the link and compares no instant: `resolved_at` is the database's clock, `created_at` the application's.
Widened by T069 (§2.13): `reason IN ('student_suspended', 'teacher_suspended')`, the link also on a closed
`teacher_suspended` case (T071), the rest unchanged.

### 2.8 `enrollment_events`

`enrollment_event_kind` gains `completed`, `terminated_no_show` and `restored` (an administrator's restore, R-322), and,
by T069 (§2.13), `slot_released` and `slot_hold_ended`. Rule 39's checks are unchanged (none carries a reason or a
payment).

### 2.9 `chat_messages`

No column. Rule 47: `attachment_mime IS NULL OR attachment_mime IN ('application/pdf', 'text/plain')`; the attachment's
three columns all NULL or all set unless `purged_at` is set (beside rule 8).

### 2.10 Nothing else

No amount, share, commission, balance, ledger or escrow column or table (FR-497, R-MONEY-6; T104 and T105 are out of
scope). No stored count of no-shows, remaining or completed sessions, or cancellation requests (R-DB-4): each is
derived; nor a counter-proposal's answer deadline, computed when read (§2.3). No new index beyond the three partial uniques of rules 45 and 46 (the complaint's the third, R-322), which are integrity rules, the FK indexes
of the two new tables, and `session_remedies_counter_slot_id_idx`, the plain index of the new foreign key
`session_remedies.counter_slot_id` that ERD §14 requires of every foreign key (R-DB-9; the third analysis, C2).

### 2.11 A deleted account's files (no column; research R-327)

The owner's decision of 2026-11-05 (SRS FR-AUTH-14 as amended, ADR 0015's amendment): a deleted person's
`users.photo_key` and the keys of their `verification_documents` (marked `erased_at` at the deletion, as now) are kept,
and their files with them, while the person is the `student_user_id` or the `teacher_user_id` of an enrollment with an
open `disputes` row of any kind (a session dispute, a compensation case, a complaint). Read through booking's entry
(`heldFileOwnersAmong`, over `enrollments`) and moderation's (`enrollmentsWithOpenMatterAmong`, over `disputes`), never
across a table (R-API-6). The deletion's after-commit removal asks it through identity's `FileHold` port; the
`erase-deleted-files` job skips a held owner's files and removes them on its first run after the last matter closes.
Rule 34 is unchanged: a key is never held without `erased_at`. While held, a file is readable by an administrator
only inside an open `disputes` row of that enrollment (`disputes.heldFiles`, `disputes.heldFileLink`; the owner's
decision of 2026-11-06, research R-327, «The administrator's read»); no column is added.

### 2.12 `slot_holds.release_reason` (booking's; research R-323, GAP-8)

| Column | Type | Notes |
|---|---|---|
| `release_reason` | enum `hold_release_reason`, nullable | Why the hold was released, written with `released_at` by every path that writes it: `converted` (the confirmation's `convertHoldOf`, `modules/booking/confirmation.repository.ts`); and, through booking's one release (`markReleased` under `releaseHolds`, `releaseExpiredHolds` or `reholdEnrollment`, `modules/booking/holds.service.ts`), its `ReleaseReason`: `expired`, `checkout_abandoned`, `slot_unavailable`, `admin`, `teacher_suspended`, `account_deleted`. Check (rule 48): `release_reason IS NULL OR released_at IS NOT NULL`; a hold released before the migration keeps NULL («not recorded»). No index (R-DB-9) |

The owner's decision of 2026-11-05. Not a derived value: `expires_at` against `released_at` tells an expiry only
roughly, and nothing else tells a new checkout from an account's end for a hold with no enrollment. Phase 2's
`payments.get` lists the enrollment's holds with it (contracts/admin-surface.md).

### 2.13 A ban's lift, a held slot and a deleted teacher's kept data (T069; SRS DEC-66, DEC-67)

The owner's decisions of 2026-11-12 (SRS DEC-66, DEC-67, DEC-69; spec FR-502, FR-503, FR-505, FR-508) and of
2026-11-13 on B42a's conflict check (the note under T069 in tasks.md). One additive migration,
`20261113120000_ban_restorable_and_kept_data` (§6). Every new column is NULL on every existing row; no backfill,
the app has never launched.

| Table | Column or object | Type | Notes |
|---|---|---|---|
| `users` (identity) | `banned_at` | timestamptz, nullable | The instant of the ban in force: written by every ban (`banStudent`, `ban`), cleared by its lift (T072). Check (rule 50): `banned_at IS NULL OR account_status = 'banned'` |
| `enrollments` (booking) | `slot_released_at` | timestamptz, nullable | An administrator's release of a held slot before its hold ended (T070, `enrollments.releaseSlot`; SRS FR-CANCEL-9) |
| `teacher_profiles` (identity) | `kept_at`, `kept_erase_at`, `kept_erased_at` | timestamptz, nullable | A deleted teacher ever approved keeps the identity and credential documents and the payout reference (T076): `kept_at` the deletion that kept them, `kept_erase_at` the erasure date an administrator set, `kept_erased_at` their erasure (T077; SRS FR-ADMIN-21) |
| `teacher_profiles` (identity) | `verification_status_before_ban`, `application_status_before_ban` | enums `teacher_verification_status`, `teacher_application_status`, nullable | The two statuses the profile had before a ban, written by every ban and cleared by its lift, which returns the profile to them (T072; spec FR-502) |
| `teacher_profiles` (identity) | `teacher_profiles_payout_account_ref_hash_key` | partial unique index | Rebuilt `WHERE kept_at IS NULL`: the payout hash binds the live accounts only, so a new account may register the payout account a kept profile holds (Q-E (a); rule 27 as widened) |
| `verification_documents` (verification) | `kept_at` | timestamptz, nullable | Set at the deletion of a teacher ever approved on each identity and credential document it keeps (T076). Rule 34 widened: `kept_at IS NULL OR erased_at IS NULL`, beside its first check, so a kept document holds its key. That every document of a deleted person still holding its key is kept or erased spans `users`, so it is held by the deletion and its spec (`tests/db-integrity/ban-restorable-kept-data.spec.ts`), not by a check |
| `enrollment_events` (booking) | `enrollment_event_kind` + `slot_released`, `slot_hold_ended` | enum values | An administrator's release of a held slot (T070) and a hold's end recorded once by the hourly sweep (T074; spec FR-505). Rule 39 unchanged: neither carries a reason or a payment |
| `enrollments` (booking) | `enrollments_held_closing_idx` | partial index on `(id)` | `WHERE confirmed_at IS NOT NULL AND (status = 'terminated_no_show' OR (status = 'cancelled' AND cancellation_reason IN ('admin', 'teacher_suspended')))`: every held closing, none a deletion or a gender correction ended (DEC-69). The hourly sweep (T074) reads it a page at a time in id order. It keeps every held closing after its hold too, so the sweep's read grows with history: accepted, re-checked at Phase 6's load pass (Q11 (a)) |
| `disputes` (moderation) | rule 49 | check | Widened: `covered_by_case_id IS NULL OR (kind = 'compensation_case' AND reason IN ('student_suspended', 'teacher_suspended') AND status <> 'open' AND covered_by_case_id <> id)`: the link also on a closed `teacher_suspended` case (T071) |

### 2.14 An administrator's direct end of an enrollment (T082; SRS FR-CANCEL-10, DEC-68)

The owner's decisions of 2026-11-12 (SRS DEC-68; spec FR-513) and of 2026-11-14 on B42c's conflict check (the note
under T082 in tasks.md, Q-R14 (a)). One additive migration, `20261114120000_enrollment_admin_end_reason` (§6). The
column is NULL on every existing row, which the check admits.

| Table | Column or object | Type | Notes |
|---|---|---|---|
| `enrollments` (booking) | `admin_end_reason` | text, nullable | The reason both parties are shown of an administrator's direct end (`sessions.endEnrollment`, T082), written with the end and cleared by the restore; the internal note is in the audit entry only, never here. Check (rule 51, `enrollments_admin_end_reason_check`): `admin_end_reason IS NULL OR (char_length(admin_end_reason) BETWEEN 1 AND 500 AND status = 'cancelled' AND cancellation_reason = 'admin')` |
| `disputes` (moderation) | `reason` `admin_ended` | a value of the closed list in code (no column, no check; the ERD's changelog row 25) | The case a direct end opens, holding the sessions owed and every open remedy; restorable at any time while open (DEC-69), its slot held through `enrollment_restore_window_days` unless released |

## 3. State machines

### Session (`sessions.status`)

| From | To | By | Writes |
|---|---|---|---|
| `scheduled` | `done` · `student_no_show` · `teacher_no_show` · `both_no_show` · `under_threshold` · `provider_outage` | `evaluate-sessions` only, after end + delay (R-SESS-2, R-SESS-3) | `simultaneous_connected_seconds`, `evaluated_at`; `session_events(settled)`; the completion check (no count is checked: FR-448, R-322) |
| `scheduled` | `cancelled_by_agreement` | an accepted request, before the start | the request `accepted`; the remedy offered at once (final at acceptance, never disputed, decision 5); events |
| — | `scheduled` | generation (Phase 2); a make-up's booking (FR-469); an administrator's restore, the sessions still owed (FR-455, R-322) | the local date, start and zone, the instants from `packages/time` |
| `scheduled` | `cancelled_by_admin` | an admin's cancellation (FR-460), an administrator's termination on a complaint (FR-453), an account's end (FR-483, FR-484, FR-486), a suspended student's fault confirmed (its make-ups still scheduled, FR-486) | events; a case per R-312; for a student's suspension, if the case clears the student, what a Teacher-No-Show owes, on recitation a make-up or a refund (`awaiting_choice`), on the ijazah track a make-up (decision 1 as changed on the analysis, item 2), and nothing if the case confirms the fault |
| `scheduled` (past its end, unevaluated) · `done` · `*_no_show` | `disputed` | a participant's dispute, from the scheduled end to the window's close, a session whose earlier dispute was resolved or its ruling revised included (no remedy exists before the window closes: the third analysis, G1); never a cancelled session | `outcome_under_dispute`; the dispute; events |
| `disputed` | `done` · `student_no_show` · `teacher_no_show` · `both_no_show` | the administrator's resolution (R-308) | `settled_by_admin_id`, `admin_settled_at`; the dispute closed; events |
| `under_threshold` · `provider_outage` | `done` · `student_no_show` · `teacher_no_show` · `both_no_show` | the review resolution only (R-SESS-6) | the same |
| `done` · `*_no_show` (its last dispute resolved, inside the dispute window, no remedy) | `done` · `student_no_show` · `teacher_no_show` · `both_no_show` | an administrator's revision of the ruling (SRS FR-DISPUTE-7; R-308) | `settled_by_admin_id`, `admin_settled_at`; the dispute's ruling left as written; `session_events(dispute_revised)` with `outcome_before` and `outcome_after` |
| `done` · `*_no_show` (inside the dispute window, never disputed, no remedy) | `done` · `student_no_show` · `teacher_no_show` · `both_no_show` | an administrator's correction of an outcome nobody disputed (spec FR-439; R-323, GAP-3) | `settled_by_admin_id`, `admin_settled_at`; `session_events(outcome_corrected)` with `outcome_before` and `outcome_after` |
| `done` · `*_no_show` · `under_threshold` (inside the dispute window, not disputed, an administrator's resolution or revision included: no remedy offered yet, G1) | `provider_outage` | an outage window recorded over it (FR-445) | events |

No automatic transition leaves `under_threshold`, `provider_outage` or `disputed` (R-SESS-6, FR-474). A `scheduled`
session is never moved to another time (FR-461); a make-up is a new row.

### Remedy (`session_remedies.status`)

The owner's decision 9 of 2026-11-05 (plan.md): re-proposals while the choice window is open, one pending at a time,
each answered within its own answer window.

**An open remedy** is one not yet final: `awaiting_choice`, `proposed`, `counter_proposed` or `frozen`; `booked`,
`refund_case` and `lapsed` are final. Every path that hands a remedy over at an enrollment's end (a student's ban, a
teacher's end, a confirmed fault) hands over every open one, `frozen` included; a suspension freezes the open ones not
yet frozen (the owner's decision of 2026-11-05 on the third analysis, F1).

| From | To | By |
|---|---|---|
| — | `awaiting_choice` (recitation: a Teacher-No-Show, or a session a cleared student's suspension cancelled) · `proposed` | the offer, when the outcome is final (FR-462: the dispute window closed and no dispute open, never at a resolution or revision inside the window), on a `confirmed` enrollment of a student not suspended: `advance-remedies`; an accepted cancellation request (decision 5); a suspended student's case closed as cleared (decision 1) |
| `awaiting_choice` | `proposed` · `refund_case` (kind `refund`) | the student's choice |
| `awaiting_choice` · `proposed` | `booked` (the proposal) | the student's acceptance, or `choice_closes_at` passing with no counter-proposal pending (FR-466, H5) |
| `awaiting_choice` · `proposed` | `counter_proposed` | the student's counter-proposal, before `choice_closes_at` (a counter-proposal is the choice of a make-up) |
| `counter_proposed` | `booked` (the counter) | the teacher's acceptance, before the answer window closes (`counter_proposed_at` + A, computed, §2.3) |
| `counter_proposed` | `proposed` | the teacher's decline while the choice window is open: the counter's time released; the student may accept or counter-propose again (H4) |
| `counter_proposed` | `booked` (the proposal) | the teacher's decline once the choice window has closed; or the student's acceptance of the proposal, which withdraws the pending counter-proposal and releases its time (the owner's approval of 2026-11-05) |
| `counter_proposed` | `refund_case` (kind `refund`) | the answer window's close (the same computation) passing with no answer, on either track (FR-465) |
| `counter_proposed` | `proposed` · `booked` (the proposal) | the teacher's acceptance refused by the database: the counter released as at a decline, one `counter_booking_refused` row (FR-468; the third analysis, A3; the kind, not `counter_withdrawn`, by the owner's decision of 2026-11-06 on the fourth analysis, A1) |
| `proposed` · `awaiting_choice` (past `choice_closes_at`) | `refund_case` (reason `makeup_refused`) | the proposal's booking refused on every attempt until its occurrence would start within L of an attempt (FR-468, A3) |
| `awaiting_choice` · `proposed` · `counter_proposed` | `frozen` | the student's suspension: a pending counter-proposal withdrawn and its time released, the proposal's time released (the owner's decision of 2026-11-05 on the analysis, C3) |
| `frozen` | `awaiting_choice` · `proposed` | `advance-remedies`' first run after the student's reinstatement: a new offer, `offered_at`, a full `choice_closes_at`, the two snapshots read again, a new proposal under H1 |
| any open (`frozen` included) | `refund_case` | an administrator's termination on a complaint, a teacher's end, a student's ban, or a suspended student's fault confirmed |
| any open (`frozen` included) | `refund_case` (`kind` unchanged) | an administrator's hand-off to the student's manual case, `cases.openManual` with `remedyId`: a pending counter withdrawn, both reserved times released, one `remedy_handed_to_case` row (the owner's decision of 2026-11-05; R-326) |
| `refund_case` (kind `makeup`, its `case_id` the closing's case) | `awaiting_choice` · `proposed` | an administrator's restore of the enrollment: a new offer, as a frozen remedy's at reinstatement, `case_id` and `decided_at` cleared (FR-455, R-322, ADR 0023) |
| any open (`frozen` included) | `lapsed` | the student's deletion: nothing owed, no case; a remedy already `refund_case` keeps its case (C2) |

### Cancellation request

`pending → accepted | declined` by the counterparty before the start; `pending → expired` at the start (read so at once,
written by the sweep).

### Enrollment (`enrollments.status`), this phase's moves

| From | To | By |
|---|---|---|
| `confirmed` | `terminated_no_show` | an administrator's decision on a student's complaint (FR-453; no count ends an enrollment, FR-448) |
| `confirmed` | `completed` | FR-449, after the last dispute window (the owner's decision 4), and never while a `student_suspended` case is open on it (decision 1) |
| `confirmed` | `cancelled` (`account_deleted` · `teacher_suspended` · `admin`) | an account's end (R-313): `admin` for a student's ban, at once (decision 1 (a)); a student's suspension leaves the enrollment `confirmed` (decision 1 (b)) |
| `confirmed` | `cancelled` (`admin`) | a suspended student's `student_suspended` case dismissed, the fault confirmed (decision 1): in the same transaction its make-ups still scheduled `cancelled_by_admin` and every remedy owed on it handed to a new `student_fault_confirmed` case, never to the case dismissed (the second analysis, C1) |
| `terminated_no_show` (ended on a complaint) · `cancelled` (`admin`, a confirmed fault) | `confirmed` | an administrator's restore, within `enrollment_restore_window_days` of the closing, its case still open: `cancellation_reason` NULL, `confirmed_at` untouched, one `enrollment_events` row `restored` (FR-454, FR-455, R-322, ADR 0023; the second exit from a terminal state, beside ADR 0010 D5's late confirmation) |

### Dispute and case (`disputes.status`)

`open → resolved | dismissed`, by an administrator, the enrollment's row locked first and `resolved_at =
clock_timestamp()` in the same update (FR-422). A student's complaint (`absence_complaint`): `open → resolved`
(`enrollment_ended`, `party_suspended`) or `dismissed`, by `cases.decideComplaint` only (FR-453).

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
| `repeated_absence_flag_count` | 5 (the owner's decision of no automatic termination) | FR-451's mark (R-322) |
| `enrollment_restore_window_days` | 14 (SRS DEC-66, T069; 7 until then, the same decision) | FR-454's window (R-322); since DEC-69 only the hold of the slot after an administrator's closing (FR-503) |
| `rate_limit_absence_complaint` | `{ limit: 5, window_seconds: 3600 }` (the limit the same decision; its default this cycle's reading) | FR-452's rate limit, the student as subject (R-322) |
| `rate_limit_signed_in_default` | `{ limit: 150, window_seconds: 60 }` per research R-325 (the owner's decision of 2026-11-06 on the fifth analysis, 160 until then; the owner's decision of 2026-11-05 its first value; the rule its reason: the larger of 120 and the heaviest normal minute × 2–3, never a number above 200, R-321 item 5) | FR-470's default limit on every signed-in procedure that declares none, the user or administrator as subject (R-321) |
| `rate_limit_dispute_revision` | `{ limit: 10, window_seconds: 60 }` (the owner's decision of 2026-11-05 on the administrator's control) | `disputes.revise`'s own limit, the administrator as subject (FR-470) |
| `rate_limit_enrollment_restore` | `{ limit: 10, window_seconds: 60 }` (the same) | `sessions.restore`'s own limit, the administrator as subject (FR-470) |
| `rate_limit_manual_compensation_case` | `{ limit: 10, window_seconds: 60 }` (the same) | `cases.openManual`'s own limit (FR-471 (c), FR-493; R-326), the administrator as subject |
| `rate_limit_outcome_correction` | `{ limit: 10, window_seconds: 60 }` (the owner's decision of 2026-11-05 answering R-323) | `sessions.review.revise`'s own limit (FR-439; R-323, GAP-3), the administrator as subject |
| `rate_limit_live_channel` | `{ limit: 10, window_seconds: 60 }` (the owner's decision of 2026-11-05 on research R-324) | `live.events`' own limit on opening the live channel, the user as subject, failing closed (FR-428) |
| `live_channel_max_connections_per_user` | 3 (the same) | the most live streams one account holds, the oldest ended when one more opens (FR-428; R-324) |
| `room_close_grace_minutes` | 0 (the owner's decision of 2026-11-09, DEC-64) | the minutes after a session's scheduled end before the `evaluate-sessions` sweep ends its video room (FR-501; SRS FR-SESS-21, §3.14; T067) |
| `room_close_retry_minutes` | 10 (the owner's decision of 2026-11-11 on B40a's conflict check, Q5, DEC-65) | the minutes after the end plus the grace during which the sweep asks the provider again, each minute, until it reports the room ended; a positive whole number of minutes, since 0 would close nothing, so the reader refuses it and the step writes its error line and report each run (FR-501; SRS FR-SESS-21, §3.14; T067) |
| `ban_restore_window_days` | 14 (the owner's decisions of 2026-11-12, SRS DEC-66; T069) | the days a ban's or a revocation's closing holds its slot (FR-502, FR-503; SRS §3.14 «Ban restore window (days)», DEC-69) |
| `rate_limit_ban_lift` | `{ limit: 10, window_seconds: 60 }` (the same; T069) | `students.liftBan`, `teachers.liftBan` and `teachers.liftRevocation`'s own limit, the administrator as subject (FR-502; T072) |
| `rate_limit_slot_release` | `{ limit: 10, window_seconds: 60 }` (the same; T069) | `enrollments.releaseSlot`'s own limit, the administrator as subject (FR-503; T070) |
| `rate_limit_kept_data_erase_date` | `{ limit: 10, window_seconds: 60 }` (the owner's decisions of 2026-11-12, SRS DEC-67; T069) | `teachers.keptData.setEraseDate`'s own limit, the administrator as subject (FR-509; T077) |
| `rate_limit_kept_data_erase_now` | `{ limit: 10, window_seconds: 60 }` (the same; T069) | `teachers.keptData.eraseNow`'s own limit, the administrator as subject (FR-509; T077) |
| `rate_limit_kept_document_link` | `{ limit: 10, window_seconds: 60 }` (the same; T069) | `teachers.keptData.documentLink`'s own limit, the administrator as subject (FR-509; T077) |
| `rate_limit_admin_user_delete` | `{ limit: 10, window_seconds: 60 }` (the same; T069) | an administrator's deletion of an account at its owner's request, its own limit, the administrator as subject (SRS FR-ADMIN-22; T081) |
| `rate_limit_enrollment_end` | `{ limit: 10, window_seconds: 60 }` (the owner's decisions of 2026-11-12, SRS DEC-68, §3.14; T082) | `sessions.endEnrollment`'s own limit, the administrator as subject (FR-513; SRS FR-CANCEL-10) |

Removed: `teacher_no_show_threshold` (2), deleted by the migration and no longer seeded (the same decision; R-322).

Changed: `chat_retention_days` defaults to **30** (was 0; the owner's decision of 2026-11-05; SRS §3.14, FR-SESS-13),
still an administrator's setting (FR-492). The seed inserts a row only where it is absent, so the new default reaches a
new database; a database already seeded keeps its row until an administrator changes it in the panel (R-PROC-11,
research R-317).

Changed (T069; SRS DEC-66, Q6 (b)): `enrollment_restore_window_days` defaults to **14** (was 7). The seed plants 14 on a
new database, and the migration `20261113120000_ban_restorable_and_kept_data` moves an existing row to 14 only while it
still holds 7, so a value an administrator chose is left alone.

Existing keys this phase reads: `first_session_lead_hours` (fixed on each remedy at its offer), `early_join_lead_minutes`, `join_window_minutes`, `minimum_connection_seconds`,
`attendance_threshold_pct`, `dispute_window_hours`, `makeup_choice_window_days`,
`slot_release_buffer_weeks`, `chat_retention_days` (its default changed, above), `upload_max_bytes`, `rate_limit_upload`,
`document_link_ttl_seconds`, `admin_list_page_size`.

## 5. Integrity rules and the lock order

New ERD §15 rules: 40 (`sessions`' two checks), 41 (`session_participant_events`' two checks), 42
(`session_remedies`' checks), 43 (`session_events` append-only, and its counter-proposal columns set exactly on `counter_proposed` rows), 44 (`provider_outages`' check and revokes), 45
(`cancellation_requests`), 46 (`disputes`), 47 (`chat_messages`' attachment checks), 48 (`slot_holds.release_reason`
only on a released hold; R-323, GAP-8).

T005's lock order, widened (`platform/db/row-lock.ts`, contracts/kernel.md): `users` → `teacher_profiles` →
`lockKey('teacher-slots', …)` → `availability_slots` → `slot_holds` → `enrollments` → `sessions` → `session_remedies` →
`cancellation_requests` → `disputes` → `payments`; rows of one table in id order in one statement. What the database
cannot express stays with the service under those locks and a probe each: the reservation of a proposal and a counter
(R-311), one remedy offer per session (the unique on `session_id` is its second line), a restore's free slot and times
(R-322). Two paths
named by the analysis (F3, F4) keep the order: a dispute resolved `party_suspended` or `party_banned` locks the party's
`users` row first; an outage record locks the overlapped sessions' `enrollments` before the `sessions`. Beside them (the owner's decision
of 2026-11-05 on the second analysis, L1): a path that takes more than one teacher's `lockKey('teacher-slots', …)` —
a student's deletion, suspension or ban through booking's subscriber, and a dispute resolved `party_suspended` or
`party_banned` against a student — takes the keys in ascending teacher id order, as rows of one table are taken in id
order. A make-up's booking locks both slots it touches, the enrollment's own and, for a counter, the counter's, in one
call in id order (L2). On the third analysis (the owner's decision of 2026-11-05): a dispute resolved `party_banned`
against a teacher takes the teacher's `teacher_profiles` row after `users` and before the slots' key, as
`StandingService.ban`'s `lockApplication` does (L-A); `chat.send` and `POST /uploads/chat`, which insert a
`chat_messages` row referencing the sender, lock the sender's `users` row and then the enrollment (L-B); an
administrator's `sessions.cancel` takes `enrollments`, `sessions`, then `disputes` (L-C); a ruling's revision takes a
resolution's order, with no account (contracts/kernel.md). On the decision of no automatic termination (R-322): a
complaint's raising locks the student's `users` row, then the enrollment; ending the enrollment on it takes a confirmed
fault's order (`enrollments`, `sessions`, `session_remedies`, `disputes`); suspending the teacher, a `party_suspended`
resolution's; closing it, `enrollments` then `disputes`; a restore, `users` (both), `lockKey('teacher-slots', …)`, the
enrollment's `availability_slots` row, `enrollments`, `sessions`, `session_remedies`, `disputes`. On the decisions
answering the administrator's control inventory (R-323, R-326): an administrator's correction of an outcome nobody
disputed takes `enrollments`, `sessions`, reading the session's disputes and remedy under them; a manual case takes
`enrollments` then `disputes`; with a remedy handed to it, the refund hand-off's order, `users` (both), `lockKey('teacher-slots', …)`,
`enrollments`, `sessions`, `session_remedies`, `disputes`. On the fourth analysis (the owner's decision of 2026-11-06,
L1): the two sweeps that insert a `session_events` row beside another write lock the enrollment first, since the
insert's foreign key takes a key-share lock on it: `expire-cancellation-requests` takes `enrollments`, `sessions`, then
`cancellation_requests`, as an accepted request does, and `reresolve-session-instants` `enrollments` then `sessions`, as
the evaluation does, each with a probe in `tests/db-integrity/` against that path. On the fifth analysis (the owner's
decision of 2026-11-06, L2), one general rule, reworded on the sixth analysis (the owner's decision of 2026-11-06,
M2): a path that locks, updates or inserts a row referencing a `sessions` row (a foreign key's key-share included)
takes, before any session, every lock earlier in the one order that it will take. A path inserting a `session_events`
row always takes the enrollment. No path waits on a lock earlier in the order while holding a session. A cancellation
request and its decline take `users` (both parties, one call), `enrollments` (the session's), `sessions`, then
`cancellation_requests`, with a probe racing each against an administrator's `sessions.cancel` on the same session
(T021). On the sixth analysis (the owner's decisions of 2026-11-06, H1 and M2), two paths have their own rows in
contracts/kernel.md: `sessions.join` locks the two accounts (`users`, one call) and nothing else, and writes no
`sessions` row; `POST /webhooks/video` takes the participant's `users` row `FOR KEY SHARE` (`keyShareRows`, a new
helper in `platform/db/row-lock.ts`) before it inserts a participant's event, whose foreign keys would otherwise
key-share the session first and the account second, and takes no enrollment, since it inserts no `session_events`
row; a `room_ended` event, with no user, takes no lock before its insert. A probe in `tests/db-integrity/` races a
`participant_left` against a teacher's suspension with the session in its join period, and against a cancellation's
decline during the early-join lead (T012). A counter-proposal's `counter_slot_id` key-shares its `availability_slots`
row while the path holds the session; it is safe, since every path that locks an `availability_slots` row `FOR UPDATE`
takes the slot's teacher's `users` row first, which the counter's path already holds (the sixth analysis, L2).

## 6. The migration

One forward, additive migration in the first batch, `20261108120000_sessions_pass`: §2.1 to §2.9, the enum values, the
two tables with their revokes and indexes, `session_remedies_counter_slot_id_idx`, the checks, the seventeen settings rows in the seed (and `chat_retention_days`' new default, §4), and the deletion of the `teacher_no_show_threshold` row; §2.12's enum and column on booking's `slot_holds` and rule 48. Probes in
`tests/db-integrity` for rules 40 to 48. B39 adds a second, additive migration, `20261111120000_case_covered_by`:
§2.7's `covered_by_case_id`, its index and rule 49; every existing row NULL, which the check admits. Before it runs on `ijazah` (the owner's rule of B26): count `disputes` rows
that rule 46 would refuse, and `session_participant_events` rows (none expected).

B42a adds a third, additive migration, `20261113120000_ban_restorable_and_kept_data` (T069): §2.13's eight columns, the
two enum values (added `IF NOT EXISTS` and committed before the rest, as `20261108120000_sessions_pass` does), rule 50,
rule 34 and rule 27 widened, rule 49 widened, `enrollments_held_closing_idx`, and `enrollment_restore_window_days` moved
from 7 to 14 where its row still holds 7 (§4). Every existing row is NULL in every new column, which each new check admits,
and rules 27 and 49 only relax. Probes in `tests/db-integrity/ban-restorable-kept-data.spec.ts` (rule 49's beside its
first form in `sessions-pass.spec.ts`), and the step's in `tests/seed/restore-window-step.spec.ts`. Before it runs on
`ijazah` (Q1 (a): at the next device run, on the owner's word, after B39's migration): count the rows each new check
would refuse (0 on 2026-11-13: no user banned or deleted, no document erased, no duplicate payout hash, no dispute).

B42c adds a fourth, additive migration, `20261114120000_enrollment_admin_end_reason` (T082): §2.14's column and rule 51.
Every existing row is NULL in it, which the check admits. Probes in `tests/db-integrity/enrollment-admin-end-reason.spec.ts`,
red before the migration and under a mutant without the check. Applied to `ijazah_integrity` on 2026-11-14; before it runs
on `ijazah`, count the rows rule 51 would refuse (0 expected: a new nullable column).

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
10. On the third analysis (the owner's decisions of 2026-11-05; the ERD's changelog rows 14 to 16):
    `session_remedies_counter_slot_id_idx`; `offered_at` never before the dispute window's close;
    `session_events`' kind `dispute_revised` with `outcome_before` and `outcome_after`, rule 43; `disputes.resolution`
    never rewritten; what a `student_suspended` case decides on a confirmed fault's make-ups and on an enrollment
    already ended.
11. On the decision of no automatic termination (the owner's decision of 2026-11-05, ADR 0023; the ERD's changelog rows
    17 to 20): `enrollments.status`'s two notes (no threshold; the restore's move back to `confirmed`);
    `enrollment_events.kind`'s `restored`; `session_remedies`' `refund_case` final but for a restore's new offer;
    `session_events`' `complaint_raised` and `complaint_decided`, rule 43; `disputes.kind`'s `absence_complaint`,
    `resolution`'s `enrollment_ended`, the reason `absence_termination` for `teacher_no_show_threshold`, rule 46's partial
    unique and two checks, §14; the settings.
12. On the decisions of the administrator's control and the rate limits (the owner's decision of 2026-11-05; the ERD's
    changelog row 21): four rate-limit settings (§4); no column for a restore's `slot_changed`, which compares the
    slot's row with the enrollment's own generated sessions (R-322).
13. On the decisions answering the administrator's control inventory (the owner's decisions of 2026-11-05; the ERD's
    changelog rows 23 and 24): `rate_limit_signed_in_default` at 160 per 60 s (research R-325; 150 since the fifth analysis, item 18); `chat_retention_days`
    30; a deleted person's photo and document keys kept while an open dispute, case or complaint holds them (§2.11,
    R-327).
14. On the same decisions (the ERD's changelog row 25): `disputes.reason`'s `admin_opened_for_student` and
    `admin_opened_for_teacher`; `session_remedies.status`'s `refund_case` also by an administrator's hand-off; Phase 2's
    covering rule reading Phase 2's three reasons only (§2.7, R-326).
15. On the same decisions (the ERD's changelog row 26): `session_events`' kinds `outcome_corrected` and
    `instants_reresolved`, the column `previous_start_at`, rule 43 widened (§2.4); `slot_holds.release_reason` and rule
    48 (§2.12); `rate_limit_outcome_correction` (§4).
16. On the decision of the live channel (the owner's decision of 2026-11-05, research R-324; the ERD's changelog row
    28): `rate_limit_live_channel` (10 per 60 s, per user) and `live_channel_max_connections_per_user` (3) (§4). No
    table: the live channel keeps nothing in the database.
17. On the fourth analysis (the owner's decisions of 2026-11-06; the ERD's changelog rows 29 and 30):
    `session_events`' kind `counter_booking_refused`, twenty-five kinds (§2.4, §3); §11's `notifications.type` name
    `session_outcome_corrected`, read from the `outcome_corrected` row (SRS FR-NOTIF-1 as amended). No column and no
    rule.
18. On the fifth analysis (the owner's decision of 2026-11-06; the ERD's changelog row 32): `rate_limit_signed_in_default`
    seeded at 150 per 60 s, research R-325 recomputed without the name searches `rate_limit_search` counts (§4).
19. On the sixth analysis (the owner's decision of 2026-11-06, M1; the ERD's changelog row 33): `sessions.provider_room_id`
    noted unused, since the room is named for the session's id; nothing writes it (§2.1), and its removal is Not
    scheduled (tasks.md). No migration in this phase.
20. On PR #133's review, round 1, Major 1 (the owner's decision (c) of 2026-11-11; the ERD's changelog row 34):
    `disputes.covered_by_case_id` and rule 49 (§2.7, §6).
21. On the owner's decisions of 2026-11-12 (SRS DEC-66, DEC-67) and of 2026-11-13 on B42a's conflict check (T069; the
    ERD's changelog rows 36 to 44): `users.banned_at` and rule 50; `enrollments.slot_released_at`; the five
    `teacher_profiles` columns; `verification_documents.kept_at` and rule 34 widened; rule 27 widened;
    `enrollment_event_kind`'s `slot_released` and `slot_hold_ended`; `enrollments_held_closing_idx` (§14); rule 49
    widened; the seven settings rows and `enrollment_restore_window_days` at 14 (§2.13, §4, §6).
22. On the owner's decisions of 2026-11-12 (SRS DEC-68) and of 2026-11-14 on B42c's conflict check (T082; the ERD's
    changelog row 45): `enrollments.admin_end_reason` and rule 51; `rate_limit_enrollment_end` (§2.14, §4, §6).
