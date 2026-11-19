// T026 of specs/004-sessions/tasks.md (FR-473, FR-474, FR-495; SRS FR-DISPUTE-1 as amended on
// 2026-11-05; research R-308; plan.md decision 5; the third analysis, G1; contracts/app-surface.md,
// "`sessions.dispute`"; contracts/kernel.md, the «dispute raised» row): either participant raises a
// dispute over a session of theirs, with a reason.
//
// KEYED (ADR 0008, R-API-14). The raise runs inside the kernel's idempotency transaction under the
// client's key, the caller as actor and `{ sessionId, reason }` as input: a retry with the same key
// answers the first result and writes nothing new; the same key with another input is `CONFLICT`.
// `dispute_window_hours` is read before that transaction opens, as the kernel reads its own setting.
//
// THE LOCKS (kernel.md's «dispute raised» row; T005's rules). The session is read once with no lock
// to learn its enrollment; then the raiser's `users` row (the dispute references it), the session's
// enrollment (`EnrollmentSide.lockEnrollments`: the `session_events` row and the dispute reference
// it) and the session, in that order, and the session read again under them (rule 1). A second
// raise of the same session waits on the enrollment, then reads it `disputed`. The `disputes`
// insert and the `session_events` insert reference only rows already held.
//
// THE RULES, read under the locks, in this order; each refusal writes nothing and one info line with
// the session's and the caller's ids, the code and the reason, its error marked «logged»
// (`markRefusalLogged`), so the handler's one-place refusal log writes no second (PR #130's review,
// Minor 4):
//   - a session the caller is not a party of, or one that does not exist, `NOT_FOUND`; one whose
//     counterparty's recorded gender differs from the caller's, the same `NOT_FOUND` (R-GENDER-2,
//     FR-432), the server's records deciding, never the input;
//   - the raiser no longer active, or a teacher no longer approved, `ACCOUNT_RESTRICTED`: the caller
//     kind's own refusal, read again under the raiser's lock, as the join reads it (K2);
//   - a cancelled session, by agreement or by an administrator, `NOT_DISPUTABLE` (FR-473; decision
//     5); `under_threshold` or `provider_outage` `SESSION_UNDER_REVIEW`; `disputed` `DISPUTE_OPEN`;
//   - outside `[endsAt, endsAt + dispute_window_hours)` by the database's clock, `DISPUTE_WINDOW_CLOSED`
//     (the line's «else»: before the end too); the window compared as completion compares it.
// A session whose earlier dispute an administrator resolved, or whose ruling was revised, holds its
// settled status again and is raised like any other while its window is open (G1): no remedy exists
// before the window closes.
//
// THE WRITE. Moderation opens the dispute (`openSessionDispute`; rule 46 refuses a second open one,
// answered `DISPUTE_OPEN`); the session is marked `disputed`, its outcome copied to
// `outcome_under_dispute` in the same update, or left NULL from `scheduled`, which the evaluation then
// writes (T014); one `session_events` row `dispute_raised` (FR-495). One info line after the commit,
// `{ sessionId, disputeId, userId }`, never the reason.
import type { SessionsDisputeRaiseInput, SessionsDisputeRaiseOutput } from '@ijazah/contracts';
import { addHours } from '@ijazah/time';

import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { lockRows } from '../../platform/db/row-lock.js';
import { DomainError, type ErrorCode } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { sessionPartiesOf } from '../identity/index.js';
import { type NewSessionDispute, openSessionDispute } from '../moderation/index.js';
import { DISPUTE_WINDOW_SETTING, disputeWindowHours } from './completion.service.js';
import {
  DISPUTABLE_STATUSES,
  type DisputableStatus,
  markDisputed,
} from './dispute-raise.repository.js';
import type { EnrollmentSide } from './enrollment-side.port.js';
import { recordSessionEvents, type SessionEventRecord } from './session-events.repository.js';
import { type PartySessionRow, sessionOfParty } from './sessions.repository.js';
import type { PartyStanding } from './sessions.service.js';

