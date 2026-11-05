# Contract: The administrator surface (Phase 3)

Mounted on `adminRouter` (research R-318). Every procedure is an `adminProcedure`: a signed-in administrator with the
second factor (NFR-SEC-6, FR-480); every call writes one audit entry with the actor, the action, the target's
non-personal label (ADR 0021 D2), the instant and, for every action, the mandatory reason; reads included, as Phase 2's
monitor does. Every procedure declares `.output(schema)`. Nothing here computes, stores or moves an amount, or confirms
an enrollment (SC-413).

## `sessions` — the monitor, the review queue, cancellation, outages (sessions module)

| Procedure | Input | Output | Audit | Notes |
|---|---|---|---|---|
| `sessions.monitor.list` | `{ status?, student?, teacher?, from?: LocalDate, to?: LocalDate, cursor? }` | `{ items: [{ enrollmentId, student: Party, teacher: Party, status, track, sessionCount, completed, remaining, nextSession? }], nextCursor? }` | `sessions.monitor.listed` | FR-479, FR-ADMIN-6; names searched by the folded prefix (R-203); pages of `admin_list_page_size`; payment status only as a link to `/payments` |
| `sessions.monitor.get` | `{ enrollmentId }` | `{ enrollment, sessions: [{ sessionId, sequenceNumber, makeupFor?, localDate, startTimeLocal, timezone, startsAt, endsAt, status, outcomeUnderDispute?, cancellable }], cases: [{ caseId, reason, status }], cancellationRequests }` | `sessions.monitor.viewed` | |
| `sessions.cancel` | `{ sessionId, reason }` | `{ sessionId, status: 'cancelled_by_admin', caseId }` | `session.cancelled` | FR-460: any session not yet settled; one case `admin_cancellation`; no penalty |
| `sessions.review.list` | `{ cursor? }` | `{ items: [{ sessionId, enrollmentId, status: 'under_threshold' \| 'provider_outage', startsAt, endsAt, simultaneousSeconds, parties }], nextCursor? }` | `sessions.review.listed` | FR-477, FR-ADMIN-14 |
| `sessions.review.get` | `{ sessionId }` | `Telemetry` | `sessions.review.viewed` | |
| `sessions.review.resolve` | `{ sessionId, outcome: 'done' \| 'student_no_show' \| 'teacher_no_show' \| 'both_no_show', reason }` | `{ sessionId, status }` | `session.review_resolved` | Brings what the outcome brings (the count, R-309; a remedy when final, R-311) |
| `sessions.outages.list` | `{ cursor? }` | `{ items: [{ outageId, startsAt, endsAt, reason, recordedBy }], nextCursor? }` | `provider_outages.listed` | |
| `sessions.outages.record` | `{ start: { localDate, localTime }, end: { localDate, localTime }, timezone, reason }` | `{ outageId, startsAt, endsAt, reclassified: number }` | `provider_outage.recorded` | FR-445; resolved by `packages/time`; reclassifies settled sessions inside their dispute window (R-307) |

`Telemetry` = `{ sessionId, schedule: { localDate, startTimeLocal, timezone, startsAt, endsAt }, status, events: [{ party: 'student' \| 'teacher' \| 'room', type: 'joined' \| 'left' \| 'room_ended', occurredAt, connectionRef? }], intervals: { student, teacher, together }, simultaneousSeconds, joined: { student, teacher }, outages: [...] }` (FR-SESS-9).

## `disputes` — FR-475, FR-476 (sessions module, over moderation's rows)

| Procedure | Input | Output | Audit | Notes |
|---|---|---|---|---|
| `disputes.list` | `{ cursor? }` | `{ items: [{ disputeId, sessionId, raisedBy: 'student' \| 'teacher', raisedAt, outcomeUnderDispute? }], nextCursor? }` | `disputes.listed` | Open first |
| `disputes.get` | `{ disputeId }` | `{ dispute, telemetry: Telemetry, chatAvailable }` | `dispute.viewed` | |
| `disputes.chat` | `{ disputeId, cursor? }` | the chat page, as `chat.list` with the sender's role | `chat.read`, target the enrollment | Only while the dispute is open (FR-475, FR-SESS-13); chat module's read |
| `disputes.resolve` | `{ disputeId, resolution: 'upheld' \| 're_marked' \| 'no_show_recorded' \| 'compensation_ordered' \| 'party_suspended' \| 'party_banned', consumed?: boolean, against?: 'student' \| 'teacher', party?: 'student' \| 'teacher', reason }` | `{ disputeId, sessionStatus }` | `dispute.resolved` | R-308's mapping; `party_*` through `StandingService` (FR-421); `resolved_at` by the database's clock |

## `cases` — the compensation-case queue (FR-478, FR-422)

| Procedure | Input | Output | Audit | Notes |
|---|---|---|---|---|
| `cases.list` | `{ status?: 'open' \| 'resolved' \| 'dismissed', cursor? }` | `{ items: [{ caseId, enrollmentId, reason, status, openedAt, closedAt? }], nextCursor? }` | `cases.listed` | Every reason, Phase 2's included |
| `cases.get` | `{ caseId }` | `{ case, enrollment: { enrollmentId, student: Party, teacher: Party, status, track }, covers: [{ sessionId, sequenceNumber, status, remedy? }], paymentsLink: { enrollmentId } }` | `case.viewed` | No amount anywhere; the orders are on `/payments` (FR-467, R-MONEY-6) |
| `cases.resolve` | `{ caseId, note }` | `{ caseId, status: 'resolved' }` | `case.resolved` | `resolution = compensation_ordered`; the note says what Platform Administration did outside the platform |
| `cases.dismiss` | `{ caseId, note }` | `{ caseId, status: 'dismissed' }` | `case.dismissed` | |

## `students` — a student's standing (identity module, R-313, 002:T144)

| Procedure | Input | Output | Audit | Notes |
|---|---|---|---|---|
| `students.suspend` | `{ userId, reason }` | `void` | `student.suspend` | `StandingService.suspendStudent`: sessions ended, consequences (FR-486) |
| `students.ban` | `{ userId, reason }` | `void` | `student.ban` | `StandingService.banStudent` |
| `students.reinstate` | `{ userId, reason }` | `void` | `student.reinstate` | Owner decision 1; restores the account only, nothing cancelled is restored |

`users.get` (verification module) gains `cancellationRequests: { total, recent }` (FR-459). `Party` =
`{ userId, displayName \| null, deleted }`.
