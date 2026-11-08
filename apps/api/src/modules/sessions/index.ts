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
