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
// open remedies lapse. A suspension, a ban or a revocation reaches no confirmed enrollment here
// (a student's ban, T005; a teacher's end, T006).
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
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { LockedTable } from '../../platform/db/row-lock.js';
import { lockTeacherSlots, teacherSlotsOf } from '../catalog/index.js';
import type { AccountConsequence, TerminationCause } from '../identity/index.js';
import { openCompensationCase } from '../moderation/index.js';
import { type CaseOf, cancelRemainingSessions } from '../sessions/index.js';
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
  openCase(tx: Transaction, enrollmentId: string, reason: 'teacher_ended'): Promise<string>;
  /** Sessions' hand-off of an enrollment's end (`cancelRemainingSessions`). */
  cancelRemainingSessions(
    tx: Transaction,
    enrollmentIds: readonly string[],
    now: Date,
    caseOf: CaseOf,
  ): Promise<unknown>;
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
  cancelRemainingSessions,
  cancelConfirmed,
  recordEvents: recordEnrollmentEvents,
};

export interface TerminationDependencies {
  /** Payments' order standing (`orderStandingsOf`), bound by `main.ts` (R-208). */
  readonly orders: OrderStandings;
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
 * account's slots and its own hold released, their enrollments awaiting payment cancelled (this
 * file's head). Expects the caller to hold the account's `users` row (and, for a ban or a
 * revocation, its `teacher_profiles` row), and nothing after them in T005's order.
 */
export function terminationSubscriber({
  orders,
  now = () => new Date(),
  store = terminationStore,
}: TerminationDependencies): AccountConsequence {
  return async (tx, userId, cause) => {
    // Read with no lock: the account is held, and every path that confirms an enrollment of it
    // locks the account first, so the set cannot grow before the enrollments are locked below.
    const ending =
      cause === 'account_deleted' ? await store.confirmedEnrollmentsOf(tx, userId) : [];
    // The slots' key of every teacher concerned, ascending (L1): the account's own and, for a
    // student, each of their teachers'.
    for (const key of sortedUnique([userId, ...ending.map(({ teacherUserId }) => teacherUserId)])) {
      await store.lockTeacherSlots(tx, key);
    }
    const slotIds = await store.teacherSlotIds(tx, userId);
    const onSlots = await store.activeHoldIds(tx, { slotIds });
    const own = await store.activeHoldIds(tx, { studentUserId: userId });
    const at = now();
    if (ending.length > 0) {
      await endConfirmed(tx, userId, { ending, holdIds: [...onSlots, ...own], at, store });
    }
    // At most one of the two is non-empty (ADR 0016), so the holds are locked in one statement.
    if (onSlots.length > 0) await store.release(tx, onSlots, teacherReason(cause), { at, orders });
    if (own.length > 0) await store.release(tx, own, studentReason(cause), { at, orders });
  };
}

const sortedUnique = (ids: readonly string[]): string[] => [...new Set(ids)].sort();

/**
 * A deletion's confirmed enrollments ended (this file's head): the holds, then every enrollment in
 * one statement, then sessions' hand-off with the cases, then the enrollments cancelled with their
 * rows. The release after it finds its holds and enrollments already held.
 */
async function endConfirmed(
  tx: Transaction,
  userId: string,
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
): Promise<void> {
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
  if (still.length === 0) return;
  const ids = sortedUnique(still.map(({ id }) => id));
  const taught = new Set(
    still.filter(({ teacherUserId }) => teacherUserId === userId).map(({ id }) => id),
  );
  await store.cancelRemainingSessions(tx, ids, at, async (enrollmentId) =>
    taught.has(enrollmentId) ? store.openCase(tx, enrollmentId, 'teacher_ended') : null,
  );
  await store.cancelConfirmed(tx, ids, 'account_deleted');
  await store.recordEvents(
    tx,
    ids.map((enrollmentId) => ({
      kind: 'cancelled' as const,
      enrollmentId,
      cancellationReason: 'account_deleted' as const,
      occurredAt: at,
    })),
  );
}
