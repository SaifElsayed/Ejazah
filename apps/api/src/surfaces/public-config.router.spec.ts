// T038 — `platform.publicConfig` (FR-145, ADR 0021 D4; app-surface.md "`platform` and `catalog`").
//
// One public, rate-limited query answering `{ supportEmail, termsVersion, checkout }`: the address
// from the configuration (`SUPPORT_EMAIL`, never an admin setting), the version from the
// `terms_version` setting and (T002, FR-383, FR-412) the four checkout numbers the phone polls by,
// each from its setting, all read through the services the request context carries, so the router
// stays a static value the contract snapshot reads. It is a query, so an HTTP cache may hold it;
// the apps cache the last value and never block start-up on it (the phone foundation, B6).
import { describe, expect, it, vi } from 'vitest';
import type { RateLimiter } from '../platform/guards/rate-limit.guard.js';
import { createLogger } from '../platform/logging/logger.js';
import { SettingError, type SettingsReader } from '../platform/settings/settings-reader.js';
import { PUBLIC_PAGE_RATE_LIMIT } from '../platform/web/route.js';
import { type AppServices, createAppContext } from './context.js';
import { createAppCallerFactory, createAppRouter } from './procedures.js';
import { platformRouter } from './public-config.router.js';
import {
  unusedBookingServices,
  unusedCatalogServices,
  unusedCertificationServices,
  unusedChatServices,
  unusedCheckoutServices,
  unusedDiscoveryServices,
  unusedIdentityServices,
  unusedSessionsServices,
  unusedTeacherProfileServices,
  unusedVerificationServices,
} from './services.fixtures.js';

const log = createLogger({ level: 'info', destination: { write: () => undefined } });
const CLIENT = '203.0.113.9';

// The checkout numbers differ from the seeded defaults, so the answer can only come from the rows.
const STORED: Readonly<Record<string, unknown>> = {
  terms_version: '2026-10',
  checkout_confirmation_timeout_seconds: 20,
  checkout_processing_poll_seconds: 3,
  checkout_confirming_poll_seconds: 45,
  checkout_confirming_poll_window_minutes: 12,
  // 003:T104 (Q-A3 (a)): not the seed's 70, so the answer can only come from the row.
  teacher_share_percent: 65,
};

const CHECKOUT_KEYS = [
  'checkout_confirmation_timeout_seconds',
  'checkout_processing_poll_seconds',
  'checkout_confirming_poll_seconds',
  'checkout_confirming_poll_window_minutes',
] as const;

/** The stored rows; a key whose value is `undefined` is not stored. */
function settingsOf(stored: Readonly<Record<string, unknown>>): SettingsReader {
  return {
    read: async (key, schema) => {
      if (stored[key] === undefined) throw new SettingError(key, 'missing');
      const parsed = schema.safeParse(stored[key]);
      if (!parsed.success) throw new SettingError(key, 'invalid');
      return parsed.data;
    },
  };
}

function fixture(
  changes: Readonly<Record<string, unknown>> = {},
  publicConfig: AppServices['publicConfig'] = {
    supportEmail: 'support@ijazah.invalid',
    paymentMode: 'test',
  },
) {
  const check = vi.fn(async () => undefined);
  const rateLimiter = { check } as unknown as RateLimiter;
  const services: AppServices = {
    settings: settingsOf({ ...STORED, ...changes }),
    publicConfig,
    subjects: {
      listActive: async () => {
        throw new Error('not read here');
      },
    },
    identity: unusedIdentityServices,
    verification: unusedVerificationServices,
    catalog: unusedCatalogServices,
    teacherProfile: unusedTeacherProfileServices,
    discovery: unusedDiscoveryServices,
    booking: unusedBookingServices,
    checkout: unusedCheckoutServices,
    sessions: unusedSessionsServices,
    chat: unusedChatServices,
    certification: unusedCertificationServices,
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
    await expect(caller.platform.publicConfig()).resolves.toMatchObject({
      supportEmail: 'support@ijazah.invalid',
      termsVersion: '2026-10',
    });
  });

  it('answers the four checkout numbers the phone polls by, each from its setting (T002, FR-383, FR-412)', async () => {
    const { caller } = fixture();
    await expect(caller.platform.publicConfig()).resolves.toEqual({
      supportEmail: 'support@ijazah.invalid',
      termsVersion: '2026-10',
      checkout: {
        confirmationTimeoutSeconds: 20,
        processingPollSeconds: 3,
        confirmingPollSeconds: 45,
        confirmingPollWindowMinutes: 12,
      },
      teacherSharePercent: 65,
      paymentMode: 'test',
    });
  });

  it('answers the payment mode the server runs in, so every app shows «نسخة تجريبية» in test mode (003:T109)', async () => {
    const live = fixture({}, { supportEmail: 'support@ijazah.invalid', paymentMode: 'live' });
    await expect(live.caller.platform.publicConfig()).resolves.toMatchObject({ paymentMode: 'live' });
    await expect(fixture().caller.platform.publicConfig()).resolves.toMatchObject({
      paymentMode: 'test',
    });
  });

  it('fails closed when the payment mode is not wired, never answering a mode of its own (003:T109)', async () => {
    const unwired = fixture({}, { supportEmail: 'support@ijazah.invalid' });
    await expect(unwired.caller.platform.publicConfig()).rejects.toThrow();
  });

  it("answers the teacher's share rate from its setting, so the package editor shows the share as the price is typed (003:T104, Q-A3 (a))", async () => {
    const { caller } = fixture();
    await expect(caller.platform.publicConfig()).resolves.toMatchObject({ teacherSharePercent: 65 });
    await expect(
      fixture({ teacher_share_percent: 0 }).caller.platform.publicConfig(),
    ).resolves.toMatchObject({ teacherSharePercent: 0 });
  });

  it("fails closed when the teacher's share rate is not stored or is not a whole percent from 0 to 100 (003:T104)", async () => {
    for (const value of [undefined, -1, 101, 70.5, '70']) {
      await expect(
        fixture({ teacher_share_percent: value }).caller.platform.publicConfig(),
      ).rejects.toMatchObject({ cause: expect.any(SettingError) });
    }
  });

  it('is public and counts the client address under rate_limit_public_page (T170)', async () => {
    const { caller, check, router } = fixture();
    await caller.platform.publicConfig();
    expect(check).toHaveBeenCalledWith(
      PUBLIC_PAGE_RATE_LIMIT,
      { kind: 'identifier', value: CLIENT },
      'platform.publicConfig',
    );
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
    await expect(
      fixture({ terms_version: undefined }).caller.platform.publicConfig(),
    ).rejects.toMatchObject({ cause: expect.any(SettingError) });
    await expect(
      fixture({ terms_version: '' }).caller.platform.publicConfig(),
    ).rejects.toMatchObject({ cause: expect.any(SettingError) });
  });

  it.each(CHECKOUT_KEYS)(
    'fails closed when %s is not stored or is not a positive whole number (T002, FR-412)',
    async (key) => {
      for (const value of [undefined, 0, 1.5, '2']) {
        await expect(
          fixture({ [key]: value }).caller.platform.publicConfig(),
        ).rejects.toMatchObject({ cause: expect.any(SettingError) });
      }
    },
  );
});
