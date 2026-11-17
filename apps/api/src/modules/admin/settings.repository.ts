// T113: the queries behind settings (FR-034). `settings` is the admin module's table (R-API-6).
// Reading is `valueOf`. Writing is `update`, the one writer (T002 of specs/005-certification,
// research R-410): R-PROC-11 lets settings change only from the admin panel, prospectively and
// audit-logged, and that page (T024) is its only caller. Constructed over a transaction, so the
// change and its audit entry commit together.
import type { Prisma } from '@prisma/client';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { isRegisteredSetting } from '../../platform/settings/registry.js';
import { SettingError } from '../../platform/settings/settings-reader.js';
import type { StoredSettings } from './settings.service.js';

type Client = Pick<Transaction, 'setting'>;

export class SettingsRepository implements StoredSettings {
  readonly #database: Client;

  constructor(database: Client) {
    this.#database = database;
  }

  /** The stored JSON value, or undefined when the key is not stored. */
  async valueOf(key: string): Promise<unknown> {
    const row = await this.#database.setting.findUnique({
      where: { key },
      select: { value: true },
    });
    return row === null ? undefined : row.value;
  }

  /**
   * Replaces the value stored under `key`. Refused with `SettingError` (the key, never the value)
   * when the registry does not name the key, before any query, or when no row holds it, so a
   * change is never reported done that wrote nothing. The value's bounds are the caller's
   * (`settingRefusal` in the registry).
   */
  async update(key: string, value: Prisma.InputJsonValue): Promise<void> {
    if (!isRegisteredSetting(key)) throw new SettingError(key, 'missing');
    const { count } = await this.#database.setting.updateMany({ where: { key }, data: { value } });
    if (count === 0) throw new SettingError(key, 'missing');
  }
}
