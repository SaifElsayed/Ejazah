// T060 of specs/004-sessions/tasks.md (FR-453, FR-480, FR-495; SRS FR-NOSHOW-4 as rewritten on
// 2026-11-05; research R-322, «The decision»; ADR 0023 D3; contracts/admin-surface.md,
// `cases.decideComplaint`; contracts/kernel.md, the rows «a complaint decided (a)», «(b)» and
// «(c)»): an administrator decides an open complaint of a teacher's absence, on the administrator
// call's transaction, with a mandatory note. The audit entry (`complaint.decided`) is the router's.
//
// (a) `end_enrollment`, only while the enrollment is `confirmed`: the enrollment
// `terminated_no_show` through `EnrollmentSide.terminateNoShow` (T008), then T004's hand-off: every
// remaining `scheduled` session, make-ups included, `cancelled_by_admin` with the new case on its
// event, every open remedy, `frozen` included (F1), handed to the one `absence_termination` case its
// `caseOf` opens through moderation's `openCompensationCase` (whose `covers` T035 reads as every
// enrollment end's); the complaint closed `resolved`, `enrollment_ended`, through T035's
// `closeCase`. A confirmed fault's order, as `suspension-case.service.ts`' `confirmFault` runs it.
// (b) `suspend_teacher`: `StandingService.suspend` on this transaction (FR-421), whose consequences
// end the teacher's confirmed enrollments as T006 does (this one among them while it is
// confirmed; the note under T060, F16: built as it stands); the complaint `resolved`,
// `party_suspended`. Admitted on an enrollment that ended another way (spec, edge cases).
// (c) `close`: the complaint `dismissed` with the note; nothing else.
// Each writes one `session_events` row `complaint_decided` naming the complaint, with no session.
//
// (a) ON A PAUSED ENROLLMENT (T071 of specs/004-sessions; the first note under T071, Q5 (a) widened,
// P6). An enrollment paused by its teacher's suspension is `confirmed`, so (a) ends it; its open
// `teacher_suspended` case is closed in the same transaction, after the complaint, `disputes` last
// (both rows under the enrollment's lock, which every case closing takes), through
// `closePausedCaseOnEnd`: `resolved`, `compensation_ordered`, `ended_meanwhile`, covered by the
// new `absence_termination` case, by the deciding administrator, one info line of ids.
//
// THE LOCKS (`003:T005`'s rules). The complaint is read once with no lock for its enrollment (and,
// for (b), the enrollment's teacher, who never changes). (a) and (c): the enrollment's row, then
// the complaint read again under it (rule 1); (a)'s hand-off then takes the sessions and the
// remedies in one call each, then `disputes` (the case opened, the complaint closed, `closeCase`'s
// enrollment lock being the one held). (b): `standing-locks.ts`' `lockForStanding`, the `party_*`
// row's sequence for the teacher with no session (the owner's decision of 2026-11-11 on B40's
// conflict check, Q4 (a)): the account, the slots' key, the teacher's active holds, the enrollments
// (the complaint's, the holds' and the teacher's confirmed ones, one call), their sessions and
// remedies; then the complaint read again; `StandingService.suspend` and its subscriber run on these
// locks; `disputes` last. No row written references an account.
//
// THE REFUSALS, each writing nothing, in one info line of ids and its cause marked «logged»:
// anything but an open complaint (no row, a compensation case, a session dispute, a closed
// complaint, one closed while the lock was awaited) `NOT_FOUND` (admin-surface.md); (a) on an
// enrollment not `confirmed` `CONFLICT` `enrollment_not_confirmed`; (b) the standing's own refusal
// (a teacher already suspended, banned or no longer approved), as a dispute's ruling refuses it.
//
// THE LOG (the owner's rule). Each decision one info line `{ adminId, caseId, enrollmentId,
// decision }` (and `newCaseId` for (a)), on the call's transaction; never the note.
//
// THE LIVE EVENT (T066; FR-427; research R-324, item 6; the note under T066, Q3 (a)). (a) adds
// `enrollment` for both parties, read under the enrollment's lock, to the administrator kind's
// after-commit list bound to this transaction (`publisherOn`), sent once it commits. (b)'s events
// are the standing's (`account` to the teacher) and its subscriber's (`enrollment` to each
// student); (c) closes no enrollment and adds none.
import type { CasesDecideComplaintInput, CasesDecideComplaintOutput } from '@ijazah/contracts/admin';

