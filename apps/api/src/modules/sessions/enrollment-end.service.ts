// T082 of specs/004-sessions/tasks.md (FR-513; SRS FR-CANCEL-10, DEC-68; contracts/admin-surface.md,
// `sessions.endEnrollment`; contracts/kernel.md, the direct end's row): an administrator ends a
// `confirmed` enrollment directly, on the administrator call's transaction, with no complaint,
// dispute or ban behind it: the complaint's decision (a) (`complaint-decision.service.ts`) with no
// complaint. The audit entry (`enrollment.ended_by_admin`, with both texts and the slot's choice)
// and the limit (`rate_limit_enrollment_end`, before the transaction) are the router's.
//
// KEYED through the kernel's `IdempotencyService.runOn` on the kind's transaction, as
// `sessions.restore` is: scope `sessions.endEnrollment`, the administrator as actor, the input without
// its key as what was asked. A repeat answers the first result and writes nothing (`replayed`); the
// same key with another input is the kernel's `CONFLICT`.
//
// THE ORDER (the note under T082, N7). The enrollment is read once with no lock for its teacher and
// slot, which never change. With `release`, the teacher's `lockKey('teacher-slots', …)` and the
// enrollment's slot (`availability_slots`), as T070's release takes them, after both accounts'
// `FOR KEY SHARE` (`keyShareRows`, one call in id order; Q-E1 (a), the review session, 2026-11-14):
// the release writes the enrollment a second time in this transaction, so PostgreSQL checks its
// foreign keys again and key-shares both accounts, which taken after the slot deadlocks with a hold
// or a restore holding an account; the line's «no `users` lock» means no `FOR UPDATE`. Then the
// enrollment's row, read again under it (rule 1); the refusals;
// `EnrollmentSide.cancel(…, 'admin', partyReason)` (`cancelled` `admin`, `admin_end_reason` written,
// one `cancelled` row); T004's
// `cancelRemainingSessions`, which locks the remaining sessions (one call) and their open remedies,
// `frozen` included, and whose `caseOf` opens the one `admin_ended` case (`disputes`, its enrollment
// lock the one held) that every cancelled session's row names and every open remedy is handed to;
// with `release`, booking's release core (`EnrollmentSide.releaseHeldSlot`: `slot_released_at` and
// one `slot_released` row, its own locks all held, so it never waits); T071's
// `closePausedCaseOnEnd(…, end: 'admin_ended')`, a paused enrollment's open `teacher_suspended` case
// closed and covered by the new case, `disputes` last. No `users` `FOR UPDATE`: no row written
// references an account. A student's suspension case open meanwhile stays open: its sessions join the new case
// when it is closed (U2; `END_REASONS` names `admin_ended`).
//
// THE REFUSALS, each writing nothing, in one info line of ids and its cause marked «logged» (Q-R13
// (a)): no enrollment `NOT_FOUND`; one not `confirmed` once locked `CONFLICT`
// `enrollment_not_confirmed`; a complaint of the teacher's absence open on it `CONFLICT`
// `complaint_open`, naming the complaint (`{ path: 'caseId' }`, Q-R6 (a)), read under the
// enrollment's lock, which the raise takes too (`absence-complaint.service.ts`). `RATE_LIMITED` is the
// router's, before the transaction.
//
// THE LOG (the owner's rule). One info line `{ adminId, enrollmentId, caseId, slot,
// cancelledSessions, handedRemedies }` on the call's transaction; never either text.
//
// THE LIVE EVENT (T066; FR-427). `enrollment` to both parties, read under the enrollment's lock, added
// to the administrator kind's after-commit list bound to this transaction (`publisherOn`): sent once
// it commits, nothing on a replay, a refusal or a rollback.
import type {
  SessionsEndEnrollmentInput,
  SessionsEndEnrollmentOutput,
} from '@ijazah/contracts/admin';

