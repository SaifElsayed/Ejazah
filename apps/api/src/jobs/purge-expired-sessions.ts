// T025: the `purge-expired-sessions` sweep (FR-107, FR-135, research R-118; ARCHITECTURE §5 jobs).
//
// Deletes every session row past its `expires_at`, and every row revoked longer ago than
// `session_purge_after_days`, of both principals: the user rows through the identity module's
// store and the administrator rows through the admin module's, each handed in by `worker.ts` as
// the re-encryption job's columns are, since a job may not import `modules/admin`
// (`boundaries/no-upward-admin-import`, R-API-4). A revoked row is kept for the window so reuse
// detection has something to find (R-101: a rotated refresh token presented again names the
// session it revoked); an expired row serves nothing once its refresh token can no longer be
// presented, so it goes at once (R-118; a session is a credential, not a record, ERD §6). The
// window is read through the settings reader on every run (FR-034). Idempotent by construction
// (R-API-14); it runs every hour.
import { z } from 'zod';
import type { SettingsReader } from '../platform/settings/settings-reader.js';
import { defineJob, type Job } from './job.js';
import { instantBefore, SECONDS_PER_DAY } from './window.js';

/** The settings key of how long a revoked session is kept (data-model.md §4). */
export const SESSION_PURGE_AFTER_DAYS_SETTING = 'session_purge_after_days';

const days = z.int().positive();

/** What the sweep asks of a module that owns a session table. */
export interface SessionPurgeStore {
  /** Deletes the rows expired at `now` and those revoked before `revokedBefore`; how many. */
  removeExpiredOrRevokedBefore(now: Date, revokedBefore: Date): Promise<number>;
}

export interface PurgeExpiredSessionsOptions {
  readonly stores: {
    /** `user_sessions`, the identity module's. */
    readonly user: SessionPurgeStore;
    /** `admin_sessions`, the admin module's. */
    readonly admin: SessionPurgeStore;
  };
  readonly settings: SettingsReader;
  readonly clock?: () => Date;
}

export function purgeExpiredSessions({
  stores,
  settings,
  clock = () => new Date(),
}: PurgeExpiredSessionsOptions): Job {
  return defineJob({
    name: 'purge-expired-sessions',
    payload: z.object({}),
    schedule: '45 * * * *',
    run: async () => {
      const window = await settings.read(SESSION_PURGE_AFTER_DAYS_SETTING, days);
      const now = clock();
      const revokedBefore = instantBefore(now, window * SECONDS_PER_DAY);
      await stores.user.removeExpiredOrRevokedBefore(now, revokedBefore);
      await stores.admin.removeExpiredOrRevokedBefore(now, revokedBefore);
    },
  });
}
