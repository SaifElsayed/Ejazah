// T021 of specs/004-sessions: `sessions.cancellation.request` and `.answer` (FR-456, FR-457, FR-458,
// FR-461, FR-485, FR-495; SC-411; research R-310; contracts/app-surface.md,
// "`sessions.cancellation`"; contracts/kernel.md, the rows «cancellation request, a decline» and
// «cancellation accepted»).
//
// WHO MAY ASK OR ANSWER (FR-456, R-GENDER-2). Either party of a session asks; the counterparty
// answers. The caller's own id finds the session, or the request with its session, together with
// its party, so another person's and a nonexistent one answer the same `NOT_FOUND`, and so does the
// requester answering their own request. A counterparty of the other gender by the server's records
// answers that `NOT_FOUND` too, read under the locks as the join reads it (R-GENDER-4).
//
// THE LOCKS (kernel.md; T005's rules; the general rule of Phase 3). A request and a decline take
// `users` (both parties, one call, id order), the session's `enrollments` row, the `sessions` row,
// then `cancellation_requests`: every `session_events` row they write key-shares the enrollment, so
// the enrollment is taken before the session. An acceptance takes «cancellation accepted»'s row:
// `users` (both), the teacher's `lockKey('teacher-slots')`, `enrollments`, `sessions`, the session's
// `session_remedies`, then the request; the make-up it owes is offered in that place by T028 (B38),
// and an acceptance made before T028 lands is offered its remedy by T028's sweep (the analysis's F8).
// A request decides on the session's pending request, so it locks that row, when there is one, and
// reads it again (rule 1); the second line is rule 45's partial unique index, whose refusal is
// answered as the same `CANCELLATION_PENDING`. Each decision is read under the locks: the session,
// the request and both accounts read again, and the database's clock read after them
// (`clockTimestamp`), so an answer that waited on a lock past the start is refused (SC-411).
//
// THE WINDOW (FR-458, R-320; decision 14 (ii)). Until the session's scheduled start, with no minimum
// notice: at or after it a request and an answer are refused `CANCELLATION_EXPIRED` and change
// nothing. A request is read as expired from the start whatever its row says;
// `expire-cancellation-requests` (T022) writes `expired` for the record.
//
// A SESSION NO LONGER SCHEDULED (the owner's decision of 2026-11-06 on PR #126's review, follow-up
// 3). Every path that cancels a session leaves its pending request as it is (an administrator's
// cancellation, T023; an enrollment's end, T004 to T006; a complaint's decision, T060), so an
// answer, accept or decline, to a request whose session is no longer `scheduled` is refused
// `SESSION_NOT_SCHEDULED`, read under the locks, nothing written; a request on such a session the
// same.
//
// THE ORDER OF THE REFUSALS. A request: `NOT_FOUND`, `SESSION_NOT_SCHEDULED`,
// `CANCELLATION_EXPIRED`, then `CANCELLATION_PENDING` with the open request's id. An answer (the
// owner's decision of 2026-11-10 on B37, Q2): `NOT_FOUND`, `CANCELLATION_EXPIRED`,
// `SESSION_NOT_SCHEDULED`, then a request no longer pending (answered, or written expired)
// `CONFLICT` with `details.cause` `not_pending`, an addition to the contract (contracts/README.md,
// "Errors").
//
// WHAT IS WRITTEN. A request: one `pending` row and one `session_events` row
// `cancellation_requested`, keyed by the kernel's idempotency (`sessions.cancellation.request`), so
// a retry with the same key answers the first outcome and writes nothing. An answer: the request
// `accepted` or `declined` with `responded_at`, one `session_events` row `cancellation_accepted` or
// `cancellation_declined`, and on an acceptance the session `cancelled_by_agreement` (FR-457), which
// frees both parties' time (ERD §15 rule 19) and counts nothing against either party (FR-485). No
// path here cancels a whole enrollment or moves a session (FR-461).
//
// THE LOG (the owner's rule). Every refusal writes one info line, through this file's `refusal()`,
// with the ids (the session or the request, the caller, and a pending request's id) and the reason
// code, nothing else: never the reason the person wrote.
import type {
  SessionsCancellationAnswerInput,
  SessionsCancellationAnswerOutput,
  SessionsCancellationRequestInput,
  SessionsCancellationRequestOutput,
  SessionsGetOutput,
} from '@ijazah/contracts';

