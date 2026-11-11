// T149 — the HTTP application mounts the two surfaces apart, and every response it sends, on either
// surface or outside both, is the kernel's one error shape (FR-048, FR-041, R-API-11, R-SEC-9;
// contracts/kernel.md "Two surfaces", "Error shape").
//
// The application is built as main.ts builds it, but over fixture routers holding a procedure of
// each kind, since the real routers are still empty, and listened on an ephemeral port. Every case
// is a real HTTP request: a procedure answers only on its own surface's path, the caller kinds
// answer 401 and 400 through the transport, an unexpected failure leaves as the internal error with
// nothing of its text, and a path outside both surfaces gets the same shape rather than the
// framework's own.
//
// T150 adds the request body limit (FR-077): the application is built with a small limit, so a
// body one byte over it is refused with 413 `PAYLOAD_TOO_LARGE` on each surface before its
// procedure runs, a body exactly at it is read, and a refusal is not logged as unexpected.
import type { INestApplication } from '@nestjs/common';
import { initTRPC } from '@trpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApplication, type Surfaces, surfacePaths } from './app.module.js';
import { DomainError } from './platform/errors/domain-error.js';
import { RateLimiter } from './platform/guards/rate-limit.guard.js';

// No session is resolved in these cases: the resolvers answer null, as main.ts's stand-ins do (T017).
const sessions = { user: async () => null, admin: async () => null };

// The services the user surface's context carries (T038): nothing here reads one.
const services = {
  settings: {
    read: async () => {
      throw new Error('no setting is read here');
    },
  },
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

import { createLogger } from './platform/logging/logger.js';
import {
  adminProcedure,
  createAdminRouter,
  createAppRouter,
  publicProcedure,
  studentProcedure,
  toErrorShape,
} from './surfaces/procedures.js';
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
} from './surfaces/services.fixtures.js';

// No administrator session is resolved over HTTP yet, so no call here reaches auditing; T099 tests
// it. Each part refuses if it is ever reached.
const administration = {
  transactions: { run: () => Promise.reject(new Error('no administrative call is expected here')) },
  auditWriter: {
    write: () => Promise.reject(new Error('no administrative call is expected here')),
  },
};

const secret = 'SELECT password_hash FROM admin_users -- 7f3e';

// Every public procedure declares a limit (T170); the limits themselves are tested in
// platform/guards, so this limiter admits every call.
const rateLimiter = new RateLimiter({
  settings: { read: async (_key, schema) => schema.parse({ limit: 1_000, window_seconds: 60 }) },
  counter: { hit: async () => 1 },
  subjectKey: Buffer.alloc(32),
});
const anyone = { key: 'rate_limit_search', subjectOf: () => 'anyone' } as const;

const user = createAppRouter({
  ping: publicProcedure({ input: z.void(), output: z.string(), rateLimit: anyone }).query(
    () => 'pong',
  ),
  echo: publicProcedure({
    input: z.object({ n: z.number() }),
    output: z.number(),
    rateLimit: anyone,
  }).query(({ input }) => input.n),
  boom: publicProcedure({ input: z.void(), output: z.string(), rateLimit: anyone }).query(() => {
    throw new Error(secret);
  }),
  me: studentProcedure({ input: z.void(), output: z.string() }).query(
    ({ ctx }) => ctx.caller.userId,
  ),
  pad: publicProcedure({
    input: z.object({ pad: z.string() }),
    output: z.number(),
    rateLimit: anyone,
  }).mutation(({ input }) => input.pad.length),
});

const administrator = createAdminRouter({
  approve: adminProcedure({
    input: z.object({ teacherId: z.string() }),
    output: z.string(),
  }).mutation(() => 'approved'),
});

// The limit the application is built with here; production reads MAX_REQUEST_BODY_BYTES (T150).
const BODY_LIMIT = 1024;

const records: string[] = [];
let application: INestApplication;
let origin: string;

