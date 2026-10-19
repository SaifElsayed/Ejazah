// T025: the `purge-stale-push-tokens` sweep (FR-107, research R-118; ARCHITECTURE §5 jobs).
//
// Deletes every device push token not seen for longer than `push_token_stale_days`, through the
// identity module's store (R-API-6). A token the device has not presented for that long belongs to
// an uninstalled or re-registered app, and a delivery to it would fail; the row holds an encrypted
// token, so it is not kept longer than it serves. The window is read through the settings reader on
// every run (FR-034). Idempotent by construction (R-API-14); it runs once a day.
import { z } from 'zod';
import type { SettingsReader } from '../platform/settings/settings-reader.js';
import { defineJob, type Job } from './job.js';
import { instantBefore, SECONDS_PER_DAY } from './window.js';

/** The settings key of how long a token is kept after it was last seen (data-model.md §4). */
export const PUSH_TOKEN_STALE_DAYS_SETTING = 'push_token_stale_days';

const days = z.int().positive();

/** What the sweep asks of the identity module. */
export interface PushTokenPurgeStore {
  /** Deletes the tokens last seen before `staleBefore`; how many. */
  removeNotSeenSince(staleBefore: Date): Promise<number>;
}

export interface PurgeStalePushTokensOptions {
  readonly store: PushTokenPurgeStore;
  readonly settings: SettingsReader;
  readonly clock?: () => Date;
}

export function purgeStalePushTokens({
  store,
  settings,
  clock = () => new Date(),
}: PurgeStalePushTokensOptions): Job {
  return defineJob({
    name: 'purge-stale-push-tokens',
    payload: z.object({}),
    schedule: '30 3 * * *',
    run: async () => {
      const window = await settings.read(PUSH_TOKEN_STALE_DAYS_SETTING, days);
      await store.removeNotSeenSince(instantBefore(clock(), window * SECONDS_PER_DAY));
    },
  });
}
