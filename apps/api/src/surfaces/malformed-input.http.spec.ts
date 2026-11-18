// T108 — a request whose tRPC input cannot be read answers 400 `VALIDATION_FAILED`, never 500
// (T099's follow-up). tRPC 11.19 refuses an empty or broken body, a broken GET `input` and either
// batch form as `BAD_REQUEST` with the parser's SyntaxError as cause, and `toErrorShape` maps by
// that cause, so each answered 500 INTERNAL, logged as unexpected and reported with a message that
// can quote the body. Each caller kind now reads the raw input itself, after its authentication and
// immediately before its schema, and answers a failure of that read with `VALIDATION_FAILED`; the
// surface handler refuses, before tRPC and without reading the body, what tRPC would fail on before
// any procedure runs: `connectionParams`, a path that does not decode, a non-JSON content type.
// Batching is off, so a batch of either form is refused 400 whole, by tRPC. It also refuses what tRPC's node adapter cannot turn into a fetch `Request` (a URL that does not
// build, credentials in it, TRACE) and a malformed procedure path: a URL or a method of these
// reached that adapter's exception handler, which our formatter's shape cannot feed, and the
// rejection ended the process. Each such case checks that the next call is still answered.
//
// The application is built as main.ts builds it, with the real routers of both surfaces, and
// listened on an ephemeral port; the requests are raw `fetch`es, since the tRPC client cannot send
// a malformed body. The refusal is logged once at info with its correlation id and nothing of the
// body, and is never reported: `reportError` is spied on. The limit (T150) still answers 413, and
// an anonymous administrator call is still refused with 401 before its body is read. A second
// application over fixture routers holds that a SyntaxError of our own, thrown by a handler or by
// a schema's transform, stays the internal error, logged and reported; so does a failure of the
// context factory. The upload routes, the webhook and the public pages are mounted beside the
// surfaces and are reached as before. What still reaches the adapter's exception handler (a write
// that fails with an error other than an abort) is answered there, with the status our shape
// carries hidden, and the server lives on; every error body is unchanged, byte for byte.
import { request as httpRequest, ServerResponse } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createApplication, surfacePaths } from '../app.module.js';
import type { IdentityServices } from '../modules/identity/index.js';
import type { CatalogServices } from '../modules/catalog/index.js';
import type { VerificationServices } from '../modules/verification/index.js';
import { reportError } from '../platform/errors/reporting.js';
import { RateLimiter } from '../platform/guards/rate-limit.guard.js';
import { createLogger } from '../platform/logging/logger.js';
import { html } from '../platform/web/html.js';
import type { AdminSession, AdminSurfaceServices, UserSession } from './context.js';
import {
  unusedBookingServices,
  unusedCertificationServices,
  unusedModerationServices,
  unusedChatServices,
  unusedCheckoutServices,
  unusedDiscoveryServices,
  unusedSessionsServices,
  unusedTeacherProfileServices,
} from './services.fixtures.js';
import {
  adminPublicProcedure,
  createAdminRouter,
  createAppRouter,
  publicProcedure,
} from './procedures.js';

vi.mock('../platform/errors/reporting.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/errors/reporting.js')>()),
  reportError: vi.fn(),
}));

const NONCE = { nonce: 'n-0199d0a0', expiresAt: '2026-10-27T10:00:00.000Z' };

const STUDENT: UserSession = {
  userId: '0199d0a0-0000-7000-8000-000000000001',
  sessionId: '0199d0a0-0000-7000-8000-0000000000s1',
  role: 'student',
  gender: 'male',
  preferredLanguage: 'ar',
  accountStatus: 'active',
};
const APPLICANT: UserSession = {
  userId: '0199d0a0-0000-7000-8000-000000000002',
  sessionId: '0199d0a0-0000-7000-8000-0000000000s2',
  role: 'teacher',
  gender: 'female',
  preferredLanguage: 'ar',
  accountStatus: 'active',
  teacher: { verificationStatus: 'pending', payoutVerified: false, applicationStatus: 'approved' },
};
const ADMINISTRATOR: AdminSession = {
  adminId: '0199d0a0-0000-7000-8000-000000000003',
  sessionId: '0199d0a0-0000-7000-8000-0000000000s3',
  mfaVerified: true,
};
const userSessions: Readonly<Record<string, UserSession>> = {
  'student-bearer': STUDENT,
  'applicant-bearer': APPLICANT,
};
const adminSessions: Readonly<Record<string, AdminSession>> = { 'admin-bearer': ADMINISTRATOR };

