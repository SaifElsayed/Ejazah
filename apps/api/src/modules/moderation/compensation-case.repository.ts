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

/** The enrollment a case of any kind belongs to, with no lock; null for no such row. */
export async function caseEnrollmentOf(tx: Client, caseId: string): Promise<string | null> {
  const row = await tx.dispute.findUnique({ where: { id: caseId }, select: { enrollmentId: true } });
  return row?.enrollmentId ?? null;
}

/** What closing a case writes, all in one statement (T035 of specs/004-sessions, FR-422). */
export interface CaseClosingWrite {
  readonly status: 'resolved' | 'dismissed';
  readonly resolution: 'compensation_ordered' | 'enrollment_ended' | 'party_suspended' | null;
  readonly note: string;
  readonly adminId: string;
  /** The database's clock, read under the enrollment's lock. */
  readonly resolvedAt: Date;
  /**
   * On a `student_suspended` case only (ERD §15 rule 49): the case that owes the sessions its
   * suspension cancelled, `covered_by_case_id` (the note under T036 of specs/004-sessions/tasks.md);
   * absent, NULL.
   */
  readonly coveredBy?: string;
}

/**
 * Closes the case if it is still `open`, writing `status`, `resolution`, `resolution_notes`,
 * `resolved_by_admin_id`, `resolved_at` and `covered_by_case_id` together in one conditional update; whether it moved
 * the row (false for a case no longer open).
 */
