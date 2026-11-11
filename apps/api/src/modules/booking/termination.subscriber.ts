// T041 (R-219; SRS FR-PAYG-6 and FR-BOOK-9 as amended 2026-11-01 and 2026-11-03, FR-VERIFY-8,
// FR-AUTH-14; FR-362): booking's consequence of an account's end, subscribed to identity's one
// registry (`AccountConsequences`, R-121) by `main.ts`. Identity's suspension, ban and revocation
// (`StandingService`) and its deletion (`DeletionService`) call the registry inside their own
// transaction, so what this does commits or rolls back with the action.
//
// WHAT IT RELEASES. The active holds on the account's slots, as a teacher's, with `teacher_suspended`
// (a suspension, a ban or a revocation) or `account_deleted`; and the account's own active hold, as a
// student's, with `admin` (a suspension or a ban) or `account_deleted`. An account is a student or a
// teacher (ADR 0016), so at most one of the two finds a hold. The release is booking's one release,
// `releaseHolds` (FR-363): each hold released, its enrollment awaiting payment cancelled with the
// reason and one `enrollment_events` row; an enrollment with a `paid` order stays awaiting payment,
// with no row, for `confirm-enrollment` (FR-PAYG-6 as amended 2026-11-03). Those reasons are the ones
// the confirm job's step 4 reads (`cancelledByTermination`): a paid event after them takes the
// refusal branch, the enrollment stays cancelled and one compensation case is opened (FR-362). A
// payout change is not a termination and never reaches here (FR-PAYG-16).
//
// A DELETION'S CONFIRMED ENROLLMENTS (T004 of specs/004-sessions, `003:T059`, FR-AUTH-14's
// confirmed part; R-313). On `account_deleted` the account's `confirmed` enrollments end too, in the
// deletion's transaction: their remaining sessions `cancelled_by_admin` and their open remedies
// handed over through sessions' `cancelRemainingSessions`, each enrollment `cancelled`
// `account_deleted` with one `enrollment_events` row. A teacher's deletion opens one `teacher_ended`
// compensation case per enrollment (moderation's `openCompensationCase`), which its sessions' rows
// name and its open remedies are handed to; a student's opens none, so the rows name none and the
// open remedies lapse.
//
// A STUDENT'S SUSPENSION AND BAN (T005 of specs/004-sessions, `002:T144`; FR-485, FR-486; R-313;
// plan.md decision 1). The student's confirmed enrollments (an account is a student or a teacher,
// ADR 0016, so the enrollments whose student it is tell it) are reached in the action's transaction,
// in the deletion's order. A suspension cancels every upcoming session, one in its join period
// included (the owner's decision of 2026-11-07, item 5), through `cancelRemainingSessions` with
// `remedies: 'lockOnly'`, opens one `student_suspended` case per enrollment, which those sessions'
// rows name, then freezes the enrollments' open remedies through sessions' `freezeOpenRemedies`;
// each enrollment stays `confirmed` and keeps its slot. A ban cancels the upcoming sessions and
// hands the open remedies (`frozen` included) to one `student_banned` case per enrollment, nothing
// owed, then cancels the enrollments `admin` at once with one `enrollment_events` row each.
//
// A TEACHER'S END (T006 of specs/004-sessions; FR-482, FR-483, FR-485; R-313). A teacher's
// suspension, revocation and ban end the teacher's confirmed enrollments as the teacher's deletion
// does, in the same order: every remaining session `cancelled_by_admin` through
// `cancelRemainingSessions`, one inside its join period included (the room's end is T014's), one
// `teacher_ended` case per enrollment, which those sessions' rows name and every open remedy
// (`frozen` included, data-model.md §3) is handed to, then each enrollment `cancelled`
// `teacher_suspended` with one `enrollment_events` row. A ban and a revocation hold the
// application's `teacher_profiles` row too, taken after the account and before the slots' key.
//
// THE LOG LINE (the note under T005). Each call writes one info line, «Account end decided», with
// the account's id, the cause and counts only: `{ userId, cause, enrollments, cancelledSessions,
// frozenRemedies, handedRemedies, lapsedRemedies, cases }` (the lapsed count added by the owner's
// decision of 2026-11-07), zero counts included when the call decides on no confirmed enrollment.
//
// THE LOCKS (T005's rules, `platform/db/row-lock.ts`). The caller holds the account's `users` row:
// the standing actions lock it first (`lockAccount`, then `lockApplication` for a ban and a
// revocation); the deletion holds it by its conditional update of the row, which waits on, and is
// waited on by, every `lockRows(tx, 'users', …)`. Every insert of a hold (`placeHold`, FR-PAYG-19's
// re-hold) locks that account first and then reads the account's standing again, so no hold of the
// account appears after this reads them. After the account: the teacher's slots' key
// (`lockKey('teacher-slots', …)`, the slot's place in rule 2; a slot's create and reactivate take it
// after the account too, T019), then the slots and the holds read, then the release, which locks the
// holds, their enrollments and (through payments' `orderStandingsOf`, handed in by `main.ts`, R-208)
// their orders, each table's rows in id order in one statement. A deletion with confirmed
// enrollments (contracts/kernel.md, an account's end) takes the slots' key of every teacher
// concerned in ascending id (a student's teachers, L1), then the holds, then every enrollment it
// decides on, the holds' and the confirmed ones, in one statement, then sessions' hand-off (the
// sessions, the remedies, then the cases), and only then the release, whose holds and enrollments
// are already held, so its orders come last, as the one order puts `payments`. Rule 2's last
// clause: this writes no row that references an account. A hold's release and an enrollment's
// cancellation update columns that are no foreign key, and the `enrollment_events` row references
// only its enrollment, locked by the release or before the hand-off; a case and a `session_events`
// row reference no account; the students of an ended teacher are not locked, and nothing
// referencing them is written. They are told after the commit, from those rows (FR-385).
//
// THE LIVE EVENTS (T066 of specs/004-sessions; FR-427; research R-324, item 6; the note under T066,
// Q3 (a)). Each confirmed enrollment the end decided on (its sessions cancelled, the enrollment
// cancelled or, for a student's suspension, kept) tells its other party: `enrollment`, addressed
// from the rows read under the enrollments' lock, added to the after-commit list the action bound
// to its transaction (`publisherOn`): the administrator kind's for a standing action, the
// deletion's own for a deletion. Sent once the action commits, nothing on a rollback; the person
// whose account ended is told by their own `account` event. A transaction no action bound adds
// nothing. No read is added and no lock taken for it.
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { LockedTable } from '../../platform/db/row-lock.js';
import { publisherOn } from '../../platform/live/live-publisher.js';
import type { Logger } from '../../platform/logging/logger.js';
import { lockTeacherSlots, teacherSlotsOf } from '../catalog/index.js';
import type { AccountConsequence, TerminationCause } from '../identity/index.js';
import { type CompensationReason, openCompensationCase } from '../moderation/index.js';
import {
  type CaseOf,
  cancelRemainingSessions,
  type EnrollmentsEnded,
  freezeOpenRemedies,
  type RemainingSessionsOptions,
  type RemediesFrozen,
} from '../sessions/index.js';
import {
  type EnrollmentCancellationReason,
  type EnrollmentOutcome,
  recordEnrollmentEvents,
} from './enrollment-events.repository.js';
import { type ActiveHoldScope, activeHoldIds } from './holds.repository.js';
import {
  type OrderStandings,
  type ReleaseDependencies,
  type ReleasedHolds,
  releaseHolds,
  type ReleaseReason,
} from './holds.service.js';
import {
  cancelConfirmed,
  type ConfirmedEnrollment,
  confirmedEnrollmentsOf,
  holdEnrollmentIds,
  lockRows,
} from './termination.repository.js';

