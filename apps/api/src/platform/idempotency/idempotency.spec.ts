// T096 — a repeated operation returns the first outcome and does not repeat the effect (FR-042,
// R-API-14, research R-14, ADR 0008).
//
// The mechanism (T102) keys an operation by its scope and the client's idempotency key, inside the
// same database transaction as the operation's own writes. These cases hold it to that over an
// in-memory store whose transactions behave as Postgres's do for this purpose: what a transaction
// writes is seen by others only once it commits, nothing of it remains when it throws, and a key
// another transaction committed first refuses the claim, as the unique index on (scope, key) does.
// The settings reader is a fake too, so the retention it answers can be changed or withheld.
//
// "The effect" is what the operation writes inside the transaction it is handed. It is read from
// the committed store, so an effect that ran in a transaction that rolled back did not happen.
import { addSeconds } from '@ijazah/time';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { DomainError } from '../errors/domain-error.js';
import { SettingError, type SettingsReader } from '../settings/settings-reader.js';
import {
  IDEMPOTENCY_RETENTION_SETTING,
  type IdempotencyStore,
  IdempotencyService,
  KeyTakenError,
  type NewKey,
  type StoredKey,
} from './idempotency.service.js';

interface FakeTransaction {
  /** What this transaction wrote, by (scope, key); null where it removed a row. */
  readonly writes: Map<string, StoredKey | null>;
  readonly effects: string[];
}

const slot = (scope: string, key: string) => `${scope}\u0000${key}`;

/** A store whose transactions commit on success and leave nothing behind on a throw. */
class FakeStore implements IdempotencyStore<FakeTransaction> {
  readonly committed = { keys: new Map<string, StoredKey>(), effects: [] as string[] };
  #ids = 0;
  /** Runs once, inside the next claim: a competing request that commits first. */
  beforeClaim: (() => Promise<void>) | undefined;

  async transaction<T>(work: (tx: FakeTransaction) => Promise<T>): Promise<T> {
    const tx: FakeTransaction = { writes: new Map(), effects: [] };
    const result = await work(tx);
    for (const [name, row] of tx.writes) {
      if (row === null) this.committed.keys.delete(name);
      else this.committed.keys.set(name, row);
    }
    this.committed.effects.push(...tx.effects);
    return result;
  }

  async find(tx: FakeTransaction, scope: string, key: string): Promise<StoredKey | null> {
    const name = slot(scope, key);
    if (tx.writes.has(name)) return tx.writes.get(name) ?? null;
    return this.committed.keys.get(name) ?? null;
  }

  async claim(tx: FakeTransaction, row: NewKey): Promise<string> {
    const competitor = this.beforeClaim;
    this.beforeClaim = undefined;
    await competitor?.();
    const name = slot(row.scope, row.key);
    const removedHere = tx.writes.has(name) && tx.writes.get(name) === null;
    if (this.committed.keys.has(name) && !removedHere) throw new KeyTakenError();
    this.#ids += 1;
    const id = `key-${this.#ids}`;
    tx.writes.set(name, { ...row, id, status: 'in_progress', response: null });
    return id;
  }

  async complete(tx: FakeTransaction, id: string, response: unknown): Promise<void> {
    for (const [name, row] of tx.writes) {
      if (row?.id === id) tx.writes.set(name, { ...row, status: 'completed', response });
    }
  }

  async remove(tx: FakeTransaction, id: string): Promise<void> {
    for (const [name, row] of this.committed.keys) if (row.id === id) tx.writes.set(name, null);
  }

  async removeExpired(now: Date): Promise<number> {
    let removed = 0;
    for (const [name, row] of this.committed.keys) {
      if (row.expiresAt <= now) {
        this.committed.keys.delete(name);
        removed += 1;
      }
    }
    return removed;
  }
}

class FakeSettings implements SettingsReader {
  value: unknown = 24;
  reads = 0;

  async read<T>(key: string, schema: z.ZodType<T>): Promise<T> {
    this.reads += 1;
    if (key !== IDEMPOTENCY_RETENTION_SETTING || this.value === undefined) {
      throw new SettingError(key, 'missing');
    }
    const parsed = schema.safeParse(this.value);
    if (!parsed.success) throw new SettingError(key, 'invalid');
    return parsed.data;
  }
}

