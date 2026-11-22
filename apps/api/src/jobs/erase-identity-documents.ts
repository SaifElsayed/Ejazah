// R1a, `specs/002-identity/tasks.md` T176 (SRS §3.14, DEC-100, DEC-67, NFR-COMP-2; the note under
// T176, Q-3 (a); contracts/kernel.md of specs/004-sessions, "Jobs", the `erase-identity-documents`
// row): the sweep, daily at 04:40 (03:30, 03:40, 04:10 and 04:25 are other daily jobs'), registered
// by `worker.ts` through `scheduleSweeps` (`queue.upsertJobScheduler` under its name, as every sweep
// is). ⚠️ Automatic: an identity document on a live account is marked erased once
// `identity_document_retention_days` have passed since its decision, a teacher once approved
// excepted; the hourly `erase-deleted-files` then removes the file, after which there is no way back.
//
// Each run is verification's identity retention sweep (`modules/verification/identity-retention.sweep.ts`,
// whose head holds the rules): each document on its own transaction under its account's, its
// application's and its own lock, its failure caught on its own; every read paged by
// `IDENTITY_RETENTION_PAGE_SIZE`. The job only builds and schedules it: it reads no table (R-API-6;
// `erase-kept-data`'s precedent).
//
// Run twice, it leaves what one run leaves (R-API-14): a marked document is read again under its lock.
import { z } from 'zod';

import {
  createIdentityRetentionSweep,
  type IdentityRetentionSweep,
} from '../modules/verification/index.js';
import type { Database } from '../platform/db/prisma.repository.js';
import { transactionsOver } from '../platform/db/transaction.repository.js';
import type { Logger } from '../platform/logging/logger.js';
import type { SettingsReader } from '../platform/settings/settings-reader.js';
import { defineJob, type Job } from './job.js';

/** The job's name. */
export const ERASE_IDENTITY_DOCUMENTS = 'erase-identity-documents';

/** Every day at 04:40 (the daily slots taken: 03:30, 03:40, 04:10, 04:25). */
export const DAILY_AT_04_40 = '40 4 * * *';

/** How many candidates each of the sweep's pages reads (as `KEPT_DATA_PAGE_SIZE`, T077). */
export const IDENTITY_RETENTION_PAGE_SIZE = 200;

/** What the job's sweep is built over, in `worker.ts`. */
export interface EraseIdentityDocumentsDependencies {
  readonly database: Database;
  /** The retention and the ban's restore window, read on every run. */
  readonly settings: Pick<SettingsReader, 'read'>;
  /** Of some owners, those an open matter holds (booking's `heldFileOwnersAmong`). */
  readonly held: (userIds: readonly string[]) => Promise<ReadonlySet<string>>;
  /** The sweep's lines: one info per document marked, one error per document failed. */
  readonly log: Pick<Logger, 'info' | 'error'>;
  /** Error tracking; `reportError` unless a spec sets one. */
  readonly report?: (error: Error) => void;
}

export function eraseIdentityDocuments(
  options: EraseIdentityDocumentsDependencies | { readonly sweep: IdentityRetentionSweep },
): Job {
  const sweep =
    'sweep' in options
      ? options.sweep
      : createIdentityRetentionSweep({
          transactions: transactionsOver(options.database),
          settings: options.settings,
          held: options.held,
          log: options.log,
          pageSize: IDENTITY_RETENTION_PAGE_SIZE,
          ...(options.report === undefined ? {} : { report: options.report }),
        });
  return defineJob({
    name: ERASE_IDENTITY_DOCUMENTS,
    payload: z.object({}),
    schedule: DAILY_AT_04_40,
    run: async () => {
      await sweep.run();
    },
  });
}
