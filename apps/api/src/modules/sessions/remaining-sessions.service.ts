// T004 of specs/004-sessions/tasks.md (`003:T059`, FR-AUTH-14's confirmed part; FR-420, FR-484,
// FR-485, FR-495; research R-312, R-313): what an enrollment's end does to its sessions and its
// remedies, the one hand-off every end uses (a student's deletion and a teacher's end here; a
// student's ban, T005; a confirmed fault, T036; a complaint's decision (a), T060).
//
// - Every remaining `scheduled` session is `cancelled_by_admin`, freeing both parties' time (ERD §15
//   rule 19 frees a cancelled session's range) with no no-show counted, one `cancelled_by_admin`
//   row each naming the case the caller opened or joined for its enrollment, or none (C4).
// - Every open remedy (`awaiting_choice`, `proposed`, `counter_proposed`, `frozen`) is handed to that
//   case (`refund_case`), one `remedy_handed_to_case` row each, so the rows ADR 0023 says remain and
//   FR-NOTIF-1's `makeup_handed_to_case` reads exist on every path (I1); where the caller opens no
//   case (a student's deletion) it lapses instead, nothing owed, one `remedy_lapsed` row each (C2).
//   A remedy already handed to a case keeps it.
//
// THE LOCKS (contracts/kernel.md, an account's end and the general rule). The caller holds the
// enrollments' rows, and before them every lock earlier in the one order it takes. This takes the
// sessions in one statement in id order, then the remedies, and reads each again under its lock
// (rule 1); only then asks `caseOf` for each enrollment, in id order, so a case the caller opens is
// opened after the sessions and the remedies, as the one order puts `disputes` after them, its own
// enrollment lock being the one already held. The rows written reference the enrollments, the
// sessions and the cases, all held or written by this transaction, and no account.
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { LockedTable } from '../../platform/db/row-lock.js';
import {
  cancelByAdmin,
  handToCase,
  lapse,
  lockRows,
  type OpenRemedy,
  openRemediesOf,
  type RemainingSession,
  scheduledSessionsOf,
} from './remaining-sessions.repository.js';
import { recordSessionEvents, type SessionEventRecord } from './session-events.repository.js';

/** What the hand-off reads and writes, each on the caller's transaction. */
export interface RemainingSessionsStore {
  scheduledSessionsOf(
    tx: Transaction,
    enrollmentIds: readonly string[],
  ): Promise<readonly RemainingSession[]>;
  openRemediesOf(tx: Transaction, enrollmentIds: readonly string[]): Promise<readonly OpenRemedy[]>;
  lockRows(tx: Transaction, table: LockedTable, ids: readonly string[]): Promise<void>;
  cancelByAdmin(tx: Transaction, ids: readonly string[]): Promise<void>;
  handToCase(tx: Transaction, ids: readonly string[], caseId: string, at: Date): Promise<void>;
  lapse(tx: Transaction, ids: readonly string[], at: Date): Promise<void>;
  recordEvents(tx: Transaction, events: readonly SessionEventRecord[]): Promise<void>;
}

const remainingSessionsStore: RemainingSessionsStore = {
  scheduledSessionsOf,
  openRemediesOf,
  lockRows,
  cancelByAdmin,
  handToCase,
  lapse,
  recordEvents: recordSessionEvents,
};

/**
 * The case the caller opened or joined for an enrollment, asked once per enrollment after the
 * sessions' and the remedies' locks; null where the end opens none (a student's deletion).
 */
export type CaseOf = (enrollmentId: string) => Promise<string | null>;

/** What an enrollment's end did. */
export interface EnrollmentsEnded {
  readonly cancelledSessionIds: readonly string[];
  readonly handedRemedyIds: readonly string[];
  readonly lapsedRemedyIds: readonly string[];
  /** Each enrollment's case, as `caseOf` answered it. */
  readonly caseOf: ReadonlyMap<string, string | null>;
}

const sortedUnique = (ids: readonly string[]): string[] => [...new Set(ids)].sort();

