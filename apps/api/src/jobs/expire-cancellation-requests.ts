// T022 of specs/004-sessions/tasks.md (FR-458; SC-411; research R-310; contracts/kernel.md, "Jobs"
// and the `expire-cancellation-requests` row): the sweep, every minute, registered by `worker.ts`
// through `scheduleSweeps` (`queue.upsertJobScheduler` under its name, as every sweep is).
//
// Each run expires every pending cancellation request whose session's scheduled start has passed by
// the database's clock, each in its own transaction under the enrollment's, the session's and the
// request's locks, with one `cancellation_expired` row: sessions' expiry
// (`modules/sessions/cancellation-expiry.service.ts`), whose head holds the rules. A request is
// already read as expired from the start (FR-458); the sweep writes it for the record.
//
// Run twice, it leaves what one run leaves (R-API-14): a request expires once, by the `pending`
// guard read under its locks, with one row.
import { z } from 'zod';

import {
  type CancellationExpiry,
  type CancellationExpiryStore,
  createCancellationExpiry,
  type EnrollmentSide,
} from '../modules/sessions/index.js';
import type { Database } from '../platform/db/prisma.repository.js';
import { transactionsOver } from '../platform/db/transaction.repository.js';
import type { Logger } from '../platform/logging/logger.js';
import { defineJob, type Job } from './job.js';

/** The job's name. */
export const EXPIRE_CANCELLATION_REQUESTS = 'expire-cancellation-requests';

/** Every minute (kernel.md, "Jobs"): a request is written expired within a minute of its start. */
export const EVERY_MINUTE = '* * * * *';

/** How many due requests are read at a time. */
export const EXPIRY_PAGE_SIZE = 200;

/** What the job's expiry is built over, in `worker.ts`. */
export interface ExpireCancellationRequestsDependencies {
  readonly database: Database;
  /** Sessions' `EnrollmentSide`, bound to booking's `createEnrollmentSide({ settings })`. */
  readonly enrollments: Pick<EnrollmentSide, 'lockEnrollments'>;
  readonly log: Pick<Logger, 'info' | 'error'>;
  /** Error tracking; `reportError` unless a spec sets one. */
  readonly report?: (error: Error) => void;
  /** The expiry's store; the module's unless a spec narrows it to its own rows. */
  readonly store?: CancellationExpiryStore;
}

function expiryOver({
  database,
  enrollments,
  log,
  report,
  store,
}: ExpireCancellationRequestsDependencies): CancellationExpiry {
  return createCancellationExpiry({
    transactions: transactionsOver(database),
    enrollments,
    log,
    pageSize: EXPIRY_PAGE_SIZE,
    ...(report === undefined ? {} : { report }),
    ...(store === undefined ? {} : { store }),
  });
}

export function expireCancellationRequests(
  options: ExpireCancellationRequestsDependencies | { readonly expiry: CancellationExpiry },
): Job {
  const expiry = 'expiry' in options ? options.expiry : expiryOver(options);
  return defineJob({
    name: EXPIRE_CANCELLATION_REQUESTS,
    payload: z.object({}),
    schedule: EVERY_MINUTE,
    run: async () => {
      await expiry.expireStarted();
    },
  });
}
