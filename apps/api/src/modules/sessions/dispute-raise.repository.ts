// T026 of specs/004-sessions/tasks.md (FR-473, FR-474; research R-308; data-model.md §2.1, §3): the
// raise's write to `sessions`, sessions' own table (R-API-6), on the caller's transaction. The rules
// and the locks are `dispute-raise.service.ts`'.
//
// The session is marked `disputed` and its outcome frozen beside the status in the same update
// (FR-474): a settled outcome is copied to `outcome_under_dispute`; a session still `scheduled` past
// its end, never evaluated, leaves the column NULL, and the evaluation writes it there (T014, R-308).
// The update is conditional on the status read under the caller's locks (rule 40's check holds).
import type { Transaction } from '../../platform/db/prisma.repository.js';

type Client = Pick<Transaction, 'session'>;

/** The statuses a session is disputed from (R-308; data-model.md §3). */
export const DISPUTABLE_STATUSES = [
  'scheduled',
  'done',
  'student_no_show',
  'teacher_no_show',
  'both_no_show',
] as const;

export type DisputableStatus = (typeof DISPUTABLE_STATUSES)[number];

/**
 * Marks the session `disputed` where it is still `from`, its settled outcome copied to
 * `outcome_under_dispute`, or the column left NULL from `scheduled`; whether the row moved.
 */
export async function markDisputed(
  tx: Client,
  sessionId: string,
  from: DisputableStatus,
): Promise<boolean> {
  const { count } = await tx.session.updateMany({
    where: { id: sessionId, status: from },
    data:
      from === 'scheduled'
        ? { status: 'disputed' }
        : { status: 'disputed', outcomeUnderDispute: from },
  });
  return count === 1;
}
