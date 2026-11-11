// PUBLIC ENTRY of the moderation module (T017). Other modules import this file and nothing below it (R-API-3).

/**
 * The system's compensation case on an enrollment (T035, FR-362, FR-375, FR-DISPUTE-5): opened, or
 * joined while one of the same reason is open, on the caller's transaction, after the enrollment's
 * row lock (T005). The reason is one of `COMPENSATION_REASONS`.
 */
export {
  COMPENSATION_REASONS,
  COVERING_REASONS,
  type CompensationCase,
  type CompensationReason,
  openCompensationCase,
} from './compensation-case.service.js';

/**
 * An enrollment's compensation cases as the covering rule reads them (T082, `jobs/case-cover.ts`):
 * whether one is open, the latest opening and the latest closing, the database's instants.
 * `caseInstantsOf` for one enrollment, read by the confirm job under the enrollment's lock (T039);
 * `caseInstantsAmong` for some, read with no lock by the `expire-pending-payments` sweep (T040).
 */
export {
  type CaseInstants,
  caseInstantsAmong,
  caseInstantsOf,
} from './compensation-case.repository.js';

/**
 * T004 of specs/004-sessions (FR-487, R-327): of some enrollments, those with an open `disputes`
 * row of any kind, for booking's `heldFileOwnersAmong`; no lock.
 */
export { enrollmentsWithOpenMatterAmong } from './open-matters.repository.js';

/**
 * T015 of specs/004-sessions (FR-449, FR-486; the owner's decision of 2026-11-08 on lane D's
 * questions, Q1): the enrollment's open compensation case of a reason, or null, with no lock;
 * sessions' completion asks whether a `student_suspended` case is open, under the enrollment's lock.
 */
export { openCaseOf } from './compensation-case.repository.js';

/**
 * T026 of specs/004-sessions (FR-473, FR-474, R-308): a participant's dispute of a session, opened on
 * the caller's transaction after the raiser's, the enrollment's and the session's locks, at most one
 * open per session by rule 46 (null when one is); and each session's latest session dispute, for
 * the parties' screens (`sessions.get`'s `dispute`), with no lock.
 */
export { openSessionDispute } from './session-dispute.service.js';
export {
  latestSessionDisputesOf,
  type NewSessionDispute,
  type SessionDisputeState,
} from './session-dispute.repository.js';

/**
 * T024 of specs/004-sessions (FR-479, FR-439, FR-454): the sessions monitor's two reads of
 * `disputes`, with no lock: an enrollment's compensation cases, newest first, with their openings
 * (the restore window counts from one), and of some sessions those ever disputed.
 */
export {
  compensationCasesOf,
  type EnrollmentCase,
  sessionsEverDisputedAmong,
} from './compensation-case.repository.js';

/**
 * T035 of specs/004-sessions (FR-422, FR-478; research R-312): an administrator's closing of a case
 * (`closeCase`: the enrollment's lock, then one conditional update writing the closing and
 * `resolved_at` by the database's clock), and the queue's reads of `disputes` for sessions'
 * `cases.*`, with no lock.
 */
export { type CaseClosing, closeCase } from './compensation-case.service.js';
export {
  type CaseQueuePage,
  caseQueuePage,
  type CaseQueuePosition,
  type CaseQueueQuery,
  type CaseQueueRow,
  type CaseRecord,
  caseRecordOf,
  latestCaseOf,
  type SuspensionCase,
  suspensionCasesCoveredBy,
} from './compensation-case.repository.js';
/**
 * T034 of specs/004-sessions (FR-474 to FR-476, FR-422; research R-308): the administrator's
 * disputes queue's reads of session disputes, with no lock; the dispute's row lock, last in the one
 * order; and the ruling, moderation's row only (`resolveSessionDispute`, one conditional update
 * `WHERE status = 'open'`), which sessions' resolution calls on its transaction.
 */
export { resolveSessionDispute } from './session-dispute.service.js';
export {
  lockDispute,
  type SessionDisputeResolution,
  type SessionDisputeRow,
  type SessionDisputeRuling,
  sessionDisputeOf,
  sessionDisputesPage,
} from './session-dispute.repository.js';
/**
 * T059 of specs/004-sessions (FR-472, FR-439): a session's session disputes, oldest first, with no
 * lock, which a ruling's revision and an outcome's correction read under the session's lock.
 */
export { sessionDisputesOfSession } from './session-dispute.repository.js';
