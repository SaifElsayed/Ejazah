// T061 of specs/004-sessions/tasks.md (FR-454, FR-455; research R-322, «The restore», steps 4 and
// 6): the restore's reads of sessions' own tables, each on the caller's transaction. Queries only;
// the rules and the locks' order are `restore.service.ts`'. A soft-deleted session is left out by
// the client's extension (T148). Each read is bounded by one enrollment's sessions.
//
// T073 (R-322, step 4): the cases the enrollment's `cancelled_by_admin` rows name, so the restore
// does not create again a session `sessions.cancel` cancelled with an `admin_cancellation` case.
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

/** T073: a `cancelled_by_admin` row of the enrollment, the case the cancelling action named. */
export interface CancellationCase {
  readonly sessionId: string;
  readonly caseId: string;
}

/**
 * T073 (R-322, step 4; the note under T073): each `cancelled_by_admin` row of the enrollment that
 * names a case (`session_events.case_id`, C4), by session; sessions' own table, the case's reason read
 * through moderation's entry by the caller. One statement over `session_events_enrollment_id_idx`,
 * bounded by the enrollment's sessions; read under the enrollment's and the sessions' locks, which
 * every cancellation takes before it writes its row.
 */
export async function cancellationCasesOf(
  tx: Pick<Transaction, 'sessionEvent'>,
  enrollmentId: string,
): Promise<readonly CancellationCase[]> {
  const rows = await tx.sessionEvent.findMany({
    where: {
      enrollmentId,
      kind: 'cancelled_by_admin',
      sessionId: { not: null },
      caseId: { not: null },
    },
    orderBy: { id: 'asc' },
    select: { sessionId: true, caseId: true },
  });
  return rows.flatMap(({ sessionId, caseId }) =>
    sessionId === null || caseId === null ? [] : [{ sessionId, caseId }],
  );
}
