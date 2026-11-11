// T040 of specs/004-sessions/tasks.md — a deleted party's held files, read inside the open matter
// (spec FR-487; SRS FR-AUTH-14 as amended on 2026-11-06; research R-327, «The administrator's
// read»; contracts/admin-surface.md, `disputes.heldFiles` and `disputes.heldFileLink`).
//
// Sessions' `createDisputeMatterReads` over booking's real `EnrollmentSide` and moderation's
// `caseRecordOf`, asking verification's real `createDisputeHeldFiles()` (its held-document readers
// beside `readDocument`, on the call's transaction, and identity's held photo past the soft-delete
// filter), over the real tables as the application role:
//
//   - a deleted student's held photo and document listed by reference inside an open matter of each
//     kind, with no link and no key; the live teacher's files not listed; one link per press;
//   - refused `NOT_FOUND`: a live party's document and photo, another enrollment's deleted party's
//     document and photo, a reference of neither form, a document that is none;
//   - both refused `CONFLICT` `not_open` once the matter is closed;
//   - `erase-deleted-files` leaves the files while the matter is open, and its first run after the
//     close removes them; inside a later open matter of the same enrollment the list is empty and a
//     link asked for them answers `NOT_FOUND`;
//   - the ordinary readers still answer a held erased document as none while it is held:
//     `documents.link` (verification's request service), the teacher's `credentials.documentLink`
//     and `VerificationService.documentLinkFor` itself, for an administrator and for the owner.
//
// The erase job runs over the two real stores' `clearKey`, each store's page narrowed to this
// probe's rows: the integrity database is shared, and other probes' erased rows are under other
// ciphers. The storage port is a recorder. The keys are sealed under `account-deletion.spec.ts`'
// cipher, whose job store pages over every erased document while this probe runs; once done, the
// probe clears the keys it left held, so no later run's page meets them.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createEnrollmentSide,
  heldFileOwnersAmong,
} from '../../apps/api/src/modules/booking/index.js';
import { createDisputeChat } from '../../apps/api/src/modules/chat/index.js';
import { createErasedPhotos } from '../../apps/api/src/modules/identity/index.js';
import { createDisputeMatterReads } from '../../apps/api/src/modules/sessions/index.js';
import {
  createDisputeHeldFiles,
  createDocumentErasure,
  createVerificationAdminServices,
  createVerificationServices,
  VerificationService,
} from '../../apps/api/src/modules/verification/index.js';
import {
  eraseDeletedFiles,
  type ErasedFileStore,
} from '../../apps/api/src/jobs/erase-deleted-files.js';
import { ColumnCipher } from '../../apps/api/src/platform/crypto/encryption.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { DomainError } from '../../apps/api/src/platform/errors/domain-error.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import {
  SettingError,
  type SettingsReader,
} from '../../apps/api/src/platform/settings/settings-reader.js';
import {
  connectAsApplication,
  type Db,
  insertRow,
  makeAdmin,
  makeCredential,
  makeEnrollment,
  makeSession,
} from './harness';

const cipher = new ColumnCipher(Buffer.alloc(32, 7).toString('base64'));
/** The erased documents and the deleted people's photos this probe leaves holding a key. */
const heldDocuments: string[] = [];
const heldPhotos: string[] = [];
const COLUMN = 'verification_documents.storage_key_encrypted';
const ADMIN = randomUUID();

const SETTINGS: Readonly<Record<string, unknown>> = {
  document_link_ttl_seconds: 300,
  slot_release_buffer_weeks: 1,
  chat_page_size: 50,
};

const settings: SettingsReader = {
  async read(key, schema) {
    if (!Object.hasOwn(SETTINGS, key)) throw new SettingError(key, 'missing');
    return schema.parse(SETTINGS[key]);
  },
};

/** The storage port: links name the key they open, removals are recorded. */
const storage = {
  removed: [] as string[],
  async temporaryLink(key: string) {
    return `https://storage.invalid/${key}`;
  },
  async remove(key: string) {
    this.removed.push(key);
  },
};

let db: Db;
let database: Database;

beforeAll(async () => {
  db = await connectAsApplication();
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 3,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
});

afterAll(async () => {
  if (db !== undefined) {
    await db.query(
      `UPDATE verification_documents SET storage_key_encrypted = NULL
        WHERE id = ANY($1::uuid[]) AND erased_at IS NOT NULL`,
      [heldDocuments],
    );
    await db.query(
      `UPDATE users SET photo_key = NULL, updated_at = now()
        WHERE id = ANY($1::uuid[]) AND deleted_at IS NOT NULL`,
      [heldPhotos],
    );
  }
  await db?.end();
  if (database !== undefined) await closeDatabase(database);
});

