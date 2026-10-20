// T093 — the verification module's store of unreferenced documents, over the real tables, as the
// `purge-unreferenced-documents` sweep and the uploads route's per-user cap reach it (R-API-6).
//
// A document is unreferenced when no `teacher_profiles.identity_document_id` (identity),
// `teacher_credentials.document_id` (catalog) or `verification_requests.document_id`
// (verification) points at it. The store reads its own table's pointer and asks the two other
// modules through their entries, as `worker.ts` and `main.ts` compose it, answers each candidate
// with its storage key decrypted, and removes a row only while nothing points at it, with the
// object's removal inside that deletion: the foreign keys refuse a row pointed at meanwhile, and
// an object that cannot be removed keeps its row. Rows are committed (the store opens its own
// transaction) and every probe's rows are its own, so a probe asserts membership, not totals.
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createDocumentReferences as catalogReferences } from '../../apps/api/src/modules/catalog/index.js';
import { createDocumentReferences as identityReferences } from '../../apps/api/src/modules/identity/index.js';
import {
  createUnreferencedDocuments,
  type UnreferencedDocuments,
} from '../../apps/api/src/modules/verification/index.js';
import { ColumnCipher } from '../../apps/api/src/platform/crypto/encryption.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import {
  connectAsApplication,
  type Db,
  insertRow,
  makeAdmin,
  makeSubject,
  makeUser,
} from './harness';

const cipher = new ColumnCipher(Buffer.alloc(32, 3).toString('base64'));
const COLUMN = 'verification_documents.storage_key_encrypted';
const OLD = '2026-01-01T00:00:00Z';
const RECENT = '2026-09-01T00:00:00Z';
const WINDOW_START = new Date('2026-06-01T00:00:00Z');

let db: Db;
let database: Database;
let store: UnreferencedDocuments;

beforeAll(async () => {
  db = await connectAsApplication();
  database = openDatabase(process.env['DATABASE_URL'] ?? '', {
    poolMax: 2,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  store = createUnreferencedDocuments({
    database,
    cipher,
    references: [identityReferences(database), catalogReferences(database)],
  });
});

afterAll(async () => {
  await closeDatabase(database);
  await db.end();
});

/** A document of `userId`'s, uploaded at `uploadedAt`, its key encrypted as the uploads route does. */
async function document(userId: string, uploadedAt: string): Promise<{ id: string; key: string }> {
  const id = randomUUID();
  const key = `documents/${id}.pdf`;
  await insertRow(db, 'verification_documents', {
    id,
    user_id: userId,
    document_type: 'other',
    storage_key_encrypted: Buffer.from(cipher.encrypt(key, COLUMN, id)),
    uploaded_at: uploadedAt,
  });
  return { id, key };
}

/** One old document pointed at from each module, and one old and one recent pointed at by none. */
async function plant() {
  const userId = await makeUser(db);
  const loose = await document(userId, OLD);
  const recent = await document(userId, RECENT);
  const ofProfile = await document(userId, OLD);
  await insertRow(db, 'teacher_profiles', {
    user_id: userId,
    bio: '',
    qualification_summary: '',
    verification_status: 'pending',
    identity_document_id: ofProfile.id,
  });
  const ofCredential = await document(userId, OLD);
  await insertRow(db, 'teacher_credentials', {
    teacher_user_id: userId,
    subject_id: await makeSubject(db),
    document_id: ofCredential.id,
    status: 'pending',
    submitted_with_application: true,
  });
  const ofRequest = await document(userId, OLD);
  await insertRow(db, 'verification_requests', {
    user_id: userId,
    requested_by_admin_id: await makeAdmin(db),
    reason: 'Probe reason',
    status: 'open',
    document_id: ofRequest.id,
  });
  return { userId, loose, recent, ofProfile, ofCredential, ofRequest };
}

async function exists(id: string): Promise<boolean> {
  const { rows } = await db.query('SELECT 1 FROM verification_documents WHERE id = $1', [id]);
  return rows.length === 1;
}

describe('the unreferenced documents, through the verification module (T093)', () => {
  it('lists an old document nothing points at, its key decrypted, and none pointed at or recent', async () => {
    const planted = await plant();
    const listed = await store.listUnreferencedUploadedBefore(WINDOW_START);
    const ids = new Set(listed.map(({ id }) => id));
    expect(listed.find(({ id }) => id === planted.loose.id)).toEqual({
      id: planted.loose.id,
      storageKey: planted.loose.key,
    });
    for (const kept of [
      planted.recent,
      planted.ofProfile,
      planted.ofCredential,
      planted.ofRequest,
    ]) {
      expect(ids.has(kept.id)).toBe(false);
    }
  });

  it('removes the row with its object inside the deletion', async () => {
    const { loose } = await plant();
    const removeObject = vi.fn(async () => undefined);
    await expect(
      store.removeUnreferenced({ id: loose.id, storageKey: loose.key }, removeObject),
    ).resolves.toBe(true);
    expect(removeObject).toHaveBeenCalledWith(loose.key);
    expect(await exists(loose.id)).toBe(false);
  });

  it('keeps a row something points at, from any module, and never touches its object', async () => {
    const planted = await plant();
    const removeObject = vi.fn(async () => undefined);
    for (const pointed of [planted.ofProfile, planted.ofCredential, planted.ofRequest]) {
      await expect(
        store.removeUnreferenced({ id: pointed.id, storageKey: pointed.key }, removeObject),
      ).resolves.toBe(false);
      expect(await exists(pointed.id)).toBe(true);
    }
    expect(removeObject).not.toHaveBeenCalled();
  });

  it('keeps the row when its object cannot be removed', async () => {
    const { loose } = await plant();
    const failure = new Error('storage unreachable');
    await expect(
      store.removeUnreferenced({ id: loose.id, storageKey: loose.key }, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await exists(loose.id)).toBe(true);
  });

  it("counts a person's unreferenced documents of any age, for the uploads route's cap", async () => {
    const { userId } = await plant();
    await expect(store.countOf(userId)).resolves.toBe(2);
    await expect(store.countOf(await makeUser(db))).resolves.toBe(0);
  });
});
