// T113: the one query behind settings reading (FR-034). `settings` is the admin module's table
// (R-API-6); this file reads it and never writes it (R-PROC-11: settings change in the admin
// panel, audit-logged).
import type { Database } from '../../platform/db/prisma.repository.js';
import type { StoredSettings } from './settings.service.js';

export class SettingsRepository implements StoredSettings {
  readonly #database: Database;

  constructor(database: Database) {
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
}