/** The bearer whose resolution fails: the context factory throws, which is our code failing. */
const FAILING_BEARER = 'resolver-fails';

/** A module's services with only `members` answering; any other call fails loudly. */
function only<T>(module: string, members: Record<string, object>): T {
  return new Proxy(members, {
    get: (target, service: string) =>
      target[service] ??
      new Proxy(
        {},
        {
          get: (_inner, method) => () => {
            throw new Error(`${module}.${service}.${String(method)}: not reached by this spec`);
          },
        },
      ),
  }) as T;
}

const identity = only<IdentityServices>('identity', {
  signIn: { providerNonce: async () => NONCE },
});
const verification = only<VerificationServices>('verification', {});
const catalog = only<CatalogServices>('catalog', {});
const adminServices = only<AdminSurfaceServices>('admin', {});

// Every public procedure declares a limit (T170); the limits are tested in platform/guards, so
// this limiter admits every call.
const rateLimiter = new RateLimiter({
  settings: { read: async (_key, schema) => schema.parse({ limit: 1_000, window_seconds: 60 }) },
  counter: { hit: async () => 1 },
  subjectKey: Buffer.alloc(32),
});

// No administrative call here gets past its input, so nothing runs in a transaction or is audited.
const administration = {
  transactions: { run: () => Promise.reject(new Error('no administrative call is expected here')) },
  auditWriter: {
    write: () => Promise.reject(new Error('no administrative call is expected here')),
  },
};

const services = {
  settings: {
    read: async () => {
      throw new Error('no setting is read here');
    },
  },
  publicConfig: { supportEmail: 'support@ijazah.invalid', paymentMode: 'test' as const },
  subjects: { listActive: async () => [] },
  identity,
  verification,
  catalog,
  teacherProfile: unusedTeacherProfileServices,
  discovery: unusedDiscoveryServices,
  booking: unusedBookingServices,
  checkout: unusedCheckoutServices,
  sessions: unusedSessionsServices,
  chat: unusedChatServices,
  certification: unusedCertificationServices,
  moderation: unusedModerationServices,
};

const sessions = {
  user: async (bearer: string) => {
    if (bearer === FAILING_BEARER) throw new Error('the session store is unreachable');
    return userSessions[bearer] ?? null;
  },
  admin: async (bearer: string) => adminSessions[bearer] ?? null,
};

// The limit the application is built with here; production reads MAX_REQUEST_BODY_BYTES (T150).
const BODY_LIMIT = 1024;

/** A string no answer, log line or report may carry: it is only ever inside a sent body. */
const MARKER = 'T108-body-marker-5f2c9e';

/** Reached by the routes mounted beside the surfaces, so they show they were not refused. */
const besideTheSurfaces = {
  upload: '/uploads/fixture',
  webhook: '/webhooks/fixture',
  page: '/fixture-page',
} as const;

const records: Record<string, unknown>[] = [];
let application: INestApplication;
let origin: string;

function capturedLogger() {
  return createLogger({
    level: 'info',
    destination: { write: (line) => records.push(JSON.parse(line) as Record<string, unknown>) },
  });
}

/** Mounted as an upload route or the webhook is: a Node handler that answers what it was sent. */
function reachedHandler(name: string) {
  return (
    request: import('node:http').IncomingMessage,
    response: import('node:http').ServerResponse,
  ) => {
    response.statusCode = 200;
    response.setHeader('content-type', 'text/plain');
    response.end(`${name} ${request.method ?? ''} ${request.headers['content-type'] ?? 'none'}`);
  };
}

beforeAll(async () => {
  application = await createApplication({
    log: capturedLogger(),
    readiness: { databaseReachable: async () => {} },
    securityHeaders: { allowedOrigins: [], mode: 'test' },
    maxRequestBodyBytes: BODY_LIMIT,
    administration,
    rateLimiter,
    sessions,
    services,
    adminServices,
    webRoutes: {
      [besideTheSurfaces.page]: {
        methods: ['GET', 'POST'],
        handle: () => ({ page: html`<p>page reached</p>` }),
      },
    },
    routes: {
      [besideTheSurfaces.upload]: reachedHandler('upload'),
      [besideTheSurfaces.webhook]: reachedHandler('webhook'),
    },
  });
  await application.listen(0, '127.0.0.1');
  origin = (await application.getUrl()).replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await application?.close();
});

