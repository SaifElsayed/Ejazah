// T077 of specs/004-sessions/tasks.md (FR-509; SRS FR-ADMIN-21, DEC-67; the note under T077, Q-R3 (a);
// contracts/kernel.md, "Jobs", the `erase-kept-data` row; research R-323, P3-38): the sweep, daily
// at 04:25 (03:30, 03:40 and 04:10 are other daily jobs'), registered by `worker.ts` through
// `scheduleSweeps` (`queue.upsertJobScheduler` under its name, as every sweep is). ⚠️ Automatic and
// final: once a deleted teacher's erasure date has passed, their kept documents and payout reference
// are erased (the files then removed by `erase-deleted-files`, waiting on an open matter).
//
// Each run is verification's kept data erasure sweep (`modules/verification/kept-data.sweep.ts`,
// whose head holds the rules): each profile on its own transaction under its lock and its kept
// documents', its failure caught on its own; every read paged by `KEPT_DATA_PAGE_SIZE`. The job only
// builds and schedules it: it reads no table (R-API-6; B42b's `close-slot-holds` precedent).
//
// Run twice, it leaves what one run leaves (R-API-14): an erased profile is read again under its lock.
import { z } from 'zod';

import {
  createKeptDataErasureSweep,
  type KeptDataErasureSweep,
} from '../modules/verification/index.js';
import type { Database } from '../platform/db/prisma.repository.js';
import { transactionsOver } from '../platform/db/transaction.repository.js';
import type { Logger } from '../platform/logging/logger.js';
import { defineJob, type Job } from './job.js';

/** The job's name. */
export const ERASE_KEPT_DATA = 'erase-kept-data';

/** Every day at 04:25 (the note under T077, Q-R3 (a)). */
export const DAILY_AT_04_25 = '25 4 * * *';

/** How many candidates each of the sweep's pages reads (as `SLOT_HOLD_PAGE_SIZE`, T074). */
export const KEPT_DATA_PAGE_SIZE = 200;

/** What the job's sweep is built over, in `worker.ts`. */
export interface EraseKeptDataDependencies {
  readonly database: Database;
  /** The sweep's lines: one info per profile erased, one error per item failed. */
  readonly log: Pick<Logger, 'info' | 'error'>;
  /** Error tracking; `reportError` unless a spec sets one. */
  readonly report?: (error: Error) => void;
}

export function eraseKeptData(
  options: EraseKeptDataDependencies | { readonly sweep: KeptDataErasureSweep },
): Job {
  const sweep =
    'sweep' in options
      ? options.sweep
      : createKeptDataErasureSweep({
          transactions: transactionsOver(options.database),
          log: options.log,
          pageSize: KEPT_DATA_PAGE_SIZE,
          ...(options.report === undefined ? {} : { report: options.report }),
        });
  return defineJob({
    name: ERASE_KEPT_DATA,
    payload: z.object({}),
    schedule: DAILY_AT_04_25,
    run: async () => {
      await sweep.run();
    },
  });
}
