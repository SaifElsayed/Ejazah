// T072 — the seed is deterministic (FR-038, SC-002; US3 scenarios 2 to 4; data-model.md §10).
//
// Two empty databases of this file's own are migrated (tests/seed/fresh-database.ts). The first is
// seeded twice, and the checksum after the second run must equal the one after the first: a seed
// run twice equals a seed run once. The second is seeded as another engineer would, on another date
// in another zone: the process clock is moved years ahead and the process zone and the database
// session's zone are moved to UTC+14, and its checksum must equal the first database's. The second
// seed also runs later in real time than the first, so a value taken from the database server's own
// clock (a column left to its `now()` default) would differ too.
//
// Each run is given an ENCRYPTION_KEY of its own, as two machines have. The administrator's
// credential is the one thing that differs between them by design, and the checksum leaves exactly
// those two columns out (note under T074).
//
// A checksum that never changes would pass every comparison above, so the last case shows it does:
// one setting changed, inside a transaction rolled back, gives another checksum.
//
// Written before T074 and T075, it imported the two as namespaces cast to a declared API, so
// `pnpm typecheck` stayed green while it was red; since T075 it imports them by name.
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { seed } from '../../prisma/seed';
import { seedChecksum } from '../../scripts/seed-checksum';
import {
  MIGRATE_TIMEOUT_MILLISECONDS,
  connect,
  createEmptyDatabase,
  migrate,
  type FreshDatabase,
} from './fresh-database';

/** A zone fourteen hours ahead of UTC, so its calendar date is another day for most of the day. */
const SHIFTED_ZONE = 'Pacific/Kiritimati';
/** Another year, another month, another day. */
const SHIFTED_CLOCK = '2031-03-30T23:30:00.000Z';

function encryptionKey(): string {
  return randomBytes(32).toString('base64');
}

async function migrated(): Promise<FreshDatabase> {
  const database = await createEmptyDatabase();
  const result = await migrate(database);
  if (result.exitCode !== 0) {
    await database.drop();
    throw new Error(`the migrations did not apply to ${database.name}:\n${result.output}`);
  }
  return database;
}

describe('the seed produces the same dataset everywhere (T072)', () => {
  let first: FreshDatabase | undefined;
  let second: FreshDatabase | undefined;
  let firstDb: pg.Client;
  let once: string;

  beforeAll(async () => {
    [first, second] = await Promise.all([migrated(), migrated()]);
    firstDb = await connect(first.applicationUrl);
  }, MIGRATE_TIMEOUT_MILLISECONDS * 2);

  afterAll(async () => {
    await firstDb?.end();
    await Promise.all([first?.drop(), second?.drop()]);
  });

  it('gives the same checksum when it runs a second time', async () => {
    await seed(firstDb, { encryptionKey: encryptionKey() });
    once = await seedChecksum(firstDb);
    await seed(firstDb, { encryptionKey: encryptionKey() });
    expect(await seedChecksum(firstDb)).toBe(once);
  });

  it('gives the same checksum under a shifted clock and zone', async () => {
    if (second === undefined) throw new Error('the second database was not created');
    const zone = process.env['TZ'];
    const shiftedDb = await connect(second.applicationUrl, SHIFTED_ZONE);
    try {
      vi.useFakeTimers({ now: new Date(SHIFTED_CLOCK), toFake: ['Date'] });
      process.env['TZ'] = SHIFTED_ZONE;
      try {
        expect(new Date().toISOString()).toBe(SHIFTED_CLOCK);
        expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(SHIFTED_ZONE);
        await seed(shiftedDb, { encryptionKey: encryptionKey() });
      } finally {
        vi.useRealTimers();
        if (zone === undefined) delete process.env['TZ'];
        else process.env['TZ'] = zone;
      }
      expect(await seedChecksum(shiftedDb)).toBe(once);
    } finally {
      await shiftedDb.end();
    }
  });

  it('gives another checksum when the data differs, so the comparisons above can fail', async () => {
    await firstDb.query('BEGIN');
    try {
      await firstDb.query(
        `UPDATE settings SET value = '25'::jsonb WHERE key = 'idempotency_key_ttl_hours'`,
      );
      expect(await seedChecksum(firstDb)).not.toBe(once);
    } finally {
      await firstDb.query('ROLLBACK');
    }
    expect(await seedChecksum(firstDb)).toBe(once);
  });
});