const reads = () =>
  createDisputeMatterReads({
    enrollments: createEnrollmentSide({ settings }),
    heldFiles: createDisputeHeldFiles({ database, storage, cipher, settings }),
    chat: createDisputeChat({ enrollments: createEnrollmentSide({ settings }), settings }),
    log: { info: () => undefined },
  });

const inTx = <T>(work: (tx: Transaction) => Promise<T>): Promise<T> => database.$transaction(work);

async function codeOf(work: Promise<unknown>): Promise<{ code: string; cause?: string }> {
  const thrown: unknown = await work.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof DomainError))
    throw new Error(`expected a refusal, got ${String(thrown)}`);
  const cause = thrown.details?.find(({ path }) => path === 'cause')?.code;
  return cause === undefined ? { code: thrown.code } : { code: thrown.code, cause };
}

/** A document of `userId` whose key is sealed under this probe's cipher; erased when said. */
async function documentOf(
  userId: string,
  erased: boolean,
): Promise<{ id: string; key: string; uploadedAt: string }> {
  const id = randomUUID();
  const key = `documents/${id}.pdf`;
  const uploadedAt = '2026-09-01T10:00:00.000Z';
  await insertRow(db, 'verification_documents', {
    id,
    user_id: userId,
    document_type: 'national_id',
    storage_key_encrypted: Buffer.from(cipher.encrypt(key, COLUMN, id)),
    uploaded_at: uploadedAt,
    ...(erased ? { erased_at: '2026-11-10T10:00:00Z' } : {}),
  });
  if (erased) heldDocuments.push(id);
  return { id, key, uploadedAt };
}

/** Gives the person a photo key, and soft-deletes them when said (the deletion leaves the key). */
async function withPhoto(userId: string, deleted: boolean): Promise<string> {
  const photoKey = `photos/${randomUUID()}.jpg`;
  await db.query(
    `UPDATE users SET photo_key = $2, updated_at = now()${deleted ? ', deleted_at = now()' : ''}
      WHERE id = $1`,
    [userId, photoKey],
  );
  if (deleted) heldPhotos.push(userId);
  return photoKey;
}

function openCase(enrollmentId: string, reason = 'teacher_ended'): Promise<string> {
  return insertRow(db, 'disputes', {
    enrollment_id: enrollmentId,
    kind: 'compensation_case',
    reason,
    status: 'open',
  });
}

async function closeCase(caseId: string): Promise<void> {
  await db.query(
    `UPDATE disputes SET status = 'dismissed', resolution_notes = 'Probe decision',
            resolved_by_admin_id = $2, resolved_at = now(), updated_at = now() WHERE id = $1`,
    [caseId, await makeAdmin(db)],
  );
}

/**
 * An enrollment whose student is deleted holding a photo and an erased document, whose teacher is
 * live with a photo and a document, and an open compensation case on it.
 */
async function matter() {
  const { enrollmentId, studentId, teacherId } = await makeEnrollment(db);
  const studentDocument = await documentOf(studentId, true);
  const studentPhoto = await withPhoto(studentId, true);
  const teacherDocument = await documentOf(teacherId, false);
  await withPhoto(teacherId, false);
  const caseId = await openCase(enrollmentId);
  return {
    enrollmentId,
    studentId,
    teacherId,
    studentDocument,
    studentPhoto,
    teacherDocument,
    caseId,
  };
}

