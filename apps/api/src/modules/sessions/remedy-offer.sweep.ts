// T028 of specs/004-sessions/tasks.md (FR-462, FR-449; research R-311, "Offering" and "Frozen"; the
// notes under T028, Q3, Q8, Q11, and its follow-up on the unindexed reads): what `advance-remedies`
// runs every minute, before T032's windows' ends.
//
//   1. Each session owing a remedy that has none, whose dispute window has closed by the run's
//      instant (the database's clock, Q8), and each Cancelled-By-Agreement session with none (an
//      acceptance before T028 landed, F8): offered through `RemedyOffer.offer`, which takes the offer
//      row's locks and decides again under them.
//   2. Each `frozen` remedy: offered again as a new offer once its student is no longer suspended
//      (the offer reads the standing under the locks; a still-suspended student's is postponed).
//   3. T015's completion check over the `confirmed` enrollments whose sessions all have an outcome no
//      longer waiting, each under its enrollment's lock: an enrollment whose last window has closed
//      completes, one with an open `student_suspended` or `admin_cancellation` case waits (Q3 (a)).
//
// Every read is paged by id, and each item runs in its own transaction: a failure is caught on its
// own, rolled back, logged by its id at error and reported, and the run goes on; the next run tries
// it again (as T014's evaluation does). Each automatic action writes one info line after its commit
// (Q11): `{ remedyId, sessionId, enrollmentId, action }` for an offer, `{ enrollmentId }` for a
// completion; a postponement writes none.
//
// IDEMPOTENT (R-API-14). An offer is one row per session (its unique key, read again under the
// locks); a completion is one move from `confirmed`. A second run finds nothing more to do.
import { addHours } from '@ijazah/time';

import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { Transactions } from '../../platform/db/transaction.repository.js';
import { reportError } from '../../platform/errors/reporting.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import {
  type Completion,
  DISPUTE_WINDOW_SETTING,
  disputeWindowHours,
} from './completion.service.js';
import type {
  EnrollmentPageFilter,
  EnrollmentSide,
  EnrollmentStatus,
} from './enrollment-side.port.js';
import {
  type DueOffer,
  dueForOffer,
  enrollmentsSettledAmong,
  frozenRemedies,
} from './remedy-offer.repository.js';
import { type Offered, offeredLine, type RemedyOffer } from './remedy-offer.service.js';

/**
 * The enrollments T015's check is asked about: a read filter, never a write (the confirmation gate,
 * `tests/pipeline/confirmation-path.spec.ts`, reads a `status` literal as a write).
 */
const CONFIRMED: EnrollmentStatus = 'confirmed';
const CONFIRMED_ENROLLMENTS: EnrollmentPageFilter = { status: CONFIRMED };

/** The sweep's reads, each on its own transaction with no lock; narrowed in a spec. */
export interface RemedyAdvanceStore {
  dueForOffer(
    tx: Transaction,
    endedBy: Date,
    after: string | undefined,
    limit: number,
  ): Promise<readonly DueOffer[]>;
  frozenRemedies(
    tx: Transaction,
    after: string | undefined,
    limit: number,
  ): Promise<readonly { remedyId: string; sessionId: string; studentUserId: string }[]>;
  enrollmentsSettledAmong(
    tx: Transaction,
    enrollmentIds: readonly string[],
  ): Promise<readonly string[]>;
}

export const remedyAdvanceStore: RemedyAdvanceStore = {
  dueForOffer,
  frozenRemedies,
  enrollmentsSettledAmong,
};

/** What a run did, by id. */
export interface AdvanceRun {
  readonly offered: readonly string[];
  readonly reoffered: readonly string[];
  readonly completed: readonly string[];
  /** The sessions and enrollments whose step failed, left for the next run. */
  readonly failed: readonly string[];
}

export interface RemedyAdvance {
  /** One run of the sweep (this file's head). */
  run(): Promise<AdvanceRun>;
}

