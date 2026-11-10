// PUBLIC ENTRY of the sessions module (T017, ADR 0005 D2). Other modules import this file and nothing below it (R-API-3).
// booking requests session generation through this entry; it never writes the sessions table itself.
import type { Transactions } from '../../platform/db/transaction.repository.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { VideoPort } from '../../platform/ports/video/video.port.js';
import type { NodeHandler } from '../../platform/web/route.js';
import { ParticipantEventsService, videoWebhookRoute } from './video-webhook.controller.js';

/** Each enrollment's final session's local date, for a slot's release (T026, R-205, FR-394). */
export { lastSessionDateOf } from './sessions.repository.js';

/**
 * The times of a student's and a teacher's sessions in a window, for the one overlap check of the
 * booking sheet and the hold (T032, T033, R-205, FR-351, FR-BOOK-5).
 */
export { partiesSessionsBetween, type SessionTime } from './sessions.repository.js';

/** An enrollment's sessions by sequence number, for `checkout.status` (T037, FR-386, FR-393). */
export { type EnrollmentSessionRow, enrollmentSessionsOf } from './sessions.repository.js';

/**
 * T034 (R-209, FR-368, FR-369): an enrollment's sessions, written on the confirmation's
 * transaction by the confirm job (T039), which holds the locks `generation.service.ts` names.
 */
export {
  type EnrollmentToSchedule,
  generateForEnrollment,
  type ScheduledSession,
} from './generation.service.js';

/**
 * T048 (R-210, FR-370, ERD §15 rule 19): the re-resolution job's recomputation of every scheduled
 * session's cached instants, on the job's one transaction with the overlap constraints deferred,
 * and its store over the `sessions` table.
 */
export {
  type Reresolution,
  reresolveScheduledSessions,
  type SessionLengths,
} from './reresolution.service.js';
export { reresolutionStore } from './reresolution.repository.js';

/**
 * T049 (FR-390 to FR-393): the lists' reads, each on the caller's transaction with no lock, and an
 * enrollment's progress derived from its sessions (FR-392, R-DB-4): the sessions of some
 * enrollments, the sessions of a teacher's day, and the next, last, upcoming, completed and
 * remaining of one enrollment.
 */
export {
  sessionsOfEnrollments,
  type DaySession,
  teacherSessionsBetween,
} from './sessions.repository.js';
export { type SessionProgress, sessionProgress } from './progress.js';

/**
 * T004 of specs/004-sessions (`003:T059`, FR-AUTH-14's confirmed part; R-313): an enrollment's
 * end, on the caller's transaction after the enrollments' lock it holds: its remaining sessions
 * `cancelled_by_admin`, its open remedies handed to the case the caller opens or lapsed where it
 * opens none, one `session_events` row each. The one hand-off every enrollment's end uses. A
 * student's suspension (T005) runs it with `remedies: 'lockOnly'` and then `freezeOpenRemedies`:
 * the enrollments stay `confirmed`, their open remedies `frozen` (R-311, "Frozen"; C3).
 */
export {
  type CaseOf,
  cancelRemainingSessions,
  type EnrollmentsEnded,
  freezeOpenRemedies,
  type RemainingSessionsOptions,
  type RemediesFrozen,
  type RemedyHandling,
} from './remaining-sessions.service.js';
/** Sessions' one writer of `session_events` rows (T004, FR-495, R-315), for every later task. */
export {
  recordSessionEvents,
  type SessionEventKind,
  type SessionEventRecord,
} from './session-events.repository.js';
/**
 * T015 (FR-447, FR-451, SC-404; R-322; ADR 0023): an enrollment's Teacher-No-Show count, read when
 * shown and never stored, and the repeated-absence mark at `repeated_absence_flag_count`, for
 * administrators only (T024, T034, T035, T058). No lock, no write; nothing follows from either.
 */
export {
  createRepeatedAbsence,
  REPEATED_ABSENCE_FLAG_SETTING,
  type RepeatedAbsence,
  repeatedAbsenceFlagCount,
} from './repeated-absence.service.js';
export type { EnrollmentNoShowCount } from './repeated-absence.repository.js';
/**
 * T025 (FR-459; SRS FR-CANCEL-5): the cancellation requests a user made, in total and within
 * `cancellation_requests_recent_days`, counted from sessions' own table when read and never stored
 * (R-DB-4), for the user directory's `users.get` (T058). No lock, no write.
 */
export {
  CANCELLATION_REQUESTS_RECENT_DAYS_SETTING,
  type CancellationRequestCounts,
  type CancellationRequestCountsReader,
  createCancellationRequestCounts,
} from './cancellation-request-counts.service.js';
/**
 * T015 (FR-449, R-309): an enrollment's completion, checked on the settling transaction by every
 * path that settles (T014, T016, T033, T034) and again by `advance-remedies` (T028), after the
 * enrollment's lock the caller holds; bound by the composition root over `EnrollmentSide`.
 */
