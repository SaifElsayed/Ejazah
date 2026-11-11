// T036 of specs/004-sessions/tasks.md (FR-486; research R-313; contracts/kernel.md, the row «a
// `student_suspended` case closed»): the reads of sessions' own tables that closing a suspended
// student's case needs, each on the caller's transaction. The rules and the locks' order are
// `suspension-case.service.ts`'; a read that decides is made again under its locks (T005's rule 1).
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { lockRows } from '../../platform/db/row-lock.js';

type Client = Pick<Transaction, 'session' | 'sessionRemedy'>;

/** An enrollment's two parties, as its sessions copy them (ADR 0010). */
export interface EnrollmentParties {
  readonly studentUserId: string;
  readonly teacherUserId: string;
}

/**
 * The enrollment's parties from its own sessions' copies (ADR 0010; the note under T036, F7), with
 * no lock: every session of an enrollment carries the same two; null for an enrollment with none.
 */
export async function partiesOfEnrollment(
  tx: Client,
  enrollmentId: string,
): Promise<EnrollmentParties | null> {
  return tx.session.findFirst({
    where: { enrollmentId },
    orderBy: { id: 'asc' },
    select: { studentUserId: true, teacherUserId: true },
  });
}

/**
 * The sessions the case's suspension cancelled that are owed an offer (its `cancelled_by_admin`
 * events naming the case, C4; still `cancelled_by_admin`, no remedy yet), in id order. Bounded by
 * the case, over `session_events_case_id_idx`.
 */
export async function sessionsToOfferOf(tx: Client, caseId: string): Promise<string[]> {
  const rows = await tx.session.findMany({
    where: {
      deletedAt: null,
      status: 'cancelled_by_admin',
      remedy: { is: null },
      events: { some: { kind: 'cancelled_by_admin', caseId } },
    },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  return rows.map(({ id }) => id);
}

/** Locks the remedies of `sessionIds`, `FOR UPDATE`, in one call, id order (after the sessions). */
export async function lockRemediesOfSessions(
  tx: Transaction,
  sessionIds: readonly string[],
): Promise<void> {
  if (sessionIds.length === 0) return;
  const remedies = await tx.sessionRemedy.findMany({
    where: { sessionId: { in: [...sessionIds] } },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  await lockRows(
    tx,
    'session_remedies',
    remedies.map(({ id }) => id),
  );
}
