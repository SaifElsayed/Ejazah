// T113: settings reading, the admin module's implementation of the kernel's `SettingsReader`
// (FR-034, R-MONEY-12, R-API-4).
//
// One rule: a value is answered only when it is stored and the caller's schema accepts it;
// otherwise the read throws `SettingError` (fails closed). Nothing is cached, so a change made in
// the admin panel applies from the next read (SRS §3.14).
import { SettingError, type SettingsReader } from '../../platform/settings/settings-reader.js';
import type { z } from 'zod';

/** Where stored values come from: `settings.repository.ts`, or a fake in a spec. */
export interface StoredSettings {
  /** The stored JSON value, or undefined when the key is not stored. */
  valueOf(key: string): Promise<unknown>;
}

export class SettingsService implements SettingsReader {
  readonly #store: StoredSettings;

  constructor(store: StoredSettings) {
    this.#store = store;
  }

  async read<T>(key: string, schema: z.ZodType<T>): Promise<T> {
    const stored = await this.#store.valueOf(key);
    if (stored === undefined) throw new SettingError(key, 'missing');
    const parsed = schema.safeParse(stored);
    if (!parsed.success) throw new SettingError(key, 'invalid');
    return parsed.data;
  }
}
