// T026 (R-205, FR-394, FR-BOOK-10): the sessions module's reads that booking asks through this
// module's entry, so booking never reads the `sessions` table (R-API-6). Queries only, on the
// caller's transaction, and no lock. A soft-deleted session is left out by the client's extension
// (T148).
import { calendarDateOf, type LocalDate } from '@ijazah/time';

import type { Transaction } from '../../platform/db/prisma.repository.js';

/**
 * Of `enrollmentIds`, each enrollment's latest `scheduled_date_local`, its final session's requested
 * local date (ADR 0009 D1), in one grouped statement over `(enrollment_id, sequence_number)`'s
 * index. An enrollment with no session is absent.
 */
export async function lastSessionDateOf(
  tx: Pick<Transaction, 'session'>,
  enrollmentIds: readonly string[],
): Promise<ReadonlyMap<string, LocalDate>> {
  const dates = new Map<string, LocalDate>();
  if (enrollmentIds.length === 0) return dates;
  const groups = await tx.session.groupBy({
    by: ['enrollmentId'],
    where: { enrollmentId: { in: [...enrollmentIds] } },
    _max: { scheduledDateLocal: true },
  });
  for (const { enrollmentId, _max } of groups) {
    if (_max.scheduledDateLocal !== null) {
      dates.set(enrollmentId, calendarDateOf(_max.scheduledDateLocal));
    }
  }
  return dates;
}
