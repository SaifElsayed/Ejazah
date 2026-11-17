// T024 — the upload route helper over real HTTP (FR-151, R-SEC-4; public-pages.md "The uploads
// route"; kernel.md "Guards applied by default"): a POST of one multipart file behind the user
// bearer, the standing the route admits, T020's kinds guard (the per-user limit, `upload_max_bytes`,
// the type decided by content) and the kernel's one error shape. The two routes of this phase are
// written over it (`modules/verification/uploads.controller.ts`, `modules/identity/
// photo-upload.controller.ts`); what is proved here is the helper, with a handler that echoes.
import type { INestApplication } from '@nestjs/common';
import { connect } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApplication } from '../app.module.js';
import { DomainError } from '../platform/errors/domain-error.js';
import { type RateLimitCounter, RateLimiter } from '../platform/guards/rate-limit.guard.js';
import { UPLOAD_RATE_LIMIT } from '../platform/guards/upload.middleware.js';
import { InProcessLiveBus } from '../platform/live/live-bus.js';
import { createLogger } from '../platform/logging/logger.js';
import { SettingError, type SettingsReader } from '../platform/settings/settings-reader.js';
import type { UserSession } from './context.js';
import { multipart, pdfBytes } from './upload-fixtures.js';
import { kindField, uploadRoute } from './upload-route.js';
import {
  unusedAdminServices,
  unusedBookingServices,
  unusedCatalogServices,
  unusedChatServices,
  unusedCheckoutServices,
  unusedDiscoveryServices,
  unusedIdentityServices,
  unusedSessionsServices,
  unusedTeacherProfileServices,
  unusedVerificationServices,
} from './services.fixtures.js';

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
  't-live': session('u-live', 'active'),
  // T038 of specs/004-sessions: the fields and the refusal hook.
  't-fields': session('u-fields', 'active'),
  't-hooked': session('u-hooked', 'active'),
  't-hook-throws': session('u-hook-throws', 'active'),
  // T003 of specs/005-certification: a teacher's route admitting an approved teacher.
  't-t-student': session('u-t-student', 'active'),
  't-t-applicant': teacherSession('u-t-applicant', 'pending', 'active'),
  't-t-approved': teacherSession('u-t-approved', 'approved', 'active'),
  't-t-publishable': {
    ...teacherSession('u-t-publishable', 'approved', 'active'),
    teacher: {
      verificationStatus: 'approved',
      payoutVerified: true,
      applicationStatus: 'approved',
    },
  },
  't-t-suspended': teacherSession('u-t-suspended', 'approved', 'suspended'),
};

/** A teacher's session at a verification status, its payout account not verified. */
function teacherSession(
  userId: string,
  verificationStatus: 'pending' | 'approved',
  accountStatus: UserSession['accountStatus'],
): UserSession {
  return {
    ...session(userId, accountStatus),
    role: 'teacher',
    teacher: {
      verificationStatus,
      payoutVerified: false,
      applicationStatus: verificationStatus === 'approved' ? 'approved' : 'in_review',
    },
  };
}
const sessions = {
  user: async (bearer: string) => {
    // A slow resolver: the window between the headers and the body's first read (round 2, B).
    if (bearer === 't-slow') {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return session('u-slow', 'active');
    }
    return sessionsByBearer[bearer] ?? null;
  },
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
  checkout: unusedCheckoutServices,
  sessions: unusedSessionsServices,
  chat: unusedChatServices,
};
const records: string[] = [];
const log = createLogger({ level: 'info', destination: { write: (line) => records.push(line) } });

let application: INestApplication;
let origin: string;

// T063 of specs/004-sessions: the route's own after-commit point, over the process's bus.
const bus = new InProcessLiveBus();
const published: unknown[] = [];
bus.subscribe((message) => void published.push(message));
const uploaded = { type: 'enrollment', enrollmentId: '0199d0a0-0000-7000-8000-00000000e0a1' } as const;

// T038 of specs/004-sessions: what the refusal hook was handed, in order.
const hooked: { code: unknown; userId: string; fields: Record<string, string> }[] = [];

