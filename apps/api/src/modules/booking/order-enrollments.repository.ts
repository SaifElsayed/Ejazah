// T052 (FR-400, research R-220): booking's queries for the admin's payments monitor, each on the
// caller's transaction. Read-only, no lock: the monitor decides nothing on what it reads and writes
// nothing (FR-401; T005's rule 1 binds the paths that decide). A soft-deleted enrollment is left out
// by the client's extension (T148), as from every ordinary read.
//
// Both reads are bounded: `enrollmentsAmong` by the ids of one page of orders, `outcomesOf` by one
// enrollment, whose outcomes are a confirmation, its failed orders, its cancellations, restores and
// its end (§14's plain index on `enrollment_events.enrollment_id`).
import type { EnrollmentStatus, PackageTrack } from '@ijazah/contracts';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type {
  EnrollmentCancellationReason,
  EnrollmentOutcome,
} from './enrollment-events.repository.js';

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
  readonly kind: EnrollmentOutcome['kind'];
  readonly cancellationReason: EnrollmentCancellationReason | null;
  /** The order a confirmation or a failure names; null for any other outcome. */
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
 * The enrollment's outcomes, every kind (`enrollmentOutcomeKind`, Phase 3's `completed`,
 * `terminated_no_show` and `restored` among them since B42's T047, the follow-up under T047), oldest
 * first, the id breaking a tie of one transaction's instant.
 */
export function outcomesOf(
  tx: Pick<Transaction, 'enrollmentEvent'>,
  enrollmentId: string,
): Promise<OutcomeRow[]> {
  return tx.enrollmentEvent.findMany({
    where: { enrollmentId },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    select: { kind: true, cancellationReason: true, paymentId: true, occurredAt: true },
  });
}

/**
 * One `slot_holds` row of an enrollment as the payments monitor's enrollment summary shows it (T024
 * of specs/004-sessions; research R-323 GAP-8): when it was placed and when it expires, and its
 * release with its reason, each null while not recorded (a hold released before `release_reason`
 * existed keeps NULL, read «not recorded»).
 */
export interface EnrollmentHoldRow {
  readonly id: string;
  readonly placedAt: Date;
  readonly expiresAt: Date;
  readonly releasedAt: Date | null;
  readonly releaseReason:
    | 'converted'
    | 'expired'
    | 'checkout_abandoned'
    | 'slot_unavailable'
    | 'admin'
    | 'teacher_suspended'
    | 'account_deleted'
    | null;
}

/**
 * The enrollment's holds (`slot_holds.enrollment_id`), oldest first by their time-ordered id, in one
 * statement over `slot_holds_enrollment_id_idx`. Bounded by one enrollment: a hold gains its
 * enrollment at Pay, and each Retry or late payment's new hold is one more.
 */
export async function holdsOfEnrollment(
  tx: Pick<Transaction, 'slotHold'>,
  enrollmentId: string,
): Promise<EnrollmentHoldRow[]> {
  const rows = await tx.slotHold.findMany({
    where: { enrollmentId },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      createdAt: true,
      expiresAt: true,
      releasedAt: true,
      releaseReason: true,
    },
  });
  return rows.map(({ id, createdAt, expiresAt, releasedAt, releaseReason }) => ({
    id,
    placedAt: createdAt,
    expiresAt,
    releasedAt,
    releaseReason,
  }));
}
