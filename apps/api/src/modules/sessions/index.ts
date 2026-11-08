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
export type { TeacherNoShowCount } from './repeated-absence.repository.js';
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
 * the administrator surface's `sessions` namespace.
 */
export {
  type AdminNames,
  createOutageServices,
  type OutagePage,
  type OutageRecorded,
  type OutageRecordInput,
  type OutageServices,
} from './outages.service.js';
export { sessionsAdminRouter } from './sessions-admin.router.js';
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
export {
  createSessionsServices,
  type PartyStanding,
  type SessionsDependencies,
  type SessionsServices,
  type SessionsStore,
  sessionsStore,
} from './sessions.service.js';
