// T036 of specs/004-sessions/tasks.md (FR-449, FR-462, FR-486; research R-312, R-313; plan.md
// decision 1; contracts/admin-surface.md, `cases.resolve` and `cases.dismiss`; the three B39 notes
// under T036): a `student_suspended` case closed, on the administrator call's transaction, from
// T035's `cases.resolve` and `cases.dismiss` (`case-closing.service.ts`).
//
// CLEARED (`cases.resolve`). The student's fault is not the student's: each session the suspension
// cancelled (its `cancelled_by_admin` event naming this case, C4) is offered, in the same
// transaction, through T028's `offerLocked` with `clearedSuspension`, what a Teacher-No-Show owes:
// on a recitation enrollment `awaiting_choice` (a make-up or a refund, the refund through T030), on
// the ijazah track `proposed`, placed under H1 to H5 with the lead. Refused `STUDENT_SUSPENDED` only
// while the account is `suspended`, read under its lock (the note under T036, Q4 (b)):
// `verification_required` and `banned` pass. When an offer finds no free week (`offerLocked`
// answering null, the guard of `remedy-offer.service.ts`), the whole resolve is refused `CONFLICT`
// with `details.cause` `no_free_week` and nothing is written (Q5 (a)): no later run offers a
// `cancelled_by_admin` session, so a closed case would leave it owed and never offered; the offer
// writes its own warn line `{ sessionId, enrollmentId, reason: 'no_free_week' }`. The preconditions
// read under the locks (the enrollment `confirmed`, the student not suspended, no remedy on the
// sessions offered) leave no other null.
//
// THE FAULT CONFIRMED (`cases.dismiss`): an enrollment's end. The enrollment `cancelled` with `admin`
// through `EnrollmentSide.cancel` (its slot back to booking), then T004's `cancelRemainingSessions`,
// whose `caseOf` opens the new `student_fault_confirmed` case through moderation's
// `openCompensationCase`: every make-up still scheduled (booked after the reinstatement)
// `cancelled_by_admin` with the new case on its event, and every open or `frozen` remedy handed to
// the new case (its default `'hand'`), never to the case dismissed. The case is closed naming the
// new case (opened or joined) in `covered_by_case_id` (ERD §15 rule 49; the note under T036, the
// owner's decision (c) on PR #133's Major 1), so the sessions owed a remedy never offered and the
// make-ups the suspension cancelled are the new case's through T035's `covers`, by id (U1).
//
// ON AN ENROLLMENT ALSO PAUSED (T071 of specs/004-sessions; the first note under T071, Q5 (a)
// widened, P7): the fault confirmed ends an enrollment its teacher's suspension paused too
// (`confirmed`), and its open `teacher_suspended` case is closed in the same transaction, after this
// case, through `closePausedCaseOnEnd`: `resolved`, `compensation_ordered`, `ended_meanwhile`,
// covered by the new `student_fault_confirmed` case, by the administrator who dismissed, one info
// line of ids. Cleared ends nothing and closes no such case.
//
// ON AN ENROLLMENT THAT ENDED ANOTHER WAY meanwhile (a ban, a teacher's end; U2): no second end.
// Cleared offers nothing and closes the case naming the end's case, the enrollment's latest case of
// an end's reason (`END_REASONS`) opened after the suspension case (its id greater: PR #133's
// review, round 2, Minor, so an end case a restore closed before the suspension is never named),
// read under the enrollment's lock, which every opening takes; the sessions join that case through
// T035's `covers`, by id. None (a deletion opens none, a completion none): no link.
// The fault confirmed cancels nothing, opens no case and names none (owed nothing). The case is
// closed either way.
//
// THE LOCKS (contracts/kernel.md, the row «a `student_suspended` case closed»; `003:T005`'s rules).
// Cleared: `users` (both, one call, id order, the parties read with no lock from the sessions' own
// copies, ADR 0010; F7), the teacher's `lockKey('teacher-slots')`, the enrollment, the sessions
// the suspension cancelled (one call, id order), their remedies (one call), then `disputes` (the
// case closed through `closeCase`, whose enrollment lock is the one already held), the offer's
// inserts referencing the sessions and the enrollment held. The fault confirmed: the enrollment,
// then `cancelRemainingSessions`' sessions and remedies (one call each), then `disputes` (the new
// case opened, the dismissed one closed). The case is read again under the enrollment's lock, so a
// case closed meanwhile is refused `CONFLICT` `not_open` before anything is written.
//
// THE LOG (the owner's rule; the note under T036, F8). A refusal writes one info line of ids and a
// reason code through this file's one `refusal`, marked «logged». Each offer's `offeredLine` is
// written on the transaction once the case is closed (the Not-scheduled row's item (13): the
// administrator kind has no after-commit point for a log line). The fault confirmed writes one line
// of ids and counts; a closing on an enrollment that ended another way one line of ids and its
// status. No note, name or free text.
//
// THE LIVE EVENT (T066; FR-427; research R-324, item 6; the note under T066, Q3 (a)). The fault
// confirmed closes the enrollment: `enrollment` for both parties, read under its lock, added to
// the administrator kind's after-commit list bound to this transaction (`publisherOn`), sent once
// it commits. Cleared closes no enrollment (its offers are read when the screen opens, R-324 item
// 7), and a closing on an enrollment that ended another way changes none: neither adds an event.
import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError, type ErrorCode, type FieldIssue } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import { publisherOn } from '../../platform/live/live-publisher.js';
import type { Logger } from '../../platform/logging/logger.js';
import { readStanding } from '../identity/index.js';
import {
  type CaseClosing,
  closeCase,
  latestCaseOf,
  type CaseRecord,
  caseRecordOf,
  type CompensationCase,
  openCompensationCase,
} from '../moderation/index.js';
import { END_REASONS } from './case-queue.service.js';
import type { EnrollmentSide } from './enrollment-side.port.js';
import { lockAccounts, lockSessions, lockTeacherSlots } from './remedy-case.repository.js';
import { type Offered, offeredLine, type RemedyOffer } from './remedy-offer.service.js';
import {
  type CaseOf,
  cancelRemainingSessions,
  type EnrollmentsEnded,
} from './remaining-sessions.service.js';
import {
  type EnrollmentParties,
  lockRemediesOfSessions,
  partiesOfEnrollment,
  sessionsToOfferOf,
} from './suspension-case.repository.js';
import {
  closePausedCaseOnEnd,
  type PausedCaseStore,
  pausedCaseStore,
} from './teacher-suspension.service.js';

