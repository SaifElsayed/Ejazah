// T135 — browser security headers and the CORS origin allowlist (FR-076, NFR-SEC-11, DEC-51;
// OWASP ASVS 5.0 V3).
//
// The application is built as main.ts builds it (`createApplication`, T149), over fixture routers
// with one procedure on each surface, and listened on an ephemeral port. Every case is a real HTTP
// request. A browser-facing response is any response the application sends: the user surface, the
// administrator surface, the health routes and a path outside all of them.
//
// The production mode is handed to the application directly: no production configuration loads
// through `loadConfig` while every port's only provider is its stand-in (note under T146), so
// Strict-Transport-Security in production is asserted on an application built in that mode. The
// wildcard refusal is the configuration schema's own, asserted through `loadConfig`.
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApplication, surfacePaths } from '../../app.module.js';
import {
  adminProcedure,
  createAdminRouter,
  createAppRouter,
  publicProcedure,
} from '../../surfaces/procedures.js';
import { ConfigError, loadConfig } from '../config/config.module.js';
import { createLogger } from '../logging/logger.js';
import { RateLimiter } from './rate-limit.guard.js';
import {
  unusedAdminServices,
  unusedBookingServices,
  unusedCheckoutServices,
  unusedCatalogServices,
  unusedDiscoveryServices,
  unusedIdentityServices,
  unusedTeacherProfileServices,
  unusedVerificationServices,
} from '../../surfaces/services.fixtures.js';

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
};

// No administrator session is resolved over HTTP yet, so no call here reaches auditing; T099 tests
// it. Each part refuses if it is ever reached.
const administration = {
  transactions: { run: () => Promise.reject(new Error('no administrative call is expected here')) },
  auditWriter: {
    write: () => Promise.reject(new Error('no administrative call is expected here')),
  },
};

const ADMIN = 'https://admin.ijazah.example';
const OTHER_ADMIN = 'https://ops.ijazah.example';
const STRANGER = 'https://attacker.example';

// Every public procedure declares a limit (T170); the limits themselves are rate-limit.spec.ts's,
// so this limiter admits every call.
const rateLimiter = new RateLimiter({
  settings: { read: async (_key, schema) => schema.parse({ limit: 1_000, window_seconds: 60 }) },
  counter: { hit: async () => 1 },
  subjectKey: Buffer.alloc(32),
});

const surfaces = {
  app: createAppRouter({
    ping: publicProcedure({
      input: z.void(),
      output: z.string(),
      rateLimit: { key: 'rate_limit_search', subjectOf: () => 'anyone' },
    }).query(() => 'pong'),
  }),
  admin: createAdminRouter({
    approve: adminProcedure({
      input: z.object({ teacherId: z.string() }),
      output: z.string(),
    }).mutation(() => 'approved'),
  }),
};

type Mode = 'development' | 'test' | 'production';

async function start(mode: Mode): Promise<{ application: INestApplication; origin: string }> {
  const log = createLogger({ level: 'info', destination: { write: () => undefined } });
  const application = await createApplication({
    log,
    readiness: { databaseReachable: async () => {} },
    surfaces,
    securityHeaders: { allowedOrigins: [ADMIN, OTHER_ADMIN], mode },
    maxRequestBodyBytes: 1_048_576,
    administration,
    rateLimiter,
    sessions,
    services,
    adminServices: unusedAdminServices,
  });
  await application.listen(0, '127.0.0.1');
  const origin = (await application.getUrl()).replace('[::1]', '127.0.0.1');
  return { application, origin };
}

const running: INestApplication[] = [];
let development: string;
let production: string;

beforeAll(async () => {
  const dev = await start('development');
  const prod = await start('production');
  running.push(dev.application, prod.application);
  development = dev.origin;
  production = prod.origin;
});

afterAll(async () => {
  await Promise.all(running.map((application) => application.close()));
});

const browserFacing: ReadonlyArray<{ readonly name: string; readonly path: string }> = [
  { name: 'the user surface', path: `${surfacePaths.app}/ping` },
  { name: 'the administrator surface', path: `${surfacePaths.admin}/approve` },
  { name: 'the liveness route', path: '/health' },
  { name: 'a path outside every surface', path: '/elsewhere' },
];

