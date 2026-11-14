// T074 of specs/004-sessions/tasks.md (FR-505; DEC-69; the note under T074, Q-R1 (a); contracts/
// kernel.md, "Jobs", the `close-slot-holds` row): the sweep, hourly at minute 35 (minutes 0, 15, 20,
// 45 and 50 are other hourly jobs'), registered by `worker.ts` through `scheduleSweeps`
// (`queue.upsertJobScheduler` under its name, as every sweep is).
//
// Each run is booking's slot hold end sweep (`modules/booking/slot-hold-end.sweep.ts`, whose head
// holds the rules): every held closing whose hold ended by the one closing rule, its end recorded once
// as one `enrollment_events` row `slot_hold_ended` and one info line `{ enrollmentId, kind }`, each
// enrollment on its own transaction under its lock, its failure caught on its own; every read paged
// by `SLOT_HOLD_PAGE_SIZE`. The job only builds and schedules it: it reads no table (R-API-6).
//
// Run twice, it leaves what one run leaves (R-API-14): one row per closing, read again under the lock.
import { z } from 'zod';

import { createSlotHoldEndSweep, type SlotHoldEndSweep } from '../modules/booking/index.js';
import type { Database } from '../platform/db/prisma.repository.js';
import { transactionsOver } from '../platform/db/transaction.repository.js';
import type { Logger } from '../platform/logging/logger.js';
import type { SettingsReader } from '../platform/settings/settings-reader.js';
import { defineJob, type Job } from './job.js';

/** The job's name. */
export const CLOSE_SLOT_HOLDS = 'close-slot-holds';

/** Every hour, at minute 35 (the note under T074, Q-R1 (a)). */
export const EVERY_HOUR_AT_35 = '35 * * * *';

/** How many candidates each of the sweep's pages reads (as `REMEDY_PAGE_SIZE`, T028). */
export const SLOT_HOLD_PAGE_SIZE = 200;

/** What the job's sweep is built over, in `worker.ts`. */
export interface CloseSlotHoldsDependencies {
  readonly database: Database;
  readonly settings: SettingsReader;
  /** The sweep's lines: one info per row written, one error per item failed. */
  readonly log: Pick<Logger, 'info' | 'error'>;
  /** Error tracking; `reportError` unless a spec sets one. */
  readonly report?: (error: Error) => void;
}

export function closeSlotHolds(
  options: CloseSlotHoldsDependencies | { readonly sweep: SlotHoldEndSweep },
): Job {
  const sweep =
    'sweep' in options
      ? options.sweep
      : createSlotHoldEndSweep({
          transactions: transactionsOver(options.database),
          settings: options.settings,
          log: options.log,
          pageSize: SLOT_HOLD_PAGE_SIZE,
          ...(options.report === undefined ? {} : { report: options.report }),
        });
  return defineJob({
    name: CLOSE_SLOT_HOLDS,
    payload: z.object({}),
    schedule: EVERY_HOUR_AT_35,
    run: async () => {
      await sweep.run();
    },
  });
}
