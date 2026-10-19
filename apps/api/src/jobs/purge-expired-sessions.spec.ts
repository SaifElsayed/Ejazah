// T025 — the `purge-expired-sessions` sweep (FR-107, FR-135, R-API-14, research R-118).
//
// User and administrator session rows past `expires_at`, and rows revoked longer ago than
// `session_purge_after_days`, are deleted; a revoked row is kept for that window so reuse detection
// (R-101) has something to find. The identity module's store holds the user rows and the admin
// module's the administrator rows, both handed in by `worker.ts`, since a job may not import
// `modules/admin` (`boundaries/no-upward-admin-import`). The window is read through the settings
// reader on every run (FR-034). The double-run assertion (T112's pattern) calls the handler
// directly over in-memory stores.
import { describe, expect, it } from 'vitest';
import { SettingError, type SettingsReader } from '../platform/settings/settings-reader.js';
import { runOnceAndTwice } from './double-run.js';
import {
  SESSION_PURGE_AFTER_DAYS_SETTING,
  type SessionPurgeStore,
  purgeExpiredSessions,
} from './purge-expired-sessions.js';

const NOW = new Date('2026-10-08T09:00:00Z');

interface Row {
  readonly id: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

function row(id: string, expiresAt: string, revokedAt: string | null = null): Row {
  return { id, expiresAt: new Date(expiresAt), revokedAt: revokedAt ? new Date(revokedAt) : null };
}

function storeOf(rows: readonly Row[]): SessionPurgeStore & { rows: Row[] } {
  return {
    rows: [...rows],
    async removeExpiredOrRevokedBefore(now, revokedBefore) {
      const before = this.rows.length;
      this.rows = this.rows.filter(
        ({ expiresAt, revokedAt }) =>
          expiresAt > now && (revokedAt === null || revokedAt >= revokedBefore),
      );
      return before - this.rows.length;
    },
  };
}

function settingsOf(days: unknown): SettingsReader & { keys: string[] } {
  return {
    keys: [],
    async read(key, schema) {
      this.keys.push(key);
      if (key !== SESSION_PURGE_AFTER_DAYS_SETTING) throw new SettingError(key, 'missing');
      const parsed = schema.safeParse(days);
      if (!parsed.success) throw new SettingError(key, 'invalid');
      return parsed.data;
    },
  };
}

function rows(): Row[] {
  return [
    row('expired', '2026-10-08T08:59:59Z'),
    row('expires-now', '2026-10-08T09:00:00Z'),
    row('revoked-long-ago', '2026-11-01T00:00:00Z', '2026-09-08T08:59:59Z'),
    row('revoked-at-the-window', '2026-11-01T00:00:00Z', '2026-09-08T09:00:00Z'),
    row('revoked-yesterday', '2026-11-01T00:00:00Z', '2026-10-07T09:00:00Z'),
    row('live', '2026-11-01T00:00:00Z'),
  ];
}

const KEPT = ['revoked-at-the-window', 'revoked-yesterday', 'live'];

function world() {
  const user = storeOf(rows());
  const admin = storeOf(rows().map((r) => ({ ...r, id: `admin-${r.id}` })));
  const settings = settingsOf(30);
  const job = purgeExpiredSessions({ stores: { user, admin }, settings, clock: () => NOW });
  return { user, admin, settings, job };
}

describe('purge-expired-sessions (T025, FR-107, FR-135)', () => {
  it('deletes the expired rows and those revoked longer ago than the window, of both principals', async () => {
    const { user, admin, job } = world();
    await job.handle({});
    expect(user.rows.map(({ id }) => id)).toEqual(KEPT);
    expect(admin.rows.map(({ id }) => id)).toEqual(KEPT.map((id) => `admin-${id}`));
  });

  it('keeps a recently revoked row, so a reused refresh token is still detected (R-101)', async () => {
    const { user, job } = world();
    await job.handle({});
    expect(user.rows.map(({ id }) => id)).toContain('revoked-yesterday');
  });

  it('reads its window through the settings reader, and fails closed without it', async () => {
    const { settings, job } = world();
    await job.handle({});
    expect(settings.keys).toEqual([SESSION_PURGE_AFTER_DAYS_SETTING]);
    const user = storeOf([row('expired', '2026-01-01T00:00:00Z')]);
    const admin = storeOf([]);
    const missing = purgeExpiredSessions({
      stores: { user, admin },
      settings: settingsOf(undefined),
      clock: () => NOW,
    });
    await expect(missing.handle({})).rejects.toBeInstanceOf(SettingError);
    expect(user.rows).toHaveLength(1);
  });

  it('runs on a schedule, with no payload', () => {
    const { job } = world();
    expect(job.name).toBe('purge-expired-sessions');
    expect(job.schedule).toEqual(expect.any(String));
  });

  it('leaves after two runs what it leaves after one (R-API-14)', async () => {
    const { once, twice } = await runOnceAndTwice({
      world,
      run: async ({ job }) => job.handle({}),
      observe: ({ user, admin }) => [user.rows.map(({ id }) => id), admin.rows.map(({ id }) => id)],
    });
    expect(once).toEqual([KEPT, KEPT.map((id) => `admin-${id}`)]);
    expect(twice).toEqual(once);
  });
});
