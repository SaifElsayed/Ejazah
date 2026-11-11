// T034 of specs/004-sessions/tasks.md (FR-421, FR-422, FR-474, FR-476, FR-480, FR-495; research
// R-308; plan.md decision 13; contracts/admin-surface.md, `disputes.resolve`; contracts/kernel.md,
// «evaluation, a review or dispute resolution» and «a dispute resolved `party_suspended` or
// `party_banned`»): an administrator's ruling on a session dispute, on the call's transaction.
// Sessions orchestrates; moderation closes its own row (`resolveSessionDispute`); identity moves
// the standing (`StandingService`). The audit entry, with the mandatory reason, is the router's.
//
// THE MAPPING (R-308). The session's final status from the resolution:
//   - `upheld`, `compensation_ordered`, `party_suspended`, `party_banned`: the frozen outcome
//     (`outcome_under_dispute`); `compensation_ordered` records the decision and moves no money
//     (FR-DISPUTE-6, R-MONEY-6: nothing here reads or writes an amount);
//   - `re_marked`: `done` when the session was consumed, `both_no_show` when not (no attribution, a
//     make-up owed);
//   - `no_show_recorded`: `student_no_show` or `teacher_no_show`, against whom the input names.
// The outcome is written through the one writer of an administrator's outcome
// (`admin-outcome.service.ts`: `status`, `outcome_under_dispute` cleared, `settled_by_admin_id`,
// `admin_settled_at`, one `dispute_resolved` row), then the dispute closed `resolved` with the
// resolution, the reason as `resolution_notes`, the administrator and `resolved_at`, the database's
// clock (FR-422), then T015's completion check. No remedy is offered here: `advance-remedies` offers
// what the final outcome owes once the dispute window has closed and no dispute is open (A2).
//
// THE REFUSALS, each writing nothing and logged once (ids and the cause): no session dispute,
// `NOT_FOUND`; a dispute no longer open, `CONFLICT` `not_open`; `upheld`, `compensation_ordered`,
// `party_suspended` or `party_banned` while the outcome is not yet frozen (a dispute raised before
// the evaluation, which has not run), `CONFLICT` `not_evaluated`, so no NULL is written as final
// (Q2; `re_marked` and `no_show_recorded` name their own outcome and are admitted); and the
// standing move `StandingService` refuses (a teacher already suspended or banned, or not approved; a
// student already suspended or banned), which refuses the whole ruling with that refusal (Q3 (a)).
//
// THE LOCKS (T005's rules; the general rule of Phase 3). The dispute and its session are read with
// no lock only to learn the enrollment and the parties (the session's own copies, ADR 0010).
//   - A ruling with no standing move: the enrollment, the session, then the dispute.
//   - `party_suspended` and `party_banned` (kernel.md's `party_*` row, F3, L-A, L1, and B39's F1):
//     the party's `users` row (identity's `lockAccount`), for a teacher banned their
//     `teacher_profiles` row (`lockApplication`), then, read under the account's lock (every path
//     that confirms an enrollment of the account locks it first), the party's confirmed
//     enrollments; the slots' keys every teacher concerned, ascending (the party's own id and, for a
//     student, each of their teachers', as booking's subscriber takes them); the party's active
//     holds, the ones the subscriber releases, in one call (booking's `lockActiveHoldsOf`; the
//     owner's decision of 2026-11-11 on lane A's questions, item 3); the dispute's enrollment, the
//     holds' enrollments and the party's confirmed ones in one call; the dispute's session and the party's remaining
//     `scheduled` sessions in one call; their open remedies in one call; then the dispute. Each call
//     is in id order. `StandingService` and its consequences then run on these locks: its account
//     and application locks and the subscriber's keys, holds, enrollments, sessions and remedies are
//     ones already held, so no session is taken after one with a greater id (F1). The sequence is
//     `standing-locks.ts`' `lockForStanding`, which a complaint decided `suspend_teacher` takes too
//     (T060; the owner's decision of 2026-11-11 on B40's conflict check, Q4 (a)), moved there
//     unchanged in what it locks.
// The dispute and the session are read again under the locks (rule 1). Every row written references
// the enrollment, the session and the dispute, all held, and no account.
//
// THE LOG (the owner's rule). A refusal writes one info line of ids and its cause, marked «logged»;
// a ruling one of ids, the resolution and the final status, never the reason; a completion the
// check made `{ enrollmentId }`, on the call's transaction (the Not-scheduled row's item (13)).
// `StandingService`'s subscriber writes its own line.
import type { DisputesResolveInput, DisputesResolveOutput } from '@ijazah/contracts/admin';

