// T006 of specs/005-certification (FR-603; research R-404; the note under T006, Q1 (a)): the
// enrollment an ijazah request is sent from, as the certification module reads it through booking's
// entry, on the caller's transaction with no lock of its own: its parties, its snapshot subject and
// track, and its status. A soft-deleted enrollment is absent (R-DB-3). The request takes the
// enrollment's lock itself (`lockRows`, the row its own references by a foreign key) and reads this
// again under it.
import type { Transaction } from '../../platform/db/prisma.repository.js';

type Client = Pick<Transaction, 'enrollment'>;

/** An enrollment as an ijazah request reads it. */
export interface IjazahEnrollmentRow {
  readonly id: string;
  readonly teacherUserId: string;
  readonly studentUserId: string;
  readonly subjectId: string;
  readonly track: 'recitation' | 'ijazah_track';
  readonly status:
    'pending_payment' | 'confirmed' | 'completed' | 'terminated_no_show' | 'cancelled';
}

/** The live enrollment of that id, or null. */
export async function ijazahEnrollmentOf(
  tx: Client,
  enrollmentId: string,
): Promise<IjazahEnrollmentRow | null> {
  const row = await tx.enrollment.findFirst({
    where: { id: enrollmentId, deletedAt: null },
    select: {
      id: true,
      teacherUserId: true,
      studentUserId: true,
      snapshotSubjectId: true,
      snapshotTrack: true,
      status: true,
    },
  });
  if (row === null) return null;
  return {
    id: row.id,
    teacherUserId: row.teacherUserId,
    studentUserId: row.studentUserId,
    subjectId: row.snapshotSubjectId,
    track: row.snapshotTrack,
    status: row.status,
  };
}
