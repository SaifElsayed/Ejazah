// T004 of specs/004-sessions/tasks.md (FR-487; research R-327): the parties of some people's
// enrollments, read for `heldFileOwnersAmong` (`held-files.service.ts`), on the caller's client with
// no lock. Over the two parties' plain indexes, bounded by the people asked and their enrollments.
import type { Transaction } from '../../platform/db/prisma.repository.js';

/** An enrollment and its two parties. */
export interface EnrollmentParties {
  readonly id: string;
  readonly studentUserId: string;
  readonly teacherUserId: string;
}

/** Every enrollment `userIds` are a party of, in any status; a soft-deleted one left out (T148). */
export async function enrollmentPartiesAmong(
  tx: Pick<Transaction, 'enrollment'>,
  userIds: readonly string[],
): Promise<EnrollmentParties[]> {
  if (userIds.length === 0) return [];
  return tx.enrollment.findMany({
    where: {
      OR: [{ studentUserId: { in: [...userIds] } }, { teacherUserId: { in: [...userIds] } }],
    },
    orderBy: { id: 'asc' },
    select: { id: true, studentUserId: true, teacherUserId: true },
  });
}
