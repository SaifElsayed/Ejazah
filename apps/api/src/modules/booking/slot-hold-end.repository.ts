// T074 of specs/004-sessions (FR-505; DEC-69; the note under T074, N1, Q-R4 (a)): the hourly sweep's
// reads of booking's tables, on the caller's transaction. Queries only, and no lock: the sweep locks
// each enrollment through the kernel (`lockRows`) before it reads it again and writes (T005's rule 1).
// A soft-deleted enrollment is left out by the client's extension (T148).
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { EnrollmentCancellationReason } from './enrollment-events.repository.js';

/** A held closing as the sweep judges it: its status, its last reason, its release. */
export interface HeldClosingRow {
  readonly id: string;
  readonly status:
    'pending_payment' | 'confirmed' | 'completed' | 'terminated_no_show' | 'cancelled';
  /** The last cancellation's reason while `cancelled`; null otherwise. */
  readonly cancellationReason: EnrollmentCancellationReason | null;
  /** `slot_released_at` (T070): the slot released by an administrator. */
  readonly slotReleasedAt: Date | null;
}

/**
 * Up to `limit` held closings in id order after `after`. The `where` is T069's partial index
 * predicate (`enrollments_held_closing_idx`) as `slotUses` writes it
 * (`slot-occupancy.repository.ts`, its held closings' read, without the slots), so the planner reads
 * the index (N1). It matches every held closing ever, after its hold too (Q11 (a), the note under
 * T074: accepted, re-checked at Phase 6's load pass).
 */
export function heldClosingsAfter(
  tx: Transaction,
  after: string | undefined,
  limit: number,
): Promise<HeldClosingRow[]> {
  return tx.enrollment.findMany({
    where: {
      confirmedAt: { not: null },
      slotReleasedAt: null,
      OR: [
        { status: 'terminated_no_show' },
        { status: 'cancelled', cancellationReason: { in: ['admin', 'teacher_suspended'] } },
      ],
      ...(after === undefined ? {} : { id: { gt: after } }),
    },
    orderBy: { id: 'asc' },
    take: limit,
    select: { id: true, status: true, cancellationReason: true, slotReleasedAt: true },
  });
}

/** The enrollment as the sweep reads it again under its lock; null when there is none. */
export function heldClosingOf(tx: Transaction, id: string): Promise<HeldClosingRow | null> {
  return tx.enrollment.findUnique({
    where: { id },
    select: { id: true, status: true, cancellationReason: true, slotReleasedAt: true },
  });
}

/** The rows that close an enrollment, and the one that records its hold's end. */
const CLOSING_KINDS = new Set(['cancelled', 'terminated_no_show']);

/**
 * Of `enrollmentIds`, those with a `slot_hold_ended` row after their latest closing row
 * (`cancelled` or `terminated_no_show`), so a restored and closed again enrollment has its hold's end
 * recorded again (Q-R4 (a)). One statement over `enrollment_events_enrollment_id_idx`, bounded by the
 * enrollments asked. The rows are taken in the order they were written: by id, the database's `uuidv7()`
 * at each insert, every one of them written under the enrollment's lock; never by `occurred_at`, which
 * mixes the process's clock (booking's subscriber) and the database's (the restore, this sweep).
 */
export async function holdEndsRecordedAmong(
  tx: Transaction,
  enrollmentIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (enrollmentIds.length === 0) return new Set();
  const rows = await tx.enrollmentEvent.findMany({
    where: {
      enrollmentId: { in: [...enrollmentIds] },
      kind: { in: ['cancelled', 'terminated_no_show', 'slot_hold_ended'] },
    },
    orderBy: { id: 'asc' },
    select: { enrollmentId: true, kind: true },
  });
  const recorded = new Map<string, boolean>();
  for (const { enrollmentId, kind } of rows) {
    // A closing row resets the enrollment's record; a hold's end after it sets it.
    recorded.set(enrollmentId, !CLOSING_KINDS.has(kind));
  }
  return new Set([...recorded].flatMap(([id, done]) => (done ? [id] : [])));
}
