// T052 (FR-400, research R-220): booking's queries for the admin's payments monitor, each on the
// caller's transaction. Read-only, no lock: the monitor decides nothing on what it reads and writes
// nothing (FR-401; T005's rule 1 binds the paths that decide). A soft-deleted enrollment is left out
// by the client's extension (T148), as from every ordinary read.
//
// Both reads are bounded: `enrollmentsAmong` by the ids of one page of orders, `outcomesOf` by one
// enrollment, whose outcomes are a confirmation, its failed orders and a cancellation (§14's plain
// index on `enrollment_events.enrollment_id`).
import type { EnrollmentStatus, PackageTrack } from '@ijazah/contracts';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { EnrollmentCancellationReason } from './enrollment-events.repository.js';

/** One enrollment as the monitor reads it: its parties, its state and its snapshot's package line. */
export interface OrderEnrollmentRow {
  readonly id: string;
  readonly studentUserId: string;
  readonly teacherUserId: string;
  readonly status: EnrollmentStatus;
  readonly cancellationReason: EnrollmentCancellationReason | null;
  readonly snapshotSubjectId: string;
  readonly snapshotTrack: PackageTrack;
  readonly snapshotSessionCount: number;
  readonly snapshotDurationMinutes: number;
}

/** One `enrollment_events` row as the monitor's timeline reads it. */
export interface OutcomeRow {
  readonly kind: (typeof OUTCOME_KINDS)[number];
  readonly cancellationReason: EnrollmentCancellationReason | null;
  /** The order a confirmation or a failure names; null for a cancellation. */
  readonly paymentId: string | null;
  readonly occurredAt: Date;
}

/** The enrollments of `ids`, in one statement over the primary key; an id with no row is absent. */
export function enrollmentsAmong(
  tx: Pick<Transaction, 'enrollment'>,
  ids: readonly string[],
): Promise<OrderEnrollmentRow[]> {
  if (ids.length === 0) return Promise.resolve([]);
  return tx.enrollment.findMany({
    where: { id: { in: [...ids] } },
    select: {
      id: true,
      studentUserId: true,
      teacherUserId: true,
      status: true,
      cancellationReason: true,
      snapshotSubjectId: true,
      snapshotTrack: true,
      snapshotSessionCount: true,
      snapshotDurationMinutes: true,
    },
  });
}

/**
 * The kinds the monitor's timeline shows (`enrollmentOutcomeKind`). Phase 3's `completed`,
 * `terminated_no_show` and `restored` (T001 of specs/004-sessions) are not among them until a task
 * widens the contract, so the read leaves them out rather than fail the output's parse.
 */
const OUTCOME_KINDS = ['confirmed', 'order_failed', 'cancelled'] as const;

function isOutcome<Row extends { readonly kind: string }>(
  row: Row,
): row is Row & { readonly kind: OutcomeRow['kind'] } {
  return (OUTCOME_KINDS as readonly string[]).includes(row.kind);
}

/** The enrollment's outcomes, oldest first, the id breaking a tie of one transaction's instant. */
export async function outcomesOf(
  tx: Pick<Transaction, 'enrollmentEvent'>,
  enrollmentId: string,
): Promise<OutcomeRow[]> {
  const rows = await tx.enrollmentEvent.findMany({
    where: { enrollmentId, kind: { in: [...OUTCOME_KINDS] } },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    select: { kind: true, cancellationReason: true, paymentId: true, occurredAt: true },
  });
  return rows.filter(isOutcome);
}
