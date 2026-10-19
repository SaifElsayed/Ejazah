// T025: the `purge-otp-codes` sweep (FR-107, research R-118; ARCHITECTURE §5 jobs).
//
// Deletes every one-time code that was consumed, and every code expired longer ago than
// `otp_purge_after_hours`, through the identity module's store (R-API-6: the module that owns
// `otp_codes`). The window is read through the settings reader on every run (FR-034), never held
// as a constant. Idempotent by construction: a second run finds nothing more to delete (R-API-14).
// A consumed code is already refused by the service, and an expired one by its own expiry, so the
// cadence decides only how long dead rows take space; it runs every hour.
import { z } from 'zod';
import type { SettingsReader } from '../platform/settings/settings-reader.js';
import { defineJob, type Job } from './job.js';
import { instantBefore, SECONDS_PER_HOUR } from './window.js';

/** The settings key of the window a code is kept after its expiry (data-model.md §4). */
export const OTP_PURGE_AFTER_HOURS_SETTING = 'otp_purge_after_hours';

const hours = z.int().positive();

/** What the sweep asks of the identity module. */
export interface OtpCodePurgeStore {
  /** Deletes the consumed codes and those whose expiry is before `expiredBefore`; how many. */
  removeConsumedOrExpiredBefore(expiredBefore: Date): Promise<number>;
}

export interface PurgeOtpCodesOptions {
  readonly store: OtpCodePurgeStore;
  readonly settings: SettingsReader;
  /** The clock; the system clock unless a spec sets one. */
  readonly clock?: () => Date;
}

export function purgeOtpCodes({
  store,
  settings,
  clock = () => new Date(),
}: PurgeOtpCodesOptions): Job {
  return defineJob({
    name: 'purge-otp-codes',
    payload: z.object({}),
    schedule: '15 * * * *',
    run: async () => {
      const window = await settings.read(OTP_PURGE_AFTER_HOURS_SETTING, hours);
      await store.removeConsumedOrExpiredBefore(instantBefore(clock(), window * SECONDS_PER_HOUR));
    },
  });
}
