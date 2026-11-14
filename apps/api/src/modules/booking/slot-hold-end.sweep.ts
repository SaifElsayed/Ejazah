// T074 of specs/004-sessions/tasks.md (FR-505; SRS FR-CANCEL-9, DEC-69; the note under T074, Q-R1 (a),
// N1, N2, Q-R4 (a), Q-R5 (a), Q-R2; contracts/kernel.md, the sweep's row and "Jobs"; research R-323,
// P3-33): what `close-slot-holds` runs every hour, booking's. It records, once, the end of each held
// closing's hold as one `enrollment_events` row `slot_hold_ended`, and changes nothing else: the end
// itself is computed from the date by the one closing rule (R-DB-4), so a row written here is
// evidence only, which no read of the hold consults (Q-R2: `slotUses`, the monitor, the lift and the
// lists derive the hold from the case and the window, so a window lengthened after the row holds the
// slot again).
//
// THE CANDIDATES (N1). Every held closing, a page at a time in id order, read with no lock through
// T069's partial index (`slot-hold-end.repository.ts`); their cases in one read through moderation's
// `compensationCasesAmong`, and their recorded ends in one read of their rows, on the page's
// transaction. A candidate is due when, by the one closing rule (sessions' `closingOf`), its closing is
// admitted with its case open, its slot not released (`slot_released_at` NULL), the read's instant
// (the database's clock, `clockTimestamp`) at or after `restorableUntil` (the window of its kind,
// `windowDaysOf(settings)`), and no `slot_hold_ended` row follows its latest closing row (Q-R4 (a)).
// A case closed or a slot released before the date ends the hold another way, its evidence that case
// or that `slot_released` row: nothing is written for it.
//
// THE LOCK (N2; `003:T005`'s rules, the head of `platform/db/row-lock.ts`). Each due candidate on its
// own transaction: `lockRows('enrollments', [id])`, then the enrollment, its cases and its rows read
// again under the lock (rule 1), judged again, then the one row, which references the enrollment held
// and no account. No other lock: every path that moves a closing (a restore, a lift, a case's
// closing, a release) takes the enrollment's lock, so a race with any of them is serialised on it
// (Q-R5 (a)): the lift first, the enrollment read again `confirmed` and nothing written; the sweep
// first, its row before the restore's `restored` row.
//
// THE LOG (the owner's rule). One info line `{ enrollmentId, kind }` per row written, after its
// commit, `kind` the closing's kind; each item's failure caught on its own, rolled back, logged by its
// id at error and reported, and the run goes on (as T014's and T028's sweeps); the next run tries it
// again. IDEMPOTENT (R-API-14): a second run finds the row after the latest closing and writes none.
import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { lockRows } from '../../platform/db/row-lock.js';
import type { Transactions } from '../../platform/db/transaction.repository.js';
import { reportError } from '../../platform/errors/reporting.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { compensationCasesAmong, type EnrollmentCase } from '../moderation/index.js';
import {
  type ClosingKind,
  closingOf,
  latestEndCaseOf,
  restorableUntil,
  type WindowDays,
  windowDaysOf,
} from '../sessions/index.js';
import { type EnrollmentOutcome, recordEnrollmentEvents } from './enrollment-events.repository.js';
import {
  type HeldClosingRow,
  heldClosingOf,
  heldClosingsAfter,
  holdEndsRecordedAmong,
} from './slot-hold-end.repository.js';

export type { HeldClosingRow } from './slot-hold-end.repository.js';