import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import { publisherOn } from '../../platform/live/live-publisher.js';
import type { Logger } from '../../platform/logging/logger.js';
import { lockAccount, lockApplication, type StandingService } from '../identity/index.js';
import {
  type CaseClosing,
  type CaseRecord,
  caseRecordOf,
  closeCase,
  type CompensationCase,
  openCompensationCase,
} from '../moderation/index.js';
import { lockTeacherSlots } from './cancellation.repository.js';
import type { EnrollmentSide } from './enrollment-side.port.js';
import { lockRows, openRemediesOf, scheduledSessionsOf } from './remaining-sessions.repository.js';
import {
  type CaseOf,
  cancelRemainingSessions,
  type EnrollmentsEnded,
} from './remaining-sessions.service.js';
import { recordSessionEvents, type SessionEventRecord } from './session-events.repository.js';
import { type LockActiveHolds, lockForStanding, type StandingLockStore } from './standing-locks.js';
import {
  closePausedCaseOnEnd,
  type PausedCaseStore,
  pausedCaseStore,
} from './teacher-suspension.service.js';

/** What the decision reads, locks and writes, each on the call's transaction; faked in a spec. */
export interface ComplaintDecisionStore
  extends StandingLockStore,
    Pick<PausedCaseStore, 'pausedCaseOf'> {
  /** Moderation's: a `disputes` row of any kind, or null. */
  caseRecordOf(tx: Transaction, caseId: string): Promise<CaseRecord | null>;
  /** Moderation's `closeCase`: the closing instant, or null when the row is not open. */
  closeCase(tx: Transaction, caseId: string, closing: CaseClosing): Promise<Date | null>;
  /** Moderation's: the enrollment's `absence_termination` case, opened (or joined). */
  openTerminationCase(tx: Transaction, enrollmentId: string): Promise<CompensationCase>;
  /** T004's hand-off: the remaining sessions cancelled, the open remedies handed to `caseOf`. */
  cancelRemaining(
    tx: Transaction,
    enrollmentIds: readonly string[],
    now: Date,
    caseOf: CaseOf,
  ): Promise<EnrollmentsEnded>;
  recordEvents(tx: Transaction, events: readonly SessionEventRecord[]): Promise<void>;
}

/** The store over sessions' tables, the kernel's locks and the owners' entries (R-API-6). */
export const complaintDecisionStore: ComplaintDecisionStore = {
  caseRecordOf,
  closeCase,
  openTerminationCase: (tx, enrollmentId) =>
    openCompensationCase(tx, enrollmentId, 'absence_termination'),
  cancelRemaining: (tx, enrollmentIds, now, caseOf) =>
    cancelRemainingSessions(tx, enrollmentIds, now, caseOf),
  recordEvents: recordSessionEvents,
  lockAccount,
  lockApplication,
  lockTeacherSlots,
  scheduledSessionsOf,
  openRemediesOf,
  lockRows,
  // T071: the paused enrollment's open `teacher_suspended` case (moderation's entry).
  pausedCaseOf: pausedCaseStore.pausedCaseOf,
};

export interface ComplaintDecision {
  /** `cases.decideComplaint` on the administrator call's transaction (this file's head). */
  decideComplaint(
    tx: Transaction,
    adminId: string,
    input: CasesDecideComplaintInput,
  ): Promise<CasesDecideComplaintOutput>;
}

export interface ComplaintDecisionDependencies {
  readonly enrollments: Pick<
    EnrollmentSide,
    'enrollmentFor' | 'lockEnrollments' | 'terminateNoShow' | 'enrollmentPage'
  >;
  /** Identity's standing (`002:T144`), the instance the admin module composes. */
  readonly standing: Pick<StandingService, 'suspend'>;
  /** Booking's `lockActiveHoldsOf`, handed in by the admin module's composition. */
  readonly lockActiveHolds: LockActiveHolds;
  readonly log: Pick<Logger, 'info'>;
  /** The database's clock on the call's transaction (`clockTimestamp`). */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly store?: ComplaintDecisionStore;
}

/** Why a decision was refused, as its one log line names it. */
type RefusalCause = 'not_found' | 'enrollment_not_confirmed' | 'standing_refused';

interface RefusalIds {
  readonly adminId: string;
  readonly caseId: string;
  readonly enrollmentId?: string;
}

function refusalLine(
  log: Pick<Logger, 'info'>,
  ids: RefusalIds,
  errorCode: string,
  cause: RefusalCause,
): void {
  log.info({ ...ids, errorCode, cause }, 'A complaint decision was refused');
}

/** The refusal's error, marked «logged» after its line; a `CONFLICT` names its cause. */
function refusal(
  log: Pick<Logger, 'info'>,
  ids: RefusalIds,
  errorCode: 'NOT_FOUND' | 'CONFLICT',
  cause: Exclude<RefusalCause, 'standing_refused'>,
): DomainError {
  refusalLine(log, ids, errorCode, cause);
  return markRefusalLogged(
    errorCode === 'CONFLICT'
      ? new DomainError(errorCode, undefined, { details: [{ path: 'cause', code: cause }] })
      : new DomainError(errorCode),
  );
}

