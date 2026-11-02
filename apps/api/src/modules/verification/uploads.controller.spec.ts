// T024 — `POST /uploads/documents` (FR-151, R-SEC-3, R-SEC-4, R-DB-8; public-pages.md "The uploads
// route"): behind the user bearer of any standing but banned, a PDF of kind `identity` or
// `credential` is stored through the storage port under a server-minted key, the
// `verification_documents` row written with the key encrypted and the caller as `user_id`, and the
// answer is the id only. Over real HTTP, with the in-memory storage stand-in, the real column
// cipher and a recorded documents writer: what is proved is the ownership, the kinds and that the
// key reaches the row encrypted, not Postgres.
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApplication } from '../../app.module.js';
import { ColumnCipher } from '../../platform/crypto/encryption.js';
import { RateLimiter } from '../../platform/guards/rate-limit.guard.js';
import { createLogger } from '../../platform/logging/logger.js';
import { SettingError, type SettingsReader } from '../../platform/settings/settings-reader.js';
import type { UserSession } from '../../surfaces/context.js';
import { multipart, pdfBytes, storageStub } from '../../surfaces/upload-fixtures.js';
import {
  DOCUMENTS_UPLOAD_PATH,
  documentsUploadRoute,
  type NewDocument,
} from './uploads.controller.js';
import { DOCUMENT_STORAGE_KEY_COLUMN } from './verification.repository.js';
import {
  unusedAdminServices,
  unusedBookingServices,
  unusedCatalogServices,
  unusedDiscoveryServices,
  unusedIdentityServices,
  unusedTeacherProfileServices,
  unusedVerificationServices,
} from '../../surfaces/services.fixtures.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_UNREFERENCED = 3;

const settings: SettingsReader = {
  read: async (key, schema) => {
    if (key === 'upload_max_bytes') return schema.parse(65_536);
    if (key === 'rate_limit_upload') return schema.parse({ limit: 100, window_seconds: 60 });
    if (key === 'document_unreferenced_max_per_user') return schema.parse(MAX_UNREFERENCED);
    throw new SettingError(key, 'missing');
  },
};
const rateLimiter = new RateLimiter({
  settings,
  counter: { hit: async () => 1 },
  subjectKey: Buffer.alloc(32, 3),
});
const session: UserSession = {
  userId: '0199d0a0-0000-7000-8000-00000000000a',
  sessionId: 'session-a',
  role: 'teacher',
  gender: 'female',
  preferredLanguage: 'ar',
  accountStatus: 'verification_required',
};
const sessions = {
  user: async (bearer: string) => (bearer === 't-a' ? session : null),
  admin: async () => null,
};
const administration = {
  transactions: { run: () => Promise.reject(new Error('no administrative call is expected here')) },
  auditWriter: {
    write: () => Promise.reject(new Error('no administrative call is expected here')),
  },
};
const services = {
  settings,
  publicConfig: { supportEmail: 'support@ijazah.invalid' },
  subjects: { listActive: async () => [] },
  identity: unusedIdentityServices,
  verification: unusedVerificationServices,
  catalog: unusedCatalogServices,
  teacherProfile: unusedTeacherProfileServices,
  discovery: unusedDiscoveryServices,
  booking: unusedBookingServices,
};
const log = createLogger({ level: 'info', destination: { write: () => undefined } });
const cipher = new ColumnCipher(Buffer.alloc(32, 9).toString('base64'));
const storage = storageStub();

const written: NewDocument[] = [];
let failInsert = false;
/** How many documents nothing points at the uploader holds, as the verification store counts them. */
let held = 0;
const counted: string[] = [];
const documents = {
  createDocument: async (row: NewDocument) => {
    if (failInsert) throw new Error('the insert failed');
    written.push(row);
  },
  countUnreferencedOf: async (userId: string) => {
    counted.push(userId);
    return held;
  },
};

let application: INestApplication;
let origin: string;

beforeAll(async () => {
  application = await createApplication({
    log,
    readiness: { databaseReachable: async () => {} },
    securityHeaders: { allowedOrigins: [], mode: 'test' },
    maxRequestBodyBytes: 1024,
    administration,
    rateLimiter,
    sessions,
    services,
    adminServices: unusedAdminServices,
    routes: {
      [DOCUMENTS_UPLOAD_PATH]: documentsUploadRoute({
        sessions: sessions.user,
        guard: { settings, rateLimiter },
        log,
        storage,
        cipher,
        documents,
        settings,
      }),
    },
  });
  await application.listen(0, '127.0.0.1');
  origin = (await application.getUrl()).replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await application.close();
});

