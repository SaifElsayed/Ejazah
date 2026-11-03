// T036 (FR-BOOK-12, FR-354, FR-356; R-208): booking's queries for `payments`' checkout, each on the
// caller's transaction. Queries only; the rules and the locks' order are the services' (T005's rule
// 1: a row is locked before what is decided on it is read here again). A soft-deleted enrollment is
// left out by the client's extension (T148). Every read is bounded: one student's active hold (the
// partial unique index allows one), one enrollment, one hold by its id.
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { HeldRow } from './holds.repository.js';

type Client = Pick<Transaction, 'slotHold' | 'enrollment'>;

/** The student's active hold, expired or not, or null: at most one (ERD §15 rule 18). */
export function ownActiveHold(tx: Client, studentUserId: string): Promise<HeldRow | null> {
  return tx.slotHold.findFirst({
    where: { studentUserId, releasedAt: null },
    select: {
      id: true,
      slotId: true,
      studentUserId: true,
      enrollmentId: true,
      expiresAt: true,
    },
  });
}

/** The active hold linked to the enrollment, or null (ADR 0010 D2). */
export function activeHoldOfEnrollment(
  tx: Client,
  enrollmentId: string,
): Promise<HeldRow | null> {
  return tx.slotHold.findFirst({
    where: { enrollmentId, releasedAt: null },
    orderBy: { id: 'desc' },
    select: {
      id: true,
      slotId: true,
      studentUserId: true,
      enrollmentId: true,
      expiresAt: true,
    },
  });
}

/** An enrollment as the checkout reads it: its parties, slot, package, state and snapshot. */
export interface CheckoutEnrollmentRow {
  readonly id: string;
  readonly studentUserId: string;
  readonly teacherUserId: string;
  readonly packageId: string;
  readonly slotId: string;
  readonly status: 'pending_payment' | 'confirmed' | 'completed' | 'terminated_no_show' | 'cancelled';
  readonly cancellationReason: string | null;
  readonly snapshotPricePiasters: bigint;
  readonly snapshotSessionCount: number;
  readonly snapshotDurationMinutes: number;
  readonly snapshotSubjectId: string;
  readonly snapshotSlotTimezone: string;
  readonly snapshotTrack: 'recitation' | 'ijazah_track';
  readonly quotedFirstSessionLocalDate: Date;
}

/** The student's own enrollment of that id, or null for an unknown one and for another's (M3). */
export function studentEnrollment(
  tx: Client,
  enrollmentId: string,
  studentUserId: string,
): Promise<CheckoutEnrollmentRow | null> {
  return tx.enrollment.findFirst({
    where: { id: enrollmentId, studentUserId },
    select: {
      id: true,
      studentUserId: true,
      teacherUserId: true,
      packageId: true,
      slotId: true,
      status: true,
      cancellationReason: true,
      snapshotPricePiasters: true,
      snapshotSessionCount: true,
      snapshotDurationMinutes: true,
      snapshotSubjectId: true,
      snapshotSlotTimezone: true,
      snapshotTrack: true,
      quotedFirstSessionLocalDate: true,
    },
  });
}

/** The enrollment's status, read under its lock; null when it is gone. */
export async function enrollmentStatus(
  tx: Client,
  enrollmentId: string,
): Promise<CheckoutEnrollmentRow['status'] | null> {
  const row = await tx.enrollment.findUnique({
    where: { id: enrollmentId },
    select: { status: true },
  });
  return row?.status ?? null;
}
