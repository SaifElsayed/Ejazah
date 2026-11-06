// T004 of specs/004-sessions/tasks.md (`003:T059`, FR-AUTH-14's confirmed part; R-313): booking's
// queries for an account's end on its confirmed enrollments, each on the termination's transaction.
// The rules (which enrollments, in which order, with which case) are `termination.subscriber.ts`'.
//
// The cancellation is conditional on the enrollment being still `confirmed`, as the subscriber read
// it under its lock; its `enrollment_events` row is `enrollment-events.repository.ts`' one writer's.
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { EnrollmentCancellationReason } from './enrollment-events.repository.js';

type Client = Pick<Transaction, 'enrollment' | 'slotHold'>;

/** A confirmed enrollment an account's end reaches: its id and its two parties. */
export interface ConfirmedEnrollment {
  readonly id: string;
  readonly studentUserId: string;
  readonly teacherUserId: string;
}

/**
 * The account's `confirmed` enrollments, as the student or as the teacher, in id order; a
 * soft-deleted one left out (T148). Over the two parties' plain indexes.
 */
export async function confirmedEnrollmentsOf(
  tx: Client,
  userId: string,
): Promise<ConfirmedEnrollment[]> {
  return tx.enrollment.findMany({
    where: {
      status: 'confirmed',
      OR: [{ studentUserId: userId }, { teacherUserId: userId }],
    },
    orderBy: { id: 'asc' },
    select: { id: true, studentUserId: true, teacherUserId: true },
  });
}

/** The enrollments the holds of `holdIds` were placed for, in id order; a hold before Pay has none. */
export async function holdEnrollmentIds(tx: Client, holdIds: readonly string[]): Promise<string[]> {
  if (holdIds.length === 0) return [];
  const rows = await tx.slotHold.findMany({
    where: { id: { in: [...holdIds] }, enrollmentId: { not: null } },
    select: { enrollmentId: true },
  });
  return [
    ...new Set(rows.flatMap(({ enrollmentId }) => (enrollmentId === null ? [] : [enrollmentId]))),
  ].sort();
}

/** Cancels those of `enrollmentIds` still `confirmed` with `reason`, by one conditional update. */
export async function cancelConfirmed(
  tx: Client,
  enrollmentIds: readonly string[],
  reason: EnrollmentCancellationReason,
): Promise<void> {
  if (enrollmentIds.length === 0) return;
  await tx.enrollment.updateMany({
    where: { id: { in: [...enrollmentIds] }, status: 'confirmed' },
    data: { status: 'cancelled', cancellationReason: reason },
  });
}

/** The kernel's row lock, for the holds and the enrollments an account's end decides on (T005). */
export { lockRows } from '../../platform/db/row-lock.js';
