// B16 (T080, T082; the B16 check, decision 1; Egypt PDPL): a deleted person's stored files, over the
// real tables, as `main.ts` and `worker.ts` compose the modules (R-API-6, R-121).
//
// - Rule 34: a `verification_documents` row may lose its storage key only once it is erased; a row
//   with no key and no `erased_at` is refused by the database.
// - The deletion's transaction reaches the verification module only through the consequences
//   registry: its subscriber sets `erased_at` on the person's documents and leaves every key. After
//   the commit each file is removed through the storage port and its key cleared only once removed;
//   a removal that fails keeps the key, and the `erase-deleted-files` stores list the row until a
//   later run clears it. Another person's documents are untouched.
// - The photo follows the same rule through the identity module's store: a deleted person's photo
//   key is held until its file is gone.
// - The documents sweep (T093) passes over a row whose key is already gone.
// - T076 of specs/004-sessions (PR #137's follow-up 5 under T058): a deleted account's whole record
//   through `users.get`, over the real tables: no name, no address, no minor flag once the date of
//   birth is erased, a teacher's bio and qualification summary erased.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { hashPassword } from '../../apps/api/src/platform/crypto/hashing.js';
import { createEnrollmentSide } from '../../apps/api/src/modules/booking/index.js';
import { createBanLift } from '../../apps/api/src/modules/sessions/index.js';
import {
  AccountConsequences,
  createErasedPhotos,
  createIdentityServices,
} from '../../apps/api/src/modules/identity/index.js';
import {
  createDocumentErasure,
  createUnreferencedDocuments,
  createUserDirectory,
  documentErasureConsequence,
  VerificationService,
} from '../../apps/api/src/modules/verification/index.js';
import { ColumnCipher } from '../../apps/api/src/platform/crypto/encryption.js';
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
import {
  attempt,
  connectAsApplication,
  type Db,
  inRollback,
  insertRow,
  makeUser,
  SQLSTATE,
} from './harness';

const KEY = Buffer.alloc(32, 7).toString('base64');
const cipher = new ColumnCipher(KEY);
const COLUMN = 'verification_documents.storage_key_encrypted';
const PASSWORD = 'a long probe passphrase 34';

const SETTINGS: Readonly<Record<string, unknown>> = {
  otp_code_ttl_minutes: 10,
  otp_max_attempts: 5,
  onboarding_token_ttl_minutes: 15,
  session_access_ttl_minutes: 15,
  session_refresh_ttl_days: 30,
  session_refresh_grace_seconds: 30,
  provider_nonce_ttl_minutes: 10,
  idempotency_key_ttl_hours: 24,
};

const linkSettings: SettingsReader = {
  async read(key, schema) {
    if (key !== 'document_link_ttl_seconds') throw new SettingError(key, 'missing');
    return schema.parse(300);
  },
};

const settings: SettingsReader = {
  async read(key, schema) {
    if (!Object.hasOwn(SETTINGS, key)) throw new SettingError(key, 'missing');
    const parsed = schema.safeParse(SETTINGS[key]);
    if (!parsed.success) throw new SettingError(key, 'invalid');
    return parsed.data;
  },
};

/** The storage port's removal, failing for the keys it is told to. */
const storage = {
  removed: [] as string[],
  failing: new Set<string>(),
  async remove(key: string) {
    if (this.failing.has(key)) throw new Error('probe storage: unreachable');
    this.removed.push(key);
  },
  async temporaryLink(key: string) {
    return `https://storage.invalid/${key}`;
  },
};

let db: Db;
let database: Database;
let deletion: ReturnType<typeof createIdentityServices>['deletion'];
let erasure: ReturnType<typeof createDocumentErasure>;
let photos: ReturnType<typeof createErasedPhotos>;

