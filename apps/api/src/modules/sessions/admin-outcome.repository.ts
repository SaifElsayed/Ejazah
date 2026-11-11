// T033 of specs/004-sessions/tasks.md (FR-450; research R-308; data-model.md §2.1, rule 40): the one
// update of an administrator's outcome on sessions' own table; the rule and the event are
// `admin-outcome.service.ts`'. No lock: the caller holds the enrollment and the session.
import type { SessionStatus } from '@ijazah/contracts';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { RecordedOutcome } from './session-events.repository.js';

/**
 * The status an administrator's outcome writes: one of the four outcomes, or, for a dispute upheld
 * over a frozen `under_threshold` or `provider_outage` (R-308: the frozen outcome; rule 40 admits
 * both), that status, which leaves the session in the review queue (R-SESS-6).
 */
export type AdminSettledStatus = RecordedOutcome | 'under_threshold' | 'provider_outage';

/** The outcome written, from the status read under the caller's locks. */
export interface AdminSettlement {
  readonly id: string;
  readonly from: SessionStatus;
  readonly outcome: AdminSettledStatus;
  readonly adminId: string;
  readonly at: Date;
}

/**
 * `status` the outcome where the session is still `from`, `outcome_under_dispute` cleared,
 * `settled_by_admin_id` and `admin_settled_at` set together (rule 40); whether it moved the row.
 */
export async function settleByAdmin(
  tx: Pick<Transaction, 'session'>,
  { id, from, outcome, adminId, at }: AdminSettlement,
): Promise<boolean> {
  const { count } = await tx.session.updateMany({
    where: { id, status: from },
    data: {
      status: outcome,
      outcomeUnderDispute: null,
      settledByAdminId: adminId,
      adminSettledAt: at,
    },
  });
  return count === 1;
}
