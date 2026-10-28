// T108 — a request whose tRPC input cannot be read answers 400 `VALIDATION_FAILED`, never 500
// (T099's follow-up). tRPC 11.19 refuses an empty or broken body, a broken GET `input` and either
// batch form as `BAD_REQUEST` with the parser's SyntaxError as cause, and `toErrorShape` maps by
// that cause, so each answered 500 INTERNAL, logged as unexpected and reported with a message that
// can quote the body. Each caller kind now reads the raw input itself, after its authentication and
// immediately before its schema, and answers a failure of that read with `VALIDATION_FAILED`; the
// surface handler refuses, before tRPC and without reading the body, what tRPC would fail on before
// any procedure runs: `connectionParams`, a path that does not decode, a non-JSON content type.
//
// The application is built as main.ts builds it, with the real routers of both surfaces, and
// listened on an ephemeral port; the requests are raw `fetch`es, since the tRPC client cannot send
// a malformed body. The refusal is logged once at info with its correlation id and nothing of the
// body, and is never reported: `reportError` is spied on. The limit (T150) still answers 413, and
// an anonymous administrator call is still refused with 401 before its body is read. A second
// application over fixture routers holds that a SyntaxError of our own, thrown by a handler or by
// a schema's transform, stays the internal error, logged and reported; so does a failure of the
// context factory. The upload routes, the webhook and the public pages are mounted beside the
// surfaces and are reached as before.
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createApplication, surfacePaths } from '../app.module.js';
import type { IdentityServices } from '../modules/identity/index.js';
import type { VerificationServices } from '../modules/verification/index.js';
import { reportError } from '../platform/errors/reporting.js';
import { RateLimiter } from '../platform/guards/rate-limit.guard.js';
import { createLogger } from '../platform/logging/logger.js';
import { html } from '../platform/web/html.js';
import type { AdminSession, AdminSurfaceServices, UserSession } from './context.js';
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
  publicConfig: { supportEmail: 'support@ijazah.invalid' },
  subjects: { listActive: async () => [] },
  identity,
  verification,
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

  // A batch keeps tRPC's own status (app.module.ts, `responseMeta`), unchanged here: each call's
  // answer is in the body.
  const batchRefused = { status: 200, body: [refused, refused] };

  it('a GET batch with a broken input, on either surface: each call refused', async () => {
    expect(
      await send(`${app}/catalog.subjects.list,platform.publicConfig?batch=1&input=%7B`),
    ).toEqual(batchRefused);
    expect(
      await send(`${admin}/auth.me,home.summary?batch=1&input=%7B`, {}, 'admin-bearer'),
    ).toEqual(batchRefused);
  });

  it('a POST batch with a broken body, on either surface: each call refused', async () => {
    expect(await post(`${app}/auth.providerNonce,auth.providerNonce?batch=1`, '{"0":')).toEqual(
      batchRefused,
    );
    expect(
      await post(`${admin}/auth.signOut,auth.signOut?batch=1`, '{"0":', 'admin-bearer'),
    ).toEqual(batchRefused);
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
