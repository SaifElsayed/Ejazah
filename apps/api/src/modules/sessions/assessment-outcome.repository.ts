// 006:T008 of specs/006-programme (FR-706a; R-505; Q-3 (a) amended, Q-8 (a)): the read of session
// 1's outcome chain, sessions' query (R-API-6), walked by `assessment-outcome.ts`. Read-only, no lock.
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { type AssessmentOutcome, assessmentOutcomeOf } from './assessment-outcome.js';

/**
 * The enrollment's session 1 and the make-ups, read with no lock over the `(enrollment_id,
 * sequence_number)` index, then walked. A soft-deleted session is left out.
 */
export async function assessmentOutcome(
  tx: Pick<Transaction, 'session'>,
  enrollmentId: string,
): Promise<AssessmentOutcome> {
  const rows = await tx.session.findMany({
    where: {
      enrollmentId,
      deletedAt: null,
      OR: [{ sequenceNumber: 1 }, { makeupForSessionId: { not: null } }],
    },
    orderBy: { sequenceNumber: 'asc' },
    select: {
      id: true,
      sequenceNumber: true,
      status: true,
      scheduledEndAt: true,
      makeupForSessionId: true,
      remedy: { select: { status: true } },
    },
  });
  return assessmentOutcomeOf(
    rows.map((row) => ({
      id: row.id,
      sequenceNumber: row.sequenceNumber,
      status: row.status,
      endsAt: row.scheduledEndAt,
      makeupForSessionId: row.makeupForSessionId,
      remedyStatus: row.remedy?.status ?? null,
    })),
  );
}
