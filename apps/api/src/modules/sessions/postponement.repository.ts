// 003:T112 (SRS §3.8.6, FR-POSTPONE-1 to FR-POSTPONE-5, DEC-86, DEC-90; ERD changelog row 59, §15
// rules 65 and 66): the postponement's reads and writes over sessions' own tables, each on the
// caller's transaction. The reads take no lock: the service locks the rows they name, in
// kernel.md's «a postponement» row, and reads them again under the locks. `session_postponements` is
// append-only (rule 65): a row is inserted and never updated or removed.
import type { SessionPostponement } from '@ijazah/contracts';

import type { Transaction } from '../../platform/db/prisma.repository.js';

type Client = Pick<Transaction, 'session' | 'sessionPostponement'>;

/** A session of the week, as the postponement decides on it. */
export interface WeekSession {
  readonly id: string;
  readonly startsAt: Date;
}

/** The instants a postponement covers: a session starting at or after `from`, at or before `to`. */
export interface PostponementWeek {
  readonly from: Date;
  readonly to: Date;
}

/**
 * When `userId` last asked to postpone on `enrollmentId`, else null (FR-POSTPONE-4, Q-3 (a): per party
 * per enrollment). Over the `enrollment_id` index, bounded by the enrollment's postponements.
 */
export async function lastPostponementAt(
  tx: Pick<Client, 'sessionPostponement'>,
  enrollmentId: string,
  userId: string,
): Promise<Date | null> {
  const found = await tx.sessionPostponement.findFirst({
    where: { enrollmentId, requestedByUserId: userId },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  return found?.createdAt ?? null;
}

/**
 * The enrollment's `scheduled` sessions, make-ups included, starting inside `week`, in id order; when
 * `among` is given, only those ids (the read again under the sessions' locks). Bounded by the
 * enrollment's sessions; no lock.
 */
export async function weekSessionsOf(
  tx: Pick<Client, 'session'>,
  enrollmentId: string,
  week: PostponementWeek,
  among?: readonly string[],
): Promise<readonly WeekSession[]> {
  const rows = await tx.session.findMany({
    where: {
      enrollmentId,
      status: 'scheduled',
      deletedAt: null,
      scheduledStartAt: { gte: week.from, lte: week.to },
      ...(among === undefined ? {} : { id: { in: [...among] } }),
    },
    orderBy: { id: 'asc' },
    select: { id: true, scheduledStartAt: true },
  });
  return rows.map(({ id, scheduledStartAt }) => ({ id, startsAt: scheduledStartAt }));
}

/** The request, its id. Its reason's bounds are rule 65's; the row is never changed after. */
export async function insertPostponement(
  tx: Pick<Client, 'sessionPostponement'>,
  row: {
    readonly enrollmentId: string;
    readonly requestedByUserId: string;
    readonly reason: string;
  },
): Promise<string> {
  const { id } = await tx.sessionPostponement.create({ data: row, select: { id: true } });
  return id;
}

/**
 * Moves `ids` that are still `scheduled` to `postponed`, naming the postponement (rule 66); how many
 * moved. The status frees both parties' time (rule 19 as amended).
 */
export async function postponeSessions(
  tx: Pick<Client, 'session'>,
  ids: readonly string[],
  postponementId: string,
): Promise<number> {
  const { count } = await tx.session.updateMany({
    where: { id: { in: [...ids] }, status: 'scheduled' },
    data: { status: 'postponed', postponementId },
  });
  return count;
}

/**
 * 003:T112 (FR-POSTPONE-5; the owner's Q-D (a)): the postponement that moved each of `sessionIds`, as
 * both parties read it: which party asked (the requester against the session's teacher), its reason
 * and when. A session no postponement moved is absent. One statement over the sessions' primary key
 * and the postponement's; no lock. Bounded by the ids the caller holds.
 */
export async function postponementsAmong(
  tx: Pick<Client, 'session'>,
  sessionIds: readonly string[],
): Promise<ReadonlyMap<string, SessionPostponement>> {
  if (sessionIds.length === 0) return new Map();
  const rows = await tx.session.findMany({
    where: { id: { in: [...sessionIds] }, postponementId: { not: null } },
    select: {
      id: true,
      teacherUserId: true,
      postponement: { select: { requestedByUserId: true, reason: true, createdAt: true } },
    },
  });
  return new Map(
    rows.flatMap(({ id, teacherUserId, postponement }) =>
      postponement === null
        ? []
        : [
            [
              id,
              {
                by: postponement.requestedByUserId === teacherUserId ? 'teacher' : 'student',
                reason: postponement.reason,
                at: postponement.createdAt.toISOString(),
              },
            ] as const,
          ],
    ),
  );
}
