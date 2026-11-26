// T113: the queries behind settings (FR-034). `settings` is the admin module's table (R-API-6).
// Reading is `valueOf`. Writing is `update`, the one writer (T002 of specs/005-certification,
// research R-410): R-PROC-11 lets settings change only from the admin panel, prospectively and
// audit-logged, and that page (T024) is its only caller. Constructed over a transaction, so the
// change and its audit entry commit together.
//
// T024 (the follow-up under T024, B45 Q-B2 (a); the note under T024): the writer names the
// administrator (`updated_by_admin_id`, ERD `settings`) and answers the value it replaced, for the
// audit entry's `before`. LOCK, THEN READ (T005's rule 1, `platform/db/row-lock.ts`): its first
// statement is the update of `updated_by_admin_id`, whose row lock makes a concurrent change of the
// same key wait until this transaction ends; the value is read after it, so `before` is always the
// value this change replaced, never one another change replaced meanwhile (the race in
// `settings.repository.spec.ts`). No other lock is taken: the row is in no path's one order, and
// the only rows the transaction references are the administrator's (`admin_users`, key-shared by
// the two foreign keys), which no path locks before a setting.
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

  /** The stored JSON values of `keys`, by key, in one statement; a key no row holds is absent. */
  async valuesOf(keys: readonly string[]): Promise<ReadonlyMap<string, unknown>> {
    // Bounded by the registry: the caller asks its keys, under a hundred, by primary key.
    const rows = await this.#database.setting.findMany({
      where: { key: { in: [...keys] } },
      select: { key: true, value: true },
    });
    return new Map(rows.map(({ key, value }) => [key, value]));
  }

  /** Every stored key, in one statement selecting the key alone (002:T180's start-up report). */
  async storedKeys(): Promise<readonly string[]> {
    // Bounded by the seed: rows enter `settings` only through it (`update` never inserts).
    const rows = await this.#database.setting.findMany({ select: { key: true } });
    return rows.map(({ key }) => key);
  }

  /**
   * Replaces the value stored under `key` by `adminId`'s change and answers the value it replaced,
   * read under the row's lock (the head). Refused with `SettingError` (the key, never the value)
   * when the registry does not name the key, before any query, or when no row holds it, so a
   * change is never reported done that wrote nothing. The value's bounds are the caller's
   * (`settingRefusal` in the registry).
   */
  async update(
    key: string,
    value: Prisma.InputJsonValue,
    adminId: string,
  ): Promise<{ readonly before: unknown }> {
    if (!isRegisteredSetting(key)) throw new SettingError(key, 'missing');
    const { count } = await this.#database.setting.updateMany({
      where: { key },
      data: { updatedByAdminId: adminId },
    });
    if (count === 0) throw new SettingError(key, 'missing');
    const before = await this.valueOf(key);
    await this.#database.setting.updateMany({ where: { key }, data: { value } });
    return { before };
  }
}
