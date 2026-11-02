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