/** What the raise reads, locks and writes, each on the caller's transaction; faked in a spec. */
export interface DisputeRaiseStore {
  /** The session when `userId` is one of its parties, else null; no lock. */
  sessionOfParty(
    tx: Transaction,
    sessionId: string,
    userId: string,
  ): Promise<PartySessionRow | null>;
  /** The live accounts of `userIds` from identity's records; a deleted one is absent. */
  partiesOf(
    tx: Transaction,
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, PartyStanding>>;
  /** The raiser's `users` row, `FOR UPDATE`. */
  lockRaiser(tx: Transaction, userId: string): Promise<void>;
  /** The session's row, `FOR UPDATE`. */
  lockSession(tx: Transaction, sessionId: string): Promise<void>;
  /** Moderation's `openSessionDispute`: the dispute's id, or null when one is open. */
  openDispute(tx: Transaction, dispute: NewSessionDispute): Promise<string | null>;
  markDisputed(tx: Transaction, sessionId: string, from: DisputableStatus): Promise<boolean>;
  recordEvents(tx: Transaction, events: readonly SessionEventRecord[]): Promise<void>;
}

/** The store over sessions' tables and lock, identity's accounts and moderation's disputes. */
export const disputeRaiseStore: DisputeRaiseStore = {
  sessionOfParty,
  partiesOf: sessionPartiesOf,
  lockRaiser: (tx, userId) => lockRows(tx, 'users', [userId]),
  lockSession: (tx, sessionId) => lockRows(tx, 'sessions', [sessionId]),
  openDispute: openSessionDispute,
  markDisputed,
  recordEvents: recordSessionEvents,
};

export interface DisputeRaiseDependencies {
  /** The kernel's idempotency, as `main.ts` binds it. */
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'run'>;
  readonly settings: SettingsReader;
  readonly enrollments: Pick<EnrollmentSide, 'lockEnrollments'>;
  /** The database's clock on the call's transaction; `clockTimestamp` in production. */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly store?: DisputeRaiseStore;
}

export interface DisputeRaise {
  raiseDispute(
    caller: { readonly userId: string },
    input: SessionsDisputeRaiseInput,
    log: Logger,
  ): Promise<SessionsDisputeRaiseOutput>;
}

/** Why a raise was refused, as its one log line names it. */
type RefusalReason =
  | 'not_a_party'
  | 'gender_differs'
  | 'party_not_active'
  | 'teacher_not_approved'
  | 'cancelled'
  | 'under_review'
  | 'dispute_open'
  | 'before_end'
  | 'window_closed';

// 003:T112 (the owner's Q-B (a)): a postponed session is never disputed, as a cancelled one.
const CANCELLED: ReadonlySet<string> = new Set([
  'cancelled_by_agreement',
  'cancelled_by_admin',
  'postponed',
]);
const UNDER_REVIEW: ReadonlySet<string> = new Set(['under_threshold', 'provider_outage']);
const DISPUTABLE: ReadonlySet<string> = new Set(DISPUTABLE_STATUSES);

const isDisputable = (status: string): status is DisputableStatus => DISPUTABLE.has(status);

/** Logs the refusal with ids and its reason only, and answers the error to throw, marked logged. */
function refusal(
  log: Logger,
  ids: { readonly sessionId: string; readonly userId: string },
  errorCode: ErrorCode,
  reason: RefusalReason,
): DomainError {
  log.info({ ...ids, errorCode, reason }, 'A session dispute was refused');
  return markRefusalLogged(new DomainError(errorCode));
}

export function createDisputeRaise({
  idempotency,
  settings,
  enrollments,
  clock = clockTimestamp,
  store = disputeRaiseStore,
}: DisputeRaiseDependencies): DisputeRaise {
  return {
    raiseDispute: async ({ userId }, { sessionId, reason, idempotencyKey }, log) => {
      const ids = { sessionId, userId };
      const windowHours = await settings.read(DISPUTE_WINDOW_SETTING, disputeWindowHours);
      const raised = await idempotency.run(
        {
          scope: 'sessions.dispute.raise',
          key: idempotencyKey,
          actorId: userId,
          input: { sessionId, reason },
        },
        async (tx) => {
          const seen = await store.sessionOfParty(tx, sessionId, userId);
          if (seen === null) throw refusal(log, ids, 'NOT_FOUND', 'not_a_party');
          await store.lockRaiser(tx, userId);
          await enrollments.lockEnrollments(tx, [seen.enrollmentId]);
          await store.lockSession(tx, sessionId);
          const session = await store.sessionOfParty(tx, sessionId, userId);
          if (session === null) throw refusal(log, ids, 'NOT_FOUND', 'not_a_party');

          const counterpartyId =
            session.studentUserId === userId ? session.teacherUserId : session.studentUserId;
          const parties = await store.partiesOf(tx, [session.studentUserId, session.teacherUserId]);
          const own = parties.get(userId);
          const counterparty = parties.get(counterpartyId);
          if (own === undefined) throw refusal(log, ids, 'NOT_FOUND', 'not_a_party');
          if (counterparty !== undefined && counterparty.gender !== own.gender) {
            throw refusal(log, ids, 'NOT_FOUND', 'gender_differs');
          }
          if (own.accountStatus !== 'active') {
            throw refusal(log, ids, 'ACCOUNT_RESTRICTED', 'party_not_active');
          }
          if (userId === session.teacherUserId && !own.teacherApproved) {
            throw refusal(log, ids, 'ACCOUNT_RESTRICTED', 'teacher_not_approved');
          }

          const { status } = session;
          if (CANCELLED.has(status)) throw refusal(log, ids, 'NOT_DISPUTABLE', 'cancelled');
          if (UNDER_REVIEW.has(status)) {
            throw refusal(log, ids, 'SESSION_UNDER_REVIEW', 'under_review');
          }
          if (!isDisputable(status)) throw refusal(log, ids, 'DISPUTE_OPEN', 'dispute_open');

          const at = await clock(tx);
          if (at.getTime() < session.endsAt.getTime()) {
            throw refusal(log, ids, 'DISPUTE_WINDOW_CLOSED', 'before_end');
          }
          const closesAt = new Date(addHours(session.endsAt, windowHours));
          if (at.getTime() >= closesAt.getTime()) {
            throw refusal(log, ids, 'DISPUTE_WINDOW_CLOSED', 'window_closed');
          }

          const disputeId = await store.openDispute(tx, {
            enrollmentId: session.enrollmentId,
            sessionId,
            raisedByUserId: userId,
            reason,
          });
          if (disputeId === null) throw refusal(log, ids, 'DISPUTE_OPEN', 'dispute_open');
          // Under the session's lock its status cannot have moved since it was read.
          if (!(await store.markDisputed(tx, sessionId, status))) {
            throw new Error('sessions: a locked session moved under its lock');
          }
          await store.recordEvents(tx, [
            {
              enrollmentId: session.enrollmentId,
              sessionId,
              kind: 'dispute_raised',
              occurredAt: at,
            },
          ]);
          return { disputeId, status: 'open' as const };
        },
      );
      log.info({ sessionId, disputeId: raised.disputeId, userId }, 'A session dispute was raised');
      return raised;
    },
  };
}