import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { keyShareRows } from '../../platform/db/row-lock.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import { publisherOn } from '../../platform/live/live-publisher.js';
import type { Logger } from '../../platform/logging/logger.js';
import {
  type CompensationCase,
  openComplaintOf,
  openCompensationCase,
} from '../moderation/index.js';
import type { EnrollmentSide } from './enrollment-side.port.js';
import { lockSlots } from './makeup-booking.repository.js';
import { lockTeacherSlots } from './remedy-case.repository.js';
import {
  type CaseOf,
  cancelRemainingSessions,
  type EnrollmentsEnded,
} from './remaining-sessions.service.js';
import {
  closePausedCaseOnEnd,
  type PausedCaseStore,
  pausedCaseStore,
} from './teacher-suspension.service.js';

/** What the end locks, reads and writes besides the enrollment side; faked in a spec. */
export interface EnrollmentEndStore extends PausedCaseStore {
  /** Q-E1 (a): the accounts, `FOR KEY SHARE`, one call in id order (`keyShareRows`). */
  keyShareAccounts(tx: Transaction, userIds: readonly string[]): Promise<void>;
  lockTeacherSlots(tx: Transaction, teacherUserId: string): Promise<void>;
  lockSlot(tx: Transaction, slotId: string): Promise<void>;
  /** Moderation's: the enrollment's open complaint of the teacher's absence, null for none. */
  openComplaintOf(tx: Transaction, enrollmentId: string): Promise<string | null>;
  /** Moderation's: the enrollment's `admin_ended` case, opened (or joined). */
  openEndCase(tx: Transaction, enrollmentId: string): Promise<CompensationCase>;
  /** T004's hand-off: the remaining sessions cancelled, the open remedies handed to `caseOf`. */
  cancelRemaining(
    tx: Transaction,
    enrollmentIds: readonly string[],
    now: Date,
    caseOf: CaseOf,
  ): Promise<EnrollmentsEnded>;
}

/** The store over sessions' tables, the kernel's locks and moderation's entry (R-API-6). */
export const enrollmentEndStore: EnrollmentEndStore = {
  keyShareAccounts: (tx, userIds) => keyShareRows(tx, 'users', userIds),
  lockTeacherSlots,
  lockSlot: (tx, slotId) => lockSlots(tx, [slotId]),
  openComplaintOf,
  openEndCase: (tx, enrollmentId) => openCompensationCase(tx, enrollmentId, 'admin_ended'),
  cancelRemaining: (tx, enrollmentIds, now, caseOf) =>
    cancelRemainingSessions(tx, enrollmentIds, now, caseOf),
  ...pausedCaseStore,
};

export interface EnrollmentEndDependencies {
  readonly enrollments: Pick<
    EnrollmentSide,
    'enrollmentFor' | 'lockEnrollments' | 'cancel' | 'releaseHeldSlot'
  >;
  /** The kernel's idempotency, keyed on the call's transaction (`runOn`). */
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'runOn'>;
  readonly log: Pick<Logger, 'info'>;
  /** The database's clock on the call's transaction (`clockTimestamp`). */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly store?: EnrollmentEndStore;
}

export interface EnrollmentEnd {
  /** `sessions.endEnrollment` on the administrator call's transaction (this file's head). */
  endEnrollment(
    tx: Transaction,
    adminId: string,
    input: SessionsEndEnrollmentInput,
  ): Promise<{ readonly answer: SessionsEndEnrollmentOutput; readonly replayed: boolean }>;
}

const SCOPE = 'sessions.endEnrollment';

const sortedUnique = (ids: readonly string[]): string[] => [...new Set(ids)].sort();
const REFUSED = 'An enrollment end was refused';

interface RefusalIds {
  readonly adminId: string;
  readonly enrollmentId: string;
}

function notFound(log: Pick<Logger, 'info'>, ids: RefusalIds): DomainError {
  log.info({ ...ids, errorCode: 'NOT_FOUND', cause: 'not_found' }, REFUSED);
  return markRefusalLogged(new DomainError('NOT_FOUND'));
}

function notConfirmed(log: Pick<Logger, 'info'>, ids: RefusalIds): DomainError {
  log.info({ ...ids, errorCode: 'CONFLICT', cause: 'enrollment_not_confirmed' }, REFUSED);
  return markRefusalLogged(
    new DomainError('CONFLICT', undefined, {
      details: [{ path: 'cause', code: 'enrollment_not_confirmed' }],
    }),
  );
}

