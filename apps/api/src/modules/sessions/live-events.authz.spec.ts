// T063 of specs/004-sessions: who may open `live.events`, where the authorization gate reads it
// (R-MOBILE-13, `pnpm check:authz`, which reads only the specs under `apps/api/src/modules`; the
// owner's decision of 2026-11-09). The application is built as `main.ts` builds it, its surfaces
// the real ones: the real `live.events` over the real `userProcedure`, reached by a plain GET with
// no bearer, nothing of the guard mocked. The rest of who may open the channel, what a stream
// carries and what ends one are `surfaces/live.http.spec.ts`'.
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { createApplication } from '../../app.module.js';
import { RateLimiter } from '../../platform/guards/rate-limit.guard.js';
import { InProcessLiveBus } from '../../platform/live/live-bus.js';
import { LiveRegistry } from '../../platform/live/live-registry.js';
import { createLogger } from '../../platform/logging/logger.js';
import { SettingError, type SettingsReader } from '../../platform/settings/settings-reader.js';
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
} from '../../surfaces/services.fixtures.js';

const OPEN_WAIT_MS = 5_000;

const rows: Record<string, unknown> = {
  rate_limit_live_channel: { limit: 10, window_seconds: 60 },
  rate_limit_signed_in_default: { limit: 1_000, window_seconds: 60 },
  live_channel_max_connections_per_user: 3,
};
const settings: SettingsReader = {
  read: async <T>(key: string, schema: z.ZodType<T>): Promise<T> => {
    if (!(key in rows)) throw new SettingError(key, 'missing');
    return schema.parse(rows[key]);
  },
};

const log = createLogger({ level: 'info', destination: { write: () => undefined } });

let application: INestApplication;
let origin: string;
let registry: LiveRegistry;

beforeAll(async () => {
  const bus = new InProcessLiveBus();
  registry = new LiveRegistry({ bus, settings, log });
  application = await createApplication({
    log,
    readiness: { databaseReachable: async () => {} },
    securityHeaders: { allowedOrigins: [], mode: 'test' },
    maxRequestBodyBytes: 64 * 1024,
    administration: {
      transactions: { run: async (work) => work({} as never) },
      auditWriter: { write: async () => undefined },
    },
    rateLimiter: new RateLimiter({
      settings,
      counter: { hit: async () => 1, remainingMilliseconds: async () => 0 },
      subjectKey: Buffer.alloc(32, 6),
      log,
    }),
    sessions: { user: async () => null, admin: async () => null },
    services: {
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
    },
    adminServices: unusedAdminServices,
    live: { bus, registry },
  });
  await application.listen(0, '127.0.0.1');
  origin = (await application.getUrl()).replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  registry?.endAll();
  await application?.close();
});

describe('who may open the live channel, as the authorization gate reads it (T063, FR-428)', () => {
  it("refuses an anonymous caller UNAUTHENTICATED and opens no stream: 'live.events'", async () => {
    const path = 'live.events';

    const response = await fetch(`${origin}/trpc/${path}`, {
      signal: AbortSignal.timeout(OPEN_WAIT_MS),
    });
    const body = await response.text();

    const codes = body
      .split('\n\n')
      .filter((frame) => frame.includes('event: serialized-error'))
      .map((frame) => {
        const data = frame.split('\n').find((line) => line.startsWith('data: ')) ?? '';
        return (JSON.parse(data.slice('data: '.length)) as { code?: unknown }).code;
      });
    expect(codes).toEqual(['UNAUTHENTICATED']);
    expect(registry.count()).toBe(0);
  });
});
