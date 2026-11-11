// T034 of specs/004-sessions/tasks.md (FR-475; research R-308; contracts/admin-surface.md,
// `disputes.list`): the disputes queue's one read of sessions' own table, the disputed sessions of a
// page in one statement. No lock: nothing is decided on it.
import type { SessionStatus } from '@ijazah/contracts';

import type { Transaction } from '../../platform/db/prisma.repository.js';

/** A disputed session as the queue shows it: its enrollment, its parties and the frozen outcome. */
export interface DisputedSessionRow {
  readonly id: string;
  readonly enrollmentId: string;
  readonly studentUserId: string;
  readonly teacherUserId: string;
  readonly outcomeUnderDispute: SessionStatus | null;
}

/** Of `sessionIds`, each session by its id, over the primary key; a soft-deleted one absent. */
export async function disputedSessionsAmong(
  tx: Pick<Transaction, 'session'>,
  sessionIds: readonly string[],
): Promise<ReadonlyMap<string, DisputedSessionRow>> {
  if (sessionIds.length === 0) return new Map();
  const rows = await tx.session.findMany({
    where: { id: { in: [...new Set(sessionIds)] } },
    select: {
      id: true,
      enrollmentId: true,
      studentUserId: true,
      teacherUserId: true,
      outcomeUnderDispute: true,
    },
  });
  return new Map(rows.map((row) => [row.id, row] as const));
}
