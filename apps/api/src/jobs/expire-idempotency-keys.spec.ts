// T102 — the `expire-idempotency-keys` sweep (FR-042, R-API-14, ADR 0008).
//
// The sweep deletes every key past its retention and nothing else, through the kernel's
// idempotency service. Its double-run assertion (T112's pattern) calls the handler directly over
// an in-memory store: two runs leave exactly what one run leaves.
import { describe, expect, it } from 'vitest';
import { type SettingsReader } from '../platform/settings/settings-reader.js';
import {
  type IdempotencyStore,
  IdempotencyService,
  type StoredKey,
} from '../platform/idempotency/idempotency.service.js';
import { runOnceAndTwice } from './double-run.js';
import { expireIdempotencyKeys } from './expire-idempotency-keys.js';

const NOW = new Date('2026-10-08T09:00:00Z');

function row(id: string, expiresAt: string): StoredKey {
  return {
    id,
    scope: 'booking.startCheckout',
    key: `client-key-${id}-0000`,
    requestHash: 'hash',
    status: 'completed',
    response: { outcome: null },
    expiresAt: new Date(expiresAt),
  };
}

/** Only the sweep's own query is reachable; the rest of the store is never called by a sweep. */
function storeOf(rows: readonly StoredKey[]): IdempotencyStore<never> & { rows: StoredKey[] } {
  const unused = async (): Promise<never> => {
    throw new Error('not reached by the sweep');
  };
  return {
    rows: [...rows],
    transaction: unused,
    find: unused,
    claim: unused,
    complete: unused,
    remove: unused,
    async removeExpired(now) {
      const before = this.rows.length;
      this.rows = this.rows.filter((kept) => kept.expiresAt > now);
      return before - this.rows.length;
    },
  };
}

const settings: SettingsReader = {
  read: async () => {
    throw new Error('the sweep reads no setting');
  },
};

function world() {
  const store = storeOf([
    row('expired', '2026-10-08T08:59:59Z'),
    row('expires-now', '2026-10-08T09:00:00Z'),
    row('kept', '2026-10-08T09:00:01Z'),
  ]);
  const job = expireIdempotencyKeys(new IdempotencyService({ store, settings, clock: () => NOW }));
  return { store, job };
}

describe('expire-idempotency-keys (T102)', () => {
  it('deletes the keys past their retention and keeps the rest', async () => {
    const { store, job } = world();
    await job.handle({});
    expect(store.rows.map(({ id }) => id)).toEqual(['kept']);
  });

  it('runs on a schedule, with no payload', () => {
    const { job } = world();
    expect(job.name).toBe('expire-idempotency-keys');
    expect(job.schedule).toBe('0 * * * *');
  });

  it('leaves after two runs what it leaves after one (R-API-14)', async () => {
    const { once, twice } = await runOnceAndTwice({
      world,
      run: async ({ job }) => job.handle({}),
      observe: ({ store }) => store.rows.map(({ id }) => id),
    });
    expect(once).toEqual(['kept']);
    expect(twice).toEqual(once);
  });
});
