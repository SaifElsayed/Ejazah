// T025 of specs/004-sessions/tasks.md (FR-459; SRS FR-CANCEL-5, §3.14 «Cancellation requests recent
// period (days)»; contracts/admin-surface.md, `users.get`; plan.md decision 8): how many cancellation
// requests a user made, in total and in the recent period, for the administrator's record of the
// user. The user directory's `users.get` (T058) reads it through sessions' entry, never the table
// (R-API-6).
//
// The recent period is `cancellation_requests_recent_days`, read at each call (R-MONEY-12), counted
// back from the database's clock on the caller's transaction (`clockTimestamp`), as the dispute
// window is read (`completion.service.ts`). Derived when read and never stored (R-DB-4). No lock, no
// write (`cancellation-request-counts.repository.ts`).
import { addDays } from '@ijazah/time';
import { z } from 'zod';

import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import {
  type CancellationRequestCounts,
  cancellationRequestCountsOf,
} from './cancellation-request-counts.repository.js';

/** The days counted back for the recent count (SRS §3.14, default 30). */
export const CANCELLATION_REQUESTS_RECENT_DAYS_SETTING = 'cancellation_requests_recent_days';

/** The recent period's schema: a whole number of days, at least one. */
export const cancellationRequestsRecentDays = z.int().positive();

/** What the counts read, on the caller's transaction. */
export interface CancellationRequestCountsStore {
  cancellationRequestCountsOf(
    tx: Transaction,
    userId: string,
    recentSince: Date,
  ): Promise<CancellationRequestCounts>;
}

const cancellationRequestCountsStore: CancellationRequestCountsStore = {
  cancellationRequestCountsOf,
};

export interface CancellationRequestCountsReader {
  /** The requests `userId` made: `total`, and `recent` within the recent period; no lock. */
  cancellationRequestCountsOf(tx: Transaction, userId: string): Promise<CancellationRequestCounts>;
}

/** The counts over sessions' table, the recent period read at each call. */
export function createCancellationRequestCounts({
  settings,
  clock = clockTimestamp,
  store = cancellationRequestCountsStore,
}: {
  readonly settings: SettingsReader;
  /** The database's clock on the call's transaction; `clockTimestamp` in production. */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly store?: CancellationRequestCountsStore;
}): CancellationRequestCountsReader {
  return {
    cancellationRequestCountsOf: async (tx, userId) => {
      const days = await settings.read(
        CANCELLATION_REQUESTS_RECENT_DAYS_SETTING,
        cancellationRequestsRecentDays,
      );
      const at = await clock(tx);
      return store.cancellationRequestCountsOf(tx, userId, new Date(addDays(at, -days)));
    },
  };
}

export type { CancellationRequestCounts };
