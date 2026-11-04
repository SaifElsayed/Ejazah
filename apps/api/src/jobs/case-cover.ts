// T082 (R-215, FR-362, FR-PAYG-19; the owner's decisions of 2026-11-03 and 2026-11-04): which paid
// orders an enrollment's compensation cases cover, one rule for `confirm-enrollment` (step 1) and the
// `expire-pending-payments` sweep (its hand-off).
//
// A case covers every paid order of its enrollment whose paid event was recorded before the case was
// opened, while it is open, or before it was closed (`disputes.resolved_at`, for `resolved` and
// `dismissed`), all three the database's instants. Nothing records which order a case is for
// (`disputes` has no payment column), so the instant a case closed is what keeps an order that
// joined it covered once it is closed. An enrollment may hold several cases (two reasons), so the
// rule reads them all, as moderation folds them: an order is covered when one of them is open, or
// when it was paid no later than the latest opening or the latest closing. Paid and opened (or
// closed) in the same millisecond counts as covered, as before T082.
import type { CaseInstants } from '../modules/moderation/index.js';

/**
 * Whether the enrollment's cases (`null` when it has none) cover an order whose first paid event
 * was recorded at `paidAt` (`null` when none is recorded: only an open case covers it then).
 */
export function covers(cases: CaseInstants | null, paidAt: Date | null): boolean {
  if (cases === null) return false;
  if (cases.open) return true;
  if (paidAt === null) return false;
  const paid = paidAt.getTime();
  const closedAt = cases.lastClosedAt;
  return cases.lastOpenedAt.getTime() >= paid || (closedAt !== null && closedAt.getTime() >= paid);
}