beforeAll(async () => {
  const log = createLogger({ level: 'info', destination: { write: (line) => records.push(line) } });
  // The readiness check is T110's and is tested in platform/health; here the database is not asked.
  const readiness = { databaseReachable: async () => {} };
  application = await createApplication({
    log,
    readiness,
    // The headers and the origin allowlist are T136's, tested in platform/guards.
    securityHeaders: { allowedOrigins: [], mode: 'test' },
    maxRequestBodyBytes: BODY_LIMIT,
    administration,
    rateLimiter,
    sessions,
    services,
    adminServices: unusedAdminServices,
    surfaces: { app: user, admin: administrator },
  });
  await application.listen(0, '127.0.0.1');
  origin = (await application.getUrl()).replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await application?.close();
});

async function query(path: string, input?: unknown): Promise<{ status: number; body: unknown }> {
  const search = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`;
  const response = await fetch(`${origin}${path}${search}`);
  return { status: response.status, body: await response.json() };
}

async function mutate(path: string, input: unknown): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return { status: response.status, body: await response.json() };
}

const notFound = { error: { code: 'NOT_FOUND', message: 'Not found.' } };

describe('the HTTP application (T149)', () => {
  it('mounts the two surfaces on two different paths', () => {
    expect(surfacePaths.app).not.toBe(surfacePaths.admin);
    expect(surfacePaths.admin.startsWith(`${surfacePaths.app}/`)).toBe(false);
    expect(surfacePaths.app.startsWith(`${surfacePaths.admin}/`)).toBe(false);
  });

  it('serves a user procedure on the user surface only', async () => {
    expect(await query(`${surfacePaths.app}/ping`)).toEqual({
      status: 200,
      body: { result: { data: 'pong' } },
    });
    expect(await query(`${surfacePaths.admin}/ping`)).toEqual({ status: 404, body: notFound });
  });

  it('serves an administrator procedure on the administrator surface only', async () => {
    expect(await mutate(`${surfacePaths.admin}/approve`, { teacherId: 't1' })).toEqual({
      status: 401,
      body: { error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } },
    });
    expect(await mutate(`${surfacePaths.app}/approve`, { teacherId: 't1' })).toEqual({
      status: 404,
      body: notFound,
    });
  });

  it('answers a caller kind refusal and a validation failure with their status and shape', async () => {
    expect(await query(`${surfacePaths.app}/me`)).toEqual({
      status: 401,
      body: { error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } },
    });
    expect(await query(`${surfacePaths.app}/echo`, { n: 'seven' })).toEqual({
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'The request is not valid.',
          details: [{ path: 'n', code: 'invalid_type' }],
        },
      },
    });
  });

  it('sends an unexpected failure as the internal error, and logs it with its correlation id', async () => {
    const { status, body } = await query(`${surfacePaths.app}/boom`);
    expect(status).toBe(500);
    expect(body).toEqual({
      error: { code: 'INTERNAL', message: 'Something went wrong. Try again later.' },
    });
    expect(JSON.stringify(body)).not.toContain('password_hash');

    const logged = records.map((line) => JSON.parse(line) as Record<string, unknown>);
    const failure = logged.find((record) => record['level'] === 'error');
    expect(failure?.['correlationId']).toEqual(expect.any(String));
  });

  it('answers a path outside both surfaces with the same shape, not the framework one', async () => {
    expect(await query('/elsewhere')).toEqual({ status: 404, body: notFound });
  });
});

describe('the request body limit (T150, FR-077)', () => {
  // tRPC reads a body only when a procedure asks for its input, and the administrator caller kind
  // refuses an anonymous caller before that; no administrator session is resolved yet, so no
  // request reads a body on the real administrator surface. To show that surface's handler carries
  // the limit, a second application mounts there a router whose procedure reads its input first:
  // one built around the caller kinds on a tRPC instance of this spec's own, with the kernel's
  // formatter, since a public kind now applies a rate limit from a limiter the administrator
  // context does not carry (T170). The types refuse it on that mount; only a spec can put it there.
  const stray = initTRPC.create({ errorFormatter: ({ error }) => toErrorShape(error).body });
  const readsFirst = stray.router({
    approve: stray.procedure
      .input(z.object({ pad: z.string() }))
      .mutation(({ input }) => input.pad.length),
  }) as unknown as Surfaces['admin'];
  let wired: INestApplication;
  let wiredOrigin: string;

  beforeAll(async () => {
    wired = await createApplication({
      log: createLogger({ level: 'info', destination: { write: (line) => records.push(line) } }),
      readiness: { databaseReachable: async () => {} },
      securityHeaders: { allowedOrigins: [], mode: 'test' },
      maxRequestBodyBytes: BODY_LIMIT,
      administration,
      rateLimiter,
      sessions,
      services,
      adminServices: unusedAdminServices,
      surfaces: { app: user, admin: readsFirst },
    });
    await wired.listen(0, '127.0.0.1');
    wiredOrigin = (await wired.getUrl()).replace('[::1]', '127.0.0.1');
  });

  afterAll(async () => {
    await wired?.close();
  });

  /** A JSON body `{"pad":"xx…"}` of exactly `size` bytes. */
  function bodyOf(size: number): string {
    const body = `{"pad":"${'x'.repeat(size - 10)}"}`;
    expect(Buffer.byteLength(body)).toBe(size);
    return body;
  }

  async function post(url: string, body: string): Promise<{ status: number; body: unknown }> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    return { status: response.status, body: await response.json() };
  }

  const tooLarge = {
    status: 413,
    body: { error: { code: 'PAYLOAD_TOO_LARGE', message: 'The request is too large.' } },
  };

  function errorRecords(): number {
    return records
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((record) => record['level'] === 'error').length;
  }

  it('refuses a body one byte over the limit on the user surface with 413', async () => {
    expect(await post(`${origin}${surfacePaths.app}/pad`, bodyOf(BODY_LIMIT + 1))).toEqual(
      tooLarge,
    );
  });

  it('refuses a body one byte over the limit on the administrator surface with 413', async () => {
    expect(
      await post(`${wiredOrigin}${surfacePaths.admin}/approve`, bodyOf(BODY_LIMIT + 1)),
    ).toEqual(tooLarge);
  });

  it('reads a body exactly at the limit, on either surface', async () => {
    const accepted = { status: 200, body: { result: { data: BODY_LIMIT - 10 } } };
    expect(await post(`${origin}${surfacePaths.app}/pad`, bodyOf(BODY_LIMIT))).toEqual(accepted);
    expect(await post(`${wiredOrigin}${surfacePaths.admin}/approve`, bodyOf(BODY_LIMIT))).toEqual(
      accepted,
    );
  });

  it('refuses an anonymous administrator call before reading its body at all', async () => {
    expect(
      (await post(`${origin}${surfacePaths.admin}/approve`, bodyOf(BODY_LIMIT + 1))).status,
    ).toBe(401);
  });

  it('logs nothing as unexpected for a refused body, so it is never reported', async () => {
    const before = errorRecords();

    await post(`${origin}${surfacePaths.app}/pad`, bodyOf(BODY_LIMIT + 1));
    await post(`${wiredOrigin}${surfacePaths.admin}/approve`, bodyOf(BODY_LIMIT + 1));

    expect(errorRecords()).toBe(before);
  });
});

// T062's follow-up from B34 (the owner's decision of 2026-11-07 on B34's conflict check, item 4
// (b)): every expected refusal leaves one info line, written in one place for every procedure of
// both surfaces (the handlers' `onError`): `{ procedure, errorCode, userId }` for a signed-in user,
// `{ procedure, errorCode, adminId }` for an administrator, `{ procedure, errorCode }` for an
// anonymous call, never an input, a name or a message. A rate limit's refusal is the limiter's to
// log, once per subject and window (SRS NFR-SEC-12), so it writes no line here.
describe('every expected refusal is logged once, in one place (T062, the B34 follow-up)', () => {
  const STUDENT_ID = '0199d0a0-0000-7000-8000-0000000000a1';
  const ADMIN_ID = '0199d0a0-0000-7000-8000-0000000000a2';
  const lines: string[] = [];
  const marker = 'Nour Abdelrahman, +201001234567';
  let refusing: INestApplication;
  let refusingOrigin: string;

  const refusals = createAppRouter({
    taken: studentProcedure({ input: z.object({ note: z.string() }), output: z.void() }).mutation(
      () => {
        throw new DomainError('CONFLICT', marker);
      },
    ),
    missing: studentProcedure({ input: z.void(), output: z.void() }).query(() => {
      throw new DomainError('NOT_FOUND');
    }),
    limited: studentProcedure({ input: z.void(), output: z.void() }).query(() => {
      throw new DomainError('RATE_LIMITED');
    }),
    open: publicProcedure({ input: z.void(), output: z.void(), rateLimit: anyone }).query(() => {
      throw new DomainError('FORBIDDEN');
    }),
  });
  const adminRefusals = createAdminRouter({
    decide: adminProcedure({ input: z.object({ note: z.string() }), output: z.void() }).mutation(
      () => {
        throw new DomainError('CONFLICT', marker);
      },
    ),
  });

  beforeAll(async () => {
    refusing = await createApplication({
      log: createLogger({ level: 'info', destination: { write: (line) => lines.push(line) } }),
      readiness: { databaseReachable: async () => {} },
      securityHeaders: { allowedOrigins: [], mode: 'test' },
      maxRequestBodyBytes: BODY_LIMIT,
      administration: {
        transactions: { run: (work) => work({} as never) },
        auditWriter: { write: () => Promise.reject(new Error('nothing is audited here')) },
      },
      rateLimiter,
      sessions: {
        user: async (bearer) =>
          bearer === 'student-token'
            ? {
                userId: STUDENT_ID,
                sessionId: '0199d0a0-0000-7000-8000-0000000000b1',
                role: 'student',
                gender: 'female',
                preferredLanguage: 'ar',
                accountStatus: 'active',
              }
            : null,
        admin: async (bearer) =>
          bearer === 'admin-token'
            ? {
                adminId: ADMIN_ID,
                sessionId: '0199d0a0-0000-7000-8000-0000000000b2',
                mfaVerified: true,
              }
            : null,
      },
      services,
      adminServices: unusedAdminServices,
      surfaces: { app: refusals, admin: adminRefusals },
    });
    await refusing.listen(0, '127.0.0.1');
    refusingOrigin = (await refusing.getUrl()).replace('[::1]', '127.0.0.1');
  });

  afterAll(async () => {
    await refusing?.close();
  });

  async function call(path: string, bearer: string | null, input?: unknown): Promise<number> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (bearer !== null) headers['authorization'] = `Bearer ${bearer}`;
    const response =
      input === undefined
        ? await fetch(`${refusingOrigin}${path}`, { headers })
        : await fetch(`${refusingOrigin}${path}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(input),
          });
    await response.arrayBuffer();
    return response.status;
  }

  /** The refusal lines written since `from`, as records. */
  function refusalLines(from: number): Array<Record<string, unknown>> {
    return lines
      .slice(from)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((record) => record['msg'] === 'A procedure call was refused');
  }

  /** A record's own fields: what the request logger binds to every line left out. */
  function ownFields(record: Record<string, unknown>): Record<string, unknown> {
    const { level, time, pid, hostname, msg, correlationId, clientAddress, ...own } = record;
    void [level, time, pid, hostname, msg, correlationId, clientAddress];
    return own;
  }

  it('writes one info line for a signed-in user’s refusal: the procedure, the code and the user id', async () => {
    const from = lines.length;
    expect(await call(`${surfacePaths.app}/taken`, 'student-token', { note: marker })).toBe(409);
    expect(await call(`${surfacePaths.app}/missing`, 'student-token')).toBe(404);

    const written = refusalLines(from);
    expect(written.map((record) => record['level'])).toEqual(['info', 'info']);
    expect(written.map(ownFields)).toEqual([
      { procedure: 'taken', errorCode: 'CONFLICT', userId: STUDENT_ID },
      { procedure: 'missing', errorCode: 'NOT_FOUND', userId: STUDENT_ID },
    ]);
    expect(written.every((record) => typeof record['correlationId'] === 'string')).toBe(true);
  });

  it('writes one for an administrator’s refusal, by the administrator’s id', async () => {
    const from = lines.length;
    expect(await call(`${surfacePaths.admin}/decide`, 'admin-token', { note: marker })).toBe(409);

    expect(refusalLines(from).map(ownFields)).toEqual([
      { procedure: 'decide', errorCode: 'CONFLICT', adminId: ADMIN_ID },
    ]);
  });

  it('writes one for an anonymous refusal, with no id at all', async () => {
    const from = lines.length;
    expect(await call(`${surfacePaths.app}/open`, null)).toBe(403);
    expect(await call(`${surfacePaths.app}/missing`, null)).toBe(401);

    expect(refusalLines(from).map(ownFields)).toEqual([
      { procedure: 'open', errorCode: 'FORBIDDEN' },
      { procedure: 'missing', errorCode: 'UNAUTHENTICATED' },
    ]);
  });

  it('writes none for a rate limit’s refusal, which the limiter logs once per window', async () => {
    const from = lines.length;
    expect(await call(`${surfacePaths.app}/limited`, 'student-token')).toBe(429);

    expect(refusalLines(from)).toEqual([]);
  });

  it('never writes the input, a name or the error’s message', async () => {
    const from = lines.length;
    await call(`${surfacePaths.app}/taken`, 'student-token', { note: marker });
    await call(`${surfacePaths.admin}/decide`, 'admin-token', { note: marker });

    const written = lines.slice(from).join('\n');
    expect(written).not.toContain('Nour');
    expect(written).not.toContain('201001234567');
  });
});

