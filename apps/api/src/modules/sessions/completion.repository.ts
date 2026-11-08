// T015 of specs/004-sessions/tasks.md (FR-449; research R-309): what an enrollment's completion
// reads of sessions' own tables (R-API-6): each of its sessions with its status, its scheduled end
// and its remedy's status, make-ups included. One read on the caller's transaction, with no lock:
// the caller holds the enrollment's row and, before it, every lock its settling path takes, so no
// session or remedy of the enrollment changes under the read (every writer of either takes the
// enrollment first: contracts/kernel.md's rows). A soft-deleted session is left out by the client's
// extension (T148). Bounded by the enrollment's sessions, over `(enrollment_id, sequence_number)`'s
// index and `session_remedies.session_id`'s unique one.
import type { SessionStatus } from '@ijazah/contracts';
import type { Prisma } from '@prisma/client';

import type { Transaction } from '../../platform/db/prisma.repository.js';

/** `session_remedies.status` (data-model.md §3, "Remedy"). */
export type RemedyStatus = Prisma.SessionRemedyCreateManyInput['status'];

/** One session of the enrollment as completion reads it. */
export interface CompletionSession {
  readonly status: SessionStatus;
  readonly scheduledEndAt: Date;
  /** Its remedy's status; absent while it has none. */
  readonly remedyStatus?: RemedyStatus;
}

/** Every session of the enrollment, make-ups included, each with its remedy's status. */
export async function completionSessionsOf(
  tx: Pick<Transaction, 'session'>,
  enrollmentId: string,
): Promise<readonly CompletionSession[]> {
  const rows = await tx.session.findMany({
    where: { enrollmentId },
    orderBy: { sequenceNumber: 'asc' },
    select: { status: true, scheduledEndAt: true, remedy: { select: { status: true } } },
  });
  return rows.map(({ status, scheduledEndAt, remedy }) => ({
    status,
    scheduledEndAt,
    ...(remedy === null ? {} : { remedyStatus: remedy.status }),
  }));
}