beforeEach(() => {
  records.length = 0;
  vi.mocked(reportError).mockClear();
});

interface Answer {
  readonly status: number;
  readonly body: unknown;
}

async function send(path: string, init: RequestInit = {}, bearer?: string): Promise<Answer> {
  const headers = new Headers(init.headers);
  if (bearer !== undefined) headers.set('authorization', `Bearer ${bearer}`);
  const response = await fetch(`${origin}${path}`, { ...init, headers });
  const text = await response.text();
  return { status: response.status, body: text === '' ? null : (JSON.parse(text) as unknown) };
}

/** A POST with the JSON content type tRPC reads, and `body` exactly as given. */
function post(path: string, body: string, bearer?: string): Promise<Answer> {
  return send(
    path,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body },
    bearer,
  );
}

const refused = {
  error: { code: 'VALIDATION_FAILED', message: 'The request is not valid.' },
};
const unreadable: Answer = { status: 400, body: refused };
const internal: Answer = {
  status: 500,
  body: { error: { code: 'INTERNAL', message: 'Something went wrong. Try again later.' } },
};

/** A JSON body `{"pad":"xx…"}` of exactly `size` bytes. */
function bodyOf(size: number): string {
  const body = `{"pad":"${'x'.repeat(size - 10)}"}`;
  expect(Buffer.byteLength(body)).toBe(size);
  return body;
}

const app = surfacePaths.app;
const admin = surfacePaths.admin;

/** One procedure of each caller kind on both surfaces, the bearer it needs, and a query of each. */
const mutations = [
  { kind: 'public', path: `${app}/auth.providerNonce`, bearer: undefined },
  { kind: 'user', path: `${app}/auth.signOut`, bearer: 'student-bearer' },
  {
    kind: 'teacher',
    path: `${app}/teacher.application.markApprovedShown`,
    bearer: 'applicant-bearer',
  },
  { kind: 'administrator', path: `${admin}/auth.signOut`, bearer: 'admin-bearer' },
  { kind: 'administrator-public', path: `${admin}/auth.signIn`, bearer: undefined },
] as const;
const queries = [
  { kind: 'public', path: `${app}/catalog.subjects.list`, bearer: undefined },
  { kind: 'user', path: `${app}/account.me`, bearer: 'student-bearer' },
  { kind: 'administrator', path: `${admin}/auth.me`, bearer: 'admin-bearer' },
] as const;

describe('an unreadable input answers 400 VALIDATION_FAILED on both surfaces (T108)', () => {
  it.each(mutations)('an empty body, $kind kind ($path)', async ({ path, bearer }) => {
    expect(await post(path, '', bearer)).toEqual(unreadable);
  });

  it.each(mutations)('a broken body, $kind kind ($path)', async ({ path, bearer }) => {
    expect(await post(path, `{"marker":"${MARKER}`, bearer)).toEqual(unreadable);
  });

  it.each(queries)('a broken GET input, $kind kind ($path)', async ({ path, bearer }) => {
    expect(await send(`${path}?input=%7B`, {}, bearer)).toEqual(unreadable);
  });

  // Batching is off on both surfaces (app.module.ts, `allowBatching`): neither client sends a
  // batch, so any batch, well formed or not, is tRPC's own refusal, answered 400 in our shape
  // before any call's input is read, and the next single call is still answered.
  async function singleCallAnswered(): Promise<void> {
    expect(await post(`${app}/auth.providerNonce`, '{}')).toEqual({
      status: 200,
      body: { result: { data: NONCE } },
    });
  }

  it.each([
    ['a GET batch', `${app}/catalog.subjects.list,platform.publicConfig?batch=1`, undefined],
    ['a GET batch, broken input', `${app}/catalog.subjects.list?batch=1&input=%7B`, undefined],
    ['a GET batch', `${admin}/auth.me,home.summary?batch=1`, 'admin-bearer'],
  ] as const)('%s is refused: %s', async (_case, path, bearer) => {
    expect(await send(path, {}, bearer)).toEqual(unreadable);
    await singleCallAnswered();
  });

  it.each([
    ['a POST batch', `${app}/auth.providerNonce,auth.providerNonce?batch=1`, '{"0":{},"1":{}}'],
    ['a POST batch, broken body', `${app}/auth.providerNonce?batch=1`, '{"0":'],
    ['a POST batch', `${admin}/auth.signOut,auth.signOut?batch=1`, '{"0":{},"1":{}}'],
  ] as const)('%s is refused: %s', async (_case, path, body) => {
    const bearer = path.startsWith(admin) ? 'admin-bearer' : undefined;
    expect(await post(path, body, bearer)).toEqual(unreadable);
    await singleCallAnswered();
  });

  it('logs each refusal once at info with its correlation id, and reports none', async () => {
    await post(`${app}/auth.providerNonce`, `{"marker":"${MARKER}`);
    expect(records).toEqual([
      expect.objectContaining({
        level: 'info',
        errorCode: 'VALIDATION_FAILED',
        reason: 'input_unreadable',
        correlationId: expect.any(String),
      }),
    ]);
    expect(reportError).not.toHaveBeenCalled();
  });
});