export async function closeOpenCase(
  tx: Client,
  caseId: string,
  write: CaseClosingWrite,
): Promise<boolean> {
  const { count } = await tx.dispute.updateMany({
    where: { id: caseId, status: 'open' },
    data: {
      status: write.status,
      resolution: write.resolution,
      resolutionNotes: write.note,
      resolvedByAdminId: write.adminId,
      resolvedAt: write.resolvedAt,
      coveredByCaseId: write.coveredBy ?? null,
    },
  });
  return count === 1;
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

/** One compensation case of an enrollment as the sessions monitor shows it (T024 of specs/004-sessions). */
export interface EnrollmentCase {
  readonly caseId: string;
  /** One of `COMPENSATION_REASONS`. */
  readonly reason: string;
  readonly status: 'open' | 'resolved' | 'dismissed';
  /** The opening, the database's instant: the restore window counts from it (R-322). */
  readonly createdAt: Date;
}

/**
 * The enrollment's compensation cases, newest first by their time-ordered id, with no lock (T024 of
 * specs/004-sessions, FR-479; R-API-6: sessions reads `disputes` through this entry). A complaint
 * (`absence_complaint`) and a session dispute are not cases and are left out. One statement over
 * `disputes_enrollment_id_idx`, bounded by one enrollment.
 */
export async function compensationCasesOf(
  tx: Client,
  enrollmentId: string,
): Promise<EnrollmentCase[]> {
  const rows = await tx.dispute.findMany({
    where: { enrollmentId, kind: 'compensation_case' },
    orderBy: { id: 'desc' },
    select: { id: true, reason: true, status: true, createdAt: true },
  });
  return rows.map(({ id, reason, status, createdAt }) => ({
    caseId: id,
    reason,
    status,
    createdAt,
  }));
}

/**
 * Of `sessionIds`, those with any session dispute, open, resolved or dismissed, with no lock (T024 of
 * specs/004-sessions, FR-439: an outcome ever disputed is not corrected, its ruling revised instead).
 * One statement over `disputes_session_id_idx`, bounded by the ids asked.
 */
export async function sessionsEverDisputedAmong(
  tx: Client,
  sessionIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (sessionIds.length === 0) return new Set();
  const rows = await tx.dispute.findMany({
    where: { sessionId: { in: [...sessionIds] }, kind: 'session_dispute' },
    distinct: ['sessionId'],
    select: { sessionId: true },
  });
  return new Set(rows.flatMap(({ sessionId }) => (sessionId === null ? [] : [sessionId])));
}

// T035 of specs/004-sessions (FR-478, FR-452; research R-312, R-313; admin-surface.md, `cases.*`):
// the reads of sessions' administrator queue, each on the caller's transaction with no lock.

/** One `disputes` row as `cases.get` and `cases.resolve`/`dismiss` read it. */
export interface CaseRecord {
  readonly caseId: string;
  readonly kind: 'session_dispute' | 'compensation_case' | 'absence_complaint';
  readonly enrollmentId: string;
  /** A compensation case's code (`COMPENSATION_REASONS`), or a complaint's text. */
  readonly reason: string;
  readonly status: 'open' | 'resolved' | 'dismissed';
  readonly resolution: string | null;
  readonly resolutionNotes: string | null;
  readonly createdAt: Date;
  readonly resolvedAt: Date | null;
}

/** A row of any kind by its id, with no lock; null for none. */
export async function caseRecordOf(tx: Client, caseId: string): Promise<CaseRecord | null> {
  const row = await tx.dispute.findUnique({
    where: { id: caseId },
    select: {
      id: true,
      kind: true,
      enrollmentId: true,
      reason: true,
      status: true,
      resolution: true,
      resolutionNotes: true,
      createdAt: true,
      resolvedAt: true,
    },
  });
  if (row === null) return null;
  const { id, ...rest } = row;
  return { caseId: id, ...rest };
}

/**
 * Where a page of the queue starts: after `caseId` in its part, `first` (the open
 * `student_suspended` cases) or the rest.
 */
export interface CaseQueuePosition {
  readonly first: boolean;
  readonly caseId: string;
}

export interface CaseQueueQuery {
  readonly status?: 'open' | 'resolved' | 'dismissed';
  readonly after?: CaseQueuePosition;
  readonly limit: number;
}

/** One row of the queue: a compensation case or a complaint, and the part it is listed in. */
export interface CaseQueueRow {
  readonly caseId: string;
  readonly kind: 'compensation_case' | 'absence_complaint';
  readonly enrollmentId: string;
  readonly reason: string;
  readonly status: 'open' | 'resolved' | 'dismissed';
  readonly createdAt: Date;
  readonly resolvedAt: Date | null;
  readonly first: boolean;
}

export interface CaseQueuePage {
  readonly rows: readonly CaseQueueRow[];
  /** The last row's position, present while more rows follow it. */
  readonly next?: CaseQueuePosition;
}

/** The queue's first part: a suspended student's open case, settled fast (R-312). */
const FIRST_PART = {
  kind: 'compensation_case',
  reason: 'student_suspended',
  status: 'open',
} as const;

/**
 * A page of `limit` rows of the queue (admin-surface.md, `cases.list`): every compensation case,
 * Phase 2's reasons included, and every complaint (`absence_complaint`), of `status` when given; the
 * open `student_suspended` cases first, then the rest, each part by its time-ordered id (its
 * opening, the owner's decision of 2026-11-05 on the analysis), after `after`. At most two reads of
 * `limit` + 1 rows each, keyed on the primary key (no index covers the order; measured in Phase 6,
 * as the conflict check notes). A session dispute is `disputes.*`' and never listed here.
 */
export async function caseQueuePage(tx: Client, query: CaseQueueQuery): Promise<CaseQueuePage> {
  const { status, after, limit } = query;
  const readsFirst = (status === undefined || status === 'open') && (after?.first ?? true);
  const firstRows = readsFirst
    ? await tx.dispute.findMany({
        where: { ...FIRST_PART, ...(after === undefined ? {} : { id: { gt: after.caseId } }) },
        orderBy: { id: 'asc' },
        take: limit + 1,
        select: {
          id: true,
          kind: true,
          enrollmentId: true,
          reason: true,
          status: true,
          createdAt: true,
          resolvedAt: true,
        },
      })
    : [];
  const restRows =
    firstRows.length > limit
      ? []
      : await tx.dispute.findMany({
          where: {
            kind: { in: ['compensation_case', 'absence_complaint'] },
            ...(status === undefined ? {} : { status }),
            NOT: FIRST_PART,
            ...(after === undefined || after.first ? {} : { id: { gt: after.caseId } }),
          },
          orderBy: { id: 'asc' },
          take: limit + 1 - firstRows.length,
          select: {
            id: true,
            kind: true,
            enrollmentId: true,
            reason: true,
            status: true,
            createdAt: true,
            resolvedAt: true,
          },
        });
  const rows = [
    ...firstRows.map((row) => ({ row, first: true })),
    ...restRows.map((row) => ({ row, first: false })),
  ].flatMap(({ row: { id, kind, ...rest }, first }) =>
    kind === 'session_dispute' ? [] : [{ caseId: id, kind, ...rest, first }],
  );
  const shown = rows.slice(0, limit);
  const last = shown.at(-1);
  return rows.length > limit && last !== undefined
    ? { rows: shown, next: { first: last.first, caseId: last.caseId } }
    : { rows: shown };
}

/** A closed `student_suspended` case whose sessions another case owes. */
export interface SuspensionCase {
  readonly caseId: string;
  readonly status: 'open' | 'resolved' | 'dismissed';
}

/**
 * The `student_suspended` cases whose `covered_by_case_id` names `caseId` (ERD §15 rule 49), oldest
 * first, with no lock: what `cases.get`'s `covers` reads for a confirmed fault (U1) and an
 * enrollment's end (U2). The cases are linked by id, so no instant is compared (the note under
 * T036 of specs/004-sessions/tasks.md, the owner's decision (c) on PR #133's Major 1). Over
 * `disputes_covered_by_case_id_idx`.
 */
export async function suspensionCasesCoveredBy(
  tx: Client,
  caseId: string,
): Promise<SuspensionCase[]> {
  const rows = await tx.dispute.findMany({
    where: { coveredByCaseId: caseId, kind: 'compensation_case', reason: 'student_suspended' },
    orderBy: { id: 'asc' },
    select: { id: true, status: true },
  });
  return rows.map(({ id, status }) => ({ caseId: id, status }));
}

/**
 * The enrollment's latest compensation case of one of `reasons`, null for none, with no lock: the
 * caller holds the enrollment's, which every opening takes (`lockCasesOf`). Ids are uuidv7 from the
 * database, so the latest is the last opened. Over `disputes_enrollment_id_idx`.
 */
export async function latestCaseOf(
  tx: Client,
  enrollmentId: string,
  reasons: readonly string[],
): Promise<string | null> {
  const row = await tx.dispute.findFirst({
    where: { enrollmentId, kind: 'compensation_case', reason: { in: [...reasons] } },
    orderBy: { id: 'desc' },
    select: { id: true },
  });
  return row?.id ?? null;
}