import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { LockedTable } from '../../platform/db/row-lock.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { Logger } from '../../platform/logging/logger.js';
import { lockAccount, lockApplication, type StandingService } from '../identity/index.js';
import {
  lockDispute,
  resolveSessionDispute,
  type SessionDisputeRow,
  type SessionDisputeRuling,
  sessionDisputeOf,
} from '../moderation/index.js';
import {
  type AdminOutcomeWrite,
  type AdminSettledStatus,
  writeAdminOutcome,
} from './admin-outcome.service.js';
import { lockTeacherSlots } from './cancellation.repository.js';
import type { Completion } from './completion.service.js';
import type { EnrollmentSide } from './enrollment-side.port.js';
import { lockRows, openRemediesOf, scheduledSessionsOf } from './remaining-sessions.repository.js';
import { type SessionToResolve, sessionToResolve } from './review.repository.js';
import { type LockActiveHolds, lockForStanding, type StandingLockStore } from './standing-locks.js';

// Moved to `standing-locks.ts` with the lock sequence (T060, Q4 (a)); re-exported for the entry.
export type { LockActiveHolds, LockedHolds } from './standing-locks.js';

/** The standing moves a ruling calls (identity's entry, `002:T144`); `main.ts` hands the instance. */
export type DisputeStanding = Pick<
  StandingService,
  'suspend' | 'ban' | 'suspendStudent' | 'banStudent'
>;

/**
 * What the ruling reads, locks and writes, each on the caller's transaction; the standing move's
 * locks are `StandingLockStore`'s (`standing-locks.ts`).
 */
export interface DisputeResolutionStore extends StandingLockStore {
  /** Moderation's: the session dispute, or null. */
  disputeOf(tx: Transaction, disputeId: string): Promise<SessionDisputeRow | null>;
  sessionToResolve(tx: Transaction, sessionId: string): Promise<SessionToResolve | null>;
  lockRows(tx: Transaction, table: LockedTable, ids: readonly string[]): Promise<void>;
  /** Moderation's: the dispute's row lock, last. */
  lockDispute(tx: Transaction, disputeId: string): Promise<void>;
  /** The one writer of an administrator's outcome. */
  writeOutcome(tx: Transaction, write: AdminOutcomeWrite): Promise<void>;
  /** Moderation's ruling; whether it closed the dispute. */
  closeDispute(tx: Transaction, ruling: SessionDisputeRuling): Promise<boolean>;
}

export const disputeResolutionStore: DisputeResolutionStore = {
  disputeOf: sessionDisputeOf,
  sessionToResolve,
  lockAccount,
  lockApplication,
  lockTeacherSlots,
  scheduledSessionsOf,
  openRemediesOf,
  lockRows,
  lockDispute,
  writeOutcome: (tx, write) => writeAdminOutcome(tx, write),
  closeDispute: resolveSessionDispute,
};

export interface DisputeResolution {
  /** `disputes.resolve` on the administrator call's transaction (this file's head). */
  resolve(
    tx: Transaction,
    adminId: string,
    input: DisputesResolveInput,
  ): Promise<DisputesResolveOutput>;
}

/** Why a ruling was refused, as its one log line names it. */
type RefusalCause = 'not_found' | 'not_open' | 'not_evaluated' | 'standing_refused';

interface RefusalIds {
  readonly adminId: string;
  readonly disputeId: string;
  readonly sessionId?: string;
  readonly enrollmentId?: string;
}

