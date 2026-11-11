// T033 of specs/004-sessions/tasks.md (FR-446, FR-450, FR-495; R-SESS-6; research R-308; the
// owner's decision of 2026-11-11 on B39's conflict check, the note «one writer of an
// administrator's outcome»): the one writer of a session's outcome an administrator decides. A
// review's resolution (T033), a dispute's resolution (T034), and a ruling's revision and an
// outcome's correction (T059) each write it here: `status` the outcome, `outcome_under_dispute`
// cleared (rule 40: NULL unless `disputed`), `settled_by_admin_id` and `admin_settled_at` together
// (rule 40), then the call's one `session_events` row through T004's writer.
//
// THE LOCKS (contracts/kernel.md, «evaluation, a review or dispute resolution» and the revision's
// and correction's rows). The caller holds the session's enrollment and then the session, each
// `FOR UPDATE`, and has read the session again under them; this takes none. The update is
// conditional on the status read under those locks, so a writer that skipped them would move
// nothing, which is thrown as the broken invariant it is, never answered as a success. The event
// references the enrollment and the session, both held, and no account.
//
// No remedy is offered and no count is read here: the remedy the outcome owes is offered by
// `advance-remedies` once the dispute window has closed and no dispute is open (A2), and nothing
// follows from a count (R-322). The completion check is the caller's, after this.
import type { SessionStatus } from '@ijazah/contracts';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import {
  type AdminSettledStatus,
  type AdminSettlement,
  settleByAdmin,
} from './admin-outcome.repository.js';

export type { AdminSettledStatus } from './admin-outcome.repository.js';
import {
  type RecordedOutcome,
  recordSessionEvents,
  type SessionEventRecord,
} from './session-events.repository.js';

/** The event an administrator's outcome writes, by the path that decided it. */
export type AdminOutcomeEvent =
  | { readonly kind: 'review_resolved' }
  | { readonly kind: 'dispute_resolved' }
  /** A ruling's revision (T059): the dispute revised, and the outcome it replaced. */
  | {
      readonly kind: 'dispute_revised';
      readonly disputeId: string;
      readonly outcomeBefore: RecordedOutcome;
    }
  /** A correction of an outcome nobody disputed (T059): the outcome it replaced. */
  | { readonly kind: 'outcome_corrected'; readonly outcomeBefore: RecordedOutcome };

const RECORDED: ReadonlySet<string> = new Set([
  'done',
  'student_no_show',
  'teacher_no_show',
  'both_no_show',
]);

/** The outcome a revision or a correction wrote, which is always one of the four (rule 43). */
function recordedOutcome(status: AdminSettledStatus): RecordedOutcome {
  if (!RECORDED.has(status)) throw new Error('sessions: a revision wrote a status under review');
  return status as RecordedOutcome;
}

/** One administrator's outcome, as the caller decided it under its locks. */
export interface AdminOutcomeWrite {
  readonly sessionId: string;
  readonly enrollmentId: string;
  /** The status read under the locks; the update moves the row only from it. */
  readonly from: SessionStatus;
  readonly outcome: AdminSettledStatus;
  readonly adminId: string;
  /** The database's instant (`clockTimestamp`), `admin_settled_at` and the event's. */
  readonly at: Date;
  readonly event: AdminOutcomeEvent;
}

/** What the writer writes, each on the caller's transaction. */
export interface AdminOutcomeStore {
  settleByAdmin(tx: Transaction, settlement: AdminSettlement): Promise<boolean>;
  recordEvents(tx: Transaction, events: readonly SessionEventRecord[]): Promise<void>;
}

export const adminOutcomeStore: AdminOutcomeStore = {
  settleByAdmin,
  recordEvents: recordSessionEvents,
};

/** The event's row, with the columns its kind sets (rule 43). */
function eventRecord(write: AdminOutcomeWrite): SessionEventRecord {
  const base = {
    enrollmentId: write.enrollmentId,
    sessionId: write.sessionId,
    occurredAt: write.at,
  };
  const { event } = write;
  switch (event.kind) {
    case 'review_resolved':
    case 'dispute_resolved':
      return { ...base, kind: event.kind };
    case 'dispute_revised':
      return {
        ...base,
        kind: event.kind,
        caseId: event.disputeId,
        outcomeBefore: event.outcomeBefore,
        outcomeAfter: recordedOutcome(write.outcome),
      };
    case 'outcome_corrected':
      return {
        ...base,
        kind: event.kind,
        outcomeBefore: event.outcomeBefore,
        outcomeAfter: recordedOutcome(write.outcome),
      };
  }
}

/**
 * Writes the administrator's outcome and its event on the caller's transaction, under its locks
 * (this file's head). Throws when the session is no longer in the status read under the locks.
 */
export async function writeAdminOutcome(
  tx: Transaction,
  write: AdminOutcomeWrite,
  store: AdminOutcomeStore = adminOutcomeStore,
): Promise<void> {
  // The row is built first, so an outcome its kind may not name is refused before any write.
  const event = eventRecord(write);
  const moved = await store.settleByAdmin(tx, {
    id: write.sessionId,
    from: write.from,
    outcome: write.outcome,
    adminId: write.adminId,
    at: write.at,
  });
  if (!moved) throw new Error('sessions: a locked session changed under its locks');
  await store.recordEvents(tx, [event]);
}