describe('browser security headers (T135, FR-076)', () => {
  it.each(browserFacing)('are carried by a response of $name', async ({ path }) => {
    const response = await fetch(`${development}${path}`);
    const policy = response.headers.get('content-security-policy') ?? '';

    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    // Names the framework to anyone probing it (PR #43 review, m6).
    expect(response.headers.get('x-powered-by')).toBeNull();
  });

  it('sends Strict-Transport-Security in production', async () => {
    for (const { path } of browserFacing) {
      const response = await fetch(`${production}${path}`);
      expect(response.headers.get('strict-transport-security')).toMatch(/max-age=\d+/);
    }
  });

  it('does not send Strict-Transport-Security in development, which runs over plain HTTP', async () => {
    for (const { path } of browserFacing) {
      const response = await fetch(`${development}${path}`);
      expect(response.headers.get('strict-transport-security')).toBeNull();
    }
  });
});

describe('the CORS origin allowlist (T135, FR-076)', () => {
  function preflight(origin: string): Promise<Response> {
    return fetch(`${development}${surfacePaths.admin}/approve`, {
      method: 'OPTIONS',
      headers: {
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
  }

  it('answers an allowlisted origin, on the preflight and on the request', async () => {
    for (const origin of [ADMIN, OTHER_ADMIN]) {
      const answer = await preflight(origin);
      expect(answer.headers.get('access-control-allow-origin')).toBe(origin);
      expect(answer.headers.get('access-control-allow-methods')).toContain('POST');

      const request = await fetch(`${development}${surfacePaths.app}/ping`, {
        headers: { origin },
      });
      expect(request.headers.get('access-control-allow-origin')).toBe(origin);
      expect(request.headers.get('vary')).toMatch(/origin/i);
    }
  });

  // The refusal is the absent Access-Control-Allow-Origin: without it the browser withholds the
  // answer, whatever else the preflight lists (the Fetch standard's CORS check).
  it('refuses an unlisted origin: no response grants it access', async () => {
    const answer = await preflight(STRANGER);
    expect(answer.headers.get('access-control-allow-origin')).toBeNull();

    const request = await fetch(`${development}${surfacePaths.app}/ping`, {
      headers: { origin: STRANGER },
    });
    expect(request.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('never answers with a wildcard origin', async () => {
    for (const origin of [ADMIN, STRANGER, 'null']) {
      const answer = await preflight(origin);
      expect(answer.headers.get('access-control-allow-origin')).not.toBe('*');
    }
  });
});

describe('ADMIN_ALLOWED_ORIGINS (T135, FR-076)', () => {
  // The smallest configuration that loads; only ADMIN_ALLOWED_ORIGINS varies below.
  const base: Record<string, string> = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://ijazah_app:app@localhost:5432/ijazah',
    REDIS_URL: 'redis://localhost:6379',
    ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
    PAYMENT_GATEWAY: 'fake',
    SUPPORT_EMAIL: 'support@ijazah.invalid',
  };

  function refusal(value: string): ConfigError {
    try {
      loadConfig({ ...base, ADMIN_ALLOWED_ORIGINS: value });
    } catch (error: unknown) {
      if (error instanceof ConfigError) return error;
      throw error;
    }
    throw new Error(`expected ADMIN_ALLOWED_ORIGINS=${value} to be refused`);
  }

  it.each([
    ['a bare wildcard', '*'],
    ['a wildcard beside a listed origin', `${ADMIN},*`],
    ['a wildcard subdomain', 'https://*.ijazah.example'],
  ])('refuses %s at startup, naming the key', (_, value) => {
    const error = refusal(value);
    expect(error.offendingKeys).toEqual(['ADMIN_ALLOWED_ORIGINS']);
    expect(error.message).toMatch(/wildcard/);
  });

  it.each([
    ['a path', `${ADMIN}/panel`],
    ['a trailing slash', `${ADMIN}/`],
    ['no scheme', 'admin.ijazah.example'],
    ['the null origin', 'null'],
    ['an empty entry', `${ADMIN},`],
  ])('refuses %s, accepting bare origins only', (_, value) => {
    expect(refusal(value).offendingKeys).toEqual(['ADMIN_ALLOWED_ORIGINS']);
  });

  it('reads a comma-separated list of origins', () => {
    const config = loadConfig({ ...base, ADMIN_ALLOWED_ORIGINS: `${ADMIN}, ${OTHER_ADMIN}` });
    expect(config.ADMIN_ALLOWED_ORIGINS).toEqual([ADMIN, OTHER_ADMIN]);
  });

  it('answers no origin when the value is empty or absent, as .env.example leaves it', () => {
    expect(loadConfig({ ...base, ADMIN_ALLOWED_ORIGINS: '' }).ADMIN_ALLOWED_ORIGINS).toEqual([]);
    expect(loadConfig(base).ADMIN_ALLOWED_ORIGINS).toEqual([]);
  });
});
