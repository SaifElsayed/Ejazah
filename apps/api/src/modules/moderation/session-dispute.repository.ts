// T026 of specs/004-sessions/tasks.md (FR-473, FR-474; research R-308; data-model.md §2.7): the
// `disputes` rows of `kind = session_dispute`, each on the caller's transaction. Queries only; the
// rule (the raiser, the session's state, the window) is sessions' (`dispute-raise.service.ts`), and
// the one-open rule is the database's (rule 46, `disputes_one_open_per_session_key`).
//
// No lock here: the caller holds the raiser's `users` row, the enrollment and the session (kernel.md,
// the «dispute raised» row) before the insert, whose foreign keys reference the three.
//
// T034: the administrator's resolution takes the dispute's own row lock here (`lockDispute`), last
// in the one order, after the caller's enrollments, sessions and remedies; the closing is one
// conditional update `WHERE status = 'open'`.
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { isUniqueViolation } from '../../platform/db/db-errors.js';
import { lockRows } from '../../platform/db/row-lock.js';

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

// ---------------------------------------------------------------------------------------------
// T034 of specs/004-sessions/tasks.md (FR-474, FR-475, FR-476, FR-422; research R-308;
// contracts/kernel.md, «evaluation, a review or dispute resolution» and the `party_*` row): the
// administrator's reads of a session dispute, its row lock and its one closing update.
// ---------------------------------------------------------------------------------------------

/** A session dispute's resolution (R-308); `enrollment_ended` is a complaint's only. */
export type SessionDisputeResolution =
  | 'upheld'
  | 're_marked'
  | 'no_show_recorded'
  | 'compensation_ordered'
  | 'party_suspended'
  | 'party_banned';

/** A session dispute as the administrator reads it. */
export interface SessionDisputeRow {
  readonly id: string;
  readonly enrollmentId: string;
  readonly sessionId: string;
  readonly raisedByUserId: string | null;
  readonly reason: string;
  readonly status: 'open' | 'resolved' | 'dismissed';
  readonly createdAt: Date;
  readonly resolution: SessionDisputeResolution | null;
  readonly resolutionNotes: string | null;
  readonly resolvedAt: Date | null;
}

interface SelectedDispute extends Omit<SessionDisputeRow, 'sessionId' | 'resolution'> {
  readonly sessionId: string | null;
  readonly resolution: SessionDisputeRow['resolution'] | 'enrollment_ended';
}

/** A selected row as a session dispute: its session set (rule 46) and no complaint's resolution. */
function disputeRowOf(row: SelectedDispute): SessionDisputeRow {
  if (row.sessionId === null || row.resolution === 'enrollment_ended') {
    throw new Error('moderation: a session dispute broke rule 46');
  }
  return { ...row, sessionId: row.sessionId, resolution: row.resolution };
}

/** The session dispute, with no lock; null when there is none of that kind. */
export async function sessionDisputeOf(
  tx: Client,
  disputeId: string,
): Promise<SessionDisputeRow | null> {
  const row = await tx.dispute.findFirst({
    where: { id: disputeId, kind: 'session_dispute' },
    select: {
      id: true,
      enrollmentId: true,
      sessionId: true,
      raisedByUserId: true,
      reason: true,
      status: true,
      createdAt: true,
      resolution: true,
      resolutionNotes: true,
      resolvedAt: true,
    },
  });
  return row === null ? null : disputeRowOf(row);
}

/**
 * A page of session disputes with no lock: the open ones oldest first after `after`, or the closed
 * ones newest first before `after`; at most `limit`. Over the primary key, filtered by kind and
 * status, which no index covers (R-DB-9: none added before a measured slow query).
 */
export async function sessionDisputesPage(
  tx: Client,
  group: 'open' | 'closed',
  after: string | undefined,
  limit: number,
): Promise<readonly SessionDisputeRow[]> {
  const open = group === 'open';
  const rows = await tx.dispute.findMany({
    where: {
      kind: 'session_dispute',
      status: open ? 'open' : { in: ['resolved', 'dismissed'] },
      ...(after === undefined ? {} : { id: open ? { gt: after } : { lt: after } }),
    },
    orderBy: { id: open ? 'asc' : 'desc' },
    take: limit,
    select: {
      id: true,
      enrollmentId: true,
      sessionId: true,
      raisedByUserId: true,
      reason: true,
      status: true,
      createdAt: true,
      resolution: true,
      resolutionNotes: true,
      resolvedAt: true,
    },
  });
  return rows.map(disputeRowOf);
}

/** Locks the dispute's row `FOR UPDATE` (kernel.md: `disputes` after the sessions and remedies). */
export async function lockDispute(tx: Transaction, disputeId: string): Promise<void> {
  await lockRows(tx, 'disputes', [disputeId]);
}

/** A session dispute's closing, as the administrator rules it (FR-422, FR-476). */
export interface SessionDisputeRuling {
  readonly disputeId: string;
  readonly resolution: SessionDisputeResolution;
  /** The administrator's mandatory reason, `resolution_notes`. */
  readonly notes: string;
  readonly adminId: string;
  /** The database's clock (`clockTimestamp`), read under the caller's locks. */
  readonly resolvedAt: Date;
}

/**
 * Closes the session dispute `resolved` where it is still open, writing the resolution, its notes,
 * the administrator and the instant in one conditional update; whether it moved the row.
 */
export async function closeSessionDispute(
  tx: Client,
  { disputeId, resolution, notes, adminId, resolvedAt }: SessionDisputeRuling,
): Promise<boolean> {
  const { count } = await tx.dispute.updateMany({
    where: { id: disputeId, kind: 'session_dispute', status: 'open' },
    data: {
      status: 'resolved',
      resolution,
      resolutionNotes: notes,
      resolvedByAdminId: adminId,
      resolvedAt,
    },
  });
  return count === 1;
}

/**
 * T059 of specs/004-sessions/tasks.md (FR-472, FR-439; research R-308, «A ruling's revision»): a
 * session's session disputes, open or closed, in id order (time-ordered, the oldest first), with no
 * lock; a revision and a correction read them under the session's lock, which a dispute's raising
 * takes before its insert. Over `disputes_session_id_idx`, bounded by one session's disputes.
 */
export async function sessionDisputesOfSession(
  tx: Client,
  sessionId: string,
): Promise<readonly SessionDisputeRow[]> {
  const rows = await tx.dispute.findMany({
    where: { sessionId, kind: 'session_dispute' },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      enrollmentId: true,
      sessionId: true,
      raisedByUserId: true,
      reason: true,
      status: true,
      createdAt: true,
      resolution: true,
      resolutionNotes: true,
      resolvedAt: true,
    },
  });
  return rows.map(disputeRowOf);
}
