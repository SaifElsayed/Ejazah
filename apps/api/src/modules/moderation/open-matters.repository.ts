// T004 of specs/004-sessions/tasks.md (FR-487; SRS FR-AUTH-14 as amended; research R-327; the
// owner's decision of 2026-11-05): which enrollments have an open matter, a `disputes` row of any
// kind (a session dispute, a compensation case, a complaint) still `open`, so a deleted party's
// files wait for it to close. Booking asks it through this module's entry with its own
// enrollments (`heldFileOwnersAmong`), so neither module reads the other's table (R-API-6).
//
// One read over `disputes_enrollment_id_idx`, bounded by the ids asked, with no lock: the answer
// decides only whether files are removed now or by a later run of `erase-deleted-files`.
import type { Transaction } from '../../platform/db/prisma.repository.js';

/** Of `enrollmentIds`, those with an open `disputes` row of any kind. */
export async function enrollmentsWithOpenMatterAmong(
  tx: Pick<Transaction, 'dispute'>,
  enrollmentIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (enrollmentIds.length === 0) return new Set();
  const rows = await tx.dispute.findMany({
    where: { enrollmentId: { in: [...enrollmentIds] }, status: 'open' },
    distinct: ['enrollmentId'],
    select: { enrollmentId: true },
  });
  return new Set(rows.map(({ enrollmentId }) => enrollmentId));
}

/**
 * 005:T012 (FR-492, SRS FR-SESS-13; the note under T012, Q-R1 (a)): of `enrollmentIds`, those with
 * an open `user_reports` row, read through its `enrollment_id` (a session or chat report carries
 * it, `user_reports_context_check`; a profile report has none). One read over
 * `user_reports_enrollment_id_idx`, no lock. The chat purge's alone: booking's held files keep
 * `enrollmentsWithOpenMatterAmong`, since FR-AUTH-14 holds files for disputes, cases and complaints.
 */
export async function enrollmentsWithOpenReportAmong(
  tx: Pick<Transaction, 'userReport'>,
  enrollmentIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (enrollmentIds.length === 0) return new Set();
  const rows = await tx.userReport.findMany({
    where: { enrollmentId: { in: [...enrollmentIds] }, status: 'open' },
    distinct: ['enrollmentId'],
    select: { enrollmentId: true },
  });
  return new Set(rows.flatMap(({ enrollmentId }) => (enrollmentId === null ? [] : [enrollmentId])));
}