// T003 of specs/005-certification: the uploaders the teacher's route handled, in order.
const teacherHandled: string[] = [];

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
      '/uploads/probe': uploadRoute(
        { sessions: sessions.user, guard: { settings, rateLimiter }, log, live: bus },
        {
          kindOf: kindField(['identity', 'credential']),
          refuses: ['banned'],
          handle: async ({ uploader, kind, type, bytes, filename, live }) => {
            live.afterCommit([uploader.userId], uploaded);
            return { userId: uploader.userId, kind, type, size: bytes.byteLength, filename };
          },
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
      // T038 of specs/004-sessions: a handler that echoes the fields, and refuses on `refuse`, with
      // a hook that records each refusal.
      '/uploads/fields': uploadRoute(
        { sessions: sessions.user, guard: { settings, rateLimiter }, log },
        {
          kindOf: kindField(['identity']),
          refuses: ['banned'],
          handle: async ({ fields }) => {
            if (fields.has('refuse')) throw new DomainError('CONFLICT');
            return { fields: Object.fromEntries(fields) };
          },
          refused: (error, { uploader, fields }) => {
            hooked.push({
              code: error instanceof DomainError ? error.code : 'unexpected',
              userId: uploader.userId,
              fields: Object.fromEntries(fields),
            });
          },
        },
      ),
      // T038: a hook that throws: the answer is the refusal still.
      '/uploads/hook-throws': uploadRoute(
        { sessions: sessions.user, guard: { settings, rateLimiter }, log },
        {
          kindOf: kindField(['identity']),
          refuses: ['banned'],
          handle: async () => {
            throw new DomainError('CONFLICT');
          },
          refused: () => {
            throw new Error('the hook failed');
          },
        },
      ),
      // T063: a handler that adds an event and then fails, as a refused transaction would.
      '/uploads/refusing': uploadRoute(
        { sessions: sessions.user, guard: { settings, rateLimiter }, log, live: bus },
        {
          kindOf: kindField(['identity']),
          refuses: ['banned'],
          handle: async ({ uploader, live }) => {
            live.afterCommit([uploader.userId], uploaded);
            throw new DomainError('CONFLICT');
          },
        },
      ),
      // T003 of specs/005-certification: a teacher's route, as `POST /uploads/signature` declares.
      '/uploads/teacher-probe': uploadRoute(
        { sessions: sessions.user, guard: { settings, rateLimiter }, log },
        {
          kindOf: kindField(['identity']),
          admits: 'approved',
          refuses: ['suspended', 'banned'],
          handle: async ({ uploader }) => {
            teacherHandled.push(uploader.userId);
            return { userId: uploader.userId };
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

/** One raw request on a fresh socket: the head, then `body`, then the socket destroyed or the answer read. */
function rawRequest(head: string, body: Buffer, mode: 'abort' | 'answer'): Promise<string> {
  const { hostname, port } = new URL(origin);
  return new Promise((resolve, reject) => {
    const socket = connect({ host: hostname, port: Number(port) }, () => {
      socket.write(head);
      socket.write(body);
      if (mode === 'abort') {
        // The client goes away mid-body.
        setTimeout(() => {
          socket.destroy();
          resolve('');
        }, 50);
      }
    });
    let answer = '';
    socket.on('data', (chunk: Buffer) => {
      answer += chunk.toString('latin1');
    });
    socket.on('close', () => resolve(answer));
    socket.on('error', (error: NodeJS.ErrnoException) =>
      mode === 'abort' || error.code === 'ECONNRESET' ? resolve(answer) : reject(error),
    );
  });
}

/** Waits until a logged line contains `text`, or fails after a bounded time. */
async function loggedSoon(text: string): Promise<void> {
  for (let tick = 0; tick < 40; tick += 1) {
    if (records.some((line) => line.includes(text))) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`nothing logged containing "${text}"`);
}

describe('the upload route’s after-commit point (T063)', () => {
  it('sends what the handler added once it resolved, and nothing when it threw', async () => {
    published.length = 0;
    expect((await post('/uploads/probe', 't-live', identityPdf())).status).toBe(201);
    expect(published).toEqual([{ to: ['u-live'], event: uploaded }]);

    published.length = 0;
    const refused = await post('/uploads/refusing', 't-live', identityPdf());
    expect(refused.status).toBe(409);
    await refused.arrayBuffer();
    expect(published).toEqual([]);
  });
});

// T038 of specs/004-sessions: the fields reach the handler, and a route may hear its refusals (the
// chat route logs `{ userId, enrollmentId, cause }`); the hook never changes the answer.
describe('the upload route’s fields and refusal hook (T038 of specs/004-sessions)', () => {
  const withFields = (extra: readonly { name: string; value: string }[], bytes = pdfBytes()) =>
    multipart([
      { name: 'kind', value: 'identity' },
      ...extra,
      { name: 'file', filename: 'id.pdf', type: 'application/pdf', bytes },
    ]);

  it('hands the handler the fields that preceded the file', async () => {
    hooked.length = 0;
    const response = await post(
      '/uploads/fields',
      't-fields',
      withFields([{ name: 'note', value: 'تجويد' }]),
    );
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      fields: { kind: 'identity', note: 'تجويد' },
    });
    expect(hooked).toEqual([]);
  });

  it("hands the hook a refusal by the guard and by the handler, with the uploader and the fields, the answer the refusal's", async () => {
    hooked.length = 0;
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const byGuard = await post(
      '/uploads/fields',
      't-hooked',
      withFields([{ name: 'note', value: 'a' }], png),
    );
    expect(byGuard.status).toBe(400);
    await expect(byGuard.json()).resolves.toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    const byHandler = await post(
      '/uploads/fields',
      't-hooked',
      withFields([{ name: 'refuse', value: '1' }]),
    );
    expect(byHandler.status).toBe(409);
    await expect(byHandler.json()).resolves.toMatchObject({ error: { code: 'CONFLICT' } });
    expect(hooked).toEqual([
      { code: 'VALIDATION_FAILED', userId: 'u-hooked', fields: { kind: 'identity', note: 'a' } },
      { code: 'CONFLICT', userId: 'u-hooked', fields: { kind: 'identity', refuse: '1' } },
    ]);
  });

  it('does not call the hook before the caller is known', async () => {
    hooked.length = 0;
    const response = await post('/uploads/fields', undefined, withFields([]));
    expect(response.status).toBe(401);
    await response.arrayBuffer();
    expect(hooked).toEqual([]);
  });

  it('answers the refusal still when the hook throws, never a 500', async () => {
    const response = await post('/uploads/hook-throws', 't-hook-throws', withFields([]));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'CONFLICT' } });
  });
});

