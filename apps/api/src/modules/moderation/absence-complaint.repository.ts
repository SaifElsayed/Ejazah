// T060 of specs/004-sessions/tasks.md (FR-452; research R-322, «The complaint»; data-model.md §2.7;
// ERD §15 rule 46): the `disputes` rows of `kind = absence_complaint`, each on the caller's
// transaction. Queries only: the rule (the caller the enrollment's student, the enrollment
// `confirmed`) is sessions' (`absence-complaint.service.ts` there), and the one-open rule is the
// database's (`disputes_one_open_complaint_per_enrollment_key`).
//
// No lock here: the raising holds the student's `users` row and the enrollment (kernel.md, the
// complaint row) before the insert, whose foreign keys reference the two. The read of the open
// complaint takes none: `enrollments.get` shows it, and the raising reads it in a new transaction
// after the one-open rule refused its insert, to name it in the refusal.
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { isUniqueViolation } from '../../platform/db/db-errors.js';

type Client = Pick<Transaction, 'dispute'>;

/**
 * Inserts the enrollment's open complaint, raised by the student with their text and no session;
 * its id, or null when the database refuses it because one is already open. Any other refusal is
 * thrown as it is. A null leaves the transaction aborted: the caller refuses and rolls it back.
 */
export async function insertAbsenceComplaint(
  tx: Client,
  enrollmentId: string,
  studentUserId: string,
  reason: string,
): Promise<string | null> {
  try {
    const { id } = await tx.dispute.create({
      data: {
        enrollmentId,
        raisedByUserId: studentUserId,
        reason,
        kind: 'absence_complaint',
        status: 'open',
      },
      select: { id: true },
    });
    return id;
  } catch (error: unknown) {
    if (isUniqueViolation(error, 'disputes_one_open_complaint_per_enrollment_key')) return null;
    throw error;
  }
}

/**
 * The enrollment's open complaint's id, or null for none, with no lock; at most one is open
 * (rule 46). Over `disputes_one_open_complaint_per_enrollment_key`.
 */
export async function openComplaintOf(tx: Client, enrollmentId: string): Promise<string | null> {
  const row = await tx.dispute.findFirst({
    where: { enrollmentId, kind: 'absence_complaint', status: 'open' },
    select: { id: true },
  });
  return row?.id ?? null;
}