// PR #130's review, round 1, Minor 4 (the follow-ups under T062 in specs/004-sessions/tasks.md; the
// owner's decision of 2026-11-10, Q6): a refusal a module logs itself, with its reason, carries the
// mark «logged» (`markRefusalLogged`, `platform/errors/logged-refusal.ts`), the input guard's mark
// widened, so `onError` writes no second line for the one call. Through the whole handler, with the
// real routers and services over stores that refuse: a refused `sessions.get`, `sessions.join` and
// outage record each write exactly one refusal line, the module's; an unmarked refusal still gets
// `onError`'s (the describe above).
describe('a refusal the module logged is logged once (PR #130, Minor 4)', () => {
  const STUDENT_ID = '0199d0a0-0000-7000-8000-0000000000c1';
  const ADMIN_ID = '0199d0a0-0000-7000-8000-0000000000c2';
  const SESSION_ID = '0199d0a0-0000-7000-8000-0000000000c3';
  const REFUSAL_MESSAGES = new Set([
    'A procedure call was refused',
    'A session read or join was refused',
    'Outage window refused',
  ]);
  const lines: string[] = [];
  let refusing: INestApplication;
  let refusingOrigin: string;

  beforeAll(async () => {
    const { sessionsRouter, sessionsAdminRouter, createSessionsServices, createOutageServices } =
      await import('./modules/sessions/index.js');
    const log = createLogger({ level: 'info', destination: { write: (line) => lines.push(line) } });
    const sessionsServices = createSessionsServices({
      transactions: { run: (work) => work({} as never) },
      settings: { read: async (_key, schema) => schema.parse(15) },
      video: {} as never,
      enrollmentSide: {} as never,
      // No session is the caller's: `sessions.get` and `sessions.join` refuse NOT_FOUND.
      store: {
        sessionOfParty: async () => null,
        lockAccounts: async () => undefined,
        partiesOf: async () => new Map(),
        latestCancellationOf: async () => null,
        remedyOf: async () => null,
        slotOf: async () => null,
      },
      idempotency: { run: () => Promise.reject(new Error('nothing is keyed here')) },
    });
    const outages = createOutageServices({
      enrollments: { lockEnrollments: async () => undefined },
      completion: { completeIfDue: async () => false },
      settings: { read: async () => Promise.reject(new Error('no setting is read here')) },
      log,
      adminNames: async () => new Map(),
    });
    const adminServices = new Proxy(
      { outages },
      {
        get: (target, key) =>
          key in target
            ? Reflect.get(target, key)
            : Reflect.get(unusedAdminServices as object, key),
      },
    ) as typeof unusedAdminServices;
    refusing = await createApplication({
      log,
      readiness: { databaseReachable: async () => {} },
      securityHeaders: { allowedOrigins: [], mode: 'test' },
      maxRequestBodyBytes: BODY_LIMIT,
      administration: {
        transactions: { run: (work) => work({} as never) },
        auditWriter: { write: () => Promise.reject(new Error('nothing is audited here')) },
      },
      rateLimiter,
      sessions: {
        user: async (bearer) =>
          bearer === 'student-token'
            ? {
                userId: STUDENT_ID,
                sessionId: '0199d0a0-0000-7000-8000-0000000000d1',
                role: 'student',
                gender: 'female',
                preferredLanguage: 'ar',
                accountStatus: 'active',
              }
            : null,
        admin: async (bearer) =>
          bearer === 'admin-token'
            ? {
                adminId: ADMIN_ID,
                sessionId: '0199d0a0-0000-7000-8000-0000000000d2',
                mfaVerified: true,
              }
            : null,
      },
      services: { ...services, sessions: sessionsServices },
      adminServices,
      surfaces: {
        app: createAppRouter({ sessions: sessionsRouter }),
        admin: createAdminRouter({ sessions: sessionsAdminRouter }),
      },
    });
    await refusing.listen(0, '127.0.0.1');
    refusingOrigin = (await refusing.getUrl()).replace('[::1]', '127.0.0.1');
  });

  afterAll(async () => {
    await refusing?.close();
  });

  async function call(path: string, bearer: string, input: unknown, method: 'GET' | 'POST') {
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${bearer}` };
    const response =
      method === 'GET'
        ? await fetch(
            `${refusingOrigin}${path}?input=${encodeURIComponent(JSON.stringify(input))}`,
            {
              headers,
            },
          )
        : await fetch(`${refusingOrigin}${path}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(input),
          });
    await response.arrayBuffer();
    return response.status;
  }

  /** The refusal lines, of any writer, written since `from`. */
  function refusalLines(from: number): Array<Record<string, unknown>> {
    return lines
      .slice(from)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((record) => REFUSAL_MESSAGES.has(String(record['msg'])));
  }

  it('writes one line for a refused sessions.get, the module’s with its reason', async () => {
    const from = lines.length;
    expect(
      await call(
        `${surfacePaths.app}/sessions.get`,
        'student-token',
        { sessionId: SESSION_ID },
        'GET',
      ),
    ).toBe(404);
    const written = refusalLines(from);
    expect(written.map((record) => record['msg'])).toEqual(['A session read or join was refused']);
    expect(written[0]).toMatchObject({ errorCode: 'NOT_FOUND', reason: 'not_a_party' });
  });

  it('writes one line for a refused sessions.join, the module’s with its reason', async () => {
    const from = lines.length;
    expect(
      await call(
        `${surfacePaths.app}/sessions.join`,
        'student-token',
        { sessionId: SESSION_ID },
        'POST',
      ),
    ).toBe(404);
    const written = refusalLines(from);
    expect(written.map((record) => record['msg'])).toEqual(['A session read or join was refused']);
    expect(written[0]).toMatchObject({ errorCode: 'NOT_FOUND', reason: 'not_a_party' });
  });

  it('writes one line for a refused outage record, the module’s with its reason', async () => {
    const from = lines.length;
    const at = { localDate: '2026-11-10', localTime: '10:00' };
    expect(
      await call(
        `${surfacePaths.admin}/sessions.outages.record`,
        'admin-token',
        { start: at, end: at, timezone: 'Africa/Cairo', reason: 'Probe outage' },
        'POST',
      ),
    ).toBe(400);
    const written = refusalLines(from);
    expect(written.map((record) => record['msg'])).toEqual(['Outage window refused']);
    expect(written[0]).toMatchObject({ adminId: ADMIN_ID, reason: 'end_not_after_start' });
  });
});
