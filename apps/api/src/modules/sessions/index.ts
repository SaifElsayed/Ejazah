// PUBLIC ENTRY of the sessions module (T017, ADR 0005 D2). Other modules import this file and nothing below it (R-API-3).
// booking requests session generation through this entry; it never writes the sessions table itself.

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
