// The follow-up under T003 of specs/005-certification (B45 lane C's Q-C2; the review session's ruling,
// 2026-11-17; carried by B46's T006, lane A) — the signature row over the real tables as the
// application role (FR-601, SRS FR-IJAZAH-12; research R-411; ERD, `teacher_signatures`,
// `teacher_user_id` unique):
//
// - One row per teacher under the real unique: a second row for the same teacher is refused by
//   `teacher_signatures_teacher_user_id_key`, and the service's replace keeps one row.
// - Two concurrent uploads of one teacher are serialised on the teacher's `users` lock
//   (`teacher-signature.service.ts`, step 2): the second reads the first's row as the one it
//   replaces, so exactly one row remains, it names one of the two new files, the other new file and
//   the original are erased after their commits, and no new file is left behind. Each transaction
//   pauses after its read of the current row until the other has read too, or 300 ms have passed:
//   with the lock the second cannot read until the first commits; without it both read the original.
//
// Observed red: the second case against the mutant «`lockAccount` dropped from `replace`»
// (REPORT.md's red table): both read the original row and the first new file is left orphaned.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTeacherSignatureService } from '../../apps/api/src/modules/catalog/index';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader';
import { connectAsApplication, type Db, insertRow, makeUser, SQLSTATE } from './harness';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const settings: SettingsReader = {
  read: async () => {
    throw new Error('no setting is read by a replace');
  },
};
const PAUSE_MS = 300;

/** The storage port in memory: what is stored, and every call in order (R-API-4: no adapter import). */
function recordingStorage() {
  const objects = new Map<string, { readonly body: Uint8Array; readonly contentType: string }>();
  const calls: { readonly operation: string; readonly args: readonly unknown[] }[] = [];
  return {
    calls,
    async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
      calls.push({ operation: 'put', args: [key] });
      objects.set(key, { body: Uint8Array.from(body), contentType });
    },
    async read(key: string): Promise<{ readonly body: Uint8Array; readonly contentType: string }> {
      calls.push({ operation: 'read', args: [key] });
      const object = objects.get(key);
      if (object === undefined) throw new Error('nothing is stored under this key');
      return object;
    },
    async remove(key: string): Promise<void> {
      calls.push({ operation: 'remove', args: [key] });
      objects.delete(key);
    },
    async exists(key: string): Promise<boolean> {
      return objects.has(key);
    },
    async temporaryLink(key: string, seconds: number): Promise<string> {
      return `https://files.invalid/${key}?expires=${String(seconds)}`;
    },
  };
}

let db: Db;
let database: Database;

beforeAll(async () => {
  db = await connectAsApplication();
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 4,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
});

afterAll(async () => {
  await db?.end();
  if (database !== undefined) await closeDatabase(database);
});

async function rowsOf(teacherId: string): Promise<{ storage_key: string }[]> {
  const { rows } = await db.query<{ storage_key: string }>(
    `SELECT storage_key FROM teacher_signatures WHERE teacher_user_id = $1`,
    [teacherId],
  );
  return rows;
}

describe('the signature row (the follow-up under T003)', () => {
  it('holds one row per teacher under the real unique', async () => {
    const teacherId = await makeUser(db);
    await insertRow(db, 'teacher_signatures', {
      teacher_user_id: teacherId,
      storage_key: `signatures/${teacherId}/${randomUUID()}.png`,
    });
    const second: unknown = await insertRow(db, 'teacher_signatures', {
      teacher_user_id: teacherId,
      storage_key: `signatures/${teacherId}/${randomUUID()}.png`,
    }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(second).toMatchObject({
      code: SQLSTATE.uniqueViolation,
      constraint: 'teacher_signatures_teacher_user_id_key',
    });
    expect(await rowsOf(teacherId)).toHaveLength(1);
  });

  it('serialises two concurrent uploads of one teacher on the users lock', async () => {
    const teacherId = await makeUser(db);
    const storage = recordingStorage();
    const original = `signatures/${teacherId}/${randomUUID()}.png`;
    await storage.put(original, PNG, 'image/png');
    await insertRow(db, 'teacher_signatures', {
      teacher_user_id: teacherId,
      storage_key: original,
    });

    // Each transaction's read of the current row pauses until the other has read too, or PAUSE_MS.
    let reads = 0;
    let bothRead = (): void => undefined;
    const allRead = new Promise<void>((resolve) => {
      bothRead = resolve;
    });
    const pausing = (tx: Transaction): Transaction =>
      new Proxy(tx, {
        get(target, property, receiver) {
          const value: unknown = Reflect.get(target, property, receiver);
          if (property !== 'teacherSignature') return value;
          const table = value as Transaction['teacherSignature'];
          return new Proxy(table, {
            get(inner, name, innerReceiver) {
              const method: unknown = Reflect.get(inner, name, innerReceiver);
              if (name !== 'findUnique' || typeof method !== 'function') return method;
              return async (...args: unknown[]) => {
                const row: unknown = await (method as (...a: unknown[]) => Promise<unknown>).apply(
                  inner,
                  args,
                );
                reads += 1;
                if (reads === 2) bothRead();
                await Promise.race([
                  allRead,
                  new Promise((resolve) => setTimeout(resolve, PAUSE_MS)),
                ]);
                return row;
              };
            },
          });
        },
      });
    const paused = {
      ...database,
      $transaction: (work: (tx: Transaction) => Promise<unknown>) =>
        database.$transaction((tx) => work(pausing(tx)), { maxWait: 5_000, timeout: 20_000 }),
    } as unknown as Database;
    const signatures = createTeacherSignatureService({
      database: paused,
      storage,
      settings,
      log: { info: () => undefined, warn: () => undefined } as never,
    });

    await Promise.all([
      signatures.replace(teacherId, { type: 'image/png', bytes: PNG }),
      signatures.replace(teacherId, { type: 'image/png', bytes: PNG }),
    ]);

    const rows = await rowsOf(teacherId);
    expect(rows).toHaveLength(1);
    const kept = rows[0]?.storage_key ?? '';
    const puts = storage.calls
      .filter(({ operation }) => operation === 'put')
      .map(({ args }) => String(args[0]))
      .filter((key) => key !== original);
    expect(puts).toHaveLength(2);
    expect(puts).toContain(kept);
    // The other new file was replaced by the second upload and erased; the original too.
    const stillStored = await Promise.all(
      [original, ...puts].map(async (key) => ((await storage.exists(key)) ? key : null)),
    );
    expect(stillStored.filter((key) => key !== null)).toEqual([kept]);
  });
});
