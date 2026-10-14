// T155: the `_encrypted` columns as the `reencrypt-columns` job reaches them, through the
// repositories of the modules that own their tables (R-API-6), against Postgres as the application
// role (FR-031, R-DB-8, R-SEC-10).
//
// Three of the four: identity's two and verification's one. The fourth,
// `admin_users.mfa_secret_encrypted`, is not reached from here: R-API-4 lets only the three
// composition files import the admin module (T143), and this file is not one of them. Its
// repository, `modules/admin/admin-users.repository.ts`, issues the same two queries on its table.
//
// Each column holds a value written under the old key. Its page holds that row with that value, in
// id order and after the given row; a payout reference that is not set is not a row to rewrite. A
// value is replaced only where the row still holds the one read: a stale value is refused and the
// row is left as it is, which is what keeps a value the application wrote meanwhile. The sweep's
// own behaviour, over these same columns, is `apps/api/src/jobs/reencrypt-columns.spec.ts`.
//
// NOTHING IS LEFT BEHIND: every write runs inside one Prisma interactive transaction that always
// ends by throwing `ROLLBACK`, as in `soft-delete.spec.ts`.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEncryptedColumns as identityColumns } from '../../apps/api/src/modules/identity/index.js';
import { createEncryptedColumns as verificationColumns } from '../../apps/api/src/modules/verification/index.js';
import { ColumnCipher } from '../../apps/api/src/platform/crypto/encryption.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { connectAsApplication, type Db } from './harness';

const OLD = new ColumnCipher(Buffer.alloc(32, 7).toString('base64'));
const NEW = new ColumnCipher(Buffer.alloc(32, 9).toString('base64'));

let db: Db;
let database: Database;