export interface RemedyAdvanceDependencies {
  readonly transactions: Transactions;
  readonly offer: Pick<RemedyOffer, 'offer'>;
  readonly completion: Completion;
  readonly enrollments: Pick<EnrollmentSide, 'enrollmentPage' | 'lockEnrollments'>;
  readonly settings: SettingsReader;
  readonly log: Pick<Logger, 'info' | 'error'>;
  /** How many rows each read takes (the job's). */
  readonly pageSize: number;
  /** Error tracking; `reportError` unless a spec sets one. */
  readonly report?: (error: Error) => void;
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly store?: RemedyAdvanceStore;
}

export function createRemedyAdvance({
  transactions,
  offer,
  completion,
  enrollments,
  settings,
  log,
  pageSize,
  report = reportError,
  clock = clockTimestamp,
  store = remedyAdvanceStore,
}: RemedyAdvanceDependencies): RemedyAdvance {
  const failedWith = (error: unknown): Error =>
    error instanceof Error ? error : new Error(String(error));

  /** One session's offer on its own transaction, its line after the commit. */
  async function offerOne(sessionId: string, failed: string[]): Promise<Offered | null> {
    try {
      const offered = await transactions.run((tx) => offer.offer(tx, sessionId));
      if (offered !== null) offeredLine(log, offered);
      return offered;
    } catch (error: unknown) {
      failed.push(sessionId);
      log.error({ sessionId }, 'Remedy offer failed');
      report(failedWith(error));
      return null;
    }
  }

  async function offerDue(endedBy: Date, offered: string[], failed: string[]): Promise<void> {
    let after: string | undefined;
    for (;;) {
      const page = await transactions.run((tx) => store.dueForOffer(tx, endedBy, after, pageSize));
      for (const { sessionId } of page) {
        const done = await offerOne(sessionId, failed);
        if (done !== null) offered.push(done.remedyId);
      }
      if (page.length < pageSize) return;
      after = page.at(-1)?.sessionId;
    }
  }

  async function reofferFrozen(reoffered: string[], failed: string[]): Promise<void> {
    let after: string | undefined;
    for (;;) {
      const page = await transactions.run((tx) => store.frozenRemedies(tx, after, pageSize));
      for (const { sessionId } of page) {
        const done = await offerOne(sessionId, failed);
        if (done !== null) reoffered.push(done.remedyId);
      }
      if (page.length < pageSize) return;
      after = page.at(-1)?.remedyId;
    }
  }

  async function completeDue(completed: string[], failed: string[]): Promise<void> {
    let cursor: string | undefined;
    for (;;) {
      const page = await transactions.run((tx) =>
        enrollments.enrollmentPage(tx, CONFIRMED_ENROLLMENTS, cursor, pageSize),
      );
      const ids = page.items.map(({ enrollmentId }) => enrollmentId);
      const candidates = await transactions.run((tx) => store.enrollmentsSettledAmong(tx, ids));
      for (const enrollmentId of candidates) {
        try {
          const done = await transactions.run(async (tx) => {
            await enrollments.lockEnrollments(tx, [enrollmentId]);
            return completion.completeIfDue(tx, enrollmentId);
          });
          if (!done) continue;
          completed.push(enrollmentId);
          log.info({ enrollmentId }, 'Enrollment completed');
        } catch (error: unknown) {
          failed.push(enrollmentId);
          log.error({ enrollmentId }, 'Enrollment completion failed');
          report(failedWith(error));
        }
      }
      if (page.nextCursor === undefined) return;
      cursor = page.nextCursor;
    }
  }

  return {
    run: async () => {
      const [at, hours] = await Promise.all([
        transactions.run((tx) => clock(tx)),
        settings.read(DISPUTE_WINDOW_SETTING, disputeWindowHours),
      ]);
      const offered: string[] = [];
      const reoffered: string[] = [];
      const completed: string[] = [];
      const failed: string[] = [];
      await offerDue(new Date(addHours(at, -hours)), offered, failed);
      await reofferFrozen(reoffered, failed);
      await completeDue(completed, failed);
      return { offered, reoffered, completed, failed };
    },
  };
}
