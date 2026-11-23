// 006:T008 of specs/006-programme (R-510; FR-706, FR-706b, FR-709; data-model.md «State
// transitions»; B-P2's conflict check, Q-2 (a), the owner, 2026-11-23): the close hook, booking's
// one close of a programme, and booking's own end of a programme enrollment.
//
// THE CLOSE HOOK (R-510, analyze G-5, N-6). Every path that moves a programme's enrollment away from
// `confirmed` calls it on its own transaction: the termination subscriber's cancellation, sessions'
// `terminateNoShow`, `complete` and `cancel` through `EnrollmentSide`, and the programme's own closes
// below. Of the enrollments it is given, those whose programme is not closed yet are set `closed` at
// the database's instant (`paused_at` cleared, rule 77); every open item of theirs is `withdrawn`
// (a `pay_blocked` item among them: a close ends it, FR-706b; data-model.md: «a close withdraws an
// open item»); then payments' `deleteProgrammeCard`, handed in (booking imports no payments, R-208;
// R-API-6: each module writes its own tables), once per programme closed: a stub until T013, its
// call asserted by the specs. One info line per programme closed, its id and the reason only. An
// enrollment that is no programme, or one already closed, is not touched.
//
// THE LOCKS (kernel.md, 006:T008's row). The caller holds the programmes' rows, taken before the
// enrollments' (`lockRows(tx, 'programmes', …)`, the one order: … `slot_holds`, `programmes`,
// `enrollments` …), so the hook's writes touch rows already held: the programme's update, the items'
// (`FOR NO KEY UPDATE`, no key column changed), and the card row T013 will delete.
//
// THE PROGRAMME'S OWN END (`endProgramme`: `offer_declined`, `offer_lapsed`, `assessment_refused`).
// The caller holds the programme's row, then the enrollment's. The enrollment moves `confirmed` →
// `cancelled` with the reason by one conditional update (nothing is written when it did not move);
// then sessions' hand-off cancels what is left of it (a make-up of session 1 still scheduled, its
// open remedy lapsed, no case: these closings keep the fee and owe nothing, DEC-94), its one
// `enrollment_events` row, and the close hook. The weekly time is offered again at once: none of the
// three reasons is in the occupancy's held closings (`slot-occupancy.repository.ts`).
import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { cancelRemainingSessions } from '../sessions/index.js';
import { recordEnrollmentEvents } from './enrollment-events.repository.js';
import { moveEnrollment } from './enrollment-side.repository.js';
import { withdrawOpenRequests } from './programme-requests.repository.js';
import { closeProgrammeRows } from './programmes.repository.js';
import type { ProgrammeLog } from './programmes.service.js';

/** Payments' `deleteProgrammeCard` (a stub until T013), handed in: booking imports no payments. */
export type DeleteProgrammeCard = (tx: Transaction, enrollmentId: string) => Promise<void>;

/** Why a programme closes: the enrollment's cancellation reason, or its move. */
export type ProgrammeCloseCause = string;

/** The close hook's writes on booking's tables. */
export interface ProgrammeCloseStore {
  closeProgrammeRows(
    tx: Transaction,
    enrollmentIds: readonly string[],
    closedAt: Date,
  ): Promise<string[]>;
  withdrawOpenRequests(tx: Transaction, enrollmentIds: readonly string[]): Promise<number>;
}

export const programmeCloseStore: ProgrammeCloseStore = {
  closeProgrammeRows,
  withdrawOpenRequests,
};

/** What the close hook is built over; the composition root binds payments' entry and the log. */
export interface ProgrammeCloseDependencies {
  readonly deleteProgrammeCard: DeleteProgrammeCard;
  readonly log: ProgrammeLog;
  /** The database's clock on the transaction (`clock_timestamp()`), the close's instant. */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly store?: ProgrammeCloseStore;
}

/**
 * Where a composition root has not bound payments' entry yet (the follow-up under T013): no saved
 * card exists before T013 writes one, so deleting none is what payments' stub does too.
 */
export const noProgrammeCardYet: DeleteProgrammeCard = () => Promise.resolve();

/**
 * The close hook (this file's head): the programmes among `enrollmentIds` not yet closed, closed,
 * their open items withdrawn and their cards deleted; the ids closed, in id order.
 */
export async function closeProgrammes(
  tx: Transaction,
  enrollmentIds: readonly string[],
  cause: ProgrammeCloseCause,
  dependencies: ProgrammeCloseDependencies,
): Promise<readonly string[]> {
  const store = dependencies.store ?? programmeCloseStore;
  const clock = dependencies.clock ?? clockTimestamp;
  const closed = await store.closeProgrammeRows(tx, enrollmentIds, await clock(tx));
  if (closed.length === 0) return closed;
  await store.withdrawOpenRequests(tx, closed);
  for (const enrollmentId of closed) {
    await dependencies.deleteProgrammeCard(tx, enrollmentId);
    dependencies.log.info({ enrollmentId, reason: cause }, 'A programme was closed');
  }
  return closed;
}

/** The programme's own closings (R-505, R-513, FR-709). */
export type ProgrammeEndReason = 'offer_declined' | 'offer_lapsed' | 'assessment_refused';

/** What the programme's own end writes, over the owners' entries. */
export interface ProgrammeEndStore {
  moveToCancelled(
    tx: Transaction,
    enrollmentId: string,
    reason: ProgrammeEndReason,
  ): Promise<boolean>;
  cancelRemainingSessions(tx: Transaction, enrollmentId: string, now: Date): Promise<void>;
  recordCancelled(
    tx: Transaction,
    enrollmentId: string,
    reason: ProgrammeEndReason,
    occurredAt: Date,
  ): Promise<void>;
}

export const programmeEndStore: ProgrammeEndStore = {
  moveToCancelled: (tx, enrollmentId, reason) =>
    moveEnrollment(tx, enrollmentId, { status: 'cancelled', cancellationReason: reason }),
  cancelRemainingSessions: async (tx, enrollmentId, now) => {
    // No case: the programme's own closings keep the fee and owe nothing (DEC-94).
    await cancelRemainingSessions(tx, [enrollmentId], now, () => Promise.resolve(null));
  },
  recordCancelled: (tx, enrollmentId, cancellationReason, occurredAt) =>
    recordEnrollmentEvents(tx, [
      { kind: 'cancelled', enrollmentId, cancellationReason, occurredAt },
    ]),
};

/**
 * The programme's own end (this file's head): the enrollment `cancelled` with `reason`, what is left
 * of it cancelled, its event, then the close hook; whether the enrollment moved. The caller holds the
 * programme's row, then the enrollment's.
 */
export async function endProgramme(
  tx: Transaction,
  enrollmentId: string,
  reason: ProgrammeEndReason,
  dependencies: ProgrammeCloseDependencies & { readonly end?: ProgrammeEndStore },
): Promise<boolean> {
  const end = dependencies.end ?? programmeEndStore;
  const now = await (dependencies.clock ?? clockTimestamp)(tx);
  if (!(await end.moveToCancelled(tx, enrollmentId, reason))) return false;
  await end.cancelRemainingSessions(tx, enrollmentId, now);
  await end.recordCancelled(tx, enrollmentId, reason, now);
  await closeProgrammes(tx, [enrollmentId], reason, dependencies);
  return true;
}