/** What closing a suspended student's case reads, locks and writes; faked in a spec. */
export interface SuspensionCaseStore extends Pick<PausedCaseStore, 'pausedCaseOf'> {
  /** The enrollment's parties from its sessions' copies, no lock (F7). */
  partiesOf(tx: Transaction, enrollmentId: string): Promise<EnrollmentParties | null>;
  /** Both accounts, `FOR UPDATE`, one call, id order. */
  lockAccounts(tx: Transaction, userIds: readonly string[]): Promise<void>;
  lockTeacherSlots(tx: Transaction, teacherUserId: string): Promise<void>;
  lockSessions(tx: Transaction, ids: readonly string[]): Promise<void>;
  lockRemediesOfSessions(tx: Transaction, sessionIds: readonly string[]): Promise<void>;
  /** Moderation's: the case, read again under the enrollment's lock. */
  caseRecordOf(tx: Transaction, caseId: string): Promise<CaseRecord | null>;
  /** Identity's: the account's status, read under its lock; null for none. */
  accountStatusOf(tx: Transaction, userId: string): Promise<string | null>;
  /** The sessions the case's suspension cancelled, owed an offer, in id order. */
  sessionsToOffer(tx: Transaction, caseId: string): Promise<readonly string[]>;
  /** Moderation's `closeCase`: the closing instant, or null when the case is not open. */
  closeCase(tx: Transaction, caseId: string, closing: CaseClosing): Promise<Date | null>;
  /** Moderation's: the enrollment's `student_fault_confirmed` case, opened (or joined). */
  openFaultCase(tx: Transaction, enrollmentId: string): Promise<CompensationCase>;
  /**
   * Moderation's: the case of the enrollment's end, its latest of `END_REASONS` opened after
   * `afterCaseId` (the suspension case); null for none.
   */
  endCaseOf(tx: Transaction, enrollmentId: string, afterCaseId: string): Promise<string | null>;
  /** T004's hand-off: the remaining sessions cancelled, the open remedies handed to `caseOf`. */
  cancelRemaining(
    tx: Transaction,
    enrollmentIds: readonly string[],
    now: Date,
    caseOf: CaseOf,
  ): Promise<EnrollmentsEnded>;
}

