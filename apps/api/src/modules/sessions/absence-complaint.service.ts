// T060 of specs/004-sessions/tasks.md (FR-452, FR-495, FR-496; SRS FR-NOSHOW-4 as rewritten on
// 2026-11-05; research R-322, «The complaint»; ADR 0023 D3; contracts/app-surface.md,
// "`sessions.complaint`"; contracts/kernel.md, the row «a student's complaint raised»): the student
// of a `confirmed` enrollment complains of the teacher's absence, with a mandatory reason. The
// complaint offers no time (R-320).
//
// THE CALLER (the note under T060, F2). The participant kind admits either role; this service
// decides the caller is the enrollment's student, so the teacher, another enrollment's student, a
// forged or a guessed id and a teacher of the other gender by the server's records (R-GENDER-2,
// FR-432) all answer the `NOT_FOUND` a nonexistent enrollment answers.
//
// THE LOCKS (kernel.md's complaint row; `003:T005`'s rules). The enrollment is read once with no
// lock to learn its student (sessions reads no booking table, through `EnrollmentSide`, R-301); a
// caller who is not that student takes no lock. Then the student's `users` row (the complaint
// references it), then the enrollment, and the enrollment read again under them (rule 1):
// `confirmed`, the caller its student. The insert and the `session_events` row reference only rows
// already held.
//
// ONE OPEN PER ENROLLMENT. The database holds it (rule 46,
// `disputes_one_open_complaint_per_enrollment_key`): a second raise waits on the enrollment's lock,
// then its insert is refused, which aborts its transaction. That transaction is rolled back and the
// open complaint's id read in a new one, for `COMPLAINT_OPEN`'s `details` (`complaintId`).
//
// THE LIMIT is the procedure's (`rate_limit_absence_complaint`, the student as subject), applied by
// the kind before this service and apart from the one-open rule (R-321, item 6).
//
// THE LOG (the owner's rule). A refusal writes one info line of ids and its reason, marked «logged»
// (`markRefusalLogged`); a complaint raised one line `{ enrollmentId, complaintId, userId }` after
// its commit. Never the reason's text.
import type {
  SessionsComplaintRaiseInput,
  SessionsComplaintRaiseOutput,
} from '@ijazah/contracts';

import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { lockRows } from '../../platform/db/row-lock.js';
import type { Transactions } from '../../platform/db/transaction.repository.js';
import {
  DomainError,
  type ErrorCode,
  type FieldIssue,
} from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { Logger } from '../../platform/logging/logger.js';
import { sessionPartiesOf } from '../identity/index.js';
import { openAbsenceComplaint, openComplaintOf } from '../moderation/index.js';
import type { EnrollmentSide } from './enrollment-side.port.js';
import { recordSessionEvents, type SessionEventRecord } from './session-events.repository.js';
import type { PartyStanding } from './sessions.service.js';

