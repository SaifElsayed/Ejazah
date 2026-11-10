// T028 of specs/004-sessions/tasks.md (FR-462, FR-449; research R-311, "Offering" and "Frozen";
// contracts/kernel.md, "Jobs", the `advance-remedies` row): the sweep, every minute, registered by
// `worker.ts` through `scheduleSweeps` (`queue.upsertJobScheduler` under its name, as every sweep is).
//
// Each run is sessions' remedy advance (`modules/sessions/remedy-offer.sweep.ts`, whose head holds
// the rules): the remedies owed once their dispute windows have closed and the Cancelled-By-Agreement
// sessions with none, offered; each frozen remedy of a reinstated student offered again; T015's
// completion check over the confirmed enrollments whose sessions all have an outcome. Each item on its
// own transaction, its failure caught on its own; every read paged by `REMEDY_PAGE_SIZE`. T032 adds
// the windows' ends to the same run.
//
// Run twice, it leaves what one run leaves (R-API-14): one remedy per session (its unique key, read
// again under the offer's locks), one completion per enrollment (one move from `confirmed`).
import { z } from 'zod';

import {
  type Completion,
  createRemedyAdvance,
  createRemedyOffer,
  type EnrollmentSide,
  type RemedyAdvance,
  type RemedyAdvanceStore,
  type RemedyOfferStore,
} from '../modules/sessions/index.js';
import type { Database } from '../platform/db/prisma.repository.js';
import { transactionsOver } from '../platform/db/transaction.repository.js';
import type { Logger } from '../platform/logging/logger.js';
import type { SettingsReader } from '../platform/settings/settings-reader.js';
import { EVERY_MINUTE } from './expire-cancellation-requests.js';
import { defineJob, type Job } from './job.js';

/** The job's name. */
export const ADVANCE_REMEDIES = 'advance-remedies';

/** How many rows each of the sweep's reads takes at a time (as `EXPIRY_PAGE_SIZE`, T022). */
export const REMEDY_PAGE_SIZE = 200;

/** What the job's advance is built over, in `worker.ts`. */
export interface AdvanceRemediesDependencies {
  readonly database: Database;
  readonly settings: SettingsReader;
  /** Sessions' `EnrollmentSide`, bound to booking's `createEnrollmentSide({ settings })`. */
  readonly enrollments: EnrollmentSide;
  /** T015's completion over the same side (`createCompletion`). */
  readonly completion: Completion;
  readonly log: Pick<Logger, 'info' | 'error'>;
  /** Error tracking; `reportError` unless a spec sets one. */
  readonly report?: (error: Error) => void;
  /** The offer's and the sweep's stores; the module's unless a spec narrows them. */
  readonly offerStore?: RemedyOfferStore;
  readonly store?: RemedyAdvanceStore;
}

function advanceOver({
  database,
  settings,
  enrollments,
  completion,
  log,
  report,
  offerStore,
  store,
}: AdvanceRemediesDependencies): RemedyAdvance {
  return createRemedyAdvance({
    transactions: transactionsOver(database),
    offer: createRemedyOffer({
      enrollments,
      settings,
      ...(offerStore === undefined ? {} : { store: offerStore }),
    }),
    completion,
    enrollments,
    settings,
    log,
    pageSize: REMEDY_PAGE_SIZE,
    ...(report === undefined ? {} : { report }),
    ...(store === undefined ? {} : { store }),
  });
}

export function advanceRemedies(
  options: AdvanceRemediesDependencies | { readonly advance: RemedyAdvance },
): Job {
  const advance = 'advance' in options ? options.advance : advanceOver(options);
  return defineJob({
    name: ADVANCE_REMEDIES,
    payload: z.object({}),
    schedule: EVERY_MINUTE,
    run: async () => {
      await advance.run();
    },
  });
}
