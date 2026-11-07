// T008 of specs/004-sessions/tasks.md (research R-301, R-322, R-323 GAP-1; the third analysis, U3):
// booking's queries behind sessions' `EnrollmentSide` port (`enrollment-side.service.ts`), each on
// the caller's transaction. Queries only; a soft-deleted enrollment is left out by the client's
// extension (T148).
//
// No lock is taken here but by `lockRows`, the kernel's: the moves' conditional updates touch the
// one enrollment row the caller already holds (`EnrollmentSide.lockEnrollments`), and the reads
// (the enrollments, their events and the active holds of `slot_holds`) take none.
import type { $Enums } from '@prisma/client';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type {
  EnrollmentEventEntry,
  EnrollmentPageFilter,
  EnrollmentPageItem,
  EnrollmentTerms,
} from '../sessions/index.js';

type Client = Pick<Transaction, 'enrollment' | 'enrollmentEvent'>;

/** The enrollment's snapshot, slot and status; null when there is none. */
export async function enrollmentTermsById(
  tx: Client,
  id: string,
): Promise<EnrollmentTerms | null> {
  const row = await tx.enrollment.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      slotId: true,
      snapshotTrack: true,
      snapshotSlotTimezone: true,
      snapshotDurationMinutes: true,
      snapshotSessionCount: true,
    },
  });
  if (row === null) return null;
  return {
    id: row.id,
    status: row.status,
    slotId: row.slotId,
    track: row.snapshotTrack,
    timezone: row.snapshotSlotTimezone,
    durationMinutes: row.snapshotDurationMinutes,
    sessionCount: row.snapshotSessionCount,
  };
}

/** A move's source: one status, with the cancellation's reason when it is `cancelled`. */
export type MoveSource =
  | { readonly status: Exclude<$Enums.EnrollmentStatus, 'cancelled'> }
  | { readonly status: 'cancelled'; readonly cancellationReason: $Enums.CancellationReason };

/** A move's target: the status and the reason it then carries (null clears it). */
export interface MoveTarget {
  readonly status: $Enums.EnrollmentStatus;
  readonly cancellationReason: $Enums.CancellationReason | null;
}

/**
 * Moves the enrollment to `target` when it is in one of `from`, by one conditional update; answers
 * whether it moved. `confirmed_at` is never written (R-HONEST-1).
 */
export async function moveEnrollment(
  tx: Client,
  id: string,
  from: readonly MoveSource[],
  target: MoveTarget,
): Promise<boolean> {
  const { count } = await tx.enrollment.updateMany({
    where: {
      id,
      OR: from.map((source) =>
        source.status === 'cancelled'
          ? { status: source.status, cancellationReason: source.cancellationReason }
          : { status: source.status },
      ),
    },
    data: { status: target.status, cancellationReason: target.cancellationReason },
  });
  return count === 1;
}

/** The enrollment's `enrollment_events` rows, oldest first, the id breaking a tie; no payment. */
export async function enrollmentEventsOf(
  tx: Client,
  enrollmentId: string,
): Promise<EnrollmentEventEntry[]> {
  const rows = await tx.enrollmentEvent.findMany({
    where: { enrollmentId },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    select: { kind: true, cancellationReason: true, occurredAt: true },
  });
  return rows.map(({ kind, cancellationReason, occurredAt }) =>
    cancellationReason === null ? { kind, occurredAt } : { kind, cancellationReason, occurredAt },
  );
}

/**
 * Up to `take` enrollments matching `filter`, newest first by their time-ordered id, those before
 * `cursor` when it is given.
 */
export async function enrollmentsPage(
  tx: Client,
  filter: EnrollmentPageFilter,
  cursor: string | undefined,
  take: number,
): Promise<EnrollmentPageItem[]> {
  const ids = [
    ...(filter.enrollmentIds === undefined ? [] : [{ id: { in: [...filter.enrollmentIds] } }]),
    ...(cursor === undefined ? [] : [{ id: { lt: cursor } }]),
  ];
  const rows = await tx.enrollment.findMany({
    where: {
      AND: ids,
      ...(filter.status === undefined ? {} : { status: filter.status }),
      ...(filter.studentUserIds === undefined
        ? {}
        : { studentUserId: { in: [...filter.studentUserIds] } }),
      ...(filter.teacherUserIds === undefined
        ? {}
        : { teacherUserId: { in: [...filter.teacherUserIds] } }),
    },
    orderBy: { id: 'desc' },
    take,
    select: {
      id: true,
      studentUserId: true,
      teacherUserId: true,
      status: true,
      snapshotTrack: true,
      snapshotSessionCount: true,
    },
  });
  return rows.map((row) => ({
    enrollmentId: row.id,
    studentUserId: row.studentUserId,
    teacherUserId: row.teacherUserId,
    status: row.status,
    track: row.snapshotTrack,
    sessionCount: row.snapshotSessionCount,
  }));
}

/** An active hold as `heldTimesOf` reads it: its slot, its session count and its expiry. */
export interface ActiveHold {
  readonly slotId: string;
  readonly sessionCount: number;
  readonly expiresAt: Date;
}

/**
 * The active holds (`released_at` NULL, even past `expires_at`: `holds.repository.ts`' rule) of
 * `studentUserIds` or on `slotIds`, in id order; nothing asked for two empty lists. Bounded by the
 * two partial unique indexes: one active hold per student and one per slot.
 */
export async function activeHoldsAmong(
  tx: Pick<Transaction, 'slotHold'>,
  scope: { readonly studentUserIds: readonly string[]; readonly slotIds: readonly string[] },
): Promise<ActiveHold[]> {
  const either = [
    ...(scope.studentUserIds.length === 0
      ? []
      : [{ studentUserId: { in: [...scope.studentUserIds] } }]),
    ...(scope.slotIds.length === 0 ? [] : [{ slotId: { in: [...scope.slotIds] } }]),
  ];
  if (either.length === 0) return [];
  return tx.slotHold.findMany({
    where: { releasedAt: null, OR: either },
    orderBy: { id: 'asc' },
    select: { slotId: true, sessionCount: true, expiresAt: true },
  });
}

/** The kernel's row lock, for `EnrollmentSide.lockEnrollments` (T005). */
export { lockRows } from '../../platform/db/row-lock.js';