export {
  type Completion,
  createCompletion,
  DISPUTE_WINDOW_SETTING,
  disputeWindowHours,
} from './completion.service.js';
/**
 * T016 (FR-445, R-307): the provider outage windows, `sessions.outages.record` and `.list`, behind
 * the administrator surface's `sessions` namespace, and the record's store over sessions' tables,
 * which the race probe narrows as it narrows `evaluationStore`.
 */
export {
  type AdminNames,
  createOutageServices,
  type OutagePage,
  type OutageRecorded,
  type OutageRecordInput,
  type OutageServices,
  type OutageStore,
  outageStore,
} from './outages.service.js';
export { sessionsAdminRouter } from './sessions-admin.router.js';
/**
 * T023 (FR-460, FR-485; kernel.md, the row «an administrator's `sessions.cancel`»): an
 * administrator's cancellation of a `scheduled` session on the call's transaction, under the
 * enrollment's and the session's locks, its `admin_cancellation` case opened or joined and one
 * `cancelled_by_admin` event naming it; composed by the admin module for `sessions.cancel`.
 */
export {
  createSessionCancel,
  type SessionCancel,
  type SessionCancelInput,
  type SessionCancelled,
  type SessionCancelStore,
  sessionCancelStore,
} from './session-cancel.service.js';
/**
 * T024 (FR-479, FR-451, FR-439, FR-454; R-323 GAP-1, GAP-4): the enrollment and session monitor,
 * `sessions.monitor.list` and `.get`, read on the call's transaction, composed by the admin module;
 * and the derived values other tasks read through the same one function: a counter-proposal's
 * `answerClosesAt` (D1; T031, T032), a refused booking's `bookingRetriedUntil`, an outcome's
 * `correctable` (T059) and the restore window's end (T061).
 */
export {
  createSessionsMonitor,
  type SessionsMonitor,
  type SessionsMonitorStore,
  sessionsMonitorStore,
} from './sessions-monitor.service.js';
export { answerClosesAt, bookingRetriedUntil } from './remedy-deadlines.js';
export { isCorrectable } from './outcome-correction.js';
export { ENROLLMENT_RESTORE_WINDOW_SETTING, restorableUntil } from './restore-window.js';
/**
 * T008 (R-301): the `EnrollmentSide` port, what sessions needs of an enrollment that only booking
 * answers, bound by the composition root to booking's `createEnrollmentSide()`.
 */
export type {
  EnrollmentCancellationReason,
  EnrollmentEventEntry,
  EnrollmentEventKind,
  EnrollmentPage,
  EnrollmentPageFilter,
  EnrollmentPageItem,
  EnrollmentSide,
  EnrollmentStatus,
  EnrollmentTerms,
  EnrollmentTrack,
  HeldTime,
} from './enrollment-side.port.js';

/**
 * T012 (FR-440; R-SESS-1, R-SESS-7; research R-303, R-304): `POST /webhooks/video`, the video
 * provider's signed webhook, a raw-body route the composition root mounts beside the payment
 * webhook. It verifies each event through the video port before anything runs and records an
 * attendance event once under its provider id in `session_participant_events`.
 */
export { VIDEO_WEBHOOK_PATH, type VideoEventOutcome } from './video-webhook.controller.js';

/** The route over the video port's verify operation, the process's transactions and its log. */
export function createVideoWebhookRoute({
  transactions,
  video,
  log,
  maxBodyBytes,
  report,
}: {
  readonly transactions: Transactions;
  readonly video: Pick<VideoPort, 'verifyAndParseParticipantEvent'>;
  readonly log: Logger;
  /** `MAX_REQUEST_BODY_BYTES`. */
  readonly maxBodyBytes: number;
  /** The process's error reporting by default (T111); a recorder in the specs. */
  readonly report?: (error: Error) => void;
}): NodeHandler {
  return videoWebhookRoute({
    verify: (rawBody, headers) => video.verifyAndParseParticipantEvent(rawBody, headers),
    events: new ParticipantEventsService({
      transactions,
      log,
      ...(report === undefined ? {} : { report }),
    }),
    log,
    maxBodyBytes,
  });
}

/**
 * T014 (FR-441, FR-446, FR-482; R-SESS-2, R-SESS-3; research R-306, R-313): the evaluation the
 * `evaluate-sessions` sweep runs every minute: each session due settled on its own transaction under
 * the enrollment's and the session's locks, with T015's completion check, and the rooms of the
 * cancelled sessions in their join period ended.
 */
export {
  createEvaluation,
  type DueSession,
  type Evaluation,
  EVALUATION_DELAY_SETTING,
  type EvaluationRun,
  type EvaluationStore,
  evaluationStore,
  type SessionToSettle,
  type Settlement,
} from './evaluation.service.js';

/**
 * T013 (FR-442, FR-443, FR-444; research R-305): the attendance rules, pure, which the evaluation
 * (T014) runs over a session's recorded events, its window and the outages overlapping it.
 */
export {
  type Attendance,
  type AttendanceEvent,
  type AttendanceOutcome,
  type AttendanceSettings,
  type AttendanceWindow,
  evaluateAttendance,
} from './attendance.rules.js';

