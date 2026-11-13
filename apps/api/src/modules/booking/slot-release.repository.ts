// T070 of specs/004-sessions (FR-503; SRS FR-CANCEL-9): the release's reads and its one write of
// `enrollments`, on the caller's transaction. No lock is taken here: the service takes the kernel's
// locks in kernel.md's order before it reads the enrollment again and writes (T005's rule 1).
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { EnrollmentCancellationReason } from './enrollment-events.repository.js';

/** What the release reads of an enrollment: its slot and teacher, its closing and its release. */
export interface HeldEnrollment {
  readonly id: string;
  readonly teacherUserId: string;
  readonly slotId: string;
  readonly status:
    'pending_payment' | 'confirmed' | 'completed' | 'terminated_no_show' | 'cancelled';
  /** Set once a payment confirmed it (R-HONEST-1); a closing that can be held was confirmed. */
  readonly confirmedAt: Date | null;
  /** The last cancellation's reason while `cancelled`; null otherwise (a restore clears it). */
  readonly cancellationReason: EnrollmentCancellationReason | null;
  readonly slotReleasedAt: Date | null;
}

/** The enrollment, with no lock; null when there is none (a soft-deleted one left out, T148). */
export function heldEnrollmentOf(tx: Transaction, id: string): Promise<HeldEnrollment | null> {
  return tx.enrollment.findUnique({
    where: { id },
    select: {
      id: true,
      teacherUserId: true,
      slotId: true,
      status: true,
      confirmedAt: true,
      cancellationReason: true,
      slotReleasedAt: true,
    },
  });
}

/**
 * Writes `slot_released_at` once, `WHERE slot_released_at IS NULL`; whether it did. The caller holds
 * the enrollment's lock and read it again under it, so the condition only guards a second writer.
 */
export async function markSlotReleased(tx: Transaction, id: string, at: Date): Promise<boolean> {
  const { count } = await tx.enrollment.updateMany({
    where: { id, slotReleasedAt: null },
    data: { slotReleasedAt: at },
  });
  return count === 1;
}