// T003 of specs/005-certification (R-411, R-106): a route may declare the teacher standing it admits,
// as the teacher kind's `admits` does, in the kind's order: the role (403), the restricted standings
// (`ACCOUNT_RESTRICTED`), then the standing below the declared one (403), each before the body is
// read, so the handler is never reached.
describe('a teacher’s upload route (T003 of specs/005-certification)', () => {
  it('refuses a student FORBIDDEN, the handler never reached', async () => {
    const response = await post('/uploads/teacher-probe', 't-t-student', identityPdf());
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(teacherHandled).not.toContain('u-t-student');
  });

  it('refuses an applicant FORBIDDEN, the handler never reached', async () => {
    const response = await post('/uploads/teacher-probe', 't-t-applicant', identityPdf());
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(teacherHandled).not.toContain('u-t-applicant');
  });

  it('refuses a suspended approved teacher ACCOUNT_RESTRICTED', async () => {
    const response = await post('/uploads/teacher-probe', 't-t-suspended', identityPdf());
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'ACCOUNT_RESTRICTED',
        details: [{ path: 'accountStatus', code: 'suspended' }],
      },
    });
    expect(teacherHandled).not.toContain('u-t-suspended');
  });

  it('admits an approved teacher, the payout account verified or not', async () => {
    for (const [bearer, userId] of [
      ['t-t-approved', 'u-t-approved'],
      ['t-t-publishable', 'u-t-publishable'],
    ] as const) {
      const response = await post('/uploads/teacher-probe', bearer, identityPdf());
      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual({ userId });
    }
    expect(teacherHandled).toEqual(['u-t-approved', 'u-t-publishable']);
  });
});

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

  it('refuses a body that is not multipart as a validation failure', async () => {
    const plain = await fetch(`${origin}/uploads/probe`, {
      method: 'POST',
      headers: { authorization: 'Bearer t-active', 'content-type': 'application/pdf' },
      body: new Uint8Array(pdfBytes()),
    });
    expect(plain.status).toBe(400);
    await expect(plain.json()).resolves.toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('refuses a body with no file as a validation failure', async () => {
    const noFile = await post(
      '/uploads/probe',
      't-active',
      multipart([{ name: 'kind', value: 'identity' }]),
    );
    expect(noFile.status).toBe(400);
  });

  it('refuses an unknown kind as a validation failure naming the field', async () => {
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

  it('settles when the client aborts mid-body, logging the abort and holding nothing (PR #80 review, 1)', async () => {
    const { body, contentType } = identityPdf();
    const head = [
      'POST /uploads/probe HTTP/1.1',
      `Host: ${new URL(origin).host}`,
      'Authorization: Bearer t-active',
      `Content-Type: ${contentType}`,
      `Content-Length: ${body.byteLength}`,
      '',
      '',
    ].join('\r\n');
    // Half the body: the kind field and the file's head, never its end.
    await rawRequest(head, body.subarray(0, Math.floor(body.byteLength / 2)), 'abort');
    await loggedSoon('Upload aborted by the client');
    expect(records.filter((line) => line.includes('Unexpected error on an upload route'))).toEqual(
      [],
    );
  });

  it('settles when the client aborts before the body is read, while the session is resolved (PR #80 review, round 2 B)', async () => {
    const { body, contentType } = identityPdf();
    const head = [
      'POST /uploads/probe HTTP/1.1',
      `Host: ${new URL(origin).host}`,
      'Authorization: Bearer t-slow',
      `Content-Type: ${contentType}`,
      `Content-Length: ${body.byteLength}`,
      '',
      '',
    ].join('\r\n');
    const before = records.filter((line) => line.includes('Upload aborted by the client')).length;
    // The head and nothing of the body; the socket destroyed while the resolver still waits.
    await rawRequest(head, Buffer.alloc(0), 'abort');
    for (let tick = 0; tick < 40; tick += 1) {
      if (records.filter((line) => line.includes('Upload aborted by the client')).length > before)
        break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(
      records.filter((line) => line.includes('Upload aborted by the client')).length,
    ).toBeGreaterThan(before);
  });

  it('refuses a declared length over upload_max_bytes before reading a byte (PR #80 review, 3)', async () => {
    const { contentType } = identityPdf();
    const head = [
      'POST /uploads/probe HTTP/1.1',
      `Host: ${new URL(origin).host}`,
      'Authorization: Bearer t-active',
      `Content-Type: ${contentType}`,
      `Content-Length: ${LIMIT_BYTES * 1000}`,
      '',
      '',
    ].join('\r\n');
    const answer = await rawRequest(head, Buffer.alloc(0), 'answer');
    expect(answer).toMatch(/^HTTP\/1\.1 413 /);
    expect(answer).toContain('PAYLOAD_TOO_LARGE');
  });

  it('answers a malformed multipart body with 400 and closes, never reading it as an abort (PR #80 review, round 2 A)', async () => {
    const boundary = 'ijazah-boundary-7f3e';
    const body = Buffer.from(
      `--${boundary}\r\nthis is not a header\r\n\r\nx\r\n--${boundary}--\r\n`,
    );
    const head = [
      'POST /uploads/probe HTTP/1.1',
      `Host: ${new URL(origin).host}`,
      'Authorization: Bearer t-active',
      `Content-Type: multipart/form-data; boundary=${boundary}`,
      `Content-Length: ${body.byteLength}`,
      '',
      '',
    ].join('\r\n');
    const answer = await rawRequest(head, body, 'answer');
    expect(answer).toMatch(/^HTTP\/1\.1 400 /);
    expect(answer).toContain('VALIDATION_FAILED');
  });

  it('answers a deeper path under the route with 404, as the pages do (PR #80 review, 7)', async () => {
    const response = await post('/uploads/probe/extra', 't-active', identityPdf());
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'NOT_FOUND' } });
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
