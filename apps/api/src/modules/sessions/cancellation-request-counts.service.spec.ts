// T025 of specs/004-sessions/tasks.md (FR-459, R-DB-4) — the cancellation-request counts over a
// recorded store: the recent period is read at each call and counted back from the database's
// clock, and the counts are the store's, passed through. Over the real table:
// `tests/db-integrity/cancellation-request-counts.spec.ts`.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import {
  CANCELLATION_REQUESTS_RECENT_DAYS_SETTING,
  type CancellationRequestCountsStore,
  createCancellationRequestCounts,
} from './cancellation-request-counts.service.js';

const tx = {} as Transaction;
const USER = '0199d0a0-0000-7000-8000-000000000c25';
const NOW = new Date('2026-11-10T12:00:00Z');

function settingsOf(days: unknown): { reader: SettingsReader; keys: string[] } {
  const keys: string[] = [];
  return {
    keys,
    reader: {
      read: async (key, schema) => {
        keys.push(key);
        return schema.parse(days);
      },
    },
  };
}

function store(asked: Array<{ userId: string; recentSince: Date }>): CancellationRequestCountsStore {
  return {
    cancellationRequestCountsOf: async (_tx, userId, recentSince) => {
      asked.push({ userId, recentSince });
      return { total: 7, recent: 2 };
    },
  };
}

describe('createCancellationRequestCounts (T025, FR-459)', () => {
  it('reads cancellation_requests_recent_days at each call and counts back that many days from the database clock', async () => {
    const asked: Array<{ userId: string; recentSince: Date }> = [];
    const { reader, keys } = settingsOf(30);
    const counts = createCancellationRequestCounts({
      settings: reader,
      clock: async () => NOW,
      store: store(asked),
    });

    expect(await counts.cancellationRequestCountsOf(tx, USER)).toEqual({ total: 7, recent: 2 });
    await counts.cancellationRequestCountsOf(tx, USER);

    expect(keys).toEqual([
      CANCELLATION_REQUESTS_RECENT_DAYS_SETTING,
      CANCELLATION_REQUESTS_RECENT_DAYS_SETTING,
    ]);
    expect(asked).toEqual([
      { userId: USER, recentSince: new Date('2026-10-11T12:00:00Z') },
      { userId: USER, recentSince: new Date('2026-10-11T12:00:00Z') },
    ]);
  });

  it('follows a changed setting on the next call, never a value held from before', async () => {
    const asked: Array<{ userId: string; recentSince: Date }> = [];
    let days = 30;
    const counts = createCancellationRequestCounts({
      settings: { read: async (_key, schema) => schema.parse(days) },
      clock: async () => NOW,
      store: store(asked),
    });
    await counts.cancellationRequestCountsOf(tx, USER);
    days = 7;
    await counts.cancellationRequestCountsOf(tx, USER);
    expect(asked.map(({ recentSince }) => recentSince.toISOString())).toEqual([
      '2026-10-11T12:00:00.000Z',
      '2026-11-03T12:00:00.000Z',
    ]);
  });

  it('refuses a recent period that is not a positive whole number of days, counting nothing', async () => {
    for (const days of [0, -1, 1.5, '30', null]) {
      const asked: Array<{ userId: string; recentSince: Date }> = [];
      const counts = createCancellationRequestCounts({
        settings: settingsOf(days).reader,
        clock: async () => NOW,
        store: store(asked),
      });
      await expect(counts.cancellationRequestCountsOf(tx, USER), String(days)).rejects.toThrow();
      expect(asked).toEqual([]);
    }
  });
});
