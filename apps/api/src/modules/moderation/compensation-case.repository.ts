// T035 (FR-362, FR-375, FR-DISPUTE-5): the `disputes` rows of `kind = compensation_case` as the
// system opens them, each on the caller's transaction. Queries and the lock only; the rule, one open
// case per enrollment and reason, is `compensation-case.service.ts`'s.
//
// The lock is the kernel's (`platform/db/row-lock.ts`) on the case's enrollment: `disputes` has no
// unique index that keeps one open case per enrollment and reason, so two openings serialise on the
// row every case of that enrollment belongs to. It reads and writes no column of `enrollments`
// (booking's table, R-API-6); a case's insert references that row by its foreign key in any case.
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { lockRows } from '../../platform/db/row-lock.js';

type Client = Pick<Transaction, 'dispute'>;

/** Locks the enrollment's row, FOR UPDATE, until the transaction ends (T005). */
export function lockCasesOf(tx: Transaction, enrollmentId: string): Promise<void> {
  return lockRows(tx, 'enrollments', [enrollmentId]);
}

/** The enrollment's open compensation case of `reason`, the oldest if ever several; null if none. */
export async function openCaseOf(
  tx: Client,
  enrollmentId: string,
  reason: string,
): Promise<string | null> {
  const open = await tx.dispute.findFirst({
    where: { enrollmentId, kind: 'compensation_case', reason, status: 'open' },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  return open?.id ?? null;
}

/**
 * Inserts an open compensation case of the enrollment, raised by the system: no session, no raiser
 * (ERD §10, `raised_by_user_id` NULL when opened by the system). Its id.
 */
export async function insertCase(
  tx: Client,
  enrollmentId: string,
  reason: string,
): Promise<string> {
  const { id } = await tx.dispute.create({
    data: { enrollmentId, kind: 'compensation_case', reason, status: 'open' },
    select: { id: true },
  });
  return id;
}

/**
 * When the enrollment's latest compensation case was opened (`disputes.created_at`, the database's
 * clock), open or not, or null when it has none (T039; the note under T035). Read under the
 * enrollment's lock, which every opening takes, so no case is opened meanwhile.
 */
export async function latestCaseOpenedAt(tx: Client, enrollmentId: string): Promise<Date | null> {
  const latest = await tx.dispute.findFirst({
    where: { enrollmentId, kind: 'compensation_case' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  return latest?.createdAt ?? null;
}

/**
 * Of `enrollmentIds`, those with a compensation case, open or not (T040: the sweep hands a paid order
 * on only when its enrollment has none). Read with no lock: the confirm job decides under its own.
 */
export async function enrollmentsWithCompensationCase(
  tx: Client,
  enrollmentIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (enrollmentIds.length === 0) return new Set();
  const rows = await tx.dispute.findMany({
    where: { enrollmentId: { in: [...enrollmentIds] }, kind: 'compensation_case' },
    distinct: ['enrollmentId'],
    select: { enrollmentId: true },
  });
  return new Set(rows.map(({ enrollmentId }) => enrollmentId));
}