beforeAll(async () => {
  // The harness proves DATABASE_URL is the application role, never the owner, before anything runs.
  db = await connectAsApplication();
  database = openDatabase(process.env['DATABASE_URL'] ?? '', {
    poolMax: 2,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
});

afterAll(async () => {
  await closeDatabase(database);
  await db.end();
});

const ROLLBACK = new Error('rolled back on purpose: the probe leaves no row behind');

async function inClientRollback(probe: (tx: Transaction) => Promise<void>): Promise<void> {
  try {
    await database.$transaction(
      async (tx) => {
        await probe(tx);
        throw ROLLBACK;
      },
      { timeout: 30_000 },
    );
  } catch (error: unknown) {
    if (error !== ROLLBACK) throw error;
  }
}

function newUser(tx: Transaction): Promise<{ id: string }> {
  return tx.user.create({
    data: {
      email: `probe-${randomUUID()}@example.invalid`,
      gender: 'female',
      dateOfBirth: '1990-01-01T00:00:00Z',
      displayName: 'Probe user',
      preferredLanguage: 'ar',
      timezone: 'Africa/Cairo',
      accountStatus: 'active',
    },
    select: { id: true },
  });
}

/**
 * One row per column, each holding a value written under the old key, by column. A value is bound
 * to its row (T172), so each row's id is drawn here and given to the insert.
 */
async function plant(tx: Transaction): Promise<Map<string, { id: string; value: Uint8Array }>> {
  const planted = new Map<string, { id: string; value: Uint8Array }>();
  const value = (column: string, id: string) => OLD.encrypt(`secret for ${column}`, column, id);

  const teacher = await newUser(tx);
  const profileId = randomUUID();
  const payout = value('teacher_profiles.payout_account_ref_encrypted', profileId);
  const profile = await tx.teacherProfile.create({
    data: {
      id: profileId,
      userId: teacher.id,
      bio: 'Probe',
      qualificationSummary: 'Probe',
      verificationStatus: 'approved',
      payoutAccountRefEncrypted: Uint8Array.from(payout),
    },
    select: { id: true },
  });
  planted.set('teacher_profiles.payout_account_ref_encrypted', { id: profile.id, value: payout });

  const deviceId = randomUUID();
  const token = value('device_push_tokens.token_encrypted', deviceId);
  const device = await tx.devicePushToken.create({
    data: {
      id: deviceId,
      userId: teacher.id,
      tokenEncrypted: Uint8Array.from(token),
      tokenHash: `probe-${randomUUID()}`,
      platform: 'android',
      lastSeenAt: new Date('2026-10-12T00:00:00Z'),
    },
    select: { id: true },
  });
  planted.set('device_push_tokens.token_encrypted', { id: device.id, value: token });

  const documentId = randomUUID();
  const storageKey = value('verification_documents.storage_key_encrypted', documentId);
  const document = await tx.verificationDocument.create({
    data: {
      id: documentId,
      userId: teacher.id,
      documentType: 'national_id',
      storageKeyEncrypted: Uint8Array.from(storageKey),
    },
    select: { id: true },
  });
  planted.set('verification_documents.storage_key_encrypted', {
    id: document.id,
    value: storageKey,
  });
  return planted;
}

function columnsOver(tx: Transaction) {
  return [...identityColumns(tx), ...verificationColumns(tx)];
}

/** Every row of a column, page by page, as the sweep reads it. */
async function readAll(
  column: ReturnType<typeof columnsOver>[number],
): Promise<{ id: string; value: Uint8Array }[]> {
  const rows: { id: string; value: Uint8Array }[] = [];
  for (;;) {
    const page = await column.page(rows.at(-1)?.id, 2);
    rows.push(...page);
    if (page.length < 2) return rows;
  }
}

describe('the encrypted columns, through their owning modules (T155)', () => {
  it('are the three columns of ERD §0 that identity and verification own', async () => {
    await inClientRollback(async (tx) => {
      expect(columnsOver(tx).map(({ column }) => column)).toEqual([
        'teacher_profiles.payout_account_ref_encrypted',
        'device_push_tokens.token_encrypted',
        'verification_documents.storage_key_encrypted',
      ]);
    });
  });

  it('page every row holding a value, in id order, each page after the row given', async () => {
    await inClientRollback(async (tx) => {
      const planted = await plant(tx);
      for (const column of columnsOver(tx)) {
        const rows = await readAll(column);
        const ids = rows.map(({ id }) => id);
        expect(ids).toEqual([...ids].sort());
        expect(new Set(ids).size).toBe(ids.length);
        const mine = planted.get(column.column);
        const found = rows.find(({ id }) => id === mine?.id);
        expect(Buffer.from(found?.value ?? []).equals(Buffer.from(mine?.value ?? [1]))).toBe(true);
      }
    });
  });

  it('pass over a teacher whose payout reference is not set', async () => {
    await inClientRollback(async (tx) => {
      const teacher = await newUser(tx);
      const unset = await tx.teacherProfile.create({
        data: {
          userId: teacher.id,
          bio: 'Probe',
          qualificationSummary: 'Probe',
          verificationStatus: 'pending',
        },
        select: { id: true },
      });
      const payout = columnsOver(tx).find(
        ({ column }) => column === 'teacher_profiles.payout_account_ref_encrypted',
      );
      const rows = payout === undefined ? [] : await readAll(payout);
      expect(rows.map(({ id }) => id)).not.toContain(unset.id);
    });
  });

  it('replace a value only where the row still holds it, as the application role', async () => {
    await inClientRollback(async (tx) => {
      const planted = await plant(tx);
      for (const column of columnsOver(tx)) {
        const mine = planted.get(column.column);
        if (mine === undefined) throw new Error(`nothing planted in ${column.column}`);
        const next = NEW.encrypt(`secret for ${column.column}`, column.column, mine.id);
        const stale = OLD.encrypt('a value the row no longer holds', column.column, mine.id);

        expect(await column.replace(mine.id, stale, next)).toBe(false);
        expect(await column.replace(mine.id, mine.value, next)).toBe(true);
        expect(await column.replace(mine.id, mine.value, next)).toBe(false);
        expect(await column.replace(randomUUID(), mine.value, next)).toBe(false);

        const rows = await readAll(column);
        const held = rows.find(({ id }) => id === mine.id)?.value ?? new Uint8Array();
        expect(Buffer.from(held).equals(next)).toBe(true);
        expect(NEW.decrypt(held, column.column, mine.id)).toBe(`secret for ${column.column}`);
      }
    });
  });
});