const isOpenComplaint = (found: CaseRecord | null): found is CaseRecord =>
  found?.kind === 'absence_complaint' && found.status === 'open';

export function createComplaintDecision({
  enrollments,
  standing,
  lockActiveHolds,
  log,
  clock = clockTimestamp,
  store = complaintDecisionStore,
}: ComplaintDecisionDependencies): ComplaintDecision {
  /** The enrollment's terms; its foreign key keeps the row. */
  const termsOf = async (tx: Transaction, enrollmentId: string) => {
    const terms = await enrollments.enrollmentFor(tx, enrollmentId);
    if (terms === null) throw new Error('complaint decision: a complaint without its enrollment');
    return terms;
  };

  /** The complaint closed as `closing` says; under the enrollment's lock it is still open. */
  const close = async (tx: Transaction, caseId: string, closing: CaseClosing): Promise<void> => {
    if ((await store.closeCase(tx, caseId, closing)) === null) {
      throw new Error('complaint decision: a complaint read open under its lock did not close');
    }
  };

  return {
    decideComplaint: async (tx, adminId, { caseId, decision, note }) => {
      const seen = await store.caseRecordOf(tx, caseId);
      if (!isOpenComplaint(seen)) {
        throw refusal(log, { adminId, caseId }, 'NOT_FOUND', 'not_found');
      }
      const { enrollmentId } = seen;
      const ids = { adminId, caseId, enrollmentId };
      let teacherUserId: string | undefined;
      if (decision === 'suspend_teacher') {
        teacherUserId = (await termsOf(tx, enrollmentId)).teacherUserId;
        await lockForStanding(
          tx,
          { enrollments, lockActiveHolds, store },
          { party: 'teacher', partyUserId: teacherUserId, banned: false, enrollmentId },
        );
      } else {
        await enrollments.lockEnrollments(tx, [enrollmentId]);
      }
      if (!isOpenComplaint(await store.caseRecordOf(tx, caseId))) {
        throw refusal(log, ids, 'NOT_FOUND', 'not_found');
      }
      const terms = await termsOf(tx, enrollmentId);

      let now: Date | undefined;
      let newCaseId: string | null = null;
      if (decision === 'end_enrollment') {
        if (terms.status !== 'confirmed' || !(await enrollments.terminateNoShow(tx, enrollmentId))) {
          throw refusal(log, ids, 'CONFLICT', 'enrollment_not_confirmed');
        }
        now = await clock(tx);
        const ended = await store.cancelRemaining(
          tx,
          [enrollmentId],
          now,
          async () => (await store.openTerminationCase(tx, enrollmentId)).caseId,
        );
        newCaseId = ended.caseOf.get(enrollmentId) ?? null;
        await close(tx, caseId, { status: 'resolved', resolution: 'enrollment_ended', note, adminId });
        // T071 (P6): a paused enrollment's `teacher_suspended` case, covered by the new case.
        await closePausedCaseOnEnd(tx, store, log, {
          adminId,
          enrollmentId,
          endCaseId: newCaseId,
          end: 'complaint_end_enrollment',
        });
        // T066: the enrollment closed, to both parties once this transaction commits.
        publisherOn(tx)?.afterCommit([terms.studentUserId, terms.teacherUserId], {
          type: 'enrollment',
          enrollmentId,
        });
      } else if (decision === 'suspend_teacher' && teacherUserId !== undefined) {
        try {
          await standing.suspend(tx, adminId, teacherUserId);
        } catch (error: unknown) {
          if (error instanceof DomainError) {
            refusalLine(log, ids, error.code, 'standing_refused');
            throw markRefusalLogged(error);
          }
          throw error;
        }
        await close(tx, caseId, { status: 'resolved', resolution: 'party_suspended', note, adminId });
      } else {
        await close(tx, caseId, { status: 'dismissed', resolution: null, note, adminId });
      }

      await store.recordEvents(tx, [
        {
          enrollmentId,
          sessionId: null,
          kind: 'complaint_decided',
          caseId,
          occurredAt: now ?? (await clock(tx)),
        },
      ]);
      log.info(
        { ...ids, decision, ...(newCaseId === null ? {} : { newCaseId }) },
        'A complaint of the teacher’s absence was decided',
      );
      return {
        caseId,
        status: decision === 'close' ? 'dismissed' : 'resolved',
        enrollmentStatus: (await termsOf(tx, enrollmentId)).status,
        ...(newCaseId === null ? {} : { newCaseId }),
      };
    },
  };
}