/** What the raising locks, reads and writes besides the enrollment side; faked in a spec. */
export interface AbsenceComplaintStore {
  /** The student's `users` row, `FOR UPDATE`. */
  lockStudent(tx: Transaction, userId: string): Promise<void>;
  /** The live accounts of `userIds` from identity's records; a deleted one is absent. */
  partiesOf(
    tx: Transaction,
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, PartyStanding>>;
  /** Moderation's: the complaint's id, or null when one is open (the transaction then aborted). */
  openComplaint(
    tx: Transaction,
    enrollmentId: string,
    studentUserId: string,
    reason: string,
  ): Promise<string | null>;
  /** Moderation's: the enrollment's open complaint's id, or null. */
  openComplaintOf(tx: Transaction, enrollmentId: string): Promise<string | null>;
  recordEvents(tx: Transaction, events: readonly SessionEventRecord[]): Promise<void>;
}

/** The store over the kernel's lock and the owners' entries (R-API-6). */
export const absenceComplaintStore: AbsenceComplaintStore = {
  lockStudent: (tx, userId) => lockRows(tx, 'users', [userId]),
  partiesOf: sessionPartiesOf,
  openComplaint: openAbsenceComplaint,
  openComplaintOf,
  recordEvents: recordSessionEvents,
};

export interface AbsenceComplaint {
  /** `sessions.complaint.raise` (this file's head). */
  raise(
    caller: { readonly userId: string },
    input: SessionsComplaintRaiseInput,
    log: Logger,
  ): Promise<SessionsComplaintRaiseOutput>;
}

export interface AbsenceComplaintDependencies {
  readonly transactions: Transactions;
  readonly enrollments: Pick<EnrollmentSide, 'enrollmentFor' | 'lockEnrollments'>;
  /** The database's clock on the call's transaction; `clockTimestamp` in production. */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly store?: AbsenceComplaintStore;
}

/** Why a raise was refused, as its one log line names it. */
type RefusalReason =
  'not_the_student' | 'gender_differs' | 'enrollment_not_confirmed' | 'complaint_open';

/** Logs the refusal with ids and its reason only, and answers the error to throw, marked logged. */
function refusal(
  log: Logger,
  ids: { readonly enrollmentId: string; readonly userId: string },
  errorCode: ErrorCode,
  reason: RefusalReason,
  details?: readonly FieldIssue[],
): DomainError {
  log.info({ ...ids, errorCode, reason }, 'A complaint of the teacher’s absence was refused');
  return markRefusalLogged(
    new DomainError(errorCode, undefined, details === undefined ? undefined : { details }),
  );
}

/** The one-open rule refused the insert; its transaction is rolled back before the refusal. */
class ComplaintAlreadyOpen extends Error {}

export function createAbsenceComplaint({
  transactions,
  enrollments,
  clock = clockTimestamp,
  store = absenceComplaintStore,
}: AbsenceComplaintDependencies): AbsenceComplaint {
  return {
    raise: async ({ userId }, { enrollmentId, reason }, log) => {
      const ids = { enrollmentId, userId };
      let complaintId: string;
      try {
        complaintId = await transactions.run(async (tx) => {
          const seen = await enrollments.enrollmentFor(tx, enrollmentId);
          if (seen?.studentUserId !== userId) {
            throw refusal(log, ids, 'NOT_FOUND', 'not_the_student');
          }
          await store.lockStudent(tx, userId);
          await enrollments.lockEnrollments(tx, [enrollmentId]);
          const terms = await enrollments.enrollmentFor(tx, enrollmentId);
          if (terms?.studentUserId !== userId) {
            throw refusal(log, ids, 'NOT_FOUND', 'not_the_student');
          }
          const parties = await store.partiesOf(tx, [terms.studentUserId, terms.teacherUserId]);
          const own = parties.get(userId);
          const teacher = parties.get(terms.teacherUserId);
          if (own === undefined) throw refusal(log, ids, 'NOT_FOUND', 'not_the_student');
          if (teacher !== undefined && teacher.gender !== own.gender) {
            throw refusal(log, ids, 'NOT_FOUND', 'gender_differs');
          }
          if (terms.status !== 'confirmed') {
            throw refusal(log, ids, 'CONFLICT', 'enrollment_not_confirmed', [
              { path: 'cause', code: 'enrollment_not_confirmed' },
            ]);
          }
          const opened = await store.openComplaint(tx, enrollmentId, userId, reason);
          if (opened === null) throw new ComplaintAlreadyOpen();
          await store.recordEvents(tx, [
            {
              enrollmentId,
              sessionId: null,
              kind: 'complaint_raised',
              caseId: opened,
              occurredAt: await clock(tx),
            },
          ]);
          return opened;
        });
      } catch (error: unknown) {
        if (!(error instanceof ComplaintAlreadyOpen)) throw error;
        // The aborted transaction is rolled back; the open complaint is read in a new one.
        const openId = await transactions.run((tx) => store.openComplaintOf(tx, enrollmentId));
        throw refusal(
          log,
          ids,
          'COMPLAINT_OPEN',
          'complaint_open',
          openId === null ? undefined : [{ path: 'complaintId', code: openId }],
        );
      }
      log.info({ enrollmentId, complaintId, userId }, 'A complaint of the teacher’s absence was raised');
      return { complaintId, status: 'open' };
    },
  };
}
