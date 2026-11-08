// T015 of specs/004-sessions/tasks.md (FR-447, FR-451, SC-404; research R-322; ADR 0023): the
// repeated-absence count's two grouped reads over the `sessions` table, sessions' own (R-API-6).
//
// The count is read when shown and never stored (R-DB-4): an enrollment's sessions whose `status` is
// `teacher_no_show`, since it began. Each session counts by its final status: a Both-No-Show, a
// Cancelled-By-Agreement session and an absence a dispute's resolution or a ruling's revision turned
// into another outcome have another status, and a session under dispute is `disputed` (its frozen
// `outcome_under_dispute` not read) and counts once it is resolved. A soft-deleted session is left
// out by the client's extension (T148). Nothing assumes every session of an enrollment was generated
// at once (FR-424): a make-up is a session of its enrollment like any other.
//
// No lock and no write: nothing is decided on the count, and no path reads it to change a session,
// an enrollment, an account or a remedy (FR-448, FR-451). No index is added (R-DB-9): the first
// read is bounded by the enrollments asked (a page), over `(enrollment_id, sequence_number)`'s
// index; the second by one teacher's sessions, over `sessions_teacher_user_id_idx` on the cached
// column of ADR 0010.
import type { Transaction } from '../../platform/db/prisma.repository.js';

type Client = Pick<Transaction, 'session'>;

/** An enrollment and its Teacher-No-Show count. */
export interface TeacherNoShowCount {
  readonly enrollmentId: string;
  readonly teacherNoShows: number;
}

/**
 * Of `enrollmentIds`, each one's count of `teacher_no_show` sessions, in one grouped statement; an
 * enrollment with none answers 0.
 */
export async function teacherNoShowCountsOf(
  tx: Client,
  enrollmentIds: readonly string[],
): Promise<ReadonlyMap<string, number>> {
  const counts = new Map<string, number>();
  if (enrollmentIds.length === 0) return counts;
  for (const enrollmentId of enrollmentIds) counts.set(enrollmentId, 0);
  const groups = await tx.session.groupBy({
    by: ['enrollmentId'],
    where: { enrollmentId: { in: [...new Set(enrollmentIds)] }, status: 'teacher_no_show' },
    _count: { _all: true },
  });
  for (const { enrollmentId, _count } of groups) counts.set(enrollmentId, _count._all);
  return counts;
}

/**
 * The teacher's enrollments with at least `atLeast` `teacher_no_show` sessions, with their counts,
 * by enrollment id, in one statement grouped over `sessions.teacher_user_id`.
 */
export async function teacherEnrollmentsWithNoShowsAtLeast(
  tx: Client,
  teacherUserId: string,
  atLeast: number,
): Promise<readonly TeacherNoShowCount[]> {
  const groups = await tx.session.groupBy({
    by: ['enrollmentId'],
    where: { teacherUserId, status: 'teacher_no_show' },
    _count: { _all: true },
    having: { enrollmentId: { _count: { gte: atLeast } } },
    orderBy: { enrollmentId: 'asc' },
  });
  return groups.map(({ enrollmentId, _count }) => ({
    enrollmentId,
    teacherNoShows: _count._all,
  }));
}
