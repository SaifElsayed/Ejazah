// T056, T057 — the teacher's application and credentials over the real tables, as `main.ts`
// composes them: the verification module's services over the identity module's application entry
// (`teacher_profiles`), the catalog module's credential rows and subjects, its own documents, and
// the kernel's idempotency keys (R-121, R-API-6, FR-106). The service specs prove the rules over
// stores in memory; this proves the real stores keep them: each write conditional on the state it
// moves from, decided by the database, so two requests racing from one state cannot both move it,
// and a keyed retry answers the first outcome. Rows are committed (the services open their own
// transactions) and every probe's rows are its own, so a probe asserts its rows, not totals.
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { grantSubjects } from '../../apps/api/src/modules/catalog/index.js';
import { readApplication } from '../../apps/api/src/modules/identity/index.js';
import {
  createVerificationServices,
  type VerificationServices,
} from '../../apps/api/src/modules/verification/index.js';
import { ColumnCipher } from '../../apps/api/src/platform/crypto/encryption.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository.js';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import {
  connectAsApplication,
  type Db,
  insertRow,
  makeAdmin,
  makeSubject,
  makeUser,
} from './harness';

const cipher = new ColumnCipher(Buffer.alloc(32, 7).toString('base64'));
const SETTINGS: Readonly<Record<string, unknown>> = {
  idempotency_key_ttl_hours: 24,
  document_link_ttl_seconds: 300,
};
const settings: SettingsReader = {
  read: async (key, schema) => schema.parse(SETTINGS[key]),
};

let db: Db;
let database: Database;
let services: VerificationServices;