import { clockTimestamp } from '../../platform/db/db-clock.js';
import { isUniqueViolation } from '../../platform/db/db-errors.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { Transactions } from '../../platform/db/transaction.repository.js';
import {
  DomainError,
  type ErrorCode,
  type FieldIssue,
} from '../../platform/errors/domain-error.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import type { Logger } from '../../platform/logging/logger.js';
import { sessionPartiesOf } from '../identity/index.js';
import {
  answerRequest,
  type CancellationRequestRow,
  cancelByAgreement,
  insertRequest,
  lockRemediesOf,
  lockRequests,
  lockSessions,
  lockTeacherSlots,
  pendingRequestOf,
  requestById,
  requestOfParty,
} from './cancellation.repository.js';
import type { EnrollmentSide } from './enrollment-side.port.js';
import { recordSessionEvents, type SessionEventRecord } from './session-events.repository.js';
import { lockSessionParties, type PartySessionRow, sessionOfParty } from './sessions.repository.js';

/** What the cancellation reads, locks and writes, each on the caller's transaction; faked in a spec. */
export interface CancellationStore {
  /** The session when `userId` is one of its two parties, else null; no lock. */
  sessionOfParty(
    tx: Transaction,
    sessionId: string,
    userId: string,
  ): Promise<PartySessionRow | null>;
  /** The request when `userId` is a party of its session, else null; no lock. */
  requestOfParty(
    tx: Transaction,
    requestId: string,
    userId: string,
  ): Promise<CancellationRequestRow | null>;
  /** The live accounts' genders from identity's records; a deleted one is absent. */
  partiesOf(
    tx: Transaction,
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, { readonly gender: 'male' | 'female' }>>;
  /** Both accounts, `FOR UPDATE`, in one call. */
  lockAccounts(tx: Transaction, userIds: readonly string[]): Promise<void>;
  /** The teacher's `lockKey('teacher-slots')`. */
  lockTeacherSlots(tx: Transaction, teacherUserId: string): Promise<void>;
  lockSessions(tx: Transaction, ids: readonly string[]): Promise<void>;
  /** The session's remedy rows, `FOR UPDATE`. */
  lockRemediesOf(tx: Transaction, sessionId: string): Promise<void>;
  lockRequests(tx: Transaction, ids: readonly string[]): Promise<void>;
  /** The session's pending request's id, else null. */
  pendingRequestOf(tx: Transaction, sessionId: string): Promise<string | null>;
  requestById(tx: Transaction, id: string): Promise<CancellationRequestRow | null>;
  insertRequest(
    tx: Transaction,
    row: {
      readonly sessionId: string;
      readonly requestedByUserId: string;
      readonly reason: string;
    },
  ): Promise<string>;
  /** The conditional answer; whether it moved the row. */
  answerRequest(
    tx: Transaction,
    id: string,
    answer: 'accepted' | 'declined',
    at: Date,
  ): Promise<boolean>;
  /** The conditional cancellation; whether it moved the row. */
  cancelByAgreement(tx: Transaction, sessionId: string): Promise<boolean>;
  /** T004's writer of `session_events` rows. */
  recordEvents(tx: Transaction, events: readonly SessionEventRecord[]): Promise<void>;
}

/** The store over sessions' tables, the kernel's locks and identity's accounts (R-API-6). */
export const cancellationStore: CancellationStore = {
  sessionOfParty,
  requestOfParty,
  partiesOf: sessionPartiesOf,
  lockAccounts: lockSessionParties,
  lockTeacherSlots,
  lockSessions,
  lockRemediesOf,
  lockRequests,
  pendingRequestOf,
  requestById,
  insertRequest,
  answerRequest,
  cancelByAgreement,
  recordEvents: recordSessionEvents,
};

/** The person asking, from the server-held session. */
export interface CancellationCaller {
  readonly userId: string;
}

/** `sessions.cancellation.request` and `.answer`. */
export interface CancellationServices {
  request(
    caller: CancellationCaller,
    input: SessionsCancellationRequestInput,
    log: Logger,
  ): Promise<SessionsCancellationRequestOutput>;
  answer(
    caller: CancellationCaller,
    input: SessionsCancellationAnswerInput,
    log: Logger,
  ): Promise<SessionsCancellationAnswerOutput>;
}

export interface CancellationDependencies {
  readonly transactions: Transactions;
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'run'>;
  readonly enrollments: Pick<EnrollmentSide, 'lockEnrollments'>;
  readonly store?: CancellationStore;
  /** The database's clock on a transaction (`clockTimestamp`). */
  readonly clock?: (tx: Transaction) => Promise<Date>;
}

/** Why a request or an answer was refused, as its one log line names it. */
type RefusalReason =
  | 'not_a_party'
  | 'own_request'
  | 'gender_differs'
  | 'not_scheduled'
  | 'started'
  | 'request_pending'
  | 'not_pending';

/** The ids a refusal's line names: the session or the request, the caller, a pending request. */
interface RefusalIds {
  readonly sessionId?: string;
  readonly requestId?: string;
  readonly userId: string;
}

/** Logs the refusal with ids and its reason only, and answers the error to throw. */
function refusal(
  log: Logger,
  ids: RefusalIds,
  errorCode: ErrorCode,
  reason: RefusalReason,
  // The shape of DomainError's own options (`domain-error.ts`), written out so no literal index is.
  details?: { readonly details?: readonly FieldIssue[]; readonly cause?: unknown },
): DomainError {
  log.info({ ...ids, errorCode, reason }, 'A cancellation request or answer was refused');
  return new DomainError(errorCode, undefined, details);
}

const SCOPE = 'sessions.cancellation.request';

export function createCancellationServices({
  transactions,
  idempotency,
  enrollments,
  store = cancellationStore,
  clock = clockTimestamp,
}: CancellationDependencies): CancellationServices {
  /** The session's two accounts, in id order (rule 2). */
  const partiesInOrder = (session: PartySessionRow) =>
    [session.studentUserId, session.teacherUserId].sort();

  /**
   * Under the locks: the session read again, the other gender refused as a nonexistent session;
   * answers the session and the database's clock read after them. Each path then refuses in its
   * own order (`notScheduled`, `started`).
   */
  async function decidable(
    tx: Transaction,
    sessionId: string,
    log: Logger,
    ids: RefusalIds,
  ): Promise<{ readonly session: PartySessionRow; readonly at: Date }> {
    const session = await store.sessionOfParty(tx, sessionId, ids.userId);
    if (session === null) throw refusal(log, ids, 'NOT_FOUND', 'not_a_party');
    const parties = await store.partiesOf(tx, partiesInOrder(session));
    const own = parties.get(ids.userId);
    const other = parties.get(
      session.studentUserId === ids.userId ? session.teacherUserId : session.studentUserId,
    );
    if (own === undefined) throw refusal(log, ids, 'NOT_FOUND', 'not_a_party');
    if (other !== undefined && other.gender !== own.gender) {
      throw refusal(log, ids, 'NOT_FOUND', 'gender_differs');
    }
    return { session, at: await clock(tx) };
  }

  /** A session no longer `scheduled` refused `SESSION_NOT_SCHEDULED`. */
  function notScheduled(session: PartySessionRow, log: Logger, ids: RefusalIds): void {
    if (session.status !== 'scheduled') {
      throw refusal(log, ids, 'SESSION_NOT_SCHEDULED', 'not_scheduled');
    }
  }

  /** At or after the session's start, by the clock read under the locks, `CANCELLATION_EXPIRED`. */
  function started(session: PartySessionRow, at: Date, log: Logger, ids: RefusalIds): void {
    if (at.getTime() >= session.startsAt.getTime()) {
      throw refusal(log, ids, 'CANCELLATION_EXPIRED', 'started');
    }
  }

  return {
    request: ({ userId }, { idempotencyKey, ...asked }, log) =>
      idempotency.run(
        { scope: SCOPE, key: idempotencyKey, actorId: userId, input: asked },
        async (tx) => {
          const ids = { sessionId: asked.sessionId, userId };
          const seen = await store.sessionOfParty(tx, asked.sessionId, userId);
          if (seen === null) throw refusal(log, ids, 'NOT_FOUND', 'not_a_party');
          await store.lockAccounts(tx, partiesInOrder(seen));
          await enrollments.lockEnrollments(tx, [seen.enrollmentId]);
          await store.lockSessions(tx, [seen.id]);
          let pending = await store.pendingRequestOf(tx, seen.id);
          if (pending !== null) {
            await store.lockRequests(tx, [pending]);
            pending = await store.pendingRequestOf(tx, seen.id);
          }
          const { session, at } = await decidable(tx, seen.id, log, ids);
          // The request's order (approved 2026-11-10): the status, then the start.
          notScheduled(session, log, ids);
          started(session, at, log, ids);
          if (pending !== null) {
            throw refusal(
              log,
              { ...ids, requestId: pending },
              'CANCELLATION_PENDING',
              'request_pending',
              { details: [{ path: 'requestId', code: pending }] },
            );
          }
          let requestId: string;
          try {
            requestId = await store.insertRequest(tx, {
              sessionId: session.id,
              requestedByUserId: userId,
              reason: asked.reason,
            });
          } catch (error: unknown) {
            if (isUniqueViolation(error, 'cancellation_requests_one_pending_key')) {
              throw refusal(log, ids, 'CANCELLATION_PENDING', 'request_pending', { cause: error });
            }
            throw error;
          }
          await store.recordEvents(tx, [
            {
              enrollmentId: session.enrollmentId,
              sessionId: session.id,
              kind: 'cancellation_requested',
              occurredAt: at,
            },
          ]);
          return {
            requestId,
            status: 'pending' as const,
            expiresAt: session.startsAt.toISOString(),
          };
        },
      ),

    answer: ({ userId }, { requestId, accept }, log) =>
      transactions.run(async (tx) => {
        const found = await store.requestOfParty(tx, requestId, userId);
        if (found === null) throw refusal(log, { requestId, userId }, 'NOT_FOUND', 'not_a_party');
        if (found.requestedByUserId === userId) {
          throw refusal(log, { requestId, userId }, 'NOT_FOUND', 'own_request');
        }
        const seen = await store.sessionOfParty(tx, found.sessionId, userId);
        if (seen === null) throw refusal(log, { requestId, userId }, 'NOT_FOUND', 'not_a_party');
        const ids = { requestId, sessionId: seen.id, userId };

        await store.lockAccounts(tx, partiesInOrder(seen));
        if (accept) await store.lockTeacherSlots(tx, seen.teacherUserId);
        await enrollments.lockEnrollments(tx, [seen.enrollmentId]);
        await store.lockSessions(tx, [seen.id]);
        if (accept) await store.lockRemediesOf(tx, seen.id);
        await store.lockRequests(tx, [requestId]);

        const request = await store.requestById(tx, requestId);
        // A request is never deleted (data-model.md §2.6); its row stands under its own lock.
        if (request === null) throw new Error('sessions: a locked cancellation request vanished');
        const { session, at } = await decidable(tx, seen.id, log, ids);
        // The answer's order (the owner's decision of 2026-11-10, B37 Q2): the start, the status,
        // then the request no longer pending, `CONFLICT` with `details.cause` `not_pending`.
        started(session, at, log, ids);
        notScheduled(session, log, ids);
        if (request.status !== 'pending') {
          throw refusal(log, ids, 'CONFLICT', 'not_pending', {
            details: [{ path: 'cause', code: 'not_pending' }],
          });
        }

        const status = accept ? 'accepted' : 'declined';
        // Both conditional updates hold: the request is pending and the session scheduled under
        // the locks just read.
        await store.answerRequest(tx, requestId, status, at);
        if (accept) await store.cancelByAgreement(tx, session.id);
        await store.recordEvents(tx, [
          {
            enrollmentId: session.enrollmentId,
            sessionId: session.id,
            kind: accept ? 'cancellation_accepted' : 'cancellation_declined',
            occurredAt: at,
          },
        ]);
        return {
          requestId,
          status,
          sessionStatus: accept ? 'cancelled_by_agreement' : session.status,
        };
      }),
  };
}

/** `sessions.get`'s `cancellation`, as the contract shapes it. */
export type CancellationView = NonNullable<SessionsGetOutput['cancellation']>;

/**
 * The session's latest request as `viewerId` reads it at `at` (FR-458, FR-495): a stored `pending`
 * reads as `expired` from the session's start and once the session is no longer `scheduled`
 * (follow-up 3 of PR #126's review: «shown as over»); its expiry is the start.
 */
export function cancellationViewOf(
  request: CancellationRequestRow,
  session: Pick<PartySessionRow, 'startsAt' | 'status'>,
  viewerId: string,
  at: Date,
): CancellationView {
  const over = session.status !== 'scheduled' || at.getTime() >= session.startsAt.getTime();
  return {
    requestId: request.id,
    requestedByMe: request.requestedByUserId === viewerId,
    reason: request.reason,
    status: request.status === 'pending' && over ? 'expired' : request.status,
    expiresAt: session.startsAt.toISOString(),
  };
}
