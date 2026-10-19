// T024 — the upload route helper over real HTTP (FR-151, R-SEC-4; public-pages.md "The uploads
// route"; kernel.md "Guards applied by default"): a POST of one multipart file behind the user
// bearer, the standing the route admits, T020's kinds guard (the per-user limit, `upload_max_bytes`,
// the type decided by content) and the kernel's one error shape. The two routes of this phase are
// written over it (`modules/verification/uploads.controller.ts`, `modules/identity/
// photo-upload.controller.ts`); what is proved here is the helper, with a handler that echoes.
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApplication } from '../app.module.js';
import { DomainError } from '../platform/errors/domain-error.js';
import { type RateLimitCounter, RateLimiter } from '../platform/guards/rate-limit.guard.js';
import { UPLOAD_RATE_LIMIT } from '../platform/guards/upload.middleware.js';
import { createLogger } from '../platform/logging/logger.js';
import { SettingError, type SettingsReader } from '../platform/settings/settings-reader.js';
import type { UserSession } from './context.js';
import { multipart, pdfBytes } from './upload-fixtures.js';
import { kindField, uploadRoute } from './upload-route.js';

const LIMIT_BYTES = 4096;

const settings: SettingsReader = {
  read: async (key, schema) => {
    if (key === 'upload_max_bytes') return schema.parse(LIMIT_BYTES);
    if (key === UPLOAD_RATE_LIMIT) return schema.parse({ limit: 3, window_seconds: 60 });
    throw new SettingError(key, 'missing');
  },
};
const counts = new Map<string, number>();
const counter: RateLimitCounter = {
  hit: async (key) => {
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    return count;
  },
};
const rateLimiter = new RateLimiter({ settings, counter, subjectKey: Buffer.alloc(32, 2) });

function session(userId: string, accountStatus: UserSession['accountStatus']): UserSession {
  return {
    userId,
    sessionId: `session-${userId}`,
    role: 'student',
    gender: 'male',
    preferredLanguage: 'ar',
    accountStatus,
  };
}
const sessionsByBearer: Readonly<Record<string, UserSession>> = {
  't-active': session('u-active', 'active'),
  't-suspended': session('u-suspended', 'suspended'),
  't-banned': session('u-banned', 'banned'),
  't-fresh': session('u-fresh', 'active'),
  't-conflict': session('u-conflict', 'active'),
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
};
const records: string[] = [];
const log = createLogger({ level: 'info', destination: { write: (line) => records.push(line) } });

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
      '/uploads/probe': uploadRoute(
        { sessions: sessions.user, guard: { settings, rateLimiter }, log },
        {
          kindOf: kindField(['identity', 'credential']),
          refuses: ['banned'],
          handle: async ({ uploader, kind, type, bytes, filename }) => ({
            userId: uploader.userId,
            kind,
            type,
            size: bytes.byteLength,
            filename,
          }),
        },
      ),
      '/uploads/strict': uploadRoute(
        { sessions: sessions.user, guard: { settings, rateLimiter }, log },
        {
          kindOf: () => 'photo',
          refuses: ['suspended', 'banned'],
          handle: async () => {
            throw new DomainError('CONFLICT');
          },
        },
      ),
    },
  });
  await application.listen(0, '127.0.0.1');
  origin = (await application.getUrl()).replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await application.close();
});

function post(
  path: string,
  bearer: string | undefined,
  payload: { body: Buffer; contentType: string } | undefined,
): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method: 'POST',
    headers: {
      ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }),
      ...(payload === undefined ? {} : { 'content-type': payload.contentType }),
    },
    ...(payload === undefined ? {} : { body: new Uint8Array(payload.body) }),
  });
}

const identityPdf = () =>
  multipart([
    { name: 'kind', value: 'identity' },
    { name: 'file', filename: 'id.pdf', type: 'application/pdf', bytes: pdfBytes() },
  ]);

