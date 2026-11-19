// T035 of specs/004-sessions/tasks.md (FR-478; research R-312, R-313; contracts/admin-surface.md,
// `cases.get`'s `covers`): the reads of sessions' own tables that say which sessions a compensation
// case covers, each on the caller's transaction with no lock (nothing is decided on them: the
// administrator reads). Which parts a case's reason reads is `case-queue.service.ts`' rule; the
// case rows themselves are moderation's, read through its entry (R-API-6). A soft-deleted session is
// left out. Each read is bounded by one case or one enrollment, over `session_remedies_case_id_idx`,
// `session_events_case_id_idx` or `sessions_enrollment_id_idx`.
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { OWING_STATUSES } from './remedy-offer.repository.js';

type Client = Pick<Transaction, 'session' | 'sessionEvent' | 'sessionRemedy'>;

/** One session a case covers, with its remedy when it has one (no amount: FR-467). */
export interface CoveredSessionRow {
  readonly sessionId: string;
  readonly sequenceNumber: number;
  readonly status: string;
  readonly remedy: {
    readonly remedyId: string;
    readonly kind: 'makeup' | 'refund';
    readonly status: string;
  } | null;
}

function coveredRow(row: {
  readonly id: string;
  readonly sequenceNumber: number;
  readonly status: string;
  readonly remedy: { readonly id: string; readonly kind: 'makeup' | 'refund'; readonly status: string } | null;
}): CoveredSessionRow {
  return {
    sessionId: row.id,
    sequenceNumber: row.sequenceNumber,
    status: row.status,
    remedy:
      row.remedy === null
        ? null
        : { remedyId: row.remedy.id, kind: row.remedy.kind, status: row.remedy.status },
  };
}

/** The sessions whose remedy the case holds (`session_remedies.case_id`). */
export async function sessionsOfCaseRemedies(
  tx: Client,
  caseId: string,
): Promise<CoveredSessionRow[]> {
  const rows = await tx.session.findMany({
    where: { remedy: { caseId }, deletedAt: null },
    orderBy: { sequenceNumber: 'asc' },
    select: {
      id: true,
      sequenceNumber: true,
      status: true,
      remedy: { select: { id: true, kind: true, status: true } },
    },
  });
  return rows.map(coveredRow);
}

/** Which of the cancelled sessions a read keeps: the make-ups only, none of them, or any. */
export type MakeupFilter = 'only' | 'none' | 'any';

/**
 * The sessions whose `cancelled_by_admin` event names one of `caseIds` (C4), the make-ups
 * (`makeup_for_session_id` set) kept as `makeups` says.
 */
export async function sessionsCancelledByCases(
  tx: Client,
  caseIds: readonly string[],
  { makeups }: { readonly makeups: MakeupFilter },
): Promise<CoveredSessionRow[]> {
  if (caseIds.length === 0) return [];
  const rows = await tx.session.findMany({
    where: {
      deletedAt: null,
      events: { some: { kind: 'cancelled_by_admin', caseId: { in: [...caseIds] } } },
      ...(makeups === 'only' ? { makeupForSessionId: { not: null } } : {}),
      ...(makeups === 'none' ? { makeupForSessionId: null } : {}),
    },
    orderBy: { sequenceNumber: 'asc' },
    select: {
      id: true,
      sequenceNumber: true,
      status: true,
      remedy: { select: { id: true, kind: true, status: true } },
    },
  });
  return rows.map(coveredRow);
}

/**
 * The enrollment's sessions owed a remedy never offered (C1; the third analysis, I1):
 * `teacher_no_show`, `both_no_show`, `cancelled_by_agreement` or (003:T112) `postponed` with no
 * `session_remedies` row (`OWING_STATUSES`).
 */
export async function owedNeverOfferedOf(
  tx: Client,
  enrollmentId: string,
): Promise<CoveredSessionRow[]> {
  const rows = await tx.session.findMany({
    where: {
      enrollmentId,
      deletedAt: null,
      status: { in: [...OWING_STATUSES] },
      remedy: { is: null },
    },
    orderBy: { sequenceNumber: 'asc' },
    select: {
      id: true,
      sequenceNumber: true,
      status: true,
      remedy: { select: { id: true, kind: true, status: true } },
    },
  });
  return rows.map(coveredRow);
}