describe('disputes.heldFiles and disputes.heldFileLink over the real tables (FR-487, R-327)', () => {
  it('lists the deleted student’s held photo and document by reference, with no link and no key', async () => {
    const world = await matter();
    const { files } = await inTx((tx) => reads().heldFiles(tx, ADMIN, { disputeId: world.caseId }));
    expect(files).toEqual([
      { fileRef: `photo:${world.studentId}`, kind: 'photo', ownerRole: 'student' },
      {
        fileRef: `document:${world.studentDocument.id}`,
        kind: 'national_id',
        ownerRole: 'student',
        uploadedAt: world.studentDocument.uploadedAt,
      },
    ]);
    const text = JSON.stringify(files);
    expect(text).not.toContain(world.studentPhoto);
    expect(text).not.toContain(world.studentDocument.key);
    expect(text).not.toContain('https:');
  });

  it('mints one link per press to each held file', async () => {
    const world = await matter();
    const link = (fileRef: string) =>
      inTx((tx) => reads().heldFileLink(tx, ADMIN, { disputeId: world.caseId, fileRef }));
    expect(await link(`document:${world.studentDocument.id}`)).toMatchObject({
      url: `https://storage.invalid/${world.studentDocument.key}`,
      expiresAt: expect.any(String),
    });
    expect(await link(`photo:${world.studentId}`)).toMatchObject({
      url: `https://storage.invalid/${world.studentPhoto}`,
    });
  });

  it.each(['session_dispute', 'absence_complaint'] as const)(
    'reads inside an open %s as inside a case',
    async (kind) => {
      const { enrollmentId, sessionId, studentId } = await makeSession(db);
      const studentDocument = await documentOf(studentId, true);
      await db.query('UPDATE users SET deleted_at = now(), updated_at = now() WHERE id = $1', [
        studentId,
      ]);
      const disputeId = await insertRow(db, 'disputes', {
        enrollment_id: enrollmentId,
        ...(kind === 'session_dispute' ? { session_id: sessionId } : {}),
        kind,
        raised_by_user_id: studentId,
        reason: 'Probe matter',
        status: 'open',
      });
      const { files } = await inTx((tx) => reads().heldFiles(tx, ADMIN, { disputeId }));
      expect(files.map(({ fileRef }) => fileRef)).toEqual([`document:${studentDocument.id}`]);
    },
  );

  it('refuses NOT_FOUND a live party’s files, another enrollment’s deleted party’s, and a reference of neither form', async () => {
    const world = await matter();
    const other = await matter();
    const link = (fileRef: string) =>
      codeOf(inTx((tx) => reads().heldFileLink(tx, ADMIN, { disputeId: world.caseId, fileRef })));
    for (const fileRef of [
      `document:${world.teacherDocument.id}`,
      `photo:${world.teacherId}`,
      `document:${other.studentDocument.id}`,
      `photo:${other.studentId}`,
      `document:${randomUUID()}`,
      world.studentDocument.key,
      'neither form',
    ]) {
      expect(await link(fileRef)).toEqual({ code: 'NOT_FOUND' });
    }
  });

  it('refuses a dispute that is none NOT_FOUND', async () => {
    expect(
      await codeOf(inTx((tx) => reads().heldFiles(tx, ADMIN, { disputeId: randomUUID() }))),
    ).toEqual({ code: 'NOT_FOUND' });
  });

  it('refuses both CONFLICT not_open once the matter is closed', async () => {
    const world = await matter();
    await closeCase(world.caseId);
    expect(
      await codeOf(inTx((tx) => reads().heldFiles(tx, ADMIN, { disputeId: world.caseId }))),
    ).toEqual({ code: 'CONFLICT', cause: 'not_open' });
    expect(
      await codeOf(
        inTx((tx) =>
          reads().heldFileLink(tx, ADMIN, {
            disputeId: world.caseId,
            fileRef: `document:${world.studentDocument.id}`,
          }),
        ),
      ),
    ).toEqual({ code: 'CONFLICT', cause: 'not_open' });
  });

  it('erase-deleted-files leaves the files while the matter is open; its first run after the close removes them, and a link then answers NOT_FOUND', async () => {
    const world = await matter();
    const documents = createDocumentErasure({ database, cipher, storage });
    const photos = createErasedPhotos(database);
    const documentFile = {
      id: world.studentDocument.id,
      ownerUserId: world.studentId,
      storageKey: world.studentDocument.key,
    };
    const photoFile = {
      id: world.studentId,
      ownerUserId: world.studentId,
      storageKey: world.studentPhoto,
    };
    const probeStores: ErasedFileStore[] = [
      {
        pendingPage: async (after) => (after === undefined ? [documentFile] : []),
        clearKey: (file) => documents.clearKey(file),
      },
      {
        pendingPage: async (after) => (after === undefined ? [photoFile] : []),
        clearKey: (file) => photos.clearKey(file),
      },
    ];
    const reported: unknown[] = [];
    const job = eraseDeletedFiles({
      stores: probeStores,
      storage,
      held: (userIds) => heldFileOwnersAmong(database, userIds),
      report: (error) => reported.push(error),
      pageSize: 10,
    });

    await job.handle({});
    expect(storage.removed).not.toContain(world.studentDocument.key);
    expect(storage.removed).not.toContain(world.studentPhoto);
    const stillHeld = await inTx((tx) => reads().heldFiles(tx, ADMIN, { disputeId: world.caseId }));
    expect(stillHeld.files).toHaveLength(2);

    await closeCase(world.caseId);
    await job.handle({});
    expect(reported).toEqual([]);
    expect(storage.removed).toEqual(
      expect.arrayContaining([world.studentDocument.key, world.studentPhoto]),
    );

    const later = await openCase(world.enrollmentId, 'admin_opened_for_student');
    expect(await inTx((tx) => reads().heldFiles(tx, ADMIN, { disputeId: later }))).toEqual({
      files: [],
    });
    for (const fileRef of [`document:${world.studentDocument.id}`, `photo:${world.studentId}`]) {
      expect(
        await codeOf(inTx((tx) => reads().heldFileLink(tx, ADMIN, { disputeId: later, fileRef }))),
      ).toEqual({ code: 'NOT_FOUND' });
    }
  });
});

