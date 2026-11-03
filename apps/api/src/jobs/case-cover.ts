// T039 and T040 (the note under T035; the owner's decision of 2026-11-03): which paid orders a
// compensation case covers, one rule for `confirm-enrollment` and the `expire-pending-payments` sweep.

/** Whether a case opened at `caseAt` covers an order whose paid event was recorded at `paidAt`. */
export function covers(caseAt: Date | null, paidAt: Date | null): boolean {
  return caseAt !== null && paidAt !== null && caseAt.getTime() >= paidAt.getTime();
}