function complaintOpen(log: Pick<Logger, 'info'>, ids: RefusalIds, caseId: string): DomainError {
  log.info({ ...ids, caseId, errorCode: 'CONFLICT', cause: 'complaint_open' }, REFUSED);
  return markRefusalLogged(
    new DomainError('CONFLICT', undefined, {
      details: [
        { path: 'cause', code: 'complaint_open' },
        { path: 'caseId', code: caseId },
      ],
    }),
  );
}

export function createEnrollmentEnd({
  enrollments,
  idempotency,
  log,
  clock = clockTimestamp,
  store = enrollmentEndStore,
}: EnrollmentEndDependencies): EnrollmentEnd {
  const endLocked = async (
    tx: Transaction,
    adminId: string,
    { enrollmentId, partyReason, slot }: SessionsEndEnrollmentInput,
  ): Promise<SessionsEndEnrollmentOutput> => {
    const ids = { adminId, enrollmentId };
    const seen = await enrollments.enrollmentFor(tx, enrollmentId);
    if (seen === null) throw notFound(log, ids);
    if (slot === 'release') {
      // Q-E1 (a): the release writes the enrollment a second time, which checks both accounts' keys
      // again; their key-share is taken first, in the accounts' place of the one order.
      await store.keyShareAccounts(tx, sortedUnique([seen.studentUserId, seen.teacherUserId]));
      await store.lockTeacherSlots(tx, seen.teacherUserId);
      await store.lockSlot(tx, seen.slotId);
    }
    await enrollments.lockEnrollments(tx, [enrollmentId]);
    const terms = await enrollments.enrollmentFor(tx, enrollmentId);
    if (terms === null) throw notFound(log, ids);
    if (terms.status !== 'confirmed') throw notConfirmed(log, ids);
    // Read under the enrollment's lock, which the raise takes too (this file's head).
    const complaint = await store.openComplaintOf(tx, enrollmentId);
    if (complaint !== null) throw complaintOpen(log, ids, complaint);

    if (!(await enrollments.cancel(tx, enrollmentId, 'admin', partyReason))) {
      throw notConfirmed(log, ids);
    }
    const now = await clock(tx);
    const ended = await store.cancelRemaining(
      tx,
      [enrollmentId],
      now,
      async () => (await store.openEndCase(tx, enrollmentId)).caseId,
    );
    const caseId = ended.caseOf.get(enrollmentId) ?? null;
    if (caseId === null) throw new Error('enrollment end: the hand-off opened no admin_ended case');
    // With `release`: T070's release in the same transaction, its locks all held (Q-R15 (a)).
    if (slot === 'release' && (await enrollments.releaseHeldSlot(tx, enrollmentId)) === null) {
      throw new Error('enrollment end: the slot of the end just made was not released');
    }
    // T071: a paused enrollment's `teacher_suspended` case, covered by the new case.
    await closePausedCaseOnEnd(tx, store, log, {
      adminId,
      enrollmentId,
      endCaseId: caseId,
      end: 'admin_ended',
    });
    // T066: the enrollment closed, to both parties once this transaction commits.
    publisherOn(tx)?.afterCommit([terms.studentUserId, terms.teacherUserId], {
      type: 'enrollment',
      enrollmentId,
    });
    const cancelledSessions = ended.cancelledSessionIds.length;
    log.info(
      {
        adminId,
        enrollmentId,
        caseId,
        slot,
        cancelledSessions,
        handedRemedies: ended.handedRemedyIds.length,
      },
      'An enrollment was ended by an administrator',
    );
    return { enrollmentId, caseId, slot, cancelledSessions };
  };

  return {
    endEnrollment: async (tx, adminId, input) => {
      const { idempotencyKey, ...asked } = input;
      const { outcome, replayed } = await idempotency.runOn(
        tx,
        { scope: SCOPE, key: idempotencyKey, actorId: adminId, input: asked },
        (keyed) => endLocked(keyed, adminId, input),
      );
      return { answer: outcome, replayed };
    },
  };
}