beforeAll(async () => {
  db = await connectAsApplication();
  database = openDatabase(process.env['DATABASE_URL'] ?? '', {
    poolMax: 2,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  const consequences = new AccountConsequences();
  consequences.subscribe(documentErasureConsequence());
  erasure = createDocumentErasure({ database, cipher, storage });
  photos = createErasedPhotos(database);
  const unreachable = () => Promise.reject(new Error('probe: not reached'));
  deletion = createIdentityServices({
    database,
    settings,
    encryptionKey: KEY,
    cipher,
    marks: new MemorySingleUseMarks(() => new Date()),
    signIn: {
      verifyIdentityToken: unreachable,
      exchangeAuthorization: unreachable,
      revoke: unreachable,
    },
    email: { deliver: async () => undefined },
    storage,
    log: { warn: () => undefined },
    payment: { registerPayoutRecipient: unreachable },
    idempotency: new IdempotencyService<Transaction>({
      store: new IdempotencyRepository(database),
      settings,
    }),
    consequences,
    fileErasures: [erasure],
    report: () => undefined,
  }).deletion;
});

afterAll(async () => {
  await closeDatabase(database);
  await db.end();
});

/** A live email account with a password, and the documents given. */
async function personWithDocuments(count: number, uploadedAt?: string) {
  const userId = await makeUser(db, { password_hash: await hashPassword(PASSWORD) });
  await insertRow(db, 'user_roles', { user_id: userId, role: 'teacher', status: 'active' });
  const documents: { id: string; key: string }[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = randomUUID();
    const key = `documents/${id}.pdf`;
    await insertRow(db, 'verification_documents', {
      id,
      user_id: userId,
      document_type: 'national_id',
      storage_key_encrypted: Buffer.from(cipher.encrypt(key, COLUMN, id)),
      ...(uploadedAt === undefined ? {} : { uploaded_at: uploadedAt }),
    });
    documents.push({ id, key });
  }
  return { userId, documents };
}

async function documentRow(id: string) {
  const { rows } = await db.query<{ erased_at: Date | null; has_key: boolean }>(
    `SELECT erased_at, storage_key_encrypted IS NOT NULL AS has_key
       FROM verification_documents WHERE id = $1`,
    [id],
  );
  return rows[0];
}

function remove(userId: string) {
  return deletion.deleteAccount(userId, {
    confirmation: 'DELETE',
    reauth: { kind: 'password', password: PASSWORD },
    idempotencyKey: randomUUID(),
  });
}

describe('rule 34: a document loses its key only once it is erased', () => {
  it('refuses a row with no key and no erased_at, and admits one with erased_at', async () => {
    await inRollback(db, async (tx) => {
      const userId = await makeUser(tx);
      const insert = `INSERT INTO verification_documents (user_id, document_type, storage_key_encrypted, erased_at)
                      VALUES ($1, 'other', NULL, $2)`;
      expect(await attempt(tx, insert, [userId, null])).toBe(SQLSTATE.checkViolation);
      expect(await attempt(tx, insert, [userId, new Date()])).toBeNull();
    });
  });
});

describe("a deleted person's documents (B16 check, decision 1)", () => {
  it('marks them erased in the transaction, then removes each file and clears its key; another person is untouched', async () => {
    const person = await personWithDocuments(2);
    const other = await personWithDocuments(1);
    await remove(person.userId);

    for (const { id } of person.documents) {
      await vi.waitFor(async () =>
        expect(await documentRow(id)).toEqual({ erased_at: expect.any(Date), has_key: false }),
      );
    }
    expect(storage.removed).toEqual(expect.arrayContaining(person.documents.map(({ key }) => key)));
    expect(await documentRow(other.documents[0]?.id ?? '')).toEqual({
      erased_at: null,
      has_key: true,
    });
  });

  it('keeps the key of a file it could not remove, and the job store lists it until a removal succeeds', async () => {
    const person = await personWithDocuments(1);
    const [document] = person.documents;
    if (document === undefined) throw new Error('no document');
    storage.failing.add(document.key);
    await remove(person.userId);
    await vi.waitFor(async () =>
      expect((await documentRow(document.id))?.erased_at).toEqual(expect.any(Date)),
    );
    expect((await documentRow(document.id))?.has_key).toBe(true);

    const pending = await erasure.pendingPage(undefined, 1000);
    expect(pending).toContainEqual({
      id: document.id,
      ownerUserId: person.userId,
      storageKey: document.key,
    });
    storage.failing.delete(document.key);
    await storage.remove(document.key);
    await expect(
      erasure.clearKey({ id: document.id, ownerUserId: person.userId, storageKey: document.key }),
    ).resolves.toBe(true);
    expect(await documentRow(document.id)).toEqual({ erased_at: expect.any(Date), has_key: false });
    await expect(
      erasure.clearKey({ id: document.id, ownerUserId: person.userId, storageKey: document.key }),
    ).resolves.toBe(false);
  });

  it('mints no link to an erased document, not even for an administrator, while its key is still held', async () => {
    const person = await personWithDocuments(1);
    const [document] = person.documents;
    if (document === undefined) throw new Error('no document');
    storage.failing.add(document.key);
    const links = new VerificationService({ storage, cipher, settings: linkSettings });
    await database.$transaction(async (tx) => {
      await expect(
        links.documentLinkFor(tx, document.id, { kind: 'admin', adminId: randomUUID() }),
      ).resolves.toMatchObject({ url: expect.any(String) });
    });
    await remove(person.userId);
    await vi.waitFor(async () =>
      expect((await documentRow(document.id))?.erased_at).toEqual(expect.any(Date)),
    );
    expect((await documentRow(document.id))?.has_key).toBe(true);
    await database.$transaction(async (tx) => {
      await expect(
        links.documentLinkFor(tx, document.id, { kind: 'admin', adminId: randomUUID() }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
    storage.failing.delete(document.key);
  });

  it("never lists a live person's document, nor one whose key is gone", async () => {
    const live = await personWithDocuments(1);
    const pending = await erasure.pendingPage(undefined, 1000);
    expect(pending.map(({ id }) => id)).not.toContain(live.documents[0]?.id);
  });

  it('the documents sweep passes over a row whose key is already gone', async () => {
    // Uploaded long before every other probe's rows, whose keys are under other ciphers, so the
    // window holds only this probe's document.
    const person = await personWithDocuments(1, '2000-01-01T00:00:00Z');
    await remove(person.userId);
    const [document] = person.documents;
    await vi.waitFor(async () =>
      expect((await documentRow(document?.id ?? ''))?.has_key).toBe(false),
    );
    const sweep = createUnreferencedDocuments({ database, cipher, references: [] });
    const listed = await sweep.listUnreferencedUploadedBefore(new Date('2000-01-02T00:00:00Z'));
    expect(listed.map(({ id }) => id)).not.toContain(document?.id);
  });
});

describe("a deleted person's photo", () => {
  it('is listed for the job while its key is held, and its key is cleared once the file is gone', async () => {
    const photoKey = `photos/${randomUUID()}.jpg`;
    const userId = await makeUser(db, {
      password_hash: await hashPassword(PASSWORD),
      photo_key: photoKey,
    });
    await insertRow(db, 'user_roles', { user_id: userId, role: 'student', status: 'active' });
    storage.failing.add(photoKey);
    await remove(userId);
    await vi.waitFor(async () => {
      const { rows } = await db.query<{ deleted: boolean }>(
        'SELECT deleted_at IS NOT NULL AS deleted FROM users WHERE id = $1',
        [userId],
      );
      expect(rows[0]?.deleted).toBe(true);
    });
    const pending = await photos.pendingPage(undefined, 1000);
    expect(pending).toContainEqual({ id: userId, ownerUserId: userId, storageKey: photoKey });
    await expect(
      photos.clearKey({ id: userId, ownerUserId: userId, storageKey: photoKey }),
    ).resolves.toBe(true);
    const { rows } = await db.query<{ photo_key: string | null }>(
      'SELECT photo_key FROM users WHERE id = $1',
      [userId],
    );
    expect(rows[0]?.photo_key).toBeNull();
    storage.failing.delete(photoKey);
  });

  it("never lists a live person's photo", async () => {
    const photoKey = `photos/${randomUUID()}.jpg`;
    const userId = await makeUser(db, { photo_key: photoKey });
    const pending = await photos.pendingPage(undefined, 1000);
    expect(pending.map(({ id }) => id)).not.toContain(userId);
  });
});

/** T076 (follow-up 5): what `users.get` reads besides the person. */
const DIRECTORY_SETTINGS: Readonly<Record<string, number>> = {
  admin_list_page_size: 20,
  repeated_absence_flag_count: 5,
  cancellation_requests_recent_days: 30,
  ban_restore_window_days: 14,
};
const directorySettings: SettingsReader = {
  read: async (key, schema) => {
    if (!Object.hasOwn(DIRECTORY_SETTINGS, key)) throw new SettingError(key, 'missing');
    return schema.parse(DIRECTORY_SETTINGS[key]);
  },
};

function userDirectory() {
  const enrollments = createEnrollmentSide({ settings: directorySettings });
  return createUserDirectory({
    database,
    settings: directorySettings,
    enrollments,
    log: { info: () => undefined },
    slotHeldUntilOf: createBanLift({
      enrollments,
      restore: {
        restoreClosed: async () => {
          throw new Error('not used by the directory');
        },
      },
      settings: directorySettings,
      log: { info: () => undefined, warn: () => undefined },
    }).slotHeldUntilOf,
  });
}

const recordOf = (userId: string) =>
  database.$transaction((tx) => userDirectory().get(tx, randomUUID(), { targetUserId: userId }));

describe("a deleted account's whole record through users.get (T076; T058's follow-up 5)", () => {
  it('a deleted student: no name, no address, not a minor once the date of birth is erased', async () => {
    const userId = await makeUser(db, {
      password_hash: await hashPassword(PASSWORD),
      // A minor while live: only the erased date of birth makes the record say otherwise.
      date_of_birth: '2016-01-01',
      gender: 'female',
    });
    await insertRow(db, 'user_roles', { user_id: userId, role: 'student', status: 'active' });
    await remove(userId);
    expect(await recordOf(userId)).toEqual({
      userId,
      profile: { displayName: null, email: null, joinedAt: expect.any(String), deleted: true },
      role: 'student',
      gender: 'female',
      isMinor: false,
      verificationStatus: null,
      accountStatus: 'active',
      cancellationRequests: { total: 0, recent: 0 },
      enrollmentsSlotHeldUntil: null,
      banRestoreWindowDays: 14,
    });
  });

  it.each([
    ['never approved', null],
    ['ever approved', '2026-11-01T09:00:00Z'],
  ])(
    'a deleted teacher %s: no name, no address, the bio and the qualification summary erased',
    async (_label, approvedAt) => {
      const userId = await makeUser(db, { password_hash: await hashPassword(PASSWORD) });
      await insertRow(db, 'user_roles', { user_id: userId, role: 'teacher', status: 'active' });
      await insertRow(db, 'teacher_profiles', {
        user_id: userId,
        bio: 'سيرة المعلّم',
        qualification_summary: 'إجازة في حفص',
        verification_status: approvedAt === null ? 'pending' : 'approved',
        ...(approvedAt === null ? {} : { approved_at: approvedAt }),
      });
      await remove(userId);
      expect(await recordOf(userId)).toMatchObject({
        userId,
        profile: {
          displayName: null,
          email: null,
          deleted: true,
          teacher: { bio: '', qualification: '' },
        },
        role: 'teacher',
        isMinor: false,
        verificationStatus: approvedAt === null ? 'pending' : 'approved',
      });
    },
  );
});
