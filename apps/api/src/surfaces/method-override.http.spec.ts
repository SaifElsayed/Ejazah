// 002:T147 (W1) — the administrator panel sends its queries by POST, their input in the body: seven
// of its lists carry a search text (a name, an email), which in a GET's URL reaches every access
// log and proxy on the way. tRPC calls this a method override; the API allows it on the
// administrator surface only, and the user surface keeps refusing a query sent by POST.
//
// The application is built as main.ts builds it, over fixture routers whose one query answers the
// text it is given, and listened on an ephemeral port. The calls go through raw `fetch`es and
// through the tRPC client the panel uses, with its link's `methodOverride: 'POST'`.
import type { INestApplication } from '@nestjs/common';
import { createTRPCUntypedClient, httpLink } from '@trpc/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createApplication, surfacePaths } from '../app.module.js';
import type { CatalogServices } from '../modules/catalog/index.js';
import type { IdentityServices } from '../modules/identity/index.js';
import type { VerificationServices } from '../modules/verification/index.js';
import { RateLimiter } from '../platform/guards/rate-limit.guard.js';
import { createLogger } from '../platform/logging/logger.js';
import type { AdminSurfaceServices } from './context.js';
import {
  adminPublicProcedure,
  createAdminRouter,
  createAppRouter,
  publicProcedure,
} from './procedures.js';
import {
  unusedBookingServices,
  unusedCertificationServices,
  unusedChatServices,
  unusedCheckoutServices,
  unusedDiscoveryServices,
  unusedModerationServices,
  unusedSessionsServices,
  unusedTeacherProfileServices,
} from './services.fixtures.js';

const unused = <T>(): T => ({}) as T;

// The limits are tested in platform/guards; this limiter admits every call.
const rateLimiter = new RateLimiter({
  settings: { read: async (_key, schema) => schema.parse({ limit: 1_000, window_seconds: 60 }) },
  counter: { hit: async () => 1 },
  subjectKey: Buffer.alloc(32),
});

const anyone = { key: 'rate_limit_search', subjectOf: () => 'anyone' } as const;
const search = z.object({ text: z.string() });

/** The one query of each surface: it answers the text it was sent. */
const user = createAppRouter({
  search: publicProcedure({ input: search, output: z.string(), rateLimit: anyone }).query(
    ({ input }) => input.text,
  ),
});
const administrator = createAdminRouter({
  search: adminPublicProcedure({ input: search, output: z.string(), rateLimit: anyone }).query(
    ({ input }) => input.text,
  ),
});

const TEXT = 'a searched name';

let application: INestApplication;
let origin: string;

beforeAll(async () => {
  application = await createApplication({
    log: createLogger({ level: 'fatal', destination: { write: () => undefined } }),
    readiness: { databaseReachable: async () => {} },
    securityHeaders: { allowedOrigins: [], mode: 'test' },
    maxRequestBodyBytes: 1024,
    administration: {
      transactions: { run: () => Promise.reject(new Error('no transaction is expected here')) },
      auditWriter: { write: () => Promise.reject(new Error('no audit is expected here')) },
    },
    rateLimiter,
    sessions: { user: async () => null, admin: async () => null },
    services: {
      settings: {
        read: async () => {
          throw new Error('no setting is read here');
        },
      },
      publicConfig: { supportEmail: 'support@ijazah.invalid', paymentMode: 'test' as const },
      subjects: { listActive: async () => [] },
      identity: unused<IdentityServices>(),
      verification: unused<VerificationServices>(),
      catalog: unused<CatalogServices>(),
      teacherProfile: unusedTeacherProfileServices,
      discovery: unusedDiscoveryServices,
      booking: unusedBookingServices,
      checkout: unusedCheckoutServices,
      sessions: unusedSessionsServices,
      chat: unusedChatServices,
      certification: unusedCertificationServices,
      moderation: unusedModerationServices,
    },
    adminServices: unused<AdminSurfaceServices>(),
    surfaces: { app: user, admin: administrator },
  });
  await application.listen(0, '127.0.0.1');
  origin = (await application.getUrl()).replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await application?.close();
});

interface Answer {
  readonly status: number;
  readonly body: unknown;
}

/** A POST of `input` as JSON to the query `search` of the surface mounted at `path`. */
async function postQuery(path: string, input: unknown): Promise<Answer> {
  const response = await fetch(`${origin}${path}/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return { status: response.status, body: (await response.json()) as unknown };
}

describe('the administrator surface takes a query by POST, its input in the body (T147)', () => {
  it('answers an administrator query sent by POST with its input in the body', async () => {
    expect(await postQuery(surfacePaths.admin, { text: TEXT })).toEqual({
      status: 200,
      body: { result: { data: TEXT } },
    });

    // The panel's own client, its link overriding the method, sends no input in the URL.
    const urls: string[] = [];
    const client = createTRPCUntypedClient<typeof administrator>({
      links: [
        httpLink({
          url: `${origin}${surfacePaths.admin}`,
          methodOverride: 'POST',
          fetch: (input, init) => {
            urls.push(String(input));
            return fetch(input, init as RequestInit);
          },
        }),
      ],
    });
    await expect(client.query('search', { text: TEXT })).resolves.toBe(TEXT);
    expect(urls).toEqual([`${origin}${surfacePaths.admin}/search`]);
  });

  it('keeps refusing a query sent by POST on the user surface, as a procedure it does not have', async () => {
    expect(await postQuery(surfacePaths.app, { text: TEXT })).toEqual({
      status: 404,
      body: { error: expect.objectContaining({ code: 'NOT_FOUND' }) },
    });
    // The same query by GET is still answered there.
    const input = encodeURIComponent(JSON.stringify({ text: TEXT }));
    const response = await fetch(`${origin}${surfacePaths.app}/search?input=${input}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: { data: TEXT } });
  });
});
