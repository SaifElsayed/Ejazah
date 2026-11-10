// T026 of specs/004-sessions/tasks.md (FR-473, FR-474; research R-308; data-model.md §2.7): the
// `disputes` rows of `kind = session_dispute`, each on the caller's transaction. Queries only; the
// rule (the raiser, the session's state, the window) is sessions' (`dispute-raise.service.ts`), and
// the one-open rule is the database's (rule 46, `disputes_one_open_per_session_key`).
//
// No lock here: the caller holds the raiser's `users` row, the enrollment and the session (kernel.md,
// the «dispute raised» row) before the insert, whose foreign keys reference the three.
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { isUniqueViolation } from '../../platform/db/db-errors.js';

type Client = Pick<Transaction, 'dispute'>;

/** A session dispute as it is opened. */
export interface NewSessionDispute {
  readonly enrollmentId: string;
  readonly sessionId: string;
  readonly raisedByUserId: string;
  /** The participant's own text (ERD §10, `disputes.reason`). */
  readonly reason: string;
}

/**
 * Inserts the session's open dispute; its id, or null when the database refuses it because one is
 * already open (`disputes_one_open_per_session_key`). Any other refusal is thrown as it is. A null
 * leaves the transaction aborted: the caller refuses the call and rolls it back.
 */
export async function insertSessionDispute(
  tx: Client,
  dispute: NewSessionDispute,
): Promise<string | null> {
  try {
    const { id } = await tx.dispute.create({
      data: { ...dispute, kind: 'session_dispute', status: 'open' },
      select: { id: true },
    });
    return id;
  } catch (error: unknown) {
    if (isUniqueViolation(error, 'disputes_one_open_per_session_key')) return null;
    throw error;
  }
}

/** A session's latest session dispute, as the parties' screens read it (FR-495). */
export interface SessionDisputeState {
  readonly disputeId: string;
  readonly status: 'open' | 'resolved' | 'dismissed';
  readonly raisedByUserId: string | null;
}

/**
 * Of `sessionIds`, each session's latest session dispute (the greatest id, uuidv7), open or closed;
 * a session never disputed is absent. One read over `disputes_session_id_idx`, bounded by the ids
 * asked; no lock: nothing is decided on it.
 */
export async function latestSessionDisputesOf(
  tx: Client,
  sessionIds: readonly string[],
): Promise<ReadonlyMap<string, SessionDisputeState>> {
  const latest = new Map<string, SessionDisputeState>();
  if (sessionIds.length === 0) return latest;
  const rows = await tx.dispute.findMany({
    where: { sessionId: { in: [...new Set(sessionIds)] }, kind: 'session_dispute' },
    orderBy: [{ sessionId: 'asc' }, { id: 'desc' }],
    select: { id: true, sessionId: true, status: true, raisedByUserId: true },
  });
  for (const { id, sessionId, status, raisedByUserId } of rows) {
    if (sessionId === null || latest.has(sessionId)) continue;
    latest.set(sessionId, { disputeId: id, status, raisedByUserId });
  }
  return latest;
}
