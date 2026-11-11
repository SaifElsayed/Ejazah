// T059 of specs/004-sessions/tasks.md (FR-472, FR-439; research R-308, R-323 GAP-3): the reads of a
// ruling's revision and an outcome's correction on sessions' own tables. The rules are
// `ruling-revision.ts`' and `outcome-correction.ts`'; the write is `admin-outcome.service.ts`'. No
// lock here: the caller holds the enrollment and the session.
import type { SessionStatus } from '@ijazah/contracts';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { RecordedOutcome } from './session-events.repository.js';

/** A session as a revision or a correction decides on it. */
export interface SessionToRevise {
  readonly id: string;
  readonly enrollmentId: string;
  readonly status: SessionStatus;
  readonly scheduledEndAt: Date;
  /** A `session_remedies` row exists for it. */
  readonly hasRemedy: boolean;
}

/** The session, with no lock; null when there is none (a soft-deleted one left out, T148). */
export async function sessionToRevise(
  tx: Pick<Transaction, 'session'>,
  sessionId: string,
): Promise<SessionToRevise | null> {
  const row = await tx.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      enrollmentId: true,
      status: true,
      scheduledEndAt: true,
      remedy: { select: { id: true } },
    },
  });
  if (row === null) return null;
  return {
    id: row.id,
    enrollmentId: row.enrollmentId,
    status: row.status,
    scheduledEndAt: row.scheduledEndAt,
    hasRemedy: row.remedy !== null,
  };
}

/** One revision of a ruling, from its `dispute_revised` row. */
export interface RulingRevision {
  readonly outcomeBefore: RecordedOutcome;
  readonly outcomeAfter: RecordedOutcome;
  readonly revisedAt: Date;
}

/**
 * The dispute's `dispute_revised` rows, oldest first, with no lock; over `session_events`'
 * `case_id` index, bounded by one ruling's revisions.
 */
export async function revisionsOf(
  tx: Pick<Transaction, 'sessionEvent'>,
  disputeId: string,
): Promise<readonly RulingRevision[]> {
  const rows = await tx.sessionEvent.findMany({
    where: { caseId: disputeId, kind: 'dispute_revised' },
    orderBy: { id: 'asc' },
    select: { outcomeBefore: true, outcomeAfter: true, occurredAt: true },
  });
  return rows.flatMap(({ outcomeBefore, outcomeAfter, occurredAt }) =>
    outcomeBefore === null || outcomeAfter === null
      ? []
      : [
          {
            outcomeBefore: outcomeBefore as RecordedOutcome,
            outcomeAfter: outcomeAfter as RecordedOutcome,
            revisedAt: occurredAt,
          },
        ],
  );
}
