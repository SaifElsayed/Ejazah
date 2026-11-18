// T040 (R-215, FR-363, FR-364, ADR 0010 D7): the `expire-holds` sweep's decisions, over recorded
// steps. Every minute on a cron pattern in code; it reads no setting, each hold carrying its own
// expiry. The expired active holds that carry no enrollment are found a page at a time in id order
// after the last one read, and each page is released in one transaction through booking's one
// release under `'expired'` at the run's instant. Two runs leave what one leaves. The same over the
// real tables is `tests/db-integrity/expire-pending-payments.spec.ts`.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../platform/db/prisma.repository.js';
import { publisherOn } from '../platform/live/live-publisher.js';
import { runOnceAndTwice } from './double-run.js';
import { EXPIRE_HOLDS, expireHolds, type HoldExpirySteps } from './expire-holds.js';

const NOW = new Date('2026-11-03T08:00:00Z');

interface Hold {
  readonly id: string;
  readonly expiresAt: Date;
  releasedAt: Date | null;
}

function holdsWorld(holds: readonly Hold[]) {
  /** 005:T016: the payment pushes' port; the steps are stand-ins, so nothing reaches it. */
  const notices = {
    record: () => Promise.reject(new Error('the stand-in steps record no push')),
  };
  /** 005:T016: whether each release ran on a transaction carrying a list that takes work. */
  const bound: boolean[] = [];
  const transactions: string[][] = [];
  let current: string[] | undefined;
  const tx = {} as Transaction;
  const database = {
    $transaction: (async (work: (client: Transaction) => Promise<unknown>) => {
      current = [];
      transactions.push(current);
      try {
        return await work(tx);
      } finally {
        current = undefined;
      }
    }) as never,
  };
  const steps: HoldExpirySteps = {
    expiredHolds: async (client, at, after, limit) => {
      expect(client).toBe(tx);
      const ids = holds
        .filter(({ id, expiresAt, releasedAt }) => {
          const pastCursor = after === undefined || id > after;
          return releasedAt === null && expiresAt.getTime() <= at.getTime() && pastCursor;
        })
        .map(({ id }) => id)
        .sort()
        .slice(0, limit);
      current?.push(`find after ${after ?? '-'}`);
      return ids;
    },
    release: async (client, ids, at) => {
      expect(client).toBe(tx);
      bound.push(publisherOn(client)?.afterCommitDo !== undefined);
      current?.push(`release ${ids.join(',')}`);
      for (const hold of holds) {
        if (ids.includes(hold.id) && hold.releasedAt === null) hold.releasedAt = at;
      }
    },
  };
  return { holds, transactions, database, steps, notices, bound };
}

const hold = (id: string, expiresAt: string): Hold => ({
  id,
  expiresAt: new Date(expiresAt),
  releasedAt: null,
});

describe('expire-holds (T040, FR-364)', () => {
  it('runs every minute on a cron pattern in code, with no payload', () => {
    const { database, steps } = holdsWorld([]);
    const job = expireHolds({
      database,
      steps,
      notices: { record: async () => undefined },
      clock: () => NOW,
    });
    expect(job.name).toBe(EXPIRE_HOLDS);
    expect(job.name).toBe('expire-holds');
    expect(job.schedule).toBe('* * * * *');
  });

  it('releases the expired holds a page at a time, each page in one transaction, the running ones kept', async () => {
    const world = holdsWorld([
      hold('a', '2026-11-03T07:00:00Z'),
      hold('b', '2026-11-03T07:59:59Z'),
      hold('c', '2026-11-03T08:00:00Z'),
      hold('d', '2026-11-03T08:00:01Z'),
      hold('e', '2026-11-03T06:00:00Z'),
    ]);
    const job = expireHolds({ ...world, clock: () => NOW, pageSize: 2 });
    await job.handle({});
    expect(world.transactions).toEqual([
      ['find after -', 'release a,b'],
      ['find after b', 'release c,e'],
      ['find after e'],
    ]);
    expect(world.holds.map(({ id, releasedAt }) => [id, releasedAt])).toEqual([
      ['a', NOW],
      ['b', NOW],
      ['c', NOW],
      ['d', null],
      ['e', NOW],
    ]);
  });

  it('stops after a page shorter than the page size, and releases nothing when nothing expired', async () => {
    const world = holdsWorld([hold('a', '2026-11-03T09:00:00Z')]);
    await expireHolds({ ...world, clock: () => NOW }).handle({});
    expect(world.transactions).toEqual([['find after -']]);
    expect(world.holds[0]?.releasedAt).toBeNull();
  });

  it('runs twice as once (R-API-14)', async () => {
    const { once, twice } = await runOnceAndTwice({
      world: () =>
        holdsWorld([hold('a', '2026-11-03T07:00:00Z'), hold('b', '2026-11-03T09:00:00Z')]),
      run: (world) => expireHolds({ ...world, clock: () => NOW }).handle({}),
      observe: (world) => world.holds.map(({ id, releasedAt }) => [id, releasedAt]),
    });
    expect(once).toEqual([
      ['a', NOW],
      ['b', null],
    ]);
    expect(twice).toEqual(once);
  });
});

describe('expire-holds: the pushes (005:T016, the note under T016, Q-N3 (a))', () => {
  it('releases each page on a transaction that carries an after-commit list of its own', async () => {
    const world = holdsWorld([
      hold('a', '2026-11-03T07:00:00Z'),
      hold('b', '2026-11-03T07:30:00Z'),
      hold('c', '2026-11-03T07:45:00Z'),
    ]);
    await expireHolds({ ...world, clock: () => NOW, pageSize: 2 }).handle({});
    expect(world.bound).toEqual([true, true]);
  });
});
