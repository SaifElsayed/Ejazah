// T025 — the `purge-otp-codes` sweep (FR-107, R-API-14, research R-118).
//
// A code is a row until it is consumed or has been expired longer than `otp_purge_after_hours`;
// the sweep deletes those and nothing else, through the identity module's store, reading its
// window through the settings reader on every run (FR-034). Its double-run assertion (T112's
// pattern) calls the handler directly over an in-memory store: two runs leave what one run leaves.
import { describe, expect, it } from 'vitest';
import { SettingError, type SettingsReader } from '../platform/settings/settings-reader.js';
import { runOnceAndTwice } from './double-run.js';
import {
  OTP_PURGE_AFTER_HOURS_SETTING,
  type OtpCodePurgeStore,
  purgeOtpCodes,
} from './purge-otp-codes.js';

const NOW = new Date('2026-10-08T09:00:00Z');

interface Row {
  readonly id: string;
  readonly consumedAt: Date | null;
  readonly expiresAt: Date;
}

function row(id: string, expiresAt: string, consumedAt: string | null = null): Row {
  return {
    id,
    expiresAt: new Date(expiresAt),
    consumedAt: consumedAt ? new Date(consumedAt) : null,
  };
}

function storeOf(rows: readonly Row[]): OtpCodePurgeStore & { rows: Row[] } {
  return {
    rows: [...rows],
    async removeConsumedOrExpiredBefore(expiredBefore) {
      const before = this.rows.length;
      this.rows = this.rows.filter(
        ({ consumedAt, expiresAt }) => consumedAt === null && expiresAt >= expiredBefore,
      );
      return before - this.rows.length;
    },
  };
}

function settingsOf(hours: unknown): SettingsReader & { keys: string[] } {
  return {
    keys: [],
    async read(key, schema) {
      this.keys.push(key);
      if (key !== OTP_PURGE_AFTER_HOURS_SETTING) throw new SettingError(key, 'missing');
      const parsed = schema.safeParse(hours);
      if (!parsed.success) throw new SettingError(key, 'invalid');
      return parsed.data;
    },
  };
}

function world() {
  const store = storeOf([
    row('consumed', '2026-10-09T00:00:00Z', '2026-10-08T08:50:00Z'),
    row('expired-long-ago', '2026-10-07T08:59:59Z'),
    row('expired-at-the-window', '2026-10-07T09:00:00Z'),
    row('expired-recently', '2026-10-08T08:00:00Z'),
    row('live', '2026-10-08T09:10:00Z'),
  ]);
  const settings = settingsOf(24);
  const job = purgeOtpCodes({ store, settings, clock: () => NOW });
  return { store, settings, job };
}

describe('purge-otp-codes (T025, FR-107)', () => {
  it('deletes the consumed codes and those expired longer ago than the window, and keeps the rest', async () => {
    const { store, job } = world();
    await job.handle({});
    expect(store.rows.map(({ id }) => id)).toEqual([
      'expired-at-the-window',
      'expired-recently',
      'live',
    ]);
  });

  it('reads its window through the settings reader on every run, and fails closed without it', async () => {
    const { settings, job } = world();
    await job.handle({});
    await job.handle({});
    expect(settings.keys).toEqual([OTP_PURGE_AFTER_HOURS_SETTING, OTP_PURGE_AFTER_HOURS_SETTING]);

    const store = storeOf([row('expired-long-ago', '2026-10-01T00:00:00Z')]);
    const missing = purgeOtpCodes({ store, settings: settingsOf(undefined), clock: () => NOW });
    await expect(missing.handle({})).rejects.toBeInstanceOf(SettingError);
    expect(store.rows).toHaveLength(1);
    const invalid = purgeOtpCodes({ store, settings: settingsOf(0), clock: () => NOW });
    await expect(invalid.handle({})).rejects.toBeInstanceOf(SettingError);
  });

  it('runs on a schedule, with no payload', () => {
    const { job } = world();
    expect(job.name).toBe('purge-otp-codes');
    expect(job.schedule).toEqual(expect.any(String));
  });

  it('leaves after two runs what it leaves after one (R-API-14)', async () => {
    const { once, twice } = await runOnceAndTwice({
      world,
      run: async ({ job }) => job.handle({}),
      observe: ({ store }) => store.rows.map(({ id }) => id),
    });
    expect(once).toEqual(['expired-at-the-window', 'expired-recently', 'live']);
    expect(twice).toEqual(once);
  });
});