/** The rows of `fresh` among `locked`, in id order: what is still so once its lock is held. */
function stillAmong<Row extends { readonly id: string }>(
  fresh: readonly Row[],
  locked: readonly Row[],
): Row[] {
  const ids = new Set(locked.map(({ id }) => id));
  return fresh
    .filter(({ id }) => ids.has(id))
    .sort((one, other) => (one.id < other.id ? -1 : one.id > other.id ? 1 : 0));
}

/**
 * Cancels the remaining sessions of `enrollmentIds` and hands their open remedies to each one's case
 * (or lapses them where there is none), at `now`, on the caller's transaction, which holds the
 * enrollments' locks (this file's head).
 */
export async function cancelRemainingSessions(
  tx: Transaction,
  enrollmentIds: readonly string[],
  now: Date,
  caseOf: CaseOf,
  store: RemainingSessionsStore = remainingSessionsStore,
): Promise<EnrollmentsEnded> {
  const enrollments = sortedUnique(enrollmentIds);
  const cases = new Map<string, string | null>();
  if (enrollments.length === 0) {
    return { cancelledSessionIds: [], handedRemedyIds: [], lapsedRemedyIds: [], caseOf: cases };
  }
  const read = await store.scheduledSessionsOf(tx, enrollments);
  if (read.length > 0) await store.lockRows(tx, 'sessions', sortedUnique(read.map(({ id }) => id)));
  const sessions = stillAmong(await store.scheduledSessionsOf(tx, enrollments), read);
  const readRemedies = await store.openRemediesOf(tx, enrollments);
  if (readRemedies.length > 0) {
    await store.lockRows(tx, 'session_remedies', sortedUnique(readRemedies.map(({ id }) => id)));
  }
  const remedies = stillAmong(await store.openRemediesOf(tx, enrollments), readRemedies);

  for (const enrollmentId of enrollments) cases.set(enrollmentId, await caseOf(enrollmentId));
  const caseOfEnrollment = (enrollmentId: string) => cases.get(enrollmentId) ?? null;

  const cancelledSessionIds = sortedUnique(sessions.map(({ id }) => id));
  await store.cancelByAdmin(tx, cancelledSessionIds);
  const lapsed = remedies.filter(({ enrollmentId }) => caseOfEnrollment(enrollmentId) === null);
  const handed = remedies.filter(({ enrollmentId }) => caseOfEnrollment(enrollmentId) !== null);
  // Every handed remedy's enrollment has a case (the filter above); the narrowing only tells the
  // compiler so, with no branch that could never run (PR #127's CI, the follow-up under T004).
  const handedCaseIds = handed
    .map(({ enrollmentId }) => caseOfEnrollment(enrollmentId))
    .filter((caseId) => caseId !== null);
  for (const caseId of new Set(handedCaseIds)) {
    const ids = handed.filter(({ enrollmentId }) => caseOfEnrollment(enrollmentId) === caseId);
    await store.handToCase(tx, sortedUnique(ids.map(({ id }) => id)), caseId, now);
  }
  if (lapsed.length > 0) await store.lapse(tx, sortedUnique(lapsed.map(({ id }) => id)), now);

  const remedyEvent = (
    { enrollmentId, sessionId }: OpenRemedy,
    kind: 'remedy_handed_to_case' | 'remedy_lapsed',
  ): SessionEventRecord => ({ enrollmentId, sessionId, kind, occurredAt: now });
  await store.recordEvents(tx, [
    ...sessions.map(({ id, enrollmentId }): SessionEventRecord => ({
      enrollmentId,
      sessionId: id,
      kind: 'cancelled_by_admin',
      caseId: caseOfEnrollment(enrollmentId),
      occurredAt: now,
    })),
    ...handed.map((remedy) => remedyEvent(remedy, 'remedy_handed_to_case')),
    ...lapsed.map((remedy) => remedyEvent(remedy, 'remedy_lapsed')),
  ]);
  return {
    cancelledSessionIds,
    handedRemedyIds: sortedUnique(handed.map(({ id }) => id)),
    lapsedRemedyIds: sortedUnique(lapsed.map(({ id }) => id)),
    caseOf: cases,
  };
}
