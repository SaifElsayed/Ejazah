// 002:T180 (R2's note; SRS FR-034, §3.14): the start-up report of the settings registry's keys that
// no row of `settings` holds. A missing key throws at its first read (`settings.service.ts`), and keys
// reach a database only through `pnpm db:seed`, so a deploy that skipped the seed is named here, when
// the process starts, rather than by the first request or job that reads the key.
//
// The stored keys are read once and compared with `SETTINGS_REGISTRY` through `registryMismatch`:
// only the registry's keys missing from the database are reported (a stored key the registry no
// longer names is not this report's). One warn line names them all, sorted; none missing, no line.
// A read that fails is one warn line naming the error's kind. It never throws and never stops the
// process: an empty store still boots (quickstart §1), now reported. Key names only, never a value.
import type { Logger } from '../../platform/logging/logger.js';
import { registryMismatch } from '../../platform/settings/registry.js';

/** Where the stored keys come from: `settings.repository.ts`, or a stand-in in a spec. */
export interface StoredSettingKeys {
  storedKeys(): Promise<readonly string[]>;
}

export async function reportMissingKeys(
  store: StoredSettingKeys,
  log: Pick<Logger, 'warn'>,
): Promise<void> {
  let stored: readonly string[];
  try {
    stored = await store.storedKeys();
  } catch (error: unknown) {
    log.warn(
      { err: error instanceof Error ? error.name : 'unknown', reason: 'settings_report_failed' },
      'The stored settings could not be read at start-up',
    );
    return;
  }
  const missing = registryMismatch(stored).notSeeded.toSorted();
  if (missing.length === 0) return;
  log.warn(
    { missing, reason: 'settings_missing' },
    'Settings of the registry are missing from the database: run pnpm db:seed',
  );
}
