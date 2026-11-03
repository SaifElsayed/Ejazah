// PUBLIC ENTRY of the moderation module (T017). Other modules import this file and nothing below it (R-API-3).

/**
 * The system's compensation case on an enrollment (T035, FR-362, FR-375, FR-DISPUTE-5): opened, or
 * joined while one of the same reason is open, on the caller's transaction, after the enrollment's
 * row lock (T005). The reason is one of `COMPENSATION_REASONS`.
 */
export {
  COMPENSATION_REASONS,
  type CompensationCase,
  type CompensationReason,
  openCompensationCase,
} from './compensation-case.service.js';

/**
 * When the enrollment's latest compensation case was opened, or null when it has none, read on the
 * caller's transaction under the enrollment's lock (T039): the confirm job's "a case exists" and
 * the order a case covers (the note under T035).
 */
export { latestCaseOpenedAt } from './compensation-case.repository.js';
