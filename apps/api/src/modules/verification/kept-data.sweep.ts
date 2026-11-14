// T077 of specs/004-sessions/tasks.md (FR-509; SRS FR-ADMIN-21, DEC-67; the note under T077, Q-R3 (a),
// Q-R4 (a); contracts/kernel.md, the kept data's row and "Jobs"; research R-323, P3-38): what the daily
// `erase-kept-data` runs, verification's. ⚠️ Automatic and final: once a deleted teacher's
// `kept_erase_at` has passed, their kept documents and payout reference are erased as
// `teachers.keptData.eraseNow` erases them (`kept-data.service.ts`, «THE ERASURE»).
//
// THE CANDIDATES. Every kept profile not yet erased whose date passed at the database's clock, a
// page at a time in id order, read with no lock through identity's entry (`keptProfilesDue`).
//
// THE LOCK. Each candidate on its own transaction: the profile's lock, then its kept documents' in
// id order, both read again under them (`holdKeptData`, rule 1); a date cleared or moved meanwhile,
// or an erasure another run or `eraseNow` already made, erases nothing. The same locks as the
// administrator's actions, in the same order, so the two are serialised on the profile.
//
// THE LOG (the owner's rule). One info line `{ userId, reason: 'erase_date_reached', documents,
// payout }` per profile erased, after its commit; each item's failure caught on its own, rolled back,
// logged by its id at error and reported, and the run goes on; the next run tries it again.
// IDEMPOTENT (R-API-14): a second run finds the profile erased under the lock and erases nothing.
import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { Transactions } from '../../platform/db/transaction.repository.js';
import { reportError } from '../../platform/errors/reporting.js';
import type { Logger } from '../../platform/logging/logger.js';
import {
  eraseHeldKeptData,
  holdKeptData,
  type KeptDataStore,
  keptDataStore,
  type KeptErasure,
} from './kept-data.service.js';

/** What a run did, by the teacher's user id. */
export interface KeptDataErasureRun {
  /** The deleted teachers whose kept data this run erased. */
  readonly erased: readonly string[];
  /** The deleted teachers whose erasure failed, left for the next run. */
  readonly failed: readonly string[];
}

export interface KeptDataErasureSweep {
  /** One run of the sweep (this file's head). */
  run(): Promise<KeptDataErasureRun>;
}

export interface KeptDataErasureDependencies {
  readonly transactions: Transactions;
  /** The sweep's lines: one info per profile erased, one error per item failed. */
  readonly log: Pick<Logger, 'info' | 'error'>;
  /** How many candidates each page reads (the job's). */
  readonly pageSize: number;
  /** Error tracking; `reportError` unless a spec sets one. */
  readonly report?: (error: Error) => void;
  /** The database's clock on the transaction (`clockTimestamp`). */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly store?: KeptDataStore;
}

export function createKeptDataErasureSweep({
  transactions,
  log,
  pageSize,
  report = reportError,
  clock = clockTimestamp,
  store = keptDataStore,
}: KeptDataErasureDependencies): KeptDataErasureSweep {
  const failedWith = (error: unknown): Error =>
    error instanceof Error ? error : new Error(String(error));

  /** One profile under its locks, read and judged again; what was erased, or null. */
  const eraseOne = async (tx: Transaction, userId: string): Promise<KeptErasure | null> => {
    const { profile, documents } = await holdKeptData(store, tx, userId);
    const now = await clock(tx);
    if (profile === null || profile.erasedAt !== null || profile.eraseAt === null) return null;
    if (profile.eraseAt.getTime() > now.getTime()) return null;
    return eraseHeldKeptData(store, tx, { profile, documents }, now);
  };

  return {
    run: async () => {
      const erased: string[] = [];
      const failed: string[] = [];
      let after: string | undefined;
      for (;;) {
        const page = await transactions.run(async (tx) =>
          store.duePage(tx, await clock(tx), after, pageSize),
        );
        for (const { userId } of page) {
          try {
            const erasure = await transactions.run((tx) => eraseOne(tx, userId));
            if (erasure === null) continue;
            erased.push(userId);
            log.info(
              { userId, reason: 'erase_date_reached', ...erasure },
              'A deleted teacher’s kept data was erased on its date',
            );
          } catch (error: unknown) {
            failed.push(userId);
            log.error({ userId }, 'A kept data erasure failed');
            report(failedWith(error));
          }
        }
        if (page.length < pageSize) break;
        after = page.at(-1)?.profileId;
      }
      return { erased, failed };
    },
  };
}