const NOW = new Date('2026-10-08T09:00:00Z');
const KEY = 'checkout-attempt-0001';
const STUDENT = '0199c4a8-0000-7000-8000-00000000000a';
const OTHER_STUDENT = '0199c4a8-0000-7000-8000-00000000000b';
const SCOPE = 'booking.startCheckout';
const INPUT = { packageId: 'pkg-1', slotId: 'slot-9' };

function setUp() {
  const store = new FakeStore();
  const settings = new FakeSettings();
  let now = NOW;
  const service = new IdempotencyService({ store, settings, clock: () => now });
  let runs = 0;
  const effect = async (tx: FakeTransaction) => {
    runs += 1;
    tx.effects.push(`checkout ${runs}`);
    return { checkoutId: `checkout-${runs}` };
  };
  return {
    store,
    settings,
    service,
    effect,
    runs: () => runs,
    later: (hours: number) => {
      now = new Date(addSeconds(NOW, hours * 3600));
    },
  };
}

interface Request {
  readonly scope: string;
  readonly key: string;
  readonly actorId: string;
  readonly input: unknown;
}

const request = (overrides: Partial<Request> = {}): Request => ({
  scope: SCOPE,
  key: KEY,
  actorId: STUDENT,
  input: INPUT,
  ...overrides,
});

async function refusal(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected a refusal');
    },
    (error: unknown) => error,
  );
}

describe('a repeated operation (T096, FR-042)', () => {
  it('returns the first outcome and does not repeat the effect', async () => {
    const { store, service, effect, runs } = setUp();

    const first = await service.run(request(), effect);
    const second = await service.run(request(), effect);

    expect(first).toEqual({ checkoutId: 'checkout-1' });
    expect(second).toEqual(first);
    expect(runs()).toBe(1);
    expect(store.committed.effects).toEqual(['checkout 1']);
    expect(store.committed.keys.size).toBe(1);
  });

  it('reads the same input written in another key order as the same request', async () => {
    const { service, effect, runs } = setUp();
    await service.run(request({ input: { packageId: 'pkg-1', slotId: 'slot-9' } }), effect);
    await service.run(request({ input: { slotId: 'slot-9', packageId: 'pkg-1' } }), effect);
    expect(runs()).toBe(1);
  });

  it('keeps a key in one scope apart from the same key in another scope', async () => {
    const { service, effect, runs } = setUp();
    await service.run(request(), effect);
    await service.run(request({ scope: 'reviews.submit' }), effect);
    expect(runs()).toBe(2);
  });
});

describe('a key reused by someone else, or for something else (T096)', () => {
  it('refuses another actor’s replay with CONFLICT and never hands over the first actor’s outcome', async () => {
    const { store, service, effect, runs } = setUp();
    await service.run(request(), effect);

    const failure = await refusal(service.run(request({ actorId: OTHER_STUDENT }), effect));

    expect(failure).toBeInstanceOf(DomainError);
    expect(failure).toMatchObject({ code: 'CONFLICT' });
    expect((failure as Error).message).not.toContain('checkout-1');
    expect(JSON.stringify(failure)).not.toContain('checkout-1');
    expect(runs()).toBe(1);
    expect(store.committed.effects).toEqual(['checkout 1']);
  });

  it('refuses the same key with a different input with CONFLICT', async () => {
    const { service, effect, runs } = setUp();
    await service.run(request(), effect);

    const failure = await refusal(
      service.run(request({ input: { packageId: 'pkg-2', slotId: 'slot-9' } }), effect),
    );

    expect(failure).toMatchObject({ code: 'CONFLICT' });
    expect(runs()).toBe(1);
  });
});