describe('what tRPC fails on before any procedure is refused without reading the body (T108)', () => {
  it.each([
    ['connectionParams', `${app}/catalog.subjects.list?connectionParams=%7B`],
    ['connectionParams', `${admin}/auth.me?connectionParams=%7B`],
    ['a path that does not decode', `${app}/catalog.subjects.list%E0%A4%A`],
    ['a path that does not decode', `${admin}/auth.me%`],
  ])('%s: %s', async (_case, path) => {
    expect(await send(path, {}, path.startsWith(admin) ? 'admin-bearer' : undefined)).toEqual(
      unreadable,
    );
  });

  it.each([app, admin])('a POST whose content type is not JSON, on %s', async (surface) => {
    const path = `${surface}/auth.signOut`;
    const bearer = surface === admin ? 'admin-bearer' : 'student-bearer';
    const body = `{"marker":"${MARKER}"}`;
    // A string body is sent as text/plain; bytes carry no content type at all.
    expect(await send(path, { method: 'POST', body }, bearer)).toEqual(unreadable);
    expect(await send(path, { method: 'POST', body: Buffer.from(body) }, bearer)).toEqual(
      unreadable,
    );
    expect(
      await send(
        path,
        { method: 'POST', headers: { 'content-type': 'APPLICATION/JSON' }, body },
        bearer,
      ),
    ).toEqual(unreadable);
  });

  it('logs each refusal once at info with a correlation id, and reports none', async () => {
    await send(`${app}/auth.signOut`, { method: 'POST', body: `{"marker":"${MARKER}"}` });
    expect(records).toEqual([
      expect.objectContaining({
        level: 'info',
        errorCode: 'VALIDATION_FAILED',
        reason: 'content_type_not_json',
        correlationId: expect.any(String),
      }),
    ]);
    expect(reportError).not.toHaveBeenCalled();
  });
});