export type { ActiveHoldScope, ConfirmedEnrollment };

/** The cases an account's end opens on the enrollments it reaches (R-313). */
export type EndCaseReason = Extract<
  CompensationReason,
  'teacher_ended' | 'student_suspended' | 'student_banned'
>;

/** What the subscriber reads and writes, each on the termination's transaction. */
export interface TerminationStore {
  /** Takes the teacher's slots' advisory lock until the transaction ends (catalog's, R-206). */
  lockTeacherSlots(tx: Transaction, teacherUserId: string): Promise<void>;
  /** Every slot of the teacher, active or not (catalog's). */
  teacherSlotIds(tx: Transaction, teacherUserId: string): Promise<readonly string[]>;
  /** The scope's active holds, in id order, with no lock. */
  activeHoldIds(tx: Transaction, scope: ActiveHoldScope): Promise<readonly string[]>;
  /** Booking's one release (`releaseHolds`, FR-363). */
  release(
    tx: Transaction,
    holdIds: readonly string[],
    reason: ReleaseReason,
    dependencies: ReleaseDependencies,
  ): Promise<ReleasedHolds>;
  /** The account's confirmed enrollments, as student or teacher, in id order, with no lock. */
  confirmedEnrollmentsOf(tx: Transaction, userId: string): Promise<readonly ConfirmedEnrollment[]>;
  /** The enrollments the holds were placed for, with no lock. */
  holdEnrollmentIds(tx: Transaction, holdIds: readonly string[]): Promise<readonly string[]>;
  /** The kernel's row lock (T005). */
  lockRows(tx: Transaction, table: LockedTable, ids: readonly string[]): Promise<void>;
  /** Moderation's case, opened or joined on the enrollment's lock already held; its id. */
  openCase(tx: Transaction, enrollmentId: string, reason: EndCaseReason): Promise<string>;
  /** Sessions' hand-off of an enrollment's end (`cancelRemainingSessions`). */
  cancelRemainingSessions(
    tx: Transaction,
    enrollmentIds: readonly string[],
    now: Date,
    caseOf: CaseOf,
    options?: RemainingSessionsOptions,
  ): Promise<EnrollmentsEnded>;
  /** Sessions' freeze of a suspended student's open remedies (`freezeOpenRemedies`, T005). */
  freezeOpenRemedies(
    tx: Transaction,
    enrollmentIds: readonly string[],
    now: Date,
  ): Promise<RemediesFrozen>;
  /** Cancels those still confirmed with `reason`. */
  cancelConfirmed(
    tx: Transaction,
    enrollmentIds: readonly string[],
    reason: EnrollmentCancellationReason,
  ): Promise<void>;
  /** Booking's one writer of `enrollment_events` rows. */
  recordEvents(tx: Transaction, outcomes: readonly EnrollmentOutcome[]): Promise<void>;
}