/**
 * T011 of specs/004-sessions (FR-431, FR-432, FR-434, FR-435; R-GENDER-7, R-SESS-5): `sessions.get`
 * and `sessions.join`, the router `app.router.ts` mounts under `sessions` and the services
 * `main.ts` binds over the process's client, the settings, the video port and booking's
 * `EnrollmentSide`, with the store over this module's reads and identity's accounts.
 */
export { sessionsRouter } from './sessions.router.js';
/**
 * T026 (FR-473, FR-474, FR-495; R-308): `sessions.dispute.raise` is `SessionsServices.raiseDispute`
 * (its store narrowable by the race probe); and the dispute fields of `sessions.get` and the lists,
 * which the integration joins after T021's: `createDisputeView({ settings }).ofSessions(tx, sessions,
 * viewerUserId)` for `dispute`, `canRaiseDispute` and `disputeClosesAt`, and `isDisputed(status)`
 * for the lists' `disputed`.
 */
export { type DisputeRaiseStore, disputeRaiseStore } from './dispute-raise.service.js';
export {
  createDisputeView,
  disputeFieldsOf,
  type DisputeView,
  isDisputed,
  type SessionDisputeFields,
} from './dispute-view.js';
export {
  createSessionsServices,
  type PartyStanding,
  type SessionsDependencies,
  type SessionsServices,
  type SessionsStore,
  sessionsStore,
} from './sessions.service.js';

/**
 * T021 of specs/004-sessions (FR-456 to FR-458; research R-310): cancellation requests.
 * `sessions.cancellation.request` and `.answer` reach the surface through `createSessionsServices`
 * (`services.sessions.cancellation`); `cancellationStore` is their store over sessions' tables, the
 * kernel's locks and identity's accounts, which a probe may narrow. `pendingCancellationsAmong` is
 * the lists' read (`pendingCancellation`): of some sessions, those with a request pending now.
 */
export {
  type CancellationServices,
  type CancellationStore,
  cancellationStore,
} from './cancellation.service.js';
export { pendingCancellationsAmong } from './cancellation.repository.js';
/**
 * T030 of specs/004-sessions (FR-463, FR-465, FR-467; SC-410; Q6 (a)): the one hand-off of a remedy
 * to its enrollment's compensation case, `refund_choice`, `counter_unanswered` or `makeup_refused`,
 * on the caller's transaction under contracts/kernel.md's row, for T031's `choose`, T032's sweep,
 * T036 and T064; and the automatic hand-off's one line (Q11 (a)), which the sweep writes after its
 * commit.
 */
export {
  type AutomaticRemedyCaseReason,
  createRemedyCase,
  logRemedyHandedOff,
  REMEDY_CASE_REASONS,
  type RemedyCase,
  type RemedyCaseInput,
  type RemedyCaseReason,
  type RemedyCaseStore,
  remedyCaseStore,
  type RemedyHandedOff,
} from './remedy-case.service.js';
/**
 * T029 of specs/004-sessions (FR-423, FR-468, FR-469; L5; Q4 (a)): the one booking of a remedy's
 * proposal or pending counter under contracts/kernel.md's row, on the caller's transaction
 * (`bookOn`) or in its own through `runRetryingDeadlockOnce` (`run`, `book`), for T031's `accept`,
 * T032's `answerCounter` and `advance-remedies`; `makeupRefusalOf` names what refused a
 * `MAKEUP_REFUSED` (an exclusion's constraint, a reservation, a second deadlock).
 */
export {
  createMakeupBooking,
  type MakeupBooked,
  type MakeupBooking,
  type MakeupBookingInput,
  type MakeupBookingKind,
  type MakeupBookingStore,
  makeupBookingStore,
  type MakeupOperation,
  type MakeupRefusal,
  makeupRefusalOf,
} from './makeup-booking.service.js';
/**
 * T022 of specs/004-sessions (FR-458, SC-411): what the `expire-cancellation-requests` sweep runs,
 * each pending request whose session has started expired on its own transaction under
 * contracts/kernel.md's row, and its store over sessions' tables, which a spec narrows to its rows.
 */
export {
  type CancellationExpiry,
  type CancellationExpiryStore,
  cancellationExpiryStore,
  createCancellationExpiry,
  type DueRequest,
  type ExpiryRun,
} from './cancellation-expiry.service.js';
/**
 * T027 of specs/004-sessions (FR-466; research R-311, "Reservation"; H3; Q1 (a), Q7 (a)): the times
 * open remedies reserve for some people, each `{ remedyId, sessionId, startsAt, endsAt }`, read by
 * booking's one overlap check, the confirmation's new hold for a released one, the proposal, the
 * counter options and a make-up's booking; and the enrollments whose open remedy keeps their slot
 * in use (booking's occupancy). No lock, no write.
 */
export {
  type ReservationReads,
  type ReservationStore,
  reservationStore,
  type ReservedTime,
  reservedTimesOf,
} from './reservations.service.js';
export { enrollmentsWithOpenRemedyAmong } from './reservations.repository.js';
/** T027: the sessions a confirmation would generate, for the late payment's reservation read. */
export { sessionsFor } from './generation.service.js';