describe('what is unchanged (T108)', () => {
  it('a valid `{}` reaches its procedure', async () => {
    expect(await post(`${app}/auth.providerNonce`, '{}')).toEqual({
      status: 200,
      body: { result: { data: NONCE } },
    });
  });

  it('a JSON body led by a byte order mark is still read', async () => {
    expect(await post(`${app}/auth.providerNonce`, '﻿{}')).toEqual({
      status: 200,
      body: { result: { data: NONCE } },
    });
  });

  it('a body past the limit still answers 413 on either surface (T150)', async () => {
    const tooLarge = {
      status: 413,
      body: { error: { code: 'PAYLOAD_TOO_LARGE', message: 'The request is too large.' } },
    };
    expect(await post(`${app}/auth.providerNonce`, bodyOf(BODY_LIMIT + 1))).toEqual(tooLarge);
    expect(await post(`${admin}/auth.signOut`, bodyOf(BODY_LIMIT + 1), 'admin-bearer')).toEqual(
      tooLarge,
    );
  });

  it('an anonymous administrator call is still refused with 401 before its body is read', async () => {
    expect(await post(`${admin}/auth.signOut`, bodyOf(BODY_LIMIT + 1))).toEqual({
      status: 401,
      body: { error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } },
    });
    expect(await post(`${admin}/auth.signOut`, '')).toEqual({
      status: 401,
      body: { error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } },
    });
  });

  it('a failure of the context factory stays the internal error, logged and reported', async () => {
    expect(await post(`${app}/auth.signOut`, '{}', FAILING_BEARER)).toEqual(internal);
    expect(records.filter((record) => record['level'] === 'error')).toHaveLength(1);
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it('the upload routes, the webhook and the public pages are reached as before', async () => {
    const odd = { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x' } };
    expect(await textOf(`${besideTheSurfaces.upload}?connectionParams=%7B`, odd)).toEqual({
      status: 200,
      text: 'upload POST multipart/form-data; boundary=x',
    });
    expect(
      await textOf(besideTheSurfaces.webhook, { method: 'POST', body: Buffer.from('raw') }),
    ).toEqual({ status: 200, text: 'webhook POST none' });
    const page = await textOf(`${besideTheSurfaces.page}?connectionParams=%7B`, {});
    expect(page.status).toBe(200);
    expect(page.text).toContain('page reached');
  });
});

async function textOf(path: string, init: RequestInit): Promise<{ status: number; text: string }> {
  const response = await fetch(`${origin}${path}`, init);
  return { status: response.status, text: await response.text() };
}

/** How long a raw request waits for an answer: a request that crashed the handler gets none. */
const ANSWER_WAIT_MS = 2_000;

/**
 * A request as written, through `node:http`: `fetch` refuses TRACE, rewrites no `Host` and cannot
 * send what these cases send. It fails when no answer comes.
 */
function raw(
  method: string,
  path: string,
  headers: Readonly<Record<string, string>> = {},
  body?: string,
): Promise<Answer> {
  const { hostname, port } = new URL(origin);
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      { host: hostname, port, method, path, headers, timeout: ANSWER_WAIT_MS },
      (incoming) => {
        let text = '';
        incoming.setEncoding('utf8');
        incoming.on('data', (chunk: string) => (text += chunk));
        incoming.on('end', () =>
          resolve({
            status: incoming.statusCode ?? 0,
            body: text === '' ? null : (JSON.parse(text) as unknown),
          }),
        );
      },
    );
    outgoing.on('timeout', () => outgoing.destroy(new Error(`${method} ${path}: no answer`)));
    outgoing.on('error', reject);
    outgoing.end(body);
  });
}

const json = { 'content-type': 'application/json' };

describe('a request tRPC cannot turn into its own is refused before it, and the server lives on (T108)', () => {
  const notFound: Answer = {
    status: 404,
    body: { error: { code: 'NOT_FOUND', message: 'Not found.' } },
  };

  /** The next call on the same server is answered: the handler and the process survived. */
  async function stillServing(): Promise<void> {
    expect(await post(`${app}/auth.providerNonce`, '{}')).toEqual({
      status: 200,
      body: { result: { data: NONCE } },
    });
  }

  it.each([app, admin])('a URL that does not parse, on %s', async (surface) => {
    expect(await raw('POST', `${surface}//`, json, '{}')).toEqual(unreadable);
    expect((await raw('HEAD', `${surface}//`)).status).toBe(400);
    await stillServing();
  });

  it.each([app, admin])('a host carrying credentials, on %s', async (surface) => {
    const path = `${surface}/auth.signOut`;
    expect(await raw('POST', path, { ...json, host: 'user:secret@localhost' }, '{}')).toEqual(
      unreadable,
    );
    // The same credentials in an absolute-form request target, which Node accepts as written.
    const absolute = `http://user:secret@localhost${path}`;
    expect(await raw('POST', absolute, json, '{}')).toEqual(unreadable);
    await stillServing();
  });

  it.each([app, admin])('a method tRPC cannot carry answers 404, on %s', async (surface) => {
    const path = `${surface}/auth.signOut`;
    expect(await raw('TRACE', path, json)).toEqual(notFound);
    // A method a Request can carry but tRPC does not serve answered 404 already: the same answer.
    expect(await raw('PUT', path, json, '{}')).toEqual(notFound);
    expect(await raw('DELETE', path, { 'content-type': 'text/plain' }, 'x')).toEqual(notFound);
    await stillServing();
  });

  it.each([
    ['an empty procedure path', `${app}/`],
    ['an empty procedure path', `${admin}//x`],
    ['an empty segment', `${app}/auth..signOut`],
    ['a slash inside the path', `${admin}/auth.signOut/x`],
    ['a comma outside a batch', `${app}/auth.providerNonce,auth.providerNonce`],
    ['an empty call in a batch', `${app}/auth.providerNonce,?batch=1`],
    ['a character outside the names', `${app}/auth.provider%20Nonce`],
  ])('a malformed procedure path, %s: %s', async (_case, path) => {
    expect(await raw('POST', path, json, '{}')).toEqual(unreadable);
  });

  it.each([`${app}/no.such.procedure`, `${admin}/nothing`])(
    'a well-formed unknown path is still 404: %s',
    async (path) => {
      expect(await raw('POST', path, json, '{}')).toEqual(notFound);
      expect(records.filter((record) => record['reason'] !== undefined)).toEqual([]);
    },
  );

  it('a preflight never reaches the surfaces: the browser headers answer it', async () => {
    const preflight = await raw('OPTIONS', `${app}/auth.signOut`, {
      origin: 'https://elsewhere.invalid',
      'access-control-request-method': 'POST',
    });
    expect(preflight.status).toBe(204);
    expect(records).toEqual([]);
  });

  it('logs each refusal once at info with a correlation id, and reports none', async () => {
    await raw('POST', `${app}//`, json, '{}');
    await raw('TRACE', `${admin}/auth.signOut`, json);
    expect(records).toEqual([
      expect.objectContaining({
        level: 'info',
        errorCode: 'VALIDATION_FAILED',
        reason: 'url_not_parsable',
        correlationId: expect.any(String),
      }),
      expect.objectContaining({
        level: 'info',
        errorCode: 'NOT_FOUND',
        reason: 'method_not_supported',
        correlationId: expect.any(String),
      }),
    ]);
    expect(reportError).not.toHaveBeenCalled();
  });
});