describe('the upload route helper (T024, FR-151)', () => {
  it('accepts one multipart file behind the bearer and hands the handler the sniffed type and the bytes', async () => {
    const response = await post('/uploads/probe', 't-active', identityPdf());
    expect(response.status).toBe(201);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      userId: 'u-active',
      kind: 'identity',
      type: 'application/pdf',
      size: 512,
      filename: 'id.pdf',
    });
  });

  it('refuses an anonymous request and an unknown bearer with 401, in the one error shape', async () => {
    for (const bearer of [undefined, 't-nobody']) {
      const response = await post('/uploads/probe', bearer, identityPdf());
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'UNAUTHENTICATED' },
      });
    }
  });

  it('refuses the standings the route names with ACCOUNT_RESTRICTED, and admits the rest', async () => {
    const banned = await post('/uploads/probe', 't-banned', identityPdf());
    expect(banned.status).toBe(403);
    await expect(banned.json()).resolves.toMatchObject({
      error: {
        code: 'ACCOUNT_RESTRICTED',
        details: [{ path: 'accountStatus', code: 'banned' }],
      },
    });
    expect((await post('/uploads/probe', 't-suspended', identityPdf())).status).toBe(201);
    const strict = await post('/uploads/strict', 't-suspended', identityPdf());
    expect(strict.status).toBe(403);
  });

  it('answers a method other than POST with 405 and Allow', async () => {
    const response = await fetch(`${origin}/uploads/probe`, {
      headers: { authorization: 'Bearer t-active' },
    });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });

  it('refuses a body that is not multipart, one with no file, and an unknown kind as a validation failure', async () => {
    const plain = await fetch(`${origin}/uploads/probe`, {
      method: 'POST',
      headers: { authorization: 'Bearer t-active', 'content-type': 'application/pdf' },
      body: new Uint8Array(pdfBytes()),
    });
    expect(plain.status).toBe(400);
    await expect(plain.json()).resolves.toMatchObject({ error: { code: 'VALIDATION_FAILED' } });

    const noFile = await post(
      '/uploads/probe',
      't-active',
      multipart([{ name: 'kind', value: 'identity' }]),
    );
    expect(noFile.status).toBe(400);

    const wrongKind = await post(
      '/uploads/probe',
      't-active',
      multipart([
        { name: 'kind', value: 'photo' },
        { name: 'file', filename: 'id.pdf', type: 'application/pdf', bytes: pdfBytes() },
      ]),
    );
    expect(wrongKind.status).toBe(400);
    await expect(wrongKind.json()).resolves.toMatchObject({
      error: { code: 'VALIDATION_FAILED', details: [{ path: 'kind' }] },
    });
  });

  it('decides the type by content, never by the declared one (R-SEC-4)', async () => {
    const response = await post(
      '/uploads/probe',
      't-active',
      multipart([
        { name: 'kind', value: 'identity' },
        {
          name: 'file',
          filename: 'id.pdf',
          type: 'application/pdf',
          bytes: Buffer.alloc(512, 0x41),
        },
      ]),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('refuses a file over upload_max_bytes with 413 as it streams', async () => {
    const response = await post(
      '/uploads/probe',
      't-active',
      multipart([
        { name: 'kind', value: 'identity' },
        {
          name: 'file',
          filename: 'id.pdf',
          type: 'application/pdf',
          bytes: pdfBytes(LIMIT_BYTES + 1),
        },
      ]),
    );
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });
  });

  it('counts the uploader under rate_limit_upload and refuses past the limit with 429', async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      statuses.push((await post('/uploads/probe', 't-fresh', identityPdf())).status);
    }
    expect(statuses).toEqual([201, 201, 201, 429]);
  });

  it('answers a handler failure in the one error shape, with nothing of an unexpected cause', async () => {
    // The strict route takes a photo; the handler then refuses.
    const jpeg = multipart([
      {
        name: 'file',
        filename: 'me.jpg',
        type: 'image/jpeg',
        bytes: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(256, 1)]),
      },
    ]);
    const expected = await post('/uploads/strict', 't-conflict', jpeg);
    expect(expected.status).toBe(409);
    await expect(expected.json()).resolves.toMatchObject({ error: { code: 'CONFLICT' } });
  });
});
