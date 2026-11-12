// T058 of specs/004-sessions (FR-451, FR-481; the owner's decision Q7 (a) of 2026-11-12): the student
// of each of some enrollments, read from sessions' own rows (`sessions.student_user_id`, copied from
// the enrollment, ADR 0010), so the user directory names a marked enrollment's student without
// reading booking's table (R-API-6). One statement, bounded by the enrollments asked (one teacher's
// marked ones), over `(enrollment_id, sequence_number)`'s index; no index added (R-DB-9). A
// soft-deleted session is left out by the client's extension (T148). No lock, no write.
import type { Transaction } from '../../platform/db/prisma.repository.js';

/** Of `enrollmentIds`, each one's student, by enrollment id; one with no session is absent. */
export async function studentsOfEnrollments(
  tx: Pick<Transaction, 'session'>,
  enrollmentIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (enrollmentIds.length === 0) return new Map();
  const rows = await tx.session.findMany({
    where: { enrollmentId: { in: [...new Set(enrollmentIds)] } },
    distinct: ['enrollmentId'],
    select: { enrollmentId: true, studentUserId: true },
  });
  return new Map(rows.map(({ enrollmentId, studentUserId }) => [enrollmentId, studentUserId]));
}
