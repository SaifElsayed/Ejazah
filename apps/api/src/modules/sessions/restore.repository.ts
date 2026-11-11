// T061 of specs/004-sessions/tasks.md (FR-454, FR-455; research R-322, «The restore», steps 4 and
// 6): the restore's reads of sessions' own tables, each on the caller's transaction. Queries only;
// the rules and the locks' order are `restore.service.ts`'. A soft-deleted session is left out by
// the client's extension (T148). Each read is bounded by one enrollment's sessions.
import type { Transaction } from '../../platform/db/prisma.repository.js';

type Client = Pick<Transaction, 'session'>;

/** One session of the enrollment as the restore counts and checks it, with its remedy. */
export interface RestoreSession {
  readonly id: string;
  readonly sequenceNumber: number;
  readonly status: string;
  readonly makeupForSessionId: string | null;
  /** The requested local date, a `date` column (ERD §5, ADR 0009 D1). */
  readonly scheduledDateLocal: Date;
  /** The requested local start, a `time` column. */
  readonly scheduledStartTimeLocal: Date;
  readonly timezone: string;
  readonly remedy: {
    readonly id: string;
    readonly status: string;
    readonly kind: 'makeup' | 'refund';
    readonly caseId: string | null;
  } | null;
}

/** Every session of the enrollment, make-ups included, by sequence number, with its remedy. */
export async function restoreSessionsOf(
  tx: Client,
  enrollmentId: string,
): Promise<readonly RestoreSession[]> {
  return tx.session.findMany({
    where: { enrollmentId },
    orderBy: { sequenceNumber: 'asc' },
    select: {
      id: true,
      sequenceNumber: true,
      status: true,
      makeupForSessionId: true,
      scheduledDateLocal: true,
      scheduledStartTimeLocal: true,
      timezone: true,
      remedy: { select: { id: true, status: true, kind: true, caseId: true } },
    },
  });
}

/** The ids of the enrollment's sessions numbered `from` and after, by sequence number. */
export async function sessionIdsFrom(
  tx: Client,
  enrollmentId: string,
  from: number,
): Promise<ReadonlyMap<number, string>> {
  const rows = await tx.session.findMany({
    where: { enrollmentId, sequenceNumber: { gte: from } },
    select: { id: true, sequenceNumber: true },
  });
  return new Map(rows.map(({ id, sequenceNumber }) => [sequenceNumber, id]));
}
