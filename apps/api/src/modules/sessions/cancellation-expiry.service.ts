// T022 of specs/004-sessions/tasks.md (FR-458; SC-411; research R-310; contracts/kernel.md, the
// `expire-cancellation-requests` row and "Jobs"): what the `expire-cancellation-requests` sweep runs
// every minute (`jobs/expire-cancellation-requests.ts`).
//
// THE REQUESTS DUE. Each run reads the database's clock once (`clockTimestamp`), then the pending
// requests whose session's scheduled start is at or before it, a page at a time in id order, with
// no lock. A request is read as expired from the start whatever its row says (FR-458,
// `cancellationViewOf`, and the answer's `CANCELLATION_EXPIRED`); the sweep writes `expired` for
// the record, so no request is pending after its start once a run has passed it (SC-411).
//
// EACH IN ITS OWN TRANSACTION (kernel.md's row, the owner's decision of 2026-11-06 on the fourth
// analysis, L1; T005's rules). The session's `enrollments` row (`EnrollmentSide.lockEnrollments`),
// then the `sessions` row, then the `cancellation_requests` row: the order «cancellation accepted»
// takes for the same rows, so the `cancellation_expired` row's insert, whose foreign key key-shares
// the enrollment, never waits on an enrollment while holding the request. The request is read again
// under them: left as it is when no longer `pending` (an answer committed first) or its session's
// start, read under the locks, is after the clock read under them (a re-resolution moved it). Then
// one conditional update to `expired` (no `responded_at`: an expiry is no answer, ERD §15 rule 45)
// and one `session_events` row `cancellation_expired` through T004's writer.
//
// THE LOG (the owner's rule). Each expiry, an automatic action, writes one info line
// `{ requestId, sessionId }` after its commit; a request left as it is writes none. A request whose
// expiry fails writes one error line `{ requestId }` and is reported to error tracking, and the run
// goes on to the next, which a later run retries. Run twice, it leaves what one run leaves
// (R-API-14): a request expires once, by the `pending` guard read under its locks, with one row.
import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { Transactions } from '../../platform/db/transaction.repository.js';
import { reportError } from '../../platform/errors/reporting.js';
import type { Logger } from '../../platform/logging/logger.js';
import {
  type DueRequest,
  dueForExpiry,
  expireRequest,
  lockRequests,
  lockSessions,
  type RequestToExpire,
  requestToExpire,
} from './cancellation.repository.js';
import type { EnrollmentSide } from './enrollment-side.port.js';
import { recordSessionEvents, type SessionEventRecord } from './session-events.repository.js';

export type { DueRequest, RequestToExpire } from './cancellation.repository.js';

/** What the expiry reads and writes, each on the caller's transaction. */
export interface CancellationExpiryStore {
  /** The pending requests whose session started by `at`, in id order after `after`; no lock. */
  dueForExpiry(
    tx: Transaction,
    at: Date,
    after: string | undefined,
    limit: number,
  ): Promise<readonly DueRequest[]>;
  lockSessions(tx: Transaction, ids: readonly string[]): Promise<void>;
  lockRequests(tx: Transaction, ids: readonly string[]): Promise<void>;
  /** The request with its session's start, read under the caller's locks. */
  requestToExpire(tx: Transaction, id: string): Promise<RequestToExpire | null>;
  /** The conditional update; whether it moved the row. */
  expire(tx: Transaction, id: string): Promise<boolean>;
  /** T004's writer of `session_events` rows. */
  recordEvents(tx: Transaction, events: readonly SessionEventRecord[]): Promise<void>;
}

/** The expiry's store over sessions' tables. */
export const cancellationExpiryStore: CancellationExpiryStore = {
  dueForExpiry,
  lockSessions,
  lockRequests,
  requestToExpire,
  expire: expireRequest,
  recordEvents: recordSessionEvents,
};

/** What a run expired and what failed, by request id. */
export interface ExpiryRun {
  readonly expired: readonly string[];
  readonly failed: readonly string[];
}

export interface CancellationExpiry {
  /** Expires every pending request whose session has started, each in its own transaction. */
  expireStarted(): Promise<ExpiryRun>;
}

export function createCancellationExpiry({
  transactions,
  enrollments,
  log,
  pageSize,
  report = reportError,
  clock = clockTimestamp,
  store = cancellationExpiryStore,
}: {
  readonly transactions: Transactions;
  readonly enrollments: Pick<EnrollmentSide, 'lockEnrollments'>;
  readonly log: Pick<Logger, 'info' | 'error'>;
  /** How many due requests are read at a time (the job's). */
  readonly pageSize: number;
  /** Error tracking; `reportError` unless a spec sets one. */
  readonly report?: (error: Error) => void;
  /** The database's clock on a transaction (`clockTimestamp`). */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly store?: CancellationExpiryStore;
}): CancellationExpiry {
  /** One request on its own transaction; whether it expired it. */
  const expireOne = (due: DueRequest): Promise<boolean> =>
    transactions.run(async (tx) => {
      await enrollments.lockEnrollments(tx, [due.enrollmentId]);
      await store.lockSessions(tx, [due.sessionId]);
      await store.lockRequests(tx, [due.id]);
      const request = await store.requestToExpire(tx, due.id);
      if (request === null || request.status !== 'pending') return false;
      const at = await clock(tx);
      if (request.startsAt.getTime() > at.getTime()) return false;
      if (!(await store.expire(tx, request.id))) return false;
      await store.recordEvents(tx, [
        {
          enrollmentId: request.enrollmentId,
          sessionId: request.sessionId,
          kind: 'cancellation_expired',
          occurredAt: at,
        },
      ]);
      return true;
    });

  return {
    expireStarted: async () => {
      const at = await transactions.run((tx) => clock(tx));
      const expired: string[] = [];
      const failed: string[] = [];
      let after: string | undefined;
      for (;;) {
        const page = await transactions.run((tx) => store.dueForExpiry(tx, at, after, pageSize));
        for (const due of page) {
          try {
            if (!(await expireOne(due))) continue;
            expired.push(due.id);
            log.info(
              { requestId: due.id, sessionId: due.sessionId },
              'Cancellation request expired',
            );
          } catch (error: unknown) {
            failed.push(due.id);
            log.error({ requestId: due.id }, 'Cancellation request expiry failed');
            report(error instanceof Error ? error : new Error(String(error)));
          }
        }
        if (page.length < pageSize) break;
        after = page.at(-1)?.id;
      }
      return { expired, failed };
    },
  };
}