describe('nothing of the body reaches the log or the reporter (T108, R-SEC-2)', () => {
  it('holds for every refusal above', async () => {
    const broken = `{"marker":"${MARKER}`;
    for (const { path, bearer } of mutations) await post(path, broken, bearer);
    await send(`${app}/catalog.subjects.list?input=${encodeURIComponent(broken)}`);
    await post(`${app}/auth.providerNonce,auth.providerNonce?batch=1`, `{"0":${broken}`);
    await send(`${app}/auth.signOut`, { method: 'POST', body: broken }, 'student-bearer');

    const logged = JSON.stringify(records);
    expect(logged).not.toContain(MARKER);
    expect(logged).not.toContain('JSON');
    expect(records.every((record) => record['level'] === 'info')).toBe(true);
    expect(reportError).not.toHaveBeenCalled();
  });
});

describe('every error body is unchanged, byte for byte, with no `data` (T108)', () => {
  const validation = '{"error":{"code":"VALIDATION_FAILED","message":"The request is not valid."}}';
  const unauthenticated = '{"error":{"code":"UNAUTHENTICATED","message":"Sign in to continue."}}';
  const invalidFields =
    '{"error":{"code":"VALIDATION_FAILED","message":"The request is not valid.","details":' +
    '[{"path":"email","code":"invalid_type"},{"path":"password","code":"invalid_type"}]}}';
  const notFound = '{"error":{"code":"NOT_FOUND","message":"Not found."}}';
  it.each([
    ['a domain error', `${admin}/auth.signOut`, '{}', 401, unauthenticated],
    ['a validation failure', `${admin}/auth.signIn`, '{}', 400, invalidFields],
    ['an unknown path', `${app}/no.such.procedure`, '{}', 404, notFound],
    ['an unreadable input', `${app}/auth.providerNonce`, '{', 400, validation],
    ['a refused batch', `${app}/auth.providerNonce?batch=1`, '{"0":{}}', 400, validation],
  ] as const)('%s: %s', async (_case, path, body, status, text) => {
    expect(await textOf(path, { method: 'POST', headers: json, body })).toEqual({ status, text });
  });

  it('an unexpected 500', async () => {
    const headers = { ...json, authorization: `Bearer ${FAILING_BEARER}` };
    expect(await textOf(`${app}/auth.signOut`, { method: 'POST', headers, body: '{}' })).toEqual({
      status: 500,
      text: '{"error":{"code":"INTERNAL","message":"Something went wrong. Try again later."}}',
    });
  });
});