beforeAll(async () => {
  db = await connectAsApplication();
  database = openDatabase(process.env['DATABASE_URL'] ?? '', {
    poolMax: 4,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  services = createVerificationServices({
    database,
    storage: { temporaryLink: async (key) => `https://storage.invalid/${key}` },
    cipher,
    settings,
    idempotency: new IdempotencyService({ store: new IdempotencyRepository(database), settings }),
  });
});

afterAll(async () => {
  await closeDatabase(database);
  await db.end();
});

const refused = (code: string) => expect.objectContaining({ code });
const key = () => `probe-${randomUUID()}`;

/** A PDF `userId` uploaded, with its size recorded unless said otherwise. */
function upload(userId: string, sizeBytes: number | null = 4096): Promise<string> {
  return insertRow(db, 'verification_documents', {
    user_id: userId,
    document_type: 'credential',
    storage_key_encrypted: Buffer.from('probe'),
    size_bytes: sizeBytes,
  });
}

/** A teacher with two active subjects to choose and an application's documents uploaded. */
async function applicant() {
  const userId = await makeUser(db);
  const subjects = [await makeSubject(db), await makeSubject(db)];
  const application = {
    subjectIds: subjects,
    qualificationSummary: 'إجازة في حفظ القرآن',
    identityDocument: { type: 'national_id' as const, documentId: await upload(userId) },
    credentials: [
      { subjectId: subjects[0]!, documentId: await upload(userId) },
      { subjectId: subjects[1]!, documentId: await upload(userId) },
    ],
  };
  return { userId, subjects, application };
}

async function profileOf(userId: string) {
  const { rows } = await db.query(
    `SELECT verification_status, application_status, qualification_summary, identity_document_id,
            identity_document_type, application_note, verification_call_completed_on,
            verification_call_outcome
       FROM teacher_profiles WHERE user_id = $1`,
    [userId],
  );
  return rows;
}

async function credentialsOf(userId: string) {
  const { rows } = await db.query(
    `SELECT id, subject_id, document_id, status, submitted_with_application
       FROM teacher_credentials WHERE teacher_user_id = $1 ORDER BY created_at, id`,
    [userId],
  );
  return rows as {
    id: string;
    subject_id: string;
    document_id: string;
    status: string;
    submitted_with_application: boolean;
  }[];
}

/** An administrator's decision, written as B13's procedures will write it. */
async function decide(userId: string, status: string, note: string | null): Promise<void> {
  await db.query(
    `UPDATE teacher_profiles
        SET application_status = $2, application_note = $3, application_decided_at = now()
      WHERE user_id = $1`,
    [userId, status, note],
  );
}

describe('the application over the tables (T056)', () => {
  it('writes the profile in_review and one pending credential per subject; a keyed retry answers the first outcome', async () => {
    const { userId, application } = await applicant();
    const idempotencyKey = key();
    await services.application.submit(userId, { ...application, idempotencyKey });
    await services.application.submit(userId, { ...application, idempotencyKey });

    expect(await profileOf(userId)).toEqual([
      {
        verification_status: 'pending',
        application_status: 'in_review',
        qualification_summary: application.qualificationSummary,
        identity_document_id: application.identityDocument.documentId,
        identity_document_type: 'national_id',
        application_note: null,
        verification_call_completed_on: null,
        verification_call_outcome: null,
      },
    ]);
    expect(
      (await credentialsOf(userId)).map(
        ({ subject_id, document_id, status, submitted_with_application }) => ({
          subject_id,
          document_id,
          status,
          submitted_with_application,
        }),
      ),
    ).toEqual(
      application.credentials.map(({ subjectId, documentId }) => ({
        subject_id: subjectId,
        document_id: documentId,
        status: 'pending',
        submitted_with_application: true,
      })),
    );
    await expect(services.application.get(userId)).resolves.toMatchObject({
      status: 'in_review',
      subjectCount: 2,
    });
  });

  it('lets one of two applications racing from none through, the other CONFLICT, leaving one set of rows', async () => {
    const { userId, application } = await applicant();
    const outcomes = await Promise.allSettled([
      services.application.submit(userId, { ...application, idempotencyKey: key() }),
      services.application.submit(userId, { ...application, idempotencyKey: key() }),
    ]);
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find(({ status }) => status === 'rejected')).toMatchObject({
      reason: refused('CONFLICT'),
    });
    expect(await profileOf(userId)).toHaveLength(1);
    expect(await credentialsOf(userId)).toHaveLength(2);
  });

  it('refuses another person’s document with DOCUMENT_NOT_OWNED, writing nothing', async () => {
    const { userId, application } = await applicant();
    const foreign = await upload(await makeUser(db));
    await expect(
      services.application.submit(userId, {
        ...application,
        identityDocument: { type: 'passport', documentId: foreign },
        idempotencyKey: key(),
      }),
    ).rejects.toEqual(refused('DOCUMENT_NOT_OWNED'));
    expect(await profileOf(userId)).toEqual([]);
    await expect(readApplication(database, userId)).resolves.toBeNull();
  });

  it('returns the application from needs_document to in_review with the PDF asked for replaced', async () => {
    const { userId, application } = await applicant();
    await services.application.submit(userId, { ...application, idempotencyKey: key() });
    const [asked] = await credentialsOf(userId);
    await db.query(
      `UPDATE teacher_credentials SET status = 'needs_document', review_reason = 'غير واضح',
              reviewed_by_admin_id = $2, reviewed_at = now() WHERE id = $1`,
      [asked!.id, await makeAdmin(db)],
    );
    await decide(userId, 'needs_document', 'نحتاج نسخة أوضح');

    const documentId = await upload(userId);
    await services.application.resubmit(userId, {
      credentials: [{ credentialId: asked!.id, documentId }],
    });
    expect((await profileOf(userId))[0]).toMatchObject({ application_status: 'in_review' });
    expect((await credentialsOf(userId))[0]).toMatchObject({
      document_id: documentId,
      status: 'pending',
    });
  });

  it('reapplies from rejected: the earlier credentials kept, the call record and the approved screen cleared, the status pending', async () => {
    const { userId, application } = await applicant();
    await services.application.submit(userId, { ...application, idempotencyKey: key() });
    await db.query(
      `UPDATE teacher_credentials SET status = 'rejected', review_reason = 'لا تطابق',
                    reviewed_by_admin_id = $2, reviewed_at = now() WHERE teacher_user_id = $1`,
      [userId, await makeAdmin(db)],
    );
    // A revoked approval, its once-only screen already shown, then rejected (admin-surface
    // `teachers.revokeApproval` sets `rejected`, B13).
    await db.query(
      `UPDATE teacher_profiles SET verification_status = 'revoked', verification_call_completed_on = current_date,
              verification_call_outcome = 'suitable', approved_shown_at = now()
        WHERE user_id = $1`,
      [userId],
    );
    await decide(userId, 'rejected', 'الوثائق لا تطابق الاسم');

    const again = {
      ...application,
      identityDocument: { type: 'passport' as const, documentId: await upload(userId) },
      credentials: [
        { subjectId: application.subjectIds[0]!, documentId: await upload(userId) },
        { subjectId: application.subjectIds[1]!, documentId: await upload(userId) },
      ],
    };
    await services.application.reapply(userId, again);
    await expect(services.application.reapply(userId, again)).rejects.toEqual(refused('CONFLICT'));

    expect((await profileOf(userId))[0]).toMatchObject({
      verification_status: 'pending',
      application_status: 'in_review',
      application_note: null,
      verification_call_completed_on: null,
      verification_call_outcome: null,
      identity_document_type: 'passport',
    });
    const { rows: shown } = await db.query(
      'SELECT approved_shown_at FROM teacher_profiles WHERE user_id = $1',
      [userId],
    );
    expect(shown).toEqual([{ approved_shown_at: null }]);
    expect((await credentialsOf(userId)).map(({ status }) => status)).toEqual([
      'rejected',
      'rejected',
      'pending',
      'pending',
    ]);
    await expect(services.application.get(userId)).resolves.toMatchObject({ subjectCount: 2 });
  });

  it('marks the approved screen shown once, while approved', async () => {
    const { userId, application } = await applicant();
    await services.application.submit(userId, { ...application, idempotencyKey: key() });
    await decide(userId, 'approved', null);
    await services.application.markApprovedShown(userId);
    await services.application.markApprovedShown(userId);
    await expect(services.application.get(userId)).resolves.toMatchObject({
      status: 'approved',
      approvedShown: true,
    });
  });
});

describe('the credentials over the tables (T057)', () => {
  it('lists each credential with its subject, size, and the chain on an approved one only', async () => {
    const { userId, application } = await applicant();
    await services.application.submit(userId, { ...application, idempotencyKey: key() });
    const [approved, pending] = await credentialsOf(userId);
    const admin = await makeAdmin(db);
    await db.query(
      `UPDATE teacher_credentials SET status = 'approved', reviewed_by_admin_id = $2, reviewed_at = now(),
              holder_name = 'سارة عادل', riwaya = 'حفص عن عاصم' WHERE id = $1`,
      [approved!.id, admin],
    );
    for (const [position, names] of [
      [2, ['عثمان بن عفان']],
      [1, ['النبي ﷺ']],
    ] as const) {
      await insertRow(db, 'isnad_entries', {
        credential_id: approved!.id,
        position,
        names,
        created_by_admin_id: admin,
      });
    }

    const list = await services.credentials.list(userId);
    expect(
      list.map(({ credentialId, status, chain, holderName, document }) => ({
        credentialId,
        status,
        chain,
        holderName,
        document,
      })),
    ).toEqual([
      {
        credentialId: approved!.id,
        status: 'approved',
        chain: [
          { position: 1, names: ['النبي ﷺ'] },
          { position: 2, names: ['عثمان بن عفان'] },
        ],
        holderName: 'سارة عادل',
        document: { sizeBytes: 4096 },
      },
      {
        credentialId: pending!.id,
        status: 'pending',
        chain: undefined,
        holderName: undefined,
        document: { sizeBytes: 4096 },
      },
    ]);
  });

  it('adds a subject, refuses a second while one waits, and takes a new PDF only while one is asked for', async () => {
    const userId = await makeUser(db);
    const subjectId = await makeSubject(db);
    const { credentialId } = await services.credentials.add(userId, {
      subjectId,
      documentId: await upload(userId, null),
    });
    await expect(
      services.credentials.add(userId, { subjectId, documentId: await upload(userId) }),
    ).rejects.toEqual(refused('CONFLICT'));
    await expect(
      services.credentials.replaceDocument(userId, {
        credentialId,
        documentId: await upload(userId),
      }),
    ).rejects.toEqual(refused('CONFLICT'));

    await db.query(
      `UPDATE teacher_credentials SET status = 'needs_document', review_reason = 'ملف آخر',
              reviewed_by_admin_id = $2, reviewed_at = now() WHERE id = $1`,
      [credentialId, await makeAdmin(db)],
    );
    const documentId = await upload(userId);
    await services.credentials.replaceDocument(userId, { credentialId, documentId });
    expect(await credentialsOf(userId)).toEqual([
      expect.objectContaining({ id: credentialId, document_id: documentId, status: 'pending' }),
    ]);
  });

  it('grants the subjects of an approval, a subject already the teacher’s kept as it is', async () => {
    const userId = await makeUser(db);
    const subjects = [await makeSubject(db), await makeSubject(db)];
    await database.$transaction((tx) => grantSubjects(tx, userId, subjects.slice(0, 1)));
    await database.$transaction((tx) => grantSubjects(tx, userId, subjects));
    const { rows } = await db.query(
      'SELECT subject_id FROM teacher_subjects WHERE teacher_user_id = $1 ORDER BY subject_id',
      [userId],
    );
    expect(rows.map(({ subject_id }) => subject_id)).toEqual([...subjects].sort());
  });
});
