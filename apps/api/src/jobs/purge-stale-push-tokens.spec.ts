// T025 — the `purge-stale-push-tokens` sweep (FR-107, R-API-14, research R-118).
//
// A device token not seen for longer than `push_token_stale_days` is deleted, through the identity
// module's store; the window is read through the settings reader on every run (FR-034). The
// double-run assertion (T112's pattern) calls the handler directly over an in-memory store.
import { describe, expect, it } from 'vitest';
import { SettingError, type SettingsReader } from '../platform/settings/settings-reader.js';
import { runOnceAndTwice } from './double-run.js';
import {
  PUSH_TOKEN_STALE_DAYS_SETTING,
  type PushTokenPurgeStore,
  purgeStalePushTokens,
} from './purge-stale-push-tokens.js';

const NOW = new Date('2026-10-08T09:00:00Z');

interface Row {
  readonly id: string;
  readonly lastSeenAt: Date;
}

function storeOf(rows: readonly Row[]): PushTokenPurgeStore & { rows: Row[] } {
  return {
    rows: [...rows],
    async removeNotSeenSince(staleBefore) {
      const before = this.rows.length;
      this.rows = this.rows.filter(({ lastSeenAt }) => lastSeenAt >= staleBefore);
      return before - this.rows.length;
    },
  };
}

function settingsOf(days: unknown): SettingsReader & { keys: string[] } {
  return {
    keys: [],
    async read(key, schema) {
      this.keys.push(key);
      if (key !== PUSH_TOKEN_STALE_DAYS_SETTING) throw new SettingError(key, 'missing');
      const parsed = schema.safeParse(days);
      if (!parsed.success) throw new SettingError(key, 'invalid');
      return parsed.data;
    },
  };
}

function world() {
  const store = storeOf([
    { id: 'stale', lastSeenAt: new Date('2026-07-10T08:59:59Z') },
    { id: 'at-the-window', lastSeenAt: new Date('2026-07-10T09:00:00Z') },
    { id: 'recent', lastSeenAt: new Date('2026-10-01T00:00:00Z') },
  ]);
  const settings = settingsOf(90);
  const job = purgeStalePushTokens({ store, settings, clock: () => NOW });
  return { store, settings, job };
}

describe('purge-stale-push-tokens (T025, FR-107)', () => {
  it('deletes the tokens not seen for longer than the window and keeps the rest', async () => {
    const { store, job } = world();
    await job.handle({});
    expect(store.rows.map(({ id }) => id)).toEqual(['at-the-window', 'recent']);
  });

  it('reads its window through the settings reader, and fails closed without it', async () => {
    const { settings, job } = world();
    await job.handle({});
    expect(settings.keys).toEqual([PUSH_TOKEN_STALE_DAYS_SETTING]);
    const store = storeOf([{ id: 'stale', lastSeenAt: new Date('2026-01-01T00:00:00Z') }]);
    const missing = purgeStalePushTokens({
      store,
      settings: settingsOf(undefined),
      clock: () => NOW,
    });
    await expect(missing.handle({})).rejects.toBeInstanceOf(SettingError);
    expect(store.rows).toHaveLength(1);
  });

  it('runs on a schedule, with no payload', () => {
    const { job } = world();
    expect(job.name).toBe('purge-stale-push-tokens');
    expect(job.schedule).toEqual(expect.any(String));
  });

  it('leaves after two runs what it leaves after one (R-API-14)', async () => {
    const { once, twice } = await runOnceAndTwice({
      world,
      run: async ({ job }) => job.handle({}),
      observe: ({ store }) => store.rows.map(({ id }) => id),
    });
    expect(once).toEqual(['at-the-window', 'recent']);
    expect(twice).toEqual(once);
  });
});
