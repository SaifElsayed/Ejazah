// T175 (R1a; the full-codebase review of 2026-11-20; the note under T175, (3)): a deletion removes the
// person's own idempotency keys, over the real tables, as `main.ts` composes the identity module.
//
// - The person's own deletion (`account.delete`) removes every key whose actor is the person, except
//   its own running key: deleting that one would fail the kernel's `complete` (P2025) and roll the
//   whole deletion back. The deletion commits, and its key is completed.
// - Another person's keys stay, the same scope and key included.
//
// Red first on the code before T175 (no removal), and under the mutants B2-3 (`removeOfActor`
// without `keep`: the deletion rolls back) and B2-4 (`removeOfActor` not called).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addSeconds } from '../../packages/time/src/index.js';

import { createOngoingEnrollments } from '../../apps/api/src/modules/booking/index.js';
import {
  AccountConsequences,
  createIdentityServices,
} from '../../apps/api/src/modules/identity/index.js';
import { ColumnCipher } from '../../apps/api/src/platform/crypto/encryption.js';
import { hashPassword } from '../../apps/api/src/platform/crypto/hashing.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository.js';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service.js';
import { MemorySingleUseMarks } from '../../apps/api/src/platform/redis/single-use-marks.fixtures.js';
import {
  SettingError,
  type SettingsReader,
} from '../../apps/api/src/platform/settings/settings-reader.js';
import { connectAsApplication, type Db, insertRow, makeUser } from './harness';

const KEY = Buffer.alloc(32, 7).toString('base64');
const PASSWORD = 'a long probe passphrase 35';
const HOUR_SECONDS = 3600;

const SETTINGS: Readonly<Record<string, unknown>> = { idempotency_key_ttl_hours: 24 };

const settings: SettingsReader = {
  async read(key, schema) {
    if (!Object.hasOwn(SETTINGS, key)) throw new SettingError(key, 'missing');
    const parsed = schema.safeParse(SETTINGS[key]);
    if (!parsed.success) throw new SettingError(key, 'invalid');
    return parsed.data;
  },
};

let db: Db;
let database: Database;
let deletion: ReturnType<typeof createIdentityServices>['deletion'];

beforeAll(async () => {
  db = await connectAsApplication();
  database = openDatabase(process.env['DATABASE_URL'] ?? '', {
    poolMax: 2,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  const unreachable = () => Promise.reject(new Error('probe: not reached'));
  deletion = createIdentityServices({
    database,
    settings,
    encryptionKey: KEY,
    cipher: new ColumnCipher(KEY),
    marks: new MemorySingleUseMarks(() => new Date()),
    signIn: {
      verifyIdentityToken: unreachable,
      exchangeAuthorization: unreachable,
      revoke: unreachable,
    },
    email: { deliver: async () => undefined },
    storage: { remove: async () => undefined, temporaryLink: async (key) => key },
    log: { warn: () => undefined, info: () => undefined },
    payment: { registerPayoutRecipient: unreachable },
    idempotency: new IdempotencyService<Transaction>({
      store: new IdempotencyRepository(database),
      settings,
    }),
    consequences: new AccountConsequences(),
    report: () => undefined,
    ongoingEnrollments: createOngoingEnrollments({ settings }),
    openIjazahRequests: { count: async () => 0 },
    openCases: { count: async () => 0 },
  }).deletion;
});

afterAll(async () => {
  await closeDatabase(database);
  await db.end();
});

/** A live student with a password. */
async function student(): Promise<string> {
  const userId = await makeUser(db, { password_hash: await hashPassword(PASSWORD) });
  await insertRow(db, 'user_roles', { user_id: userId, role: 'student', status: 'active' });
  return userId;
}

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

/** The actor's keys, as `scope key status`, sorted. */
async function keysOf(actorId: string): Promise<string[]> {
  const { rows } = await db.query<{ scope: string; key: string; status: string }>(
    'SELECT scope, key, status FROM idempotency_keys WHERE actor_id = $1',
    [actorId],
  );
  return rows.map(({ scope, key, status }) => `${scope} ${key} ${status}`).sort();
}

async function deletedAtOf(userId: string): Promise<Date | null> {
  const { rows } = await db.query<{ deleted_at: Date | null }>(
    'SELECT deleted_at FROM users WHERE id = $1',
    [userId],
  );
  return rows[0]?.deleted_at ?? null;
}

describe("a deletion removes the person's own keys (T175)", () => {
  it('removes every other key of the person, keeps its own running key, and commits', async () => {
    const person = await student();
    const own = `deletion-${randomUUID()}`;
    await keyOf(person, 'chat.send', `chat-${randomUUID()}`);
    await keyOf(person, 'checkout.hold', `hold-${randomUUID()}`);

    await deletion.deleteAccount(person, {
      confirmation: 'DELETE',
      reauth: { kind: 'password', password: PASSWORD },
      idempotencyKey: own,
    });

    expect(await deletedAtOf(person)).not.toBeNull();
    expect(await keysOf(person)).toEqual([`account.delete ${own} completed`]);
  });

  it("leaves another person's keys, the same scope and key included", async () => {
    const person = await student();
    const other = await student();
    const shared = `shared-${randomUUID()}`;
    await keyOf(person, 'chat.send', shared);
    await keyOf(other, 'chat.send', shared);

    await deletion.deleteAccount(person, {
      confirmation: 'DELETE',
      reauth: { kind: 'password', password: PASSWORD },
      idempotencyKey: `deletion-${randomUUID()}`,
    });

    expect(await keysOf(other)).toEqual([`chat.send ${shared} completed`]);
  });
});
