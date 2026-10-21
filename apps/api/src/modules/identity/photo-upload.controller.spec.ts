// T024 — `POST /uploads/photos` (public-pages.md "The uploads route"; decision 46): behind the user
// bearer, a JPEG or PNG is stored through the storage port under a minted key, `users.photo_key`
// is written through the identity module's own repository (R-API-6), the previous photo is removed
// from storage, and the answer is a signed link. Over real HTTP with the in-memory storage stand-in
// and a recorded users writer.
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApplication } from '../../app.module.js';
import { RateLimiter } from '../../platform/guards/rate-limit.guard.js';
import { createLogger } from '../../platform/logging/logger.js';
import { SettingError, type SettingsReader } from '../../platform/settings/settings-reader.js';
import type { UserSession } from '../../surfaces/context.js';
import { multipart, pdfBytes, storageStub } from '../../surfaces/upload-fixtures.js';
import { PHOTOS_UPLOAD_PATH, photoUploadRoute } from './photo-upload.controller.js';
import {
  unusedIdentityServices,
  unusedVerificationServices,
} from '../../surfaces/services.fixtures.js';

const settings: SettingsReader = {
  read: async (key, schema) => {
    if (key === 'upload_max_bytes') return schema.parse(65_536);
    if (key === 'rate_limit_upload') return schema.parse({ limit: 100, window_seconds: 60 });
    if (key === 'document_link_ttl_seconds') return schema.parse(300);
    throw new SettingError(key, 'missing');
  },
};
const rateLimiter = new RateLimiter({
  settings,
  counter: { hit: async () => 1 },
  subjectKey: Buffer.alloc(32, 4),
});
function session(userId: string, accountStatus: UserSession['accountStatus']): UserSession {
  return {
    userId,
    sessionId: `s-${userId}`,
    role: 'student',
    gender: 'male',
    preferredLanguage: 'ar',
    accountStatus,
  };
}
const sessionsByBearer: Readonly<Record<string, UserSession>> = {
  't-a': session('0199d0a0-0000-7000-8000-00000000000a', 'active'),
  't-s': session('0199d0a0-0000-7000-8000-00000000000c', 'suspended'),
};
const sessions = {
  user: async (bearer: string) => sessionsByBearer[bearer] ?? null,
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
};
const log = createLogger({ level: 'info', destination: { write: () => undefined } });
const storage = storageStub();

const photoKeys = new Map<string, string>();
const users = {
  replacePhotoKey: async (userId: string, key: string) => {
    const previous = photoKeys.get(userId) ?? null;
    photoKeys.set(userId, key);
    return previous;
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
    routes: {
      [PHOTOS_UPLOAD_PATH]: photoUploadRoute({
        sessions: sessions.user,
        guard: { settings, rateLimiter },
        log,
        storage,
        settings,
        users,
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
  photoKeys.clear();
});

const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(256, 1)]);
const png = () =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(256, 2),
  ]);

function upload(bytes: Buffer, bearer = 't-a'): Promise<Response> {
  const payload = multipart([{ name: 'file', filename: 'me.jpg', type: 'image/jpeg', bytes }]);
  return fetch(`${origin}${PHOTOS_UPLOAD_PATH}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': payload.contentType },
    body: new Uint8Array(payload.body),
  });
}

describe('POST /uploads/photos (T024)', () => {
  it('stores the image, writes users.photo_key through identity, and answers a signed link', async () => {
    const response = await upload(jpeg());
    expect(response.status).toBe(201);
    const { photoUrl } = (await response.json()) as { photoUrl: string };
    const key = photoKeys.get('0199d0a0-0000-7000-8000-00000000000a');
    expect(key).toMatch(/^photos\/[0-9a-f-]+\/[0-9a-f-]+\.jpg$/);
    expect(storage.verifyLink(photoUrl)).toBe(key);
    expect(storage.stored(key ?? '')).toMatchObject({ contentType: 'image/jpeg' });
  });

  it('replaces the previous photo, removing it from storage, and names a PNG as one', async () => {
    await upload(jpeg());
    const first = photoKeys.get('0199d0a0-0000-7000-8000-00000000000a') ?? '';
    await upload(png());
    const second = photoKeys.get('0199d0a0-0000-7000-8000-00000000000a') ?? '';
    expect(second).toMatch(/\.png$/);
    expect(storage.stored(first)).toBeUndefined();
    expect(storage.stored(second)).toBeDefined();
  });

  it('admits JPEG and PNG only, decided by content', async () => {
    const response = await upload(pdfBytes());
    expect(response.status).toBe(400);
    expect(photoKeys.size).toBe(0);
  });

  it('refuses a suspended account, as the profile editor does (FR-137)', async () => {
    const response = await upload(jpeg(), 't-s');
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'ACCOUNT_RESTRICTED' } });
  });
});