/** The store over catalog's entry and booking's holds. */
export const terminationStore: TerminationStore = {
  lockTeacherSlots,
  teacherSlotIds: async (tx, teacherUserId) =>
    (await teacherSlotsOf(tx, teacherUserId)).map(({ id }) => id),
  activeHoldIds,
  release: releaseHolds,
  confirmedEnrollmentsOf,
  holdEnrollmentIds,
  lockRows,
  openCase: async (tx, enrollmentId, reason) =>
    (await openCompensationCase(tx, enrollmentId, reason)).caseId,
  cancelRemainingSessions: (tx, enrollmentIds, now, caseOf, options) =>
    cancelRemainingSessions(tx, enrollmentIds, now, caseOf, undefined, options),
  freezeOpenRemedies: (tx, enrollmentIds, now) => freezeOpenRemedies(tx, enrollmentIds, now),
  cancelConfirmed,
  recordEvents: recordEnrollmentEvents,
};

export interface TerminationDependencies {
  /** Payments' order standing (`orderStandingsOf`), bound by `main.ts` (R-208). */
  readonly orders: OrderStandings;
  /** The process's logger, for the one line per account end (the note under T005). */
  readonly log: Pick<Logger, 'info'>;
  /** The clock; the system clock unless a spec sets one. */
  readonly now?: () => Date;
  readonly store?: TerminationStore;
}

/** The reason the holds on an ended teacher's slots are released with (FR-PAYG-6). */
function teacherReason(cause: TerminationCause): ReleaseReason {
  return cause === 'account_deleted' ? 'account_deleted' : 'teacher_suspended';
}

/** The reason an ended student's own hold is released with (FR-PAYG-6). */
function studentReason(cause: TerminationCause): ReleaseReason {
  return cause === 'account_deleted' ? 'account_deleted' : 'admin';
}

/**
 * Booking's consequence of an account's end, for `AccountConsequences.subscribe`: the holds on the
 * account's slots and its own hold released, their enrollments awaiting payment cancelled, and the
 * account's confirmed enrollments ended or kept (this file's head), with one info line. Expects the
 * caller to hold the account's `users` row (and, for a teacher's ban or revocation, its
 * `teacher_profiles` row), and nothing after them in T005's order.
 */
