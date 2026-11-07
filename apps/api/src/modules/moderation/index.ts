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
