// 003:T105 of specs/003-booking/tasks.md (ADR 0025 D2, SRS DEC-81; the notes under T105): the due
// sweep of the releases of a teacher's share, on `close-slot-holds`' schedule (hourly at minute 35,
// the brief's «an existing job's»), registered by `worker.ts` through `scheduleSweeps`.
//
// Each run is payments' `createShareReleaseSweep` (`modules/payments/share-release.service.ts`, whose
// head holds the rules): every enrollment with a paid order carrying a share, its releases due and not
// written inserted once (`ON CONFLICT DO NOTHING` on `(enrollment_id, milestone)`, ERD §15 rule 62),
// one info line of ids and the milestone each; every read paged by `SHARE_RELEASE_PAGE_SIZE`. The job
// only builds and schedules it: it reads no table (R-API-6). It records a release as due and moves no
// money: an administrator executes it in the gateway's dashboard (N1).
//
// Run twice, it leaves what one run leaves (R-API-14): one row per enrollment and milestone.
import { z } from 'zod';

import { createShareReleaseSweep, type ShareReleaseSweep } from '../modules/payments/index.js';
import type { Database } from '../platform/db/prisma.repository.js';
import { transactionsOver } from '../platform/db/transaction.repository.js';
import type { Logger } from '../platform/logging/logger.js';
import type { SettingsReader } from '../platform/settings/settings-reader.js';
import { EVERY_HOUR_AT_35 } from './close-slot-holds.js';
import { defineJob, type Job } from './job.js';

/** The job's name. */
export const RELEASE_TEACHER_SHARES = 'release-teacher-shares';

/** How many orders each of the sweep's pages reads (as `SLOT_HOLD_PAGE_SIZE`, T074). */
export const SHARE_RELEASE_PAGE_SIZE = 200;

/** What the job's sweep is built over, in `worker.ts`. */
export interface ReleaseTeacherSharesDependencies {
  readonly database: Database;
  readonly settings: SettingsReader;
  /** The sweep's lines: one info per release written, one error per enrollment failed. */
  readonly log: Pick<Logger, 'info' | 'error'>;
  /** Error tracking; `reportError` unless a spec sets one. */
  readonly report?: (error: Error) => void;
}

export function releaseTeacherShares(
  options: ReleaseTeacherSharesDependencies | { readonly sweep: ShareReleaseSweep },
): Job {
  const sweep =
    'sweep' in options
      ? options.sweep
      : createShareReleaseSweep({
          transactions: transactionsOver(options.database),
          settings: options.settings,
          log: options.log,
          pageSize: SHARE_RELEASE_PAGE_SIZE,
          ...(options.report === undefined ? {} : { report: options.report }),
        });
  return defineJob({
    name: RELEASE_TEACHER_SHARES,
    payload: z.object({}),
    schedule: EVERY_HOUR_AT_35,
    run: async () => {
      await sweep.run();
    },
  });
}