/** The store over sessions' tables and the owners' entries (R-API-6). */
export const suspensionCaseStore: SuspensionCaseStore = {
  partiesOf: partiesOfEnrollment,
  lockAccounts,
  lockTeacherSlots,
  lockSessions,
  lockRemediesOfSessions,
  caseRecordOf,
  accountStatusOf: async (tx, userId) => (await readStanding(tx, userId))?.accountStatus ?? null,
  sessionsToOffer: sessionsToOfferOf,
  closeCase,
  openFaultCase: (tx, enrollmentId) =>
    openCompensationCase(tx, enrollmentId, 'student_fault_confirmed'),
  endCaseOf: (tx, enrollmentId, afterCaseId) =>
    latestCaseOf(tx, enrollmentId, [...END_REASONS], afterCaseId),
  cancelRemaining: (tx, enrollmentIds, now, caseOf) =>
    cancelRemainingSessions(tx, enrollmentIds, now, caseOf),
  // T071: the paused enrollment's open `teacher_suspended` case (moderation's entry).
  pausedCaseOf: pausedCaseStore.pausedCaseOf,
};

/** The case closed and its enrollment, as the caller read them with no lock. */
export interface SuspensionCaseTarget {
  readonly caseId: string;
  readonly enrollmentId: string;
}

export interface SuspensionCase {
  /** `cases.resolve` on a `student_suspended` case: the student cleared (this file's head). */
  clear(tx: Transaction, adminId: string, target: SuspensionCaseTarget, note: string): Promise<void>;
  /** `cases.dismiss` on a `student_suspended` case: the fault confirmed (this file's head). */
  confirmFault(
    tx: Transaction,
    adminId: string,
    target: SuspensionCaseTarget,
    note: string,
  ): Promise<void>;
}

/** Why a closing was refused, as its one log line names it. */
type RefusalReason = 'not_open' | 'student_suspended' | 'no_free_week';

interface RefusalIds {
  readonly adminId: string;
  readonly caseId: string;
  readonly enrollmentId: string;
  readonly sessionId?: string;
}

/**
 * Logs the refusal with ids and its reason only, and answers the error to throw, marked «logged»
 * so `onError` writes no second line (PR #130's review, round 1, Minor 4).
 */
function refusal(
  log: Pick<Logger, 'info'>,
  ids: RefusalIds,
  errorCode: ErrorCode,
  reason: RefusalReason,
  details?: readonly FieldIssue[],
): DomainError {
  log.info({ ...ids, errorCode, reason }, 'A suspension case closing was refused');
  return markRefusalLogged(
    new DomainError(errorCode, undefined, details === undefined ? undefined : { details }),
  );
}

const sortedUnique = (ids: readonly string[]): string[] => [...new Set(ids)].sort();

