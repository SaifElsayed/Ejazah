// T039 (R-215, FR-361, FR-362, FR-375, ADR 0010 D5): booking's queries for the confirm job, each on
// the caller's transaction. Queries only; the rules and the locks' order are
// `confirmation.service.ts`'s, which locks a row before it reads what it decides on here (T005's
// rule 1). A soft-deleted enrollment is left out by the client's extension (T148).
//
// `enrollments.confirmed_at` and `status = 'confirmed'` are written here by `markConfirmed` alone,
// called by `booking.confirmEnrollment` alone, called by the `confirm-enrollment` job alone
// (R-HONEST-1, FR-366).
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { EnrollmentCancellationReason } from './enrollment-events.repository.js';

type Client = Pick<Transaction, 'slotHold' | 'enrollment' | 'enrollmentEvent'>;

/** An enrollment's parties and slot: columns that never change once it is written. */
export interface EnrollmentParties {
  readonly id: string;
  readonly studentUserId: string;
  readonly teacherUserId: string;
  readonly slotId: string;
}

/** `enrollments.status` (ERD §5). */
export type EnrollmentStatus =
  'pending_payment' | 'confirmed' | 'completed' | 'terminated_no_show' | 'cancelled';

/** What the confirm job decides on, read under the enrollment's lock. */
export interface EnrollmentState {
  readonly status: EnrollmentStatus;
  readonly cancellationReason: EnrollmentCancellationReason | null;
  readonly snapshotSessionCount: number;
  readonly snapshotDurationMinutes: number;
  readonly snapshotSlotTimezone: string;
}

/** The enrollment's parties and slot, read with no lock; null when no live enrollment has the id. */
export async function partiesOf(
  tx: Pick<Transaction, 'enrollment'>,
  enrollmentId: string,
): Promise<EnrollmentParties | null> {
  const row = await tx.enrollment.findUnique({
    where: { id: enrollmentId },
    select: { id: true, studentUserId: true, teacherUserId: true, slotId: true },
  });
  return row;
}

/**
 * The ids of the active holds on the slot, of the student, or of the enrollment, in id order: at
 * most two, by the two partial unique indexes (ERD §15 rules 17–18), the enrollment's own active
 * hold being on its slot and of its student.
 */
export async function activeHoldIdsAround(
  tx: Client,
  parties: EnrollmentParties,
): Promise<readonly string[]> {
  const rows = await tx.slotHold.findMany({
    where: {
      releasedAt: null,
      OR: [
        { slotId: parties.slotId },
        { studentUserId: parties.studentUserId },
        { enrollmentId: parties.id },
      ],
    },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  return rows.map(({ id }) => id);
}

/** The enrollment's state; the caller holds its lock. */
export function enrollmentStateOf(tx: Client, enrollmentId: string): Promise<EnrollmentState> {
  return tx.enrollment.findUniqueOrThrow({
    where: { id: enrollmentId },
    select: {
      status: true,
      cancellationReason: true,
      snapshotSessionCount: true,
      snapshotDurationMinutes: true,
      snapshotSlotTimezone: true,
    },
  });
}

/** The order the enrollment's latest `confirmed` event names, or null when it has none (FR-375). */
export async function confirmingOrderOf(tx: Client, enrollmentId: string): Promise<string | null> {
  const row = await tx.enrollmentEvent.findFirst({
    where: { enrollmentId, kind: 'confirmed' },
    orderBy: { id: 'desc' },
    select: { paymentId: true },
  });
  return row?.paymentId ?? null;
}

/**
 * Converts the enrollment's active hold at `at`, by a conditional update (`released_at IS NULL`,
 * ADR 0010 D5), its release reason `converted` (T027 of specs/004-sessions, GAP-8; ERD §15 rule
 * 48); whether a hold was converted.
 */
export async function convertHoldOf(tx: Client, enrollmentId: string, at: Date): Promise<boolean> {
  const { count } = await tx.slotHold.updateMany({
    where: { enrollmentId, releasedAt: null },
    data: { releasedAt: at, releaseReason: 'converted' },
  });
  return count > 0;
}

/**
 * Confirms the enrollment at `at`, only from `pending_payment` or `cancelled`, its cancellation
 * reason back to NULL (ADR 0010 D5); whether it moved.
 */
export async function markConfirmed(tx: Client, enrollmentId: string, at: Date): Promise<boolean> {
  const { count } = await tx.enrollment.updateMany({
    where: { id: enrollmentId, status: { in: ['pending_payment', 'cancelled'] } },
    data: { status: 'confirmed', confirmedAt: at, cancellationReason: null },
  });
  return count === 1;
}

/**
 * Cancels the enrollment with `reason`, from `pending_payment` or `cancelled` (a refused paid
 * event, FR-362); whether it moved.
 */
export async function markRefused(
  tx: Client,
  enrollmentId: string,
  reason: EnrollmentCancellationReason,
): Promise<boolean> {
  const { count } = await tx.enrollment.updateMany({
    where: { id: enrollmentId, status: { in: ['pending_payment', 'cancelled'] } },
    data: { status: 'cancelled', cancellationReason: reason },
  });
  return count === 1;
}
