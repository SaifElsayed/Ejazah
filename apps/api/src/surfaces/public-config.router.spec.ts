// T038 — `platform.publicConfig` (FR-145, ADR 0021 D4; app-surface.md "`platform` and `catalog`").
//
// One public, rate-limited query answering `{ supportEmail, termsVersion }`: the address from the
// configuration (`SUPPORT_EMAIL`, never an admin setting) and the version from the `terms_version`
// setting, both read through the services the request context carries, so the router stays a
// static value the contract snapshot reads. It is a query, so an HTTP cache may hold it; the apps
// cache the last value and never block start-up on it (the phone foundation, B6).
import { describe, expect, it, vi } from 'vitest';
import type { RateLimiter } from '../platform/guards/rate-limit.guard.js';
import { createLogger } from '../platform/logging/logger.js';
import { SettingError, type SettingsReader } from '../platform/settings/settings-reader.js';
import { PUBLIC_PAGE_RATE_LIMIT } from '../platform/web/route.js';
import { type AppServices, createAppContext } from './context.js';
import { createAppCallerFactory, createAppRouter } from './procedures.js';
import { platformRouter } from './public-config.router.js';
import { unusedIdentityServices, unusedVerificationServices } from './services.fixtures.js';

const log = createLogger({ level: 'info', destination: { write: () => undefined } });
const CLIENT = '203.0.113.9';

function settingsOf(version: unknown): SettingsReader {
  return {
    read: async (key, schema) => {
      if (key !== 'terms_version') throw new SettingError(key, 'missing');
      const parsed = schema.safeParse(version);
      if (!parsed.success) throw new SettingError(key, 'invalid');
      return parsed.data;
    },
  };
}

function fixture(version: unknown = '2026-10') {
  const check = vi.fn(async () => undefined);
  const rateLimiter = { check } as unknown as RateLimiter;
  const services: AppServices = {
    settings: settingsOf(version),
    publicConfig: { supportEmail: 'support@ijazah.invalid' },
    subjects: {
      listActive: async () => {
        throw new Error('not read here');
      },
    },
    identity: unusedIdentityServices,
    verification: unusedVerificationServices,
  };
  const router = createAppRouter({ platform: platformRouter });
  const caller = createAppCallerFactory(router)(
    createAppContext({ session: null, log, rateLimiter, clientAddress: CLIENT, services }),
  );
  return { caller, check, router };
}

describe('platform.publicConfig (T038, FR-145)', () => {
  it('answers the support address from the configuration and the terms version from the setting', async () => {
    const { caller } = fixture();
    await expect(caller.platform.publicConfig()).resolves.toEqual({
      supportEmail: 'support@ijazah.invalid',
      termsVersion: '2026-10',
    });
  });

  it('is public and counts the client address under rate_limit_public_page (T170)', async () => {
    const { caller, check, router } = fixture();
    await caller.platform.publicConfig();
    expect(check).toHaveBeenCalledWith(PUBLIC_PAGE_RATE_LIMIT, CLIENT);
    const procedures = router._def.procedures as unknown as Record<
      string,
      { _def: { meta?: { surface: string; caller?: string; rateLimit?: string } } }
    >;
    const procedure = procedures['platform.publicConfig'];
    expect(procedure?._def.meta).toEqual({
      surface: 'app',
      caller: 'public',
      rateLimit: PUBLIC_PAGE_RATE_LIMIT,
    });
  });

  it('fails closed when the terms version is not stored or is not a version (FR-034)', async () => {
    await expect(fixture(null).caller.platform.publicConfig()).rejects.toMatchObject({
      cause: expect.any(SettingError),
    });
    await expect(fixture('').caller.platform.publicConfig()).rejects.toMatchObject({
      cause: expect.any(SettingError),
    });
  });
});