export function createSuspensionCase({
  enrollments,
  offers,
  log,
  clock = clockTimestamp,
  store = suspensionCaseStore,
}: {
  readonly enrollments: Pick<EnrollmentSide, 'enrollmentFor' | 'lockEnrollments' | 'cancel'>;
  /** T028's offer; built with the process's logger, which writes its no-free-week warn line. */
  readonly offers: Pick<RemedyOffer, 'offerLocked'>;
  readonly log: Pick<Logger, 'info'>;
  /** The database's clock on the call's transaction (B38's Q8). */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly store?: SuspensionCaseStore;
}): SuspensionCase {
  /** The case read again under the enrollment's lock, refused unless still open. */
  const stillOpen = async (tx: Transaction, ids: RefusalIds): Promise<void> => {
    if ((await store.caseRecordOf(tx, ids.caseId))?.status !== 'open') {
      throw refusal(log, ids, 'CONFLICT', 'not_open', [{ path: 'cause', code: 'not_open' }]);
    }
  };

  /** The closing itself; a case closed meanwhile cannot be, under the enrollment's lock. */
  const close = async (tx: Transaction, ids: RefusalIds, closing: CaseClosing): Promise<void> => {
    if ((await store.closeCase(tx, ids.caseId, closing)) === null) {
      throw refusal(log, ids, 'CONFLICT', 'not_open', [{ path: 'cause', code: 'not_open' }]);
    }
  };

  /** The one line of a closing on an enrollment that ended another way (U2), with its link (nit 4). */
  const endedAnotherWay = (
    ids: RefusalIds,
    enrollmentStatus: string,
    closing: string,
    coveredByCaseId: string | null,
  ): void => {
    log.info(
      { ...ids, enrollmentStatus, closing, coveredByCaseId },
      'A suspension case closed on an enrollment that ended another way',
    );
  };

  return {
    clear: async (tx, adminId, { caseId, enrollmentId }, note) => {
      const ids = { adminId, caseId, enrollmentId };
      const parties = await store.partiesOf(tx, enrollmentId);
      // A suspension opens its case only on a `confirmed` enrollment, whose sessions exist.
      if (parties === null) throw new Error('suspension case: an enrollment with no session');
      await store.lockAccounts(tx, sortedUnique([parties.studentUserId, parties.teacherUserId]));
      await store.lockTeacherSlots(tx, parties.teacherUserId);
      await enrollments.lockEnrollments(tx, [enrollmentId]);
      await stillOpen(tx, ids);
      if ((await store.accountStatusOf(tx, parties.studentUserId)) === 'suspended') {
        throw refusal(log, ids, 'STUDENT_SUSPENDED', 'student_suspended');
      }
      const closing: CaseClosing = {
        status: 'resolved',
        resolution: 'compensation_ordered',
        note,
        adminId,
      };
      const terms = await enrollments.enrollmentFor(tx, enrollmentId);
      if (terms?.status !== 'confirmed') {
        const endCase = await store.endCaseOf(tx, enrollmentId, caseId);
        await close(tx, ids, endCase === null ? closing : { ...closing, coveredBy: endCase });
        endedAnotherWay(ids, terms?.status ?? 'none', 'resolved', endCase);
        return;
      }
      const sessionIds = sortedUnique(await store.sessionsToOffer(tx, caseId));
      if (sessionIds.length > 0) {
        await store.lockSessions(tx, sessionIds);
        await store.lockRemediesOfSessions(tx, sessionIds);
      }
      const offered: Offered[] = [];
      for (const sessionId of sessionIds) {
        const offer = await offers.offerLocked(tx, sessionId, { clearedSuspension: true });
        if (offer === null) {
          throw refusal(log, { ...ids, sessionId }, 'CONFLICT', 'no_free_week', [
            { path: 'cause', code: 'no_free_week' },
          ]);
        }
        offered.push(offer);
      }
      await close(tx, ids, closing);
      for (const offer of offered) offeredLine(log, offer);
    },

    confirmFault: async (tx, adminId, { caseId, enrollmentId }, note) => {
      const ids = { adminId, caseId, enrollmentId };
      await enrollments.lockEnrollments(tx, [enrollmentId]);
      await stillOpen(tx, ids);
      const closing: CaseClosing = { status: 'dismissed', resolution: null, note, adminId };
      const terms = await enrollments.enrollmentFor(tx, enrollmentId);
      if (terms?.status !== 'confirmed' || !(await enrollments.cancel(tx, enrollmentId, 'admin'))) {
        await close(tx, ids, closing);
        endedAnotherWay(ids, terms?.status ?? 'none', 'dismissed', null);
        return;
      }
      const ended = await store.cancelRemaining(
        tx,
        [enrollmentId],
        await clock(tx),
        async () => (await store.openFaultCase(tx, enrollmentId)).caseId,
      );
      const faultCaseId = ended.caseOf.get(enrollmentId) ?? null;
      await close(tx, ids, faultCaseId === null ? closing : { ...closing, coveredBy: faultCaseId });
      // T071 (P7): an enrollment also paused, its `teacher_suspended` case covered by the fault case.
      await closePausedCaseOnEnd(tx, store, log, {
        adminId,
        enrollmentId,
        endCaseId: faultCaseId,
        end: 'student_fault_confirmed',
      });
      // T066: the enrollment closed, to both parties once this transaction commits.
      publisherOn(tx)?.afterCommit([terms.studentUserId, terms.teacherUserId], {
        type: 'enrollment',
        enrollmentId,
      });
      log.info(
        {
          ...ids,
          faultCaseId,
          cancelledSessions: ended.cancelledSessionIds.length,
          handedRemedies: ended.handedRemedyIds.length,
        },
        'A suspended student’s fault was confirmed',
      );
    },
  };
}
