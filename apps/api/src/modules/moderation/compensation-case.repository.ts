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
import { COVERING_REASONS } from './compensation-case.service.js';

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
 * An enrollment's compensation cases as the covering rule reads them (T082, `jobs/case-cover.ts`),
 * of Phase 2's three reasons only (`COVERING_REASONS`, T004 of specs/004-sessions), every instant
 * the database's clock: whether one of them is open, when the latest was opened
 * (`created_at`), and when the latest closed one was closed (`resolved_at`, for `resolved` and
 * `dismissed`; null when no closed case records it).
 */
export interface CaseInstants {
  readonly open: boolean;
  readonly lastOpenedAt: Date;
  readonly lastClosedAt: Date | null;
}

/** The later of two instants, either possibly absent. */
function later(one: Date | null, other: Date | null): Date | null {
  if (one === null) return other;
  if (other === null) return one;
  return other.getTime() > one.getTime() ? other : one;
}

/**
 * Of `enrollmentIds`, each one's compensation cases folded as `CaseInstants`; an enrollment with no
 * case is absent. One grouped read over `disputes_enrollment_id_idx`, at most a row per enrollment
 * and status. It takes no lock: the confirm job reads it under the enrollment's lock, which every
 * opening takes and Phase 3's closing will take (`compensation-case.service.ts`), and the
 * `expire-pending-payments` sweep reads it with none, the job deciding under its own (T040).
 */
export async function caseInstantsAmong(
  tx: Client,
  enrollmentIds: readonly string[],
): Promise<ReadonlyMap<string, CaseInstants>> {
  if (enrollmentIds.length === 0) return new Map();
  const rows = await tx.dispute.groupBy({
    by: ['enrollmentId', 'status'],
    where: {
      enrollmentId: { in: [...enrollmentIds] },
      kind: 'compensation_case',
      reason: { in: [...COVERING_REASONS] },
    },
    _max: { createdAt: true, resolvedAt: true },
  });
  const cases = new Map<string, CaseInstants>();
  for (const { enrollmentId, status, _max } of rows) {
    const openedAt = _max.createdAt;
    if (openedAt === null) continue;
    const isOpen = status === 'open';
    const seen = cases.get(enrollmentId);
    cases.set(enrollmentId, {
      open: isOpen || (seen?.open ?? false),
      lastOpenedAt: later(seen?.lastOpenedAt ?? null, openedAt) ?? openedAt,
      lastClosedAt: later(seen?.lastClosedAt ?? null, isOpen ? null : _max.resolvedAt),
    });
  }
  return cases;
}

/** The enrollment's compensation cases folded as `CaseInstants`, or null when it has none. */
export async function caseInstantsOf(
  tx: Client,
  enrollmentId: string,
): Promise<CaseInstants | null> {
  return (await caseInstantsAmong(tx, [enrollmentId])).get(enrollmentId) ?? null;
}
