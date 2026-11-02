// T076 — the harness's stand-in phone (`makeUser`, `harness.ts`) skips a number a live user holds.
//
// `phone()` draws one of 100,000,000 numbers, and the probes that commit their rows leave theirs
// behind, so a long run met one now and then and failed on `users_phone_key` (B28's run on
// `ijazah_integrity`, 2026-11-02). `makeUser` now inserts with `ON CONFLICT (phone) WHERE
// deleted_at IS NULL DO NOTHING` and draws again when no row comes back, at most five times (the
// owner's decision of 2026-11-02). Here the spec decides the numbers drawn: a committed row holds
// X, and the next `makeUser` draws X and then Y, inside a transaction and outside one. A phone the
// caller chose is inserted as given and never replaced; its collision is the database's refusal.
//
// NOTHING IS LEFT BEHIND. The rows committed here are recorded by id and deleted by the owner role
// (the application role may not delete a user), so the suite needs `DATABASE_URL_OWNER` as well.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures';
import { connectAsApplication, type Db, inRollback, makeUser, SQLSTATE } from './harness';

let db: Db;
const committed: string[] = [];
/** The number the committed row holds: what every probe below makes `makeUser` draw first. */
let taken: string;

/** A stand-in number of this spec's own, E.164 shaped. Never a real person's. */
function freshPhone(): string {
  return `+2012${String(Number.parseInt(randomUUID().slice(0, 8), 16) % 100_000_000).padStart(8, '0')}`;
}

/** Hands out `numbers` in order, then repeats the last; counts every draw. */
function drawing(...numbers: string[]): { draw: () => string; readonly draws: number } {
  let draws = 0;
  return {
    draw: () => {
      draws += 1;
      return numbers[Math.min(draws, numbers.length) - 1] ?? '';
    },
    get draws() {
      return draws;
    },
  };
}

async function phoneOf(on: Db, userId: string): Promise<string | null> {
  const { rows } = await on.query<{ phone: string | null }>(
    'SELECT phone FROM users WHERE id = $1',
    [userId],
  );
  return rows[0]?.phone ?? null;
}

beforeAll(async () => {
  specDatabaseUrl('DATABASE_URL_OWNER');
  db = await connectAsApplication();
  const holder = await makeUser(db);
  committed.push(holder);
  const phone = await phoneOf(db, holder);
  if (phone === null) throw new Error('the committed row holds no phone');
  taken = phone;
});

afterAll(async () => {
  await db?.end();
  if (committed.length === 0) return;
  const owner = new pg.Client({
    connectionString: specDatabaseUrl('DATABASE_URL_OWNER'),
    connectionTimeoutMillis: 5_000,
  });
  await owner.connect();
  try {
    await owner.query('DELETE FROM "users" WHERE id = ANY($1)', [committed]);
  } finally {
    await owner.end();
  }
});

describe('makeUser, when the number it draws is held by a committed live user (T076)', () => {
  it('draws another and inserts the row with it, outside a transaction', async () => {
    const other = freshPhone();
    const numbers = drawing(taken, other);

    const userId = await makeUser(db, {}, { drawPhone: numbers.draw });
    committed.push(userId);

    expect(numbers.draws).toBe(2);
    expect(await phoneOf(db, userId)).toBe(other);
  });

  it('draws another and inserts the row with it, inside a transaction that stays usable', async () => {
    const other = freshPhone();
    const numbers = drawing(taken, other);

    await inRollback(db, async (tx) => {
      const userId = await makeUser(tx, {}, { drawPhone: numbers.draw });
      expect(numbers.draws).toBe(2);
      expect(await phoneOf(tx, userId)).toBe(other);
    });
  });

  it('stops after five numbers that are all held, with an error naming the cause', async () => {
    const numbers = drawing(taken);

    const made = makeUser(db, {}, { drawPhone: numbers.draw });
    // A row it should not have made is still removed by its id.
    made.then((userId) => committed.push(userId)).catch(() => undefined);
    await expect(made).rejects.toThrow(
      /stand-in phone collided with a live user's 5 times in a row \(users_phone_key\)/,
    );
    expect(numbers.draws).toBe(5);
  });

  it('inserts a phone the caller chose as given, never replacing it: the database refuses the held one', async () => {
    const numbers = drawing(freshPhone());

    await inRollback(db, async (tx) => {
      const refused = await makeUser(tx, { phone: taken }, { drawPhone: numbers.draw }).then(
        () => null,
        (error: unknown) => (error as { code?: unknown }).code,
      );
      expect(refused).toBe(SQLSTATE.uniqueViolation);
    });
    expect(numbers.draws).toBe(0);
  });
});
