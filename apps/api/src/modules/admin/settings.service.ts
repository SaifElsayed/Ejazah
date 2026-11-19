// T113: settings reading, the admin module's implementation of the kernel's `SettingsReader`
// (FR-034, R-MONEY-12, R-API-4).
//
// One rule: a value is answered only when it is stored and the caller's schema accepts it;
// otherwise the read throws `SettingError` (fails closed). Nothing is cached, so a change made in
// the admin panel applies from the next read (SRS §3.14).
import type { z } from 'zod';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type {
  IdempotencyService,
  JsonValue,
} from '../../platform/idempotency/idempotency.service.js';
import type { Logger } from '../../platform/logging/logger.js';
import {
  SETTINGS_REGISTRY,
  type SettingEntry,
  type SettingRefusal,
  settingRefusal,
} from '../../platform/settings/registry.js';
import { SettingError, type SettingsReader } from '../../platform/settings/settings-reader.js';

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

// T024 of specs/005-certification (FR-624; SRS FR-ADMIN-9, §3.14; research R-410; the note under
// T024, Q-X1 (a), Q-S1 (a)): the panel's `settings.list` and `settings.update`, on the
// administrator kind's transaction (contracts/admin-surface.md, `settings.*`).
//
// `list` answers every key of the kernel's registry, in its order, with its bounds, unit, group and
// SRS row and the value stored (null where no row holds it), read in one statement.
//
// `update` is refused VALIDATION_FAILED through the registry's `settingRefusal`, one code per
// reason (`unknown` on the path `key`; `invalid` and `out_of_bounds` on `value`), logged with the
// administrator, the key and the reason, before anything is keyed or written. Otherwise it is keyed
// `settings.update` on the call's transaction (`runOn`; a replay answers the first change and
// writes nothing) and writes the value as the key's schema reads it through the writer, which names
// the administrator and answers the value it replaced, read under the row's lock
// (`settings.repository.ts`). It answers the key and the values before and after, for the audit
// entry the router records. No line carries a value: a change logs the administrator and the key. A
// change applies from the next read of the key (nothing is cached), except the signed-in default's
// limit, which the limiter holds up to 60 s (`platform/guards/rate-limit.guard.ts`).

/** A value a change stores: JSON, never null (every registry schema refuses it). */
export type StoredValue = Exclude<JsonValue, null>;

/** The settings table, as the panel's two procedures reach it: `settings.repository.ts`. */
export interface SettingsWriter {
  valuesOf(keys: readonly string[]): Promise<ReadonlyMap<string, unknown>>;
  update(key: string, value: StoredValue, adminId: string): Promise<{ readonly before: unknown }>;
}

export interface SettingsAdministrationDependencies {
  /** The kernel's idempotency, keyed on the administrator kind's transaction (`runOn`). */
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'runOn'>;
  readonly log: Pick<Logger, 'info'>;
  /** The writer on the call's transaction (`new SettingsRepository(tx)`, bound in `index.ts`). */
  readonly writerOn: (tx: Transaction) => SettingsWriter;
}

/** One setting as `settings.list` answers it (contracts/admin/settings.ts, `adminSetting`). */
export interface ListedSetting extends Omit<SettingEntry, 'schema'> {
  readonly key: string;
  readonly value: JsonValue;
}

/** What a change asked: `settings.update`'s input, as its contract parsed it. */
export interface SettingChangeAsked {
  readonly key: string;
  readonly value: JsonValue;
  readonly reason: string;
  readonly idempotencyKey: string;
}

/** What a change did, for the router's audit entry and the answer; the key's stored outcome. */
export type SettingChange = {
  readonly key: string;
  readonly before: JsonValue;
  readonly after: JsonValue;
};

export interface SettingsAdministration {
  list(tx: Transaction, adminId: string): Promise<{ readonly items: readonly ListedSetting[] }>;
  update(
    tx: Transaction,
    adminId: string,
    asked: SettingChangeAsked,
  ): Promise<SettingChange & { readonly replayed: boolean }>;
}

const UPDATE_SCOPE = 'settings.update';

/** Where a refusal points: the key the registry does not name, or the value. */
const REFUSAL_PATH: Readonly<Record<SettingRefusal, 'key' | 'value'>> = {
  unknown: 'key',
  invalid: 'value',
  out_of_bounds: 'value',
};

export function createSettingsAdministration({
  idempotency,
  log,
  writerOn,
}: SettingsAdministrationDependencies): SettingsAdministration {
  return {
    list: async (tx) => {
      const keys = Object.keys(SETTINGS_REGISTRY);
      const values = await writerOn(tx).valuesOf(keys);
      const items = keys.map((key): ListedSetting => {
        const { bounds, unit, group, srsRow } = SETTINGS_REGISTRY[key] as SettingEntry;
        return { key, value: (values.get(key) ?? null) as JsonValue, bounds, unit, group, srsRow };
      });
      return { items };
    },

    update: async (tx, adminId, { key, value, reason, idempotencyKey }) => {
      const refusal = settingRefusal(key, value);
      if (refusal !== undefined) {
        log.info({ adminId, key, reason: refusal }, 'A setting change was refused');
        throw markRefusalLogged(
          new DomainError('VALIDATION_FAILED', undefined, {
            details: [{ path: REFUSAL_PATH[refusal], code: refusal }],
          }),
        );
      }
      const after = (SETTINGS_REGISTRY[key] as SettingEntry).schema.parse(value) as StoredValue;
      const { outcome, replayed } = await idempotency.runOn(
        tx,
        {
          scope: UPDATE_SCOPE,
          key: idempotencyKey,
          actorId: adminId,
          input: { key, value, reason },
        },
        async (keyed): Promise<SettingChange> => {
          const { before } = await writerOn(keyed).update(key, after, adminId);
          return { key, before: before as JsonValue, after };
        },
      );
      if (!replayed) log.info({ adminId, key }, 'A setting was changed');
      return { ...outcome, replayed };
    },
  };
}
