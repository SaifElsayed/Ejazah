// T040 (R-215, FR-363, FR-364, FR-BOOK-9, ADR 0010 D7; ARCHITECTURE §8.1): the `expire-holds`
// sweep, booking's. Every minute, on a cron pattern in code as every sweep's (the note under T040).
//
// It releases the active holds past their expiry that carry no enrollment: a student who entered
// checkout and never pressed Pay. It reads no setting: each hold carries its expiry, written at its
// placement from `slot_hold_ttl_minutes` and `slot_hold_grace_minutes` (FR-BOOK-9), so a setting
// changed since then does not move a hold already placed. The holds that carry an enrollment are
// `expire-pending-payments`' (ADR 0010 D7).
//
// A page at a time, in id order after the last hold read, each page in one transaction: its ids are
// read, then released through booking's one release under `'expired'` at the run's instant, which
// locks the holds and reads them again under the lock (T005's rules), so a hold converted or released
// meanwhile, or linked to an enrollment by a Pay meanwhile, is handled as that release says
// (FR-363). The sweep takes no lock of its own.
//
// IDEMPOTENT (R-API-14): a second run finds no active expired hold left to release.
//
// THE PUSHES (005:T016 of specs/005-certification; the note under T016, Q-N1 (a), Q-N3 (a)). A hold
// linked to an enrollment by a Pay after the page was read is released as the release says, its
// enrollment cancelled for an expired payment with its `payment_expired` push, through the notice
// port `worker.ts` binds (`notices`). So each page runs with an after-commit list of its own
// (booking's `withOutcomeNotices`), as `expire-pending-payments`' pages do.
import { z } from 'zod';

import type { Database, Transaction } from '../platform/db/prisma.repository.js';
import {
  expiredCheckoutHoldIds,
  keyShareStudentsOfHolds,
  type PaymentOutcomeNotices,
  releaseHolds,
  withOutcomeNotices,
} from '../modules/booking/index.js';
import { orderStandingsOf } from '../modules/payments/index.js';
import { defineJob, type Job } from './job.js';

/** The sweep's name. */
export const EXPIRE_HOLDS = 'expire-holds';

/** Every minute (FR-364). */
export const EVERY_MINUTE = '* * * * *';

/** How many rows a sweep reads and handles in one transaction. */
export const EXPIRY_PAGE_SIZE = 100;

/** What the sweep asks of booking, each on its transaction (R-API-6). */
export interface HoldExpirySteps {
  /** A page of the expired active holds with no enrollment, in id order after `after`. */
  expiredHolds(
    tx: Transaction,
    at: Date,
    after: string | undefined,
    limit: number,
  ): Promise<readonly string[]>;
  /** Releases the holds of `holdIds` still active and expired at `at` (FR-363). */
  release(tx: Transaction, holdIds: readonly string[], at: Date): Promise<unknown>;
}

/**
 * The steps over booking's entry, the orders' standing being payments' (R-208); 005:T016: a
 * release's pushes through `notices`.
 */
export function holdExpiryStepsOf(notices: PaymentOutcomeNotices): HoldExpirySteps {
  return {
    expiredHolds: expiredCheckoutHoldIds,
    // 005:T016 (fixed in B48): the page's students key-shared before the release locks the holds.
    release: async (tx, holdIds, at) => {
      await keyShareStudentsOfHolds(tx, holdIds);
      return releaseHolds(tx, holdIds, 'expired', { at, orders: orderStandingsOf, notices });
    },
  };
}

/**
 * Runs `page` after each last id it answers until a page is shorter than `pageSize`: the paging both
 * expiry sweeps share. `page` answers the ids it read, in id order.
 */
export async function inPages(
  pageSize: number,
  page: (after: string | undefined) => Promise<readonly string[]>,
): Promise<void> {
  let after: string | undefined;
  for (;;) {
    const ids = await page(after);
    if (ids.length < pageSize) return;
    after = ids.at(-1);
  }
}

export interface ExpireHoldsOptions {
  readonly database: Pick<Database, '$transaction'>;
  /** 005:T016: the payment pushes' port (`NotificationWriter`, bound by `worker.ts`). */
  readonly notices: PaymentOutcomeNotices;
  readonly steps?: HoldExpirySteps;
  /** The clock; the system clock unless a spec sets one. */
  readonly clock?: () => Date;
  readonly pageSize?: number;
}

export function expireHolds({
  database,
  notices,
  steps = holdExpiryStepsOf(notices),
  clock = () => new Date(),
  pageSize = EXPIRY_PAGE_SIZE,
}: ExpireHoldsOptions): Job {
  return defineJob({
    name: EXPIRE_HOLDS,
    payload: z.object({}),
    schedule: EVERY_MINUTE,
    run: async () => {
      const at = clock();
      // 005:T016: each page with an after-commit list of its own (this file's head).
      await inPages(pageSize, (after) =>
        withOutcomeNotices(
          (work) => database.$transaction(work),
          async (tx) => {
            const ids = await steps.expiredHolds(tx, at, after, pageSize);
            if (ids.length > 0) await steps.release(tx, ids, at);
            return ids;
          },
        ),
      );
    },
  });
}
