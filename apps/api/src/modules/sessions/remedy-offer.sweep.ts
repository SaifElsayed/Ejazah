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
//   T032 (FR-465, FR-466, FR-467; research R-311, "Windows ending"; D1; H5; A3; Q4 (a), Q11 (a)):
//   the windows' ends, after the offers and before the completion check, each remedy decided again
//   under its own locks by `remedy.service.ts`' `RemedyWindows` (its head holds the rules):
//      - each `counter_proposed` remedy whose answer window has closed by the run's instant
//        (`answerClosesAt`, D1, the remedy's own A) handed to a `counter_unanswered` case;
//      - each `proposed` or `awaiting_choice` remedy whose choice window has closed by the run's
//        instant: its proposal booked (H5), a refusal retried next run while it starts at least L
//        ahead, then handed to a `makeup_refused` case; a `frozen` one is read by neither.
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
import {
  choiceWindowsEnded,
  type PendingCounterDue,
  pendingCounters,
} from './remedy.repository.js';
import type { RemedyWindows } from './remedy.service.js';
import { answerClosesAt } from './remedy-deadlines.js';

/**
 * The enrollments T015's check is asked about. This is a read filter (`EnrollmentPageFilter`, the
 * `where` of `EnrollmentSide.enrollmentPage`), never a write: the confirmation gate
 * (`tests/pipeline/confirmation-path.spec.ts`) reads any `status: 'confirmed'` literal as a write, so
 * the value is a named constant, and the typecheck holds what that gate cannot read (its own «NOT
 * SEEN»: a `status` key whose value is a variable is the typecheck's, `:45-48`). The gate is left as
 * it is (the owner's decision of 2026-11-10).
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
  /** T032: the `counter_proposed` remedies, in id order after `after`. */
  pendingCounters(
    tx: Transaction,
    after: string | undefined,
    limit: number,
  ): Promise<readonly PendingCounterDue[]>;
  /** T032: the `proposed` and `awaiting_choice` remedies past `choice_closes_at` by `at`. */
  choiceWindowsEnded(
    tx: Transaction,
    at: Date,
    after: string | undefined,
    limit: number,
  ): Promise<readonly string[]>;
}

export const remedyAdvanceStore: RemedyAdvanceStore = {
  dueForOffer,
  frozenRemedies,
  enrollmentsSettledAmong,
  pendingCounters,
  choiceWindowsEnded,
};

/** What a run did, by id. */
export interface AdvanceRun {
  readonly offered: readonly string[];
  readonly reoffered: readonly string[];
  /** T032: the remedies handed to a case, `counter_unanswered` or `makeup_refused`. */
  readonly handedOff: readonly string[];
  /** T032: the proposals booked at their choice window's end (H5). */
  readonly booked: readonly string[];
  /** T032: the bookings refused or deadlocked this run, tried again next run. */
  readonly retried: readonly string[];
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
  /** T032: the windows' ends, one remedy at a time (`createRemedyWindows`). */
  readonly windows: RemedyWindows;
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
  windows,
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

  /** T032: one remedy's window end on its own, its failure caught, logged by its id and reported. */
  async function endOne<T>(
    remedyId: string,
    failed: string[],
    message: string,
    end: (id: string) => Promise<T>,
  ): Promise<T | undefined> {
    try {
      return await end(remedyId);
    } catch (error: unknown) {
      failed.push(remedyId);
      log.error({ remedyId }, message);
      report(failedWith(error));
      return undefined;
    }
  }

  /** T032: the pending counters whose answer window has closed by `at` (D1), each handed over. */
  async function endAnswerWindows(at: Date, handedOff: string[], failed: string[]) {
    let after: string | undefined;
    for (;;) {
      const page = await transactions.run((tx) => store.pendingCounters(tx, after, pageSize));
      for (const counter of page) {
        if (answerClosesAt(counter).getTime() > at.getTime()) continue;
        const done = await endOne(
          counter.remedyId,
          failed,
          'Remedy answer window end failed',
          windows.endAnswerWindow,
        );
        if (done === 'handed_off') handedOff.push(counter.remedyId);
      }
      if (page.length < pageSize) return;
      after = page.at(-1)?.remedyId;
    }
  }

  /** T032: the proposals whose choice window has closed by `at`, each booked, retried or handed over. */
  async function endChoiceWindows(
    at: Date,
    outcome: { booked: string[]; handedOff: string[]; retried: string[] },
    failed: string[],
  ) {
    let after: string | undefined;
    for (;;) {
      const page = await transactions.run((tx) =>
        store.choiceWindowsEnded(tx, at, after, pageSize),
      );
      for (const remedyId of page) {
        const done = await endOne(
          remedyId,
          failed,
          'Remedy choice window end failed',
          windows.bookAtChoiceEnd,
        );
        if (done === 'booked') outcome.booked.push(remedyId);
        if (done === 'handed_off') outcome.handedOff.push(remedyId);
        if (done === 'refused' || done === 'deadlocked') outcome.retried.push(remedyId);
      }
      if (page.length < pageSize) return;
      after = page.at(-1);
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
      const ended = { booked: [] as string[], handedOff: [] as string[], retried: [] as string[] };
      const completed: string[] = [];
      const failed: string[] = [];
      await offerDue(new Date(addHours(at, -hours)), offered, failed);
      await reofferFrozen(reoffered, failed);
      await endAnswerWindows(at, ended.handedOff, failed);
      await endChoiceWindows(at, ended, failed);
      await completeDue(completed, failed);
      return { offered, reoffered, ...ended, completed, failed };
    },
  };
}