describe('the ordinary readers while a file is held (FR-487, the fifth analysis, U3)', () => {
  it('documents.link and VerificationService.documentLinkFor answer a held erased document as none', async () => {
    const world = await matter();
    const links = new VerificationService({ storage, cipher, settings });
    const { documents } = createVerificationAdminServices({
      database,
      storage,
      cipher,
      settings,
      standing: {} as never,
    });
    await inTx(async (tx) => {
      expect(await codeOf(documents.link(tx, ADMIN, world.studentDocument.id))).toEqual({
        code: 'NOT_FOUND',
      });
      expect(
        await codeOf(
          links.documentLinkFor(tx, world.studentDocument.id, { kind: 'admin', adminId: ADMIN }),
        ),
      ).toEqual({ code: 'NOT_FOUND' });
      expect(
        await codeOf(
          links.documentLinkFor(tx, world.studentDocument.id, {
            kind: 'user',
            userId: world.studentId,
          }),
        ),
      ).toEqual({ code: 'NOT_FOUND' });
    });
    // The same document is the held-files read's while the matter is open.
    expect(
      await inTx((tx) =>
        reads().heldFileLink(tx, ADMIN, {
          disputeId: world.caseId,
          fileRef: `document:${world.studentDocument.id}`,
        }),
      ),
    ).toMatchObject({ url: `https://storage.invalid/${world.studentDocument.key}` });
  });

  it('the teacher’s credentials.documentLink answers a held erased credential document as none', async () => {
    const { enrollmentId, teacherId } = await makeEnrollment(db);
    const { rows } = await db.query<{ subject_id: string }>(
      'SELECT snapshot_subject_id AS subject_id FROM enrollments WHERE id = $1',
      [enrollmentId],
    );
    const credentialId = await makeCredential(db, {
      teacherId,
      subjectId: rows[0]?.subject_id ?? '',
    });
    const { rows: documentRows } = await db.query<{ document_id: string }>(
      'SELECT document_id FROM teacher_credentials WHERE id = $1',
      [credentialId],
    );
    const documentId = documentRows[0]?.document_id ?? '';
    const key = `documents/${documentId}.pdf`;
    await db.query(
      `UPDATE verification_documents SET storage_key_encrypted = $2, erased_at = now() WHERE id = $1`,
      [documentId, Buffer.from(cipher.encrypt(key, COLUMN, documentId))],
    );
    heldDocuments.push(documentId);
    await db.query('UPDATE users SET deleted_at = now(), updated_at = now() WHERE id = $1', [
      teacherId,
    ]);
    const caseId = await openCase(enrollmentId);
    const { credentials } = createVerificationServices({
      database,
      storage,
      cipher,
      settings,
      idempotency: {} as never,
    });
    expect(await codeOf(credentials.documentLink(teacherId, { credentialId }))).toEqual({
      code: 'NOT_FOUND',
    });
    expect(
      await inTx((tx) =>
        reads().heldFileLink(tx, ADMIN, { disputeId: caseId, fileRef: `document:${documentId}` }),
      ),
    ).toMatchObject({ url: `https://storage.invalid/${key}` });
  });
});

describe('disputes.chat over the real tables (FR-475, R-314)', () => {
  it('answers the enrollment’s chat newest first, each sender by its role, inside the open matter only', async () => {
    const world = await matter();
    const first = await insertRow(db, 'chat_messages', {
      enrollment_id: world.enrollmentId,
      sender_user_id: world.studentId,
      body: 'السلام عليكم',
      sent_at: '2026-11-09T08:00:00Z',
    });
    const second = await insertRow(db, 'chat_messages', {
      enrollment_id: world.enrollmentId,
      sender_user_id: world.teacherId,
      body: 'وعليكم السلام',
      sent_at: '2026-11-09T08:01:00Z',
    });
    const read = () => inTx((tx) => reads().chat(tx, ADMIN, { disputeId: world.caseId }));
    expect(await read()).toEqual({
      enrollmentId: world.enrollmentId,
      page: {
        messages: [
          {
            messageId: second,
            senderRole: 'teacher',
            body: 'وعليكم السلام',
            sentAt: '2026-11-09T08:01:00.000Z',
            purged: false,
          },
          {
            messageId: first,
            senderRole: 'student',
            body: 'السلام عليكم',
            sentAt: '2026-11-09T08:00:00.000Z',
            purged: false,
          },
        ],
      },
    });
    await closeCase(world.caseId);
    expect(await codeOf(read())).toEqual({ code: 'CONFLICT', cause: 'not_open' });
  });
});