/** What the sweep reads, locks and writes, each on the caller's transaction; faked in a spec. */
export interface SlotHoldEndStore {
  candidates(
    tx: Transaction,
    after: string | undefined,
    limit: number,
  ): Promise<readonly HeldClosingRow[]>;
  lockEnrollment(tx: Transaction, enrollmentId: string): Promise<void>;
  enrollmentOf(tx: Transaction, enrollmentId: string): Promise<HeldClosingRow | null>;
  /** Moderation's: each enrollment's compensation cases, newest first, with no lock. */
  casesAmong(
    tx: Transaction,
    enrollmentIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly EnrollmentCase[]>>;
  holdEndsRecordedAmong(
    tx: Transaction,
    enrollmentIds: readonly string[],
  ): Promise<ReadonlySet<string>>;
  recordEvents(tx: Transaction, outcomes: readonly EnrollmentOutcome[]): Promise<void>;
}

/** The store over booking's rows, the kernel's lock and moderation's entry (R-API-6). */
export const slotHoldEndStore: SlotHoldEndStore = {
  candidates: heldClosingsAfter,
  lockEnrollment: (tx, enrollmentId) => lockRows(tx, 'enrollments', [enrollmentId]),
  enrollmentOf: heldClosingOf,
  casesAmong: compensationCasesAmong,
  holdEndsRecordedAmong,
  recordEvents: recordEnrollmentEvents,
};

/** What a run did, by enrollment id. */
export interface SlotHoldEndRun {
  /** The enrollments whose hold's end was recorded this run. */
  readonly recorded: readonly string[];
  /** The enrollments whose step failed, left for the next run. */
  readonly failed: readonly string[];
}

export interface SlotHoldEndSweep {
  /** One run of the sweep (this file's head). */
  run(): Promise<SlotHoldEndRun>;
}

export interface SlotHoldEndDependencies {
  readonly transactions: Transactions;
  /** The two window settings, read through sessions' `windowDaysOf` on every run (FR-034). */
  readonly settings: SettingsReader;
  readonly log: Pick<Logger, 'info' | 'error'>;
  /** How many candidates each page reads (the job's). */
  readonly pageSize: number;
  /** Error tracking; `reportError` unless a spec sets one. */
  readonly report?: (error: Error) => void;
  /** The database's clock on the transaction (`clockTimestamp`). */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly store?: SlotHoldEndStore;
}

/** The closing's kind when its hold ended at `now` and is not yet recorded; null otherwise. */
async function endedHoldOf(
  row: HeldClosingRow,
  cases: readonly EnrollmentCase[],
  recorded: boolean,
  now: Date,
  windowDays: WindowDays,
): Promise<ClosingKind | null> {
  if (row.slotReleasedAt !== null || recorded) return null;
  const closing = closingOf({
    status: row.status,
    lastCancellationReason: row.cancellationReason,
    endCase: latestEndCaseOf(cases),
  });
  if (closing === undefined || !closing.restorable) return null;
  const until = await restorableUntil(closing.closingCase.createdAt, closing.kind, windowDays);
  return now.getTime() >= until.getTime() ? closing.kind : null;
}

export function createSlotHoldEndSweep({
  transactions,
  settings,
  log,
  pageSize,
  report = reportError,
  clock = clockTimestamp,
  store = slotHoldEndStore,
}: SlotHoldEndDependencies): SlotHoldEndSweep {
  const failedWith = (error: unknown): Error =>
    error instanceof Error ? error : new Error(String(error));

  /** Of `rows`, the due ones in id order, judged with no lock on the page's transaction. */
  const dueAmong = async (
    tx: Transaction,
    rows: readonly HeldClosingRow[],
    windowDays: WindowDays,
  ): Promise<string[]> => {
    const ids = rows.map(({ id }) => id);
    const [cases, recorded, now] = await Promise.all([
      store.casesAmong(tx, ids),
      store.holdEndsRecordedAmong(tx, ids),
      clock(tx),
    ]);
    const due: string[] = [];
    for (const row of rows) {
      const kind = await endedHoldOf(
        row,
        cases.get(row.id) ?? [],
        recorded.has(row.id),
        now,
        windowDays,
      );
      if (kind !== null) due.push(row.id);
    }
    return due;
  };

  /** One enrollment under its lock, read and judged again; the kind recorded, or null. */
  const recordOne = async (
    tx: Transaction,
    enrollmentId: string,
    windowDays: WindowDays,
  ): Promise<ClosingKind | null> => {
    await store.lockEnrollment(tx, enrollmentId);
    const row = await store.enrollmentOf(tx, enrollmentId);
    if (row === null) return null;
    const [cases, recorded, now] = await Promise.all([
      store.casesAmong(tx, [enrollmentId]),
      store.holdEndsRecordedAmong(tx, [enrollmentId]),
      clock(tx),
    ]);
    const kind = await endedHoldOf(
      row,
      cases.get(enrollmentId) ?? [],
      recorded.has(enrollmentId),
      now,
      windowDays,
    );
    if (kind === null) return null;
    await store.recordEvents(tx, [{ kind: 'slot_hold_ended', enrollmentId, occurredAt: now }]);
    return kind;
  };

  return {
    run: async () => {
      const windowDays = windowDaysOf(settings);
      const recorded: string[] = [];
      const failed: string[] = [];
      let after: string | undefined;
      for (;;) {
        const { page, due } = await transactions.run(async (tx) => {
          const rows = await store.candidates(tx, after, pageSize);
          return { page: rows, due: rows.length === 0 ? [] : await dueAmong(tx, rows, windowDays) };
        });
        for (const enrollmentId of due) {
          try {
            const kind = await transactions.run((tx) => recordOne(tx, enrollmentId, windowDays));
            if (kind === null) continue;
            recorded.push(enrollmentId);
            log.info({ enrollmentId, kind }, 'A held slot’s hold ended');
          } catch (error: unknown) {
            failed.push(enrollmentId);
            log.error({ enrollmentId }, 'Slot hold end failed');
            report(failedWith(error));
          }
        }
        if (page.length < pageSize) break;
        after = page.at(-1)?.id;
      }
      return { recorded, failed };
    },
  };
}
