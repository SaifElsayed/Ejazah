// T110 — liveness and readiness answer different questions (FR-051; contracts/kernel.md "Health
// signals"; ARCHITECTURE §12).
//
// Liveness asks whether the process runs, so it never consults a dependency: a database outage
// must take the process out of rotation, not restart it. Readiness asks whether it can serve, so
// it answers 503 while the database is unreachable. Both answer a fixed `{ status }` and nothing
// else: no version, host name or dependency error text. A failed readiness check is the answer,
// not an unexpected error, so it never reaches the one error shape or error reporting. Every case
// is a real request to the application as main.ts builds it, with the readiness check faked.
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApplication, surfacePaths } from '../../app.module.js';
import { RateLimiter } from '../guards/rate-limit.guard.js';
import { createLogger } from '../logging/logger.js';
import {
  unusedIdentityServices,
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
};

// No administrator session is resolved over HTTP yet, so no call here reaches auditing; T099 tests
// it. Each part refuses if it is ever reached.
const administration = {
  transactions: { run: () => Promise.reject(new Error('no administrative call is expected here')) },
  auditWriter: {
    write: () => Promise.reject(new Error('no administrative call is expected here')),
  },
};

// The real surfaces are mounted and carry no procedure yet, so no call here is rate limited (T170).
const rateLimiter = new RateLimiter({
  settings: { read: () => Promise.reject(new Error('no rate limit is expected here')) },
  counter: { hit: () => Promise.reject(new Error('no rate limit is expected here')) },
  subjectKey: Buffer.alloc(32),
});

const secret = 'connect ECONNREFUSED 10.0.4.17:5432 (ijazah_app@db-primary)';

let reachable = true;
const readiness = {
  databaseReachable: async () => {
    if (!reachable) throw new Error(secret);
  },
};

const records: string[] = [];
let application: INestApplication;
let origin: string;

beforeAll(async () => {
  const log = createLogger({ level: 'info', destination: { write: (line) => records.push(line) } });
  application = await createApplication({
    log,
    readiness,
    securityHeaders: { allowedOrigins: [], mode: 'test' },
    maxRequestBodyBytes: 1_048_576,
    administration,
    rateLimiter,
    sessions,
    services,
  });
  await application.listen(0, '127.0.0.1');
  origin = (await application.getUrl()).replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await application?.close();
});

async function get(path: string): Promise<{ status: number; text: string }> {
  const response = await fetch(`${origin}${path}`);
  return { status: response.status, text: await response.text() };
}

describe('liveness and readiness (T110)', () => {
  it('answers liveness with 200 { status: "ok" }', async () => {
    reachable = true;
    const answer = await get('/health');
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.text)).toEqual({ status: 'ok' });
  });

  it('answers readiness with 200 { status: "ready" } while the database is reachable', async () => {
    reachable = true;
    const answer = await get('/ready');
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.text)).toEqual({ status: 'ready' });
  });

  it('answers readiness with 503 { status: "unavailable" } and nothing of the failure', async () => {
    reachable = false;
    const answer = await get('/ready');
    expect(answer.status).toBe(503);
    expect(JSON.parse(answer.text)).toEqual({ status: 'unavailable' });
    expect(answer.text).not.toContain('ECONNREFUSED');
  });

  it('keeps liveness at 200 while the database is unreachable', async () => {
    reachable = false;
    const answer = await get('/health');
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.text)).toEqual({ status: 'ok' });
  });

  it('treats a failed readiness check as the answer, not as an unexpected error', () => {
    expect(records.join('\n')).not.toContain('Unexpected');
    expect(records.join('\n')).not.toContain(secret);
  });

  it('serves both outside the two tRPC surfaces', () => {
    for (const path of ['/health', '/ready']) {
      expect(path.startsWith(surfacePaths.app)).toBe(false);
      expect(path.startsWith(surfacePaths.admin)).toBe(false);
    }
  });
});