export function terminationSubscriber({
  orders,
  log,
  now = () => new Date(),
  store = terminationStore,
}: TerminationDependencies): AccountConsequence {
  return async (tx, userId, cause) => {
    // Read with no lock: the account is held, and every path that confirms an enrollment of it
    // locks the account first, so the set cannot grow before the enrollments are locked below.
    const ending = (await store.confirmedEnrollmentsOf(tx, userId)).filter(
      (enrollment) => endOf(cause, roleIn(userId, enrollment)) !== null,
    );
    // The slots' key of every teacher concerned, ascending (L1): the account's own and, for a
    // student, each of their teachers'.
    for (const key of sortedUnique([userId, ...ending.map(({ teacherUserId }) => teacherUserId)])) {
      await store.lockTeacherSlots(tx, key);
    }
    const slotIds = await store.teacherSlotIds(tx, userId);
    const onSlots = await store.activeHoldIds(tx, { slotIds });
    const own = await store.activeHoldIds(tx, { studentUserId: userId });
    const at = now();
    const decided =
      ending.length > 0
        ? await endConfirmed(tx, userId, cause, {
            ending,
            holdIds: [...onSlots, ...own],
            at,
            store,
          })
        : NOTHING_DECIDED;
    // At most one of the two is non-empty (ADR 0016), so the holds are locked in one statement.
    if (onSlots.length > 0) await store.release(tx, onSlots, teacherReason(cause), { at, orders });
    if (own.length > 0) await store.release(tx, own, studentReason(cause), { at, orders });
    // The account's id, the cause and counts only (the note under T005).
    log.info({ userId, cause, ...decided }, 'Account end decided');
  };
}

const sortedUnique = (ids: readonly string[]): string[] => [...new Set(ids)].sort();

/** An account's active holds, locked, and the enrollments they were placed for (T034). */
export interface LockedHolds {
  readonly holdIds: readonly string[];
  readonly enrollmentIds: readonly string[];
}

/**
 * T034 of specs/004-sessions (kernel.md's `party_*` row; the owner's decision of 2026-11-11 on
 * lane A's questions, item 3): the active holds this subscriber would release for the account, the
 * holds on its slots and its own hold (the same two reads as above), locked in one statement in id
 * order, and the enrollments they were placed for, read under that lock with no lock of their own.
 * A dispute's `party_*` ruling takes them after the slots' keys and before the enrollments, so the
 * subscriber, running on the ruling's transaction, finds its holds and their enrollments already
 * held. The caller holds the account's `users` row, so no hold of the account appears after this.
 */
export async function lockActiveHoldsOf(
  tx: Transaction,
  userId: string,
  store: TerminationStore = terminationStore,
): Promise<LockedHolds> {
  const slotIds = await store.teacherSlotIds(tx, userId);
  const holdIds = sortedUnique([
    ...(await store.activeHoldIds(tx, { slotIds })),
    ...(await store.activeHoldIds(tx, { studentUserId: userId })),
  ]);
  if (holdIds.length === 0) return { holdIds, enrollmentIds: [] };
  await store.lockRows(tx, 'slot_holds', holdIds);
  return { holdIds, enrollmentIds: await store.holdEnrollmentIds(tx, holdIds) };
}

type Role = 'student' | 'teacher';

/** The account's role in the enrollment (an account is a student or a teacher, ADR 0016). */
const roleIn = (userId: string, { studentUserId }: ConfirmedEnrollment): Role =>
  studentUserId === userId ? 'student' : 'teacher';

/** How an account's end ends a confirmed enrollment it reaches (R-313's table). */
interface End {
  /** The case it opens or joins on the enrollment, which its sessions' rows name; null for none. */
  readonly caseReason: EndCaseReason | null;
  /**
   * The enrollment's cancellation reason; null for a student's suspension, which keeps it
   * `confirmed` and freezes its open remedies.
   */
  readonly cancellation: EnrollmentCancellationReason | null;
}

/** How `cause` ends the confirmed enrollments of an account in `role`; null where it reaches none. */
function endOf(cause: TerminationCause, role: Role): End | null {
  if (cause === 'account_deleted') {
    return {
      caseReason: role === 'teacher' ? 'teacher_ended' : null,
      cancellation: 'account_deleted',
    };
  }
  // A teacher's suspension, ban or revocation (T006, FR-483).
  if (role === 'teacher') return { caseReason: 'teacher_ended', cancellation: 'teacher_suspended' };
  if (cause === 'suspended') return { caseReason: 'student_suspended', cancellation: null };
  if (cause === 'banned') return { caseReason: 'student_banned', cancellation: 'admin' };
  return null;
}

