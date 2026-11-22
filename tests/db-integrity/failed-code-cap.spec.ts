// R1a (002:T173; SRS §3.14 «Failed one-time codes before issuing stops», DEC-100): the cap's two
// operations on the process's real limiter (`createRateLimiter`, as `main.ts` builds it), counting
// in the Redis at `REDIS_URL`. `countEvent` counts in the fixed window its first event opens and
// answers the digest for the event that fills the limit only; `isCapped` reads the count with one
// GET script, so asking never counts and never stretches the window, and once the window's key has
// expired the cap is open again. The limit is a setting read on every call (an in-memory reader
// here, at a one-second window so the expiry is seen); the subject is fresh per run, its counter
// key the subject's HMAC under a key drawn for this file, so no earlier run's count is met. The key
// expires with its window; nothing else is written.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomBytes, randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { createRateLimiter } from '../../apps/api/src/platform/guards/rate-limit.guard';
import { createLogger } from '../../apps/api/src/platform/logging/logger';
import {
  SettingError,
  type SettingsReader,
} from '../../apps/api/src/platform/settings/settings-reader';

const CAP = 'rate_limit_failed_one_time_code';

function redisUrl(): string {
  const url = process.env.REDIS_URL;
  if (url === undefined || url === '') throw new Error('REDIS_URL is not set in the environment');
  return url;
}

function limiterAt(limit: number, windowSeconds: number) {
  const settings: SettingsReader = {
    async read(key, schema) {
      if (key !== CAP) throw new SettingError(key, 'missing');
      return schema.parse({ limit, window_seconds: windowSeconds });
    },
  };
  return createRateLimiter({
    redisUrl: redisUrl(),
    settings,
    log: createLogger({ level: 'warn', destination: { write: () => undefined } }),
    encryptionKey: randomBytes(32).toString('base64'),
  });
}

describe('the failed codes’ cap over the real Redis counter (T173)', () => {
  it('counts each event, reads without counting, and caps at the setting’s limit', async () => {
    const limiter = limiterAt(3, 60);
    const subject = { kind: 'identifier', value: `password_reset:${randomUUID()}` } as const;

    await expect(limiter.isCapped(CAP, subject)).resolves.toBe(false);
    expect(await limiter.countEvent(CAP, subject)).toBeUndefined();
    expect(await limiter.countEvent(CAP, subject)).toBeUndefined();
    for (let read = 0; read < 5; read += 1) {
      await expect(limiter.isCapped(CAP, subject)).resolves.toBe(false);
    }
    expect(await limiter.countEvent(CAP, subject)).toMatch(/^[0-9a-f]{64}$/);
    await expect(limiter.isCapped(CAP, subject)).resolves.toBe(true);
    expect(await limiter.countEvent(CAP, subject)).toBeUndefined();
    await expect(limiter.isCapped(CAP, subject)).resolves.toBe(true);
  });

  it('opens again once the window the first event opened has ended, reads never stretching it', async () => {
    const limiter = limiterAt(1, 1);
    const subject = { kind: 'identifier', value: `signup:${randomUUID()}` } as const;

    await limiter.countEvent(CAP, subject);
    await expect(limiter.isCapped(CAP, subject)).resolves.toBe(true);
    await vi.waitFor(
      async () => {
        await expect(limiter.isCapped(CAP, subject)).resolves.toBe(false);
      },
      { timeout: 4_000, interval: 100 },
    );
  });
});
