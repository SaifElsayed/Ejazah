// T040 (FR-363, FR-364, ADR 0010 D7; R-215): what the two expiry sweeps read of booking's rows, each
// on the caller's transaction. Queries only, and no lock: a sweep finds the ids here, then hands
// them to `releaseHolds`, which locks the holds, their enrollments and their orders in T005's order
// and reads them again under the locks before it decides (T005's rule 1).
//
// A hold is active while `released_at` is NULL (ERD §15 rules 17–18), so "expired" is asked with the
// sweep's instant. Every read is a page in id order after the caller's cursor, at most `limit` rows:
// the active holds are bounded by the two partial unique indexes (one per slot and per student),
// which these reads' `released_at IS NULL` matches. A soft-deleted enrollment is left out by the
// client's extension (T148).
import type { Transaction } from '../../platform/db/prisma.repository.js';

type Client = Pick<Transaction, 'slotHold' | 'enrollment'>;

/** A page of the active holds expired at `at`, in id order after `after`. */
async function expiredHolds(
  tx: Client,
  at: Date,
  linked: { enrollmentId: null } | { enrollmentId: { not: null } },
  after: string | undefined,
  limit: number,
): Promise<readonly string[]> {
  const rows = await tx.slotHold.findMany({
    where: {
      releasedAt: null,
      expiresAt: { lte: at },
      ...linked,
      ...(after === undefined ? {} : { id: { gt: after } }),
    },
    orderBy: { id: 'asc' },
    take: limit,
    select: { id: true },
  });
  return rows.map(({ id }) => id);
}

/**
 * The ids of the active holds expired at `at` that carry no enrollment (a student in checkout who
 * never pressed Pay; `expire-holds`), in id order after `after`, at most `limit`.
 */
export function expiredCheckoutHoldIds(
  tx: Client,
  at: Date,
  after: string | undefined,
  limit: number,
): Promise<readonly string[]> {
  return expiredHolds(tx, at, { enrollmentId: null }, after, limit);
}

/**
 * The ids of the active holds expired at `at` that carry an enrollment (`expire-pending-payments`),
 * in id order after `after`, at most `limit`.
 */
export function expiredEnrollmentHoldIds(
  tx: Client,
  at: Date,
  after: string | undefined,
  limit: number,
): Promise<readonly string[]> {
  return expiredHolds(tx, at, { enrollmentId: { not: null } }, after, limit);
}

/**
 * Of `enrollmentIds`, those `confirm-enrollment` may still take: awaiting payment, or cancelled (a
 * late payment, FR-PAYG-19), in id order. Read with no lock: the job decides under its own.
 */
export async function awaitingConfirmationAmong(
  tx: Client,
  enrollmentIds: readonly string[],
): Promise<readonly string[]> {
  if (enrollmentIds.length === 0) return [];
  const rows = await tx.enrollment.findMany({
    where: { id: { in: [...enrollmentIds] }, status: { in: ['pending_payment', 'cancelled'] } },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  return rows.map(({ id }) => id);
}