function refusalLine(
  log: Pick<Logger, 'info'>,
  ids: RefusalIds,
  errorCode: string,
  cause: RefusalCause,
): void {
  log.info({ ...ids, errorCode, cause }, 'A dispute resolution was refused');
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

/** The resolutions whose final status is the frozen outcome (R-308). */
const FROZEN_KEPT: ReadonlySet<DisputesResolveInput['resolution']> = new Set([
  'upheld',
  'compensation_ordered',
  'party_suspended',
  'party_banned',
]);

/**
 * The final status R-308 maps the resolution to; null when it keeps a frozen outcome not yet written.
 * The input's schema requires `consumed`, `against` and `party` for their resolutions.
 */
function finalStatusOf(
  input: DisputesResolveInput,
  frozen: SessionToResolve['outcomeUnderDispute'],
): AdminSettledStatus | null {
  if (input.resolution === 're_marked') return input.consumed === true ? 'done' : 'both_no_show';
  if (input.resolution === 'no_show_recorded') {
    return input.against === 'student' ? 'student_no_show' : 'teacher_no_show';
  }
  return frozen as AdminSettledStatus | null;
}

export function createDisputeResolution({
  enrollments,
  standing,
  lockActiveHolds,
  completion,
  log,
  clock = clockTimestamp,
  store = disputeResolutionStore,
}: {
  readonly enrollments: Pick<EnrollmentSide, 'lockEnrollments' | 'enrollmentPage'>;
  readonly standing: DisputeStanding;
  readonly lockActiveHolds: LockActiveHolds;
  readonly completion: Completion;
  readonly log: Pick<Logger, 'info'>;
  /** The database's clock on the call's transaction (`clockTimestamp`). */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly store?: DisputeResolutionStore;
}): DisputeResolution {
  /** A standing ruling's locks, `standing-locks.ts`' `lockForStanding` (this file's head). */
  const lockStanding = async (
    tx: Transaction,
    seen: SessionToResolve,
    party: 'student' | 'teacher',
    banned: boolean,
  ): Promise<string> => {
    const partyUserId = party === 'student' ? seen.studentUserId : seen.teacherUserId;
    await lockForStanding(
      tx,
      { enrollments, lockActiveHolds, store },
      { party, partyUserId, banned, enrollmentId: seen.enrollmentId, sessionId: seen.id },
    );
    return partyUserId;
  };

  /** The standing move the ruling asks, on the call's transaction. */
  const moveStanding = (
    tx: Transaction,
    adminId: string,
    party: 'student' | 'teacher',
    banned: boolean,
    userId: string,
  ): Promise<unknown> => {
    if (party === 'teacher') {
      return banned ? standing.ban(tx, adminId, userId) : standing.suspend(tx, adminId, userId);
    }
    return banned
      ? standing.banStudent(tx, adminId, userId)
      : standing.suspendStudent(tx, adminId, userId);
  };

  return {
    resolve: async (tx, adminId, input) => {
      const { disputeId } = input;
      const seenDispute = await store.disputeOf(tx, disputeId);
      if (seenDispute === null)
        throw refusal(log, { adminId, disputeId }, 'NOT_FOUND', 'not_found');
      const { sessionId, enrollmentId } = seenDispute;
      const ids = { adminId, disputeId, sessionId, enrollmentId };
      const seenSession = await store.sessionToResolve(tx, sessionId);
      if (seenSession === null) throw refusal(log, ids, 'NOT_FOUND', 'not_found');

      const standingParty =
        input.resolution === 'party_suspended' || input.resolution === 'party_banned'
          ? input.party
          : undefined;
      const banned = input.resolution === 'party_banned';
      let partyUserId: string | undefined;
      if (standingParty === undefined) {
        await enrollments.lockEnrollments(tx, [enrollmentId]);
        await store.lockRows(tx, 'sessions', [sessionId]);
      } else {
        partyUserId = await lockStanding(tx, seenSession, standingParty, banned);
      }
      await store.lockDispute(tx, disputeId);

      const dispute = await store.disputeOf(tx, disputeId);
      if (dispute === null) throw refusal(log, { adminId, disputeId }, 'NOT_FOUND', 'not_found');
      if (dispute.status !== 'open') throw refusal(log, ids, 'CONFLICT', 'not_open');
      const session = await store.sessionToResolve(tx, sessionId);
      // An open dispute's session is `disputed` (R-308): a writer of either skipping its locks.
      if (session?.status !== 'disputed') {
        throw new Error('sessions: an open dispute’s session is not disputed under its locks');
      }
      if (FROZEN_KEPT.has(input.resolution) && session.outcomeUnderDispute === null) {
        throw refusal(log, ids, 'CONFLICT', 'not_evaluated');
      }
      const status = finalStatusOf(input, session.outcomeUnderDispute);
      if (status === null) throw refusal(log, ids, 'CONFLICT', 'not_evaluated');

      if (standingParty !== undefined && partyUserId !== undefined) {
        try {
          await moveStanding(tx, adminId, standingParty, banned, partyUserId);
        } catch (error: unknown) {
          if (error instanceof DomainError) {
            refusalLine(log, ids, error.code, 'standing_refused');
            throw markRefusalLogged(error);
          }
          throw error;
        }
      }

      const at = await clock(tx);
      await store.writeOutcome(tx, {
        sessionId,
        enrollmentId,
        from: 'disputed',
        outcome: status,
        adminId,
        at,
        event: { kind: 'dispute_resolved' },
      });
      const closed = await store.closeDispute(tx, {
        disputeId,
        resolution: input.resolution,
        notes: input.reason,
        adminId,
        resolvedAt: at,
      });
      if (!closed) throw new Error('sessions: a locked open dispute did not close');
      log.info(
        { adminId, disputeId, sessionId, enrollmentId, resolution: input.resolution, status },
        'A session dispute was resolved',
      );
      // On the call's transaction; after its commit waits in the Not-scheduled row's item (13).
      if (await completion.completeIfDue(tx, enrollmentId)) {
        log.info({ enrollmentId }, 'Enrollment completed');
      }
      return { disputeId, sessionStatus: status };
    },
  };
}