describe('the key itself (T096)', () => {
  it.each([
    ['empty', ''],
    ['shorter than 16 characters', 'abc-123'],
    ['longer than 128 characters', 'a'.repeat(129)],
    ['with a space', 'checkout attempt 0001'],
    ['with a character outside the URL-safe set', 'checkout/attempt/0001'],
    ['not ASCII', 'مفتاح-العملية-0001-0002'],
  ])('refuses a key %s before anything is read or written', async (_case, key) => {
    const { store, settings, service, effect, runs } = setUp();

    const failure = await refusal(service.run(request({ key }), effect));

    expect(failure).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(failure).toMatchObject({ details: [{ path: 'idempotencyKey' }] });
    expect(runs()).toBe(0);
    expect(settings.reads).toBe(0);
    expect(store.committed.keys.size).toBe(0);
  });

  it('accepts a key of 16 and one of 128 URL-safe characters', async () => {
    const { service, effect, runs } = setUp();
    await service.run(request({ key: 'A'.repeat(16) }), effect);
    await service.run(request({ key: `${'z'.repeat(64)}_${'9'.repeat(62)}-` }), effect);
    expect(runs()).toBe(2);
  });
});

describe('retention (T096, SRS §3.14, ADR 0008)', () => {
  it('reads the retention from the settings reader on every key write', async () => {
    const { store, settings, service, effect } = setUp();

    settings.value = 24;
    await service.run(request({ key: 'first-key-000000001' }), effect);
    settings.value = 48;
    await service.run(request({ key: 'second-key-00000002' }), effect);

    const expiries = [...store.committed.keys.values()].map((row) => row.expiresAt.toISOString());
    expect(expiries).toEqual(['2026-10-09T09:00:00.000Z', '2026-10-10T09:00:00.000Z']);
    expect(settings.reads).toBe(2);
  });

  it('fails closed when the retention is not stored: nothing runs and no key is written', async () => {
    const { store, settings, service, effect, runs } = setUp();
    settings.value = undefined;

    const failure = await refusal(service.run(request(), effect));

    expect(failure).toBeInstanceOf(SettingError);
    expect(failure).toMatchObject({ key: IDEMPOTENCY_RETENTION_SETTING, problem: 'missing' });
    expect(runs()).toBe(0);
    expect(store.committed.keys.size).toBe(0);
  });

  it('fails closed when the retention is not a whole number of hours above zero', async () => {
    const { settings, service, effect, runs } = setUp();
    for (const value of [0, -1, 1.5, '24', null]) {
      settings.value = value;
      await expect(service.run(request(), effect)).rejects.toMatchObject({ problem: 'invalid' });
    }
    expect(runs()).toBe(0);
  });

  it('treats a key past its expiry as never used', async () => {
    const { store, service, effect, runs, later } = setUp();
    await service.run(request(), effect);

    later(25);
    const again = await service.run(request(), effect);

    expect(again).toEqual({ checkoutId: 'checkout-2' });
    expect(runs()).toBe(2);
    expect(store.committed.keys.size).toBe(1);
  });
});

describe('one transaction covers the key and the effect (T096, research R-14)', () => {
  it('leaves no key behind when the effect fails, so a retry runs it', async () => {
    const { store, service } = setUp();
    let attempts = 0;
    const flaky = async (tx: FakeTransaction) => {
      attempts += 1;
      tx.effects.push(`attempt ${attempts}`);
      if (attempts === 1) throw new Error('the database went away');
      return { ok: true };
    };

    await expect(service.run(request(), flaky)).rejects.toThrow('the database went away');
    expect(store.committed.keys.size).toBe(0);
    expect(store.committed.effects).toEqual([]);

    await expect(service.run(request(), flaky)).resolves.toEqual({ ok: true });
    expect(store.committed.effects).toEqual(['attempt 2']);
  });

  it('answers a concurrent duplicate that committed first from its row, without running again', async () => {
    const { store, service, effect, runs } = setUp();
    store.beforeClaim = async () => {
      await service.run(request(), async (tx) => {
        tx.effects.push('checkout by the competitor');
        return { checkoutId: 'competitor' };
      });
    };

    const answer = await service.run(request(), effect);

    expect(answer).toEqual({ checkoutId: 'competitor' });
    expect(runs()).toBe(0);
    expect(store.committed.effects).toEqual(['checkout by the competitor']);
  });
});
