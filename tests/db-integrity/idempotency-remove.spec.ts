// T102 review fix (PR #47, n2): replacing an expired idempotency key must not fail when another
// transaction removed the same row first (FR-042, ERD section 15.16).
//
// Two callers that both find the same expired key both remove it. The second waits on the row
// lock, and once the first commits, the row it would remove is gone. The removal must then be a
// no-op, so the second caller goes on to claim the key, meets the committed one on the unique
// index (KeyTakenError), and is answered from it. A `delete` that requires its row turned that
// into P2025, an unexpected error. The race reduces to one deterministic case: removing an id that
// no row carries, through the real repository in a real Prisma transaction. Nothing is written.
//
// T175 (R1a; the note under T175, (3)): the kernel's `removeOfActor(tx, actorId, keep?)` deletes the
// keys whose actor is the one named, except the running call's own (`keep`), and no other actor's,
// the same scope and key included. The cases write keys of fresh actors through the repository and
// remove them at the end.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addSeconds } from '../../packages/time/src/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import {
  IdempotencyRepository,
  removeOfActor,
} from '../../apps/api/src/platform/idempotency/idempotency.repository.js';
import { connectAsApplication } from './harness';

let database: Database;

beforeAll(async () => {
  // The harness proves DATABASE_URL is the application role, never the owner, before anything runs.
  const db = await connectAsApplication();
  await db.end();
  database = openDatabase(process.env['DATABASE_URL'] ?? '', {
    poolMax: 2,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
});

afterAll(async () => {
  await closeDatabase(database);
});

describe('replacing an expired idempotency key (T102, PR #47 n2)', () => {
  it('removes a row another transaction already removed without an error', async () => {
    const repository = new IdempotencyRepository(database);
    await expect(
      repository.transaction((tx) => repository.remove(tx, randomUUID())),
    ).resolves.toBeUndefined();
  });
});

const HOUR_SECONDS = 3600;

/** A completed key of the actor's, written as the kernel writes one. */
async function keyOf(actorId: string, scope: string, key: string): Promise<void> {
  const repository = new IdempotencyRepository(database);
  await repository.transaction(async (tx) => {
    const id = await repository.claim(tx, {
      scope,
      actorId,
      key,
      requestHash: 'probe-hash',
      expiresAt: new Date(addSeconds(new Date(), HOUR_SECONDS)),
    });
    await repository.complete(tx, id, { outcome: null });
  });
}

/** The actor's keys, as `scope key`, sorted. */
async function keysOf(actorId: string): Promise<string[]> {
  const rows = await database.idempotencyKey.findMany({
    where: { actorId },
    select: { scope: true, key: true },
  });
  return rows.map(({ scope, key }) => `${scope} ${key}`).sort();
}

describe("removing an actor's keys (T175)", () => {
  const actor = randomUUID();
  const other = randomUUID();
  const own = { scope: 'account.delete', key: `own-${randomUUID()}` };
  const shared = `shared-${randomUUID()}`;

  beforeAll(async () => {
    await keyOf(actor, own.scope, own.key);
    await keyOf(actor, 'chat.send', shared);
    await keyOf(actor, 'checkout.hold', `hold-${randomUUID()}`);
    await keyOf(other, 'chat.send', shared);
  });

  afterAll(async () => {
    await database.idempotencyKey.deleteMany({ where: { actorId: { in: [actor, other] } } });
  });

  it('removes every key of the actor but the kept one, and answers how many', async () => {
    const removed = await database.$transaction((tx) => removeOfActor(tx, actor, own));
    expect(removed).toBe(2);
    expect(await keysOf(actor)).toEqual([`${own.scope} ${own.key}`]);
  });

  it("leaves another actor's keys, the same scope and key included", async () => {
    expect(await keysOf(other)).toEqual([`chat.send ${shared}`]);
  });

  it('removes the kept key too when nothing is kept', async () => {
    await database.$transaction((tx) => removeOfActor(tx, actor));
    expect(await keysOf(actor)).toEqual([]);
    expect(await keysOf(other)).toEqual([`chat.send ${shared}`]);
  });
});
