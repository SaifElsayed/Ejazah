// T048 (R-210, ADR 0009 D2): each enrollment's `snapshot_duration_minutes`, the length a session's
// cached end adds to its start, for the time zone re-resolution job, which reads `sessions` through
// that module's entry and booking's rows through this one (R-API-6). On the caller's transaction,
// with no lock: the snapshot never changes after the enrollment is written. Over the primary key,
// bounded by `enrollmentIds`. A soft-deleted enrollment is left out by the client's extension (T148).
import type { Transaction } from '../../platform/db/prisma.repository.js';

/** Of `enrollmentIds`, each enrollment's session length in minutes; an absent one is left out. */
export async function sessionLengthsOf(
  tx: Pick<Transaction, 'enrollment'>,
  enrollmentIds: readonly string[],
): Promise<ReadonlyMap<string, number>> {
  if (enrollmentIds.length === 0) return new Map();
  const rows = await tx.enrollment.findMany({
    where: { id: { in: [...enrollmentIds] } },
    select: { id: true, snapshotDurationMinutes: true },
  });
  return new Map(rows.map(({ id, snapshotDurationMinutes }) => [id, snapshotDurationMinutes]));
}
