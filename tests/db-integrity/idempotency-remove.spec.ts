// T102 review fix (PR #47, n2): replacing an expired idempotency key must not fail when another
// transaction removed the same row first (FR-042, ERD section 15.16).
//
// Two callers that both find the same expired key both remove it. The second waits on the row
// lock, and once the first commits, the row it would remove is gone. The removal must then be a
// no-op, so the second caller goes on to claim the key, meets the committed one on the unique
// index (KeyTakenError), and is answered from it. A `delete` that requires its row turned that
// into P2025, an unexpected error. The race reduces to one deterministic case: removing an id that
// no row carries, through the real repository in a real Prisma transaction. Nothing is written.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDatabase,
  type Database,
  openDatabase,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository.js';
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