/** What one account's end decided on its confirmed enrollments, the log line's counts. */
interface Decided {
  readonly enrollments: number;
  readonly cancelledSessions: number;
  readonly frozenRemedies: number;
  readonly handedRemedies: number;
  /** A student's deletion lapses the open remedies, nothing owed (C2). */
  readonly lapsedRemedies: number;
  readonly cases: number;
}

const NOTHING_DECIDED: Decided = {
  enrollments: 0,
  cancelledSessions: 0,
  frozenRemedies: 0,
  handedRemedies: 0,
  lapsedRemedies: 0,
  cases: 0,
};

const NOTHING_FROZEN: RemediesFrozen = { frozenRemedyIds: [], withdrawnCounterRemedyIds: [] };

/**
 * The account's confirmed enrollments ended or kept (this file's head): the holds, then every
 * enrollment in one statement, then sessions' hand-off with the cases (a suspension's with the
 * remedies locked only, then frozen), then the enrollments cancelled with their rows unless the end
 * keeps them. The release after it finds its holds and enrollments already held. An account is one
 * role (ADR 0016), so every enrollment of one call ends the same way.
 */
async function endConfirmed(
  tx: Transaction,
  userId: string,
  cause: TerminationCause,
  {
    ending,
    holdIds,
    at,
    store,
  }: {
    readonly ending: readonly ConfirmedEnrollment[];
    readonly holdIds: readonly string[];
    readonly at: Date;
    readonly store: TerminationStore;
  },
): Promise<Decided> {
  const holds = sortedUnique(holdIds);
  if (holds.length > 0) await store.lockRows(tx, 'slot_holds', holds);
  const holdsEnrollments = await (holds.length > 0 ? store.holdEnrollmentIds(tx, holds) : []);
  await store.lockRows(
    tx,
    'enrollments',
    sortedUnique([...holdsEnrollments, ...ending.map(({ id }) => id)]),
  );
  const locked = new Set(ending.map(({ id }) => id));
  const still = (await store.confirmedEnrollmentsOf(tx, userId)).filter(({ id }) => locked.has(id));
  const [first] = still;
  const end = first === undefined ? null : endOf(cause, roleIn(userId, first));
  if (end === null) return NOTHING_DECIDED;
  const ids = sortedUnique(still.map(({ id }) => id));
  const keeps = end.cancellation === null;
  const ended = await store.cancelRemainingSessions(
    tx,
    ids,
    at,
    async (enrollmentId) =>
      end.caseReason === null ? null : store.openCase(tx, enrollmentId, end.caseReason),
    keeps ? { remedies: 'lockOnly' } : {},
  );
  const frozen = keeps ? await store.freezeOpenRemedies(tx, ids, at) : NOTHING_FROZEN;
  if (end.cancellation !== null) {
    const cancellationReason = end.cancellation;
    await store.cancelConfirmed(tx, ids, cancellationReason);
    await store.recordEvents(
      tx,
      ids.map((enrollmentId) => ({
        kind: 'cancelled' as const,
        enrollmentId,
        cancellationReason,
        occurredAt: at,
      })),
    );
  }
  tellOtherParties(tx, userId, still);
  return {
    enrollments: ids.length,
    cancelledSessions: ended.cancelledSessionIds.length,
    frozenRemedies: frozen.frozenRemedyIds.length,
    handedRemedies: ended.handedRemedyIds.length,
    lapsedRemedies: ended.lapsedRemedyIds.length,
    cases: new Set([...ended.caseOf.values()].filter((caseId) => caseId !== null)).size,
  };
}

/**
 * T066 of specs/004-sessions: `enrollment` for the other party of each enrollment decided on, in id
 * order, to the after-commit list bound to the action's transaction.
 */
function tellOtherParties(
  tx: Transaction,
  userId: string,
  decided: readonly ConfirmedEnrollment[],
): void {
  const live = publisherOn(tx);
  if (live === undefined) return;
  for (const enrollment of [...decided].sort((one, other) => (one.id < other.id ? -1 : 1))) {
    const other =
      roleIn(userId, enrollment) === 'student'
        ? enrollment.teacherUserId
        : enrollment.studentUserId;
    live.afterCommit([other], { type: 'enrollment', enrollmentId: enrollment.id });
  }
}