describe("what reaches tRPC's own exception handler is answered, and the server lives on (T108)", () => {
  /** The header that marks the one request whose response write fails. */
  const FAILS = 'x-t108-write-fails';

  // The adapter's `writeResponse` waits on `drain` or `error` when a write returns false, and hands
  // an error that is not an abort to its exception handler, which reads `shape.data.httpStatus` of
  // our formatter's shape. A broken pipe or a reset is that error when it lands before the close.
  // The handler's second `res.end` on the response tRPC already ended emits
  // `ERR_STREAM_WRITE_AFTER_END` as `'error'`; the surface's listener hears it, so it is not thrown.
  it('a response whose write fails with a broken pipe', async () => {
    const escaped: unknown[] = [];
    const onEscape = (reason: unknown): void => {
      escaped.push(reason);
    };
    process.on('unhandledRejection', onEscape);
    process.on('uncaughtException', onEscape);
    const write = ServerResponse.prototype.write;
    const failing = vi.spyOn(ServerResponse.prototype, 'write').mockImplementation(function (
      this: ServerResponse,
      ...args: unknown[]
    ) {
      if (this.req.headers[FAILS] === undefined) return Reflect.apply(write, this, args) as boolean;
      const broken = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
      process.nextTick(() => this.emit('error', broken));
      return false;
    });
    try {
      const failed = await textOf(`${app}/auth.providerNonce?marker=${MARKER}`, {
        method: 'POST',
        headers: { ...json, [FAILS]: '1', 'x-t108-marker': MARKER },
        body: `{"marker":"${MARKER}"}`,
      });
      expect(failed.status).toBe(500);
      await new Promise((resolve) => setImmediate(resolve));
      expect(escaped).toEqual([]);
    } finally {
      failing.mockRestore();
      process.off('unhandledRejection', onEscape);
      process.off('uncaughtException', onEscape);
    }
    expect(reportError).toHaveBeenCalledTimes(1);
    // The listener's lines: warn, the error's code and message only, nothing of the request.
    const warnLine = (errorCode: string, errorMessage: string) => ({
      level: 'warn',
      time: expect.any(String),
      pid: expect.any(Number),
      hostname: expect.any(String),
      errorCode,
      errorMessage,
      msg: 'A surface response failed to write',
    });
    const warned = records.filter((record) => record['level'] === 'warn');
    expect(warned).toEqual([
      warnLine('EPIPE', 'write EPIPE'),
      warnLine('ERR_STREAM_WRITE_AFTER_END', 'write after end'),
    ]);
    expect(JSON.stringify(warned)).not.toContain(MARKER);
    expect(await post(`${app}/auth.providerNonce`, '{}')).toEqual({
      status: 200,
      body: { result: { data: NONCE } },
    });
  });
});

describe('a SyntaxError of our own stays the internal error, logged and reported (T108)', () => {
  const anyone = { key: 'rate_limit_search', subjectOf: () => 'anyone' } as const;
  const parsed = z.object({
    text: z.string().transform((text) => JSON.parse(text) as unknown),
  });
  const user = createAppRouter({
    throws: publicProcedure({
      input: z.object({}),
      output: z.string(),
      rateLimit: anyone,
    }).mutation(() => {
      throw new SyntaxError(`Unexpected token in ${MARKER}`);
    }),
    transforms: publicProcedure({ input: parsed, output: z.string(), rateLimit: anyone }).mutation(
      () => 'not reached',
    ),
  });
  const administrator = createAdminRouter({
    transforms: adminPublicProcedure({
      input: parsed,
      output: z.string(),
      rateLimit: anyone,
    }).mutation(() => 'not reached'),
  });
  let fixture: INestApplication;
  let fixtureOrigin: string;

  beforeAll(async () => {
    fixture = await createApplication({
      log: capturedLogger(),
      readiness: { databaseReachable: async () => {} },
      securityHeaders: { allowedOrigins: [], mode: 'test' },
      maxRequestBodyBytes: BODY_LIMIT,
      administration,
      rateLimiter,
      sessions,
      services,
      adminServices,
      surfaces: { app: user, admin: administrator },
    });
    await fixture.listen(0, '127.0.0.1');
    fixtureOrigin = (await fixture.getUrl()).replace('[::1]', '127.0.0.1');
  });

  afterAll(async () => {
    await fixture?.close();
  });

  async function call(path: string, body: string): Promise<Answer> {
    const response = await fetch(`${fixtureOrigin}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    return { status: response.status, body: await response.json() };
  }

  it.each([
    ['thrown by a handler', `${app}/throws`],
    ['thrown by a schema transform', `${app}/transforms`],
    ['thrown by a schema transform on the administrator surface', `${admin}/transforms`],
  ])('%s', async (_case, path) => {
    expect(await call(path, JSON.stringify({ text: '{' }))).toEqual(internal);
    expect(records.filter((record) => record['level'] === 'error')).toHaveLength(1);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reportError).mock.calls[0]?.[0]).toBeInstanceOf(SyntaxError);
  });
});