beforeEach(() => {
  written.length = 0;
  failInsert = false;
  held = 0;
  counted.length = 0;
});

function upload(kind: string, bytes: Buffer, bearer = 't-a'): Promise<Response> {
  const payload = multipart([
    { name: 'kind', value: kind },
    { name: 'file', filename: 'document.pdf', type: 'application/pdf', bytes },
  ]);
  return fetch(`${origin}${DOCUMENTS_UPLOAD_PATH}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': payload.contentType },
    body: new Uint8Array(payload.body),
  });
}

describe('POST /uploads/documents (T024, FR-151)', () => {
  it('stores the PDF under a minted key, writes the row with the key encrypted and the caller as owner, and answers the id', async () => {
    const response = await upload('identity', pdfBytes());
    expect(response.status).toBe(201);
    const answer = (await response.json()) as { documentId: string };
    const { documentId } = answer;
    expect(documentId).toMatch(UUID);

    expect(written).toHaveLength(1);
    const [row] = written;
    expect(row).toMatchObject({ id: documentId, userId: session.userId, documentType: 'other' });
    // The key is in the row encrypted, bound to its column and row (R-DB-8); the object is under it.
    const key = cipher.decrypt(
      row?.storageKeyEncrypted ?? new Uint8Array(),
      DOCUMENT_STORAGE_KEY_COLUMN,
      documentId,
    );
    expect(key).toContain(documentId);
    expect(storage.stored(key)).toMatchObject({ contentType: 'application/pdf' });
    expect(
      Buffer.from(storage.stored(key)?.body ?? [])
        .subarray(0, 5)
        .toString('latin1'),
    ).toBe('%PDF-');
    // Nothing in the answer but the id: no key, no link.
    expect(Object.keys(answer)).toEqual(['documentId']);
  });

  it('records a credential as such', async () => {
    await upload('credential', pdfBytes());
    expect(written[0]).toMatchObject({ documentType: 'credential' });
  });

  it('records the size the route accepted, and nothing of the file’s name (T057)', async () => {
    await upload('credential', pdfBytes(3000));
    expect(written[0]).toMatchObject({ sizeBytes: 3000 });
    expect(Object.keys(written[0] ?? {}).sort()).toEqual([
      'documentType',
      'id',
      'sizeBytes',
      'storageKeyEncrypted',
      'userId',
    ]);
  });

  it('admits PDF only, decided by content, and only the two document kinds', async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(256),
    ]);
    const image = await upload('identity', png);
    expect(image.status).toBe(400);
    const photoKind = await upload('photo', pdfBytes());
    expect(photoKind.status).toBe(400);
    expect(written).toHaveLength(0);
  });

  it('refuses an anonymous request', async () => {
    expect((await upload('identity', pdfBytes(), 't-nobody')).status).toBe(401);
  });

  it('removes the stored object again when the row cannot be written, and answers the internal error', async () => {
    failInsert = true;
    const before = storage.calls.length;
    const response = await upload('identity', pdfBytes());
    expect(response.status).toBe(500);
    const after = storage.calls.slice(before).map(({ operation }) => operation);
    expect(after).toEqual(['put', 'remove']);
    const [put, remove] = storage.calls.slice(before);
    expect(remove?.args[0]).toBe(put?.args[0]);
  });
});

describe('the per-user cap on unreferenced documents (T093)', () => {
  it('refuses a further upload with CONFLICT while the person holds the cap, storing nothing', async () => {
    held = MAX_UNREFERENCED;
    const before = storage.calls.length;
    const response = await upload('credential', pdfBytes());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: 'CONFLICT', details: [{ path: 'documents', code: 'too_many' }] },
    });
    expect(counted).toEqual([session.userId]);
    expect(storage.calls.slice(before)).toEqual([]);
    expect(written).toEqual([]);
  });

  it('admits an upload below the cap', async () => {
    held = MAX_UNREFERENCED - 1;
    const response = await upload('credential', pdfBytes());
    expect(response.status).toBe(201);
    expect(written).toHaveLength(1);
  });
});
