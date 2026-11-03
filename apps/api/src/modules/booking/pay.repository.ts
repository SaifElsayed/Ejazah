// T036 (FR-354, FR-386, R-209; ARCHITECTURE §8.1): booking's queries for `checkout.pay`, each on the
// caller's transaction. Queries only; `pay.service.ts` holds the rules and the locks' order. A
// soft-deleted enrollment is left out by the client's extension (T148).
import type { PackageTrack } from '@ijazah/contracts';
import { type Piasters, toPlainNumber } from '@ijazah/money';
import { dateColumnOf, type LocalDate } from '@ijazah/time';

import type { Transaction } from '../../platform/db/prisma.repository.js';

type Client = Pick<Transaction, 'slotHold' | 'enrollment'>;

/** A hold as Pay reads it: whose, on which slot, whether it is still open to Pay. */
export interface PayHoldRow {
  readonly id: string;
  readonly slotId: string;
  readonly studentUserId: string;
  /** The package the hold was placed for, and its session count then (the owner's decision of 2026-11-03). */
  readonly packageId: string;
  readonly sessionCount: number;
  readonly enrollmentId: string | null;
  readonly expiresAt: Date;
  readonly releasedAt: Date | null;
}

/** The student's own hold of that id, active or not, or null for an unknown one and another's (M3). */
export function studentHold(
  tx: Client,
  holdId: string,
  studentUserId: string,
): Promise<PayHoldRow | null> {
  return tx.slotHold.findFirst({
    where: { id: holdId, studentUserId },
    select: {
      id: true,
      slotId: true,
      studentUserId: true,
      packageId: true,
      sessionCount: true,
      enrollmentId: true,
      expiresAt: true,
      releasedAt: true,
    },
  });
}

/** The enrollment Pay writes, awaiting payment, with its full snapshot (FR-354, R-209). */
export interface NewEnrollment {
  readonly id: string;
  readonly studentUserId: string;
  readonly teacherUserId: string;
  readonly packageId: string;
  readonly slotId: string;
  readonly price_piasters: Piasters;
  readonly sessionCount: number;
  readonly sessionDurationMinutes: number;
  readonly subjectId: string;
  readonly track: PackageTrack;
  readonly slotTimezone: string;
  readonly purchasedAt: Date;
  /** The first session's local date the checkout showed, `YYYY-MM-DD` in the slot's zone. */
  readonly quotedFirstSessionLocalDate: LocalDate;
}

/** Writes the enrollment with the id the caller drew. */
export async function insertEnrollment(tx: Client, enrollment: NewEnrollment): Promise<void> {
  await tx.enrollment.create({
    data: {
      id: enrollment.id,
      studentUserId: enrollment.studentUserId,
      teacherUserId: enrollment.teacherUserId,
      packageId: enrollment.packageId,
      slotId: enrollment.slotId,
      snapshotPricePiasters: BigInt(toPlainNumber(enrollment.price_piasters)),
      snapshotSessionCount: enrollment.sessionCount,
      snapshotDurationMinutes: enrollment.sessionDurationMinutes,
      snapshotSubjectId: enrollment.subjectId,
      snapshotSlotTimezone: enrollment.slotTimezone,
      snapshotTrack: enrollment.track,
      status: 'pending_payment',
      purchasedAt: enrollment.purchasedAt,
      quotedFirstSessionLocalDate: dateColumnOf(enrollment.quotedFirstSessionLocalDate),
    },
    select: { id: true },
  });
}

/**
 * Links the hold to the enrollment by one conditional update, only while the hold is the
 * student's, active, unexpired at `at` and not yet linked (FR-354, ADR 0010 D2); true when it did.
 */
export async function linkActiveHold(
  tx: Client,
  hold: { readonly id: string; readonly studentUserId: string },
  enrollmentId: string,
  at: Date,
): Promise<boolean> {
  const { count } = await tx.slotHold.updateMany({
    where: {
      id: hold.id,
      studentUserId: hold.studentUserId,
      releasedAt: null,
      enrollmentId: null,
      expiresAt: { gt: at },
    },
    data: { enrollmentId },
  });
  return count === 1;
}
