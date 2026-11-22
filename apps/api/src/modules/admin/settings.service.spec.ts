// T113 — the admin module reads settings for the whole system (FR-034, R-MONEY-12, R-PROC-11).
//
// Every operational number is read from the `settings` table, through the kernel's
// `SettingsReader`, and never replaced by a constant: a key that is not there, or whose value does
// not match what the caller expects, throws `SettingError`. Nothing is cached, so a change made in
// the admin panel applies to the next read (SRS §3.14, prospective changes). The store is a fake
// here; the query is one `findUnique` in `settings.repository.ts`.
//
// T024 of specs/005-certification (FR-624; research R-410; the note under T024): the panel's
// `settings.list` and `settings.update`, `createSettingsAdministration`, over a stand-in writer and
// a stand-in idempotency. `list` answers every registry key with what the registry says of it and
// the value stored; `update` is refused through the registry's `settingRefusal` (one code per
// reason, `unknown` included) before anything is keyed or written, writes the schema's value
// through the writer with the administrator, keyed `settings.update`, and answers the value before
// and after; a replay writes nothing. Lines carry the administrator, the key and the refusal, never
// a value.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DomainError } from '../../platform/errors/domain-error.js';
import { isRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { IdempotentRequest } from '../../platform/idempotency/idempotency.service.js';
import { SETTINGS_REGISTRY } from '../../platform/settings/registry.js';
import { SettingError } from '../../platform/settings/settings-reader.js';
import {
  createSettingsAdministration,
  type ListedSetting,
  SettingsService,
  type StoredSettings,
} from './settings.service.js';

function storeOf(values: Record<string, unknown>) {
  const reads: string[] = [];
  const store: StoredSettings = {
    valueOf: async (key) => {
      reads.push(key);
      return Object.hasOwn(values, key) ? values[key] : undefined;
    },
  };
  return { store, reads, values };
}

const hours = z.number().int().positive();

describe('reading a setting (T113)', () => {
  it('answers the stored value, as the caller’s schema reads it', async () => {
    const { store } = storeOf({ idempotency_key_ttl_hours: 24 });
    await expect(new SettingsService(store).read('idempotency_key_ttl_hours', hours)).resolves.toBe(
      24,
    );
  });

  it('fails closed on a key that is not stored, naming the key', async () => {
    const { store } = storeOf({});
    const failure = await new SettingsService(store)
      .read('idempotency_key_ttl_hours', hours)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SettingError);
    expect(failure).toMatchObject({ key: 'idempotency_key_ttl_hours', problem: 'missing' });
  });

  it('fails closed on a value the schema refuses, and never echoes the value', async () => {
    const { store } = storeOf({ idempotency_key_ttl_hours: 'twenty-four' });
    const failure = await new SettingsService(store)
      .read('idempotency_key_ttl_hours', hours)
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ key: 'idempotency_key_ttl_hours', problem: 'invalid' });
    expect(String((failure as Error).message)).not.toContain('twenty-four');
  });

  it('fails closed on a stored JSON null rather than reading it as no limit', async () => {
    const { store } = storeOf({ idempotency_key_ttl_hours: null });
    await expect(
      new SettingsService(store).read('idempotency_key_ttl_hours', hours),
    ).rejects.toMatchObject({ problem: 'invalid' });
  });

  it('reads the store every time, so a change applies to the next read', async () => {
    const { store, reads, values } = storeOf({ idempotency_key_ttl_hours: 24 });
    const settings = new SettingsService(store);
    await expect(settings.read('idempotency_key_ttl_hours', hours)).resolves.toBe(24);
    values['idempotency_key_ttl_hours'] = 48;
    await expect(settings.read('idempotency_key_ttl_hours', hours)).resolves.toBe(48);
    expect(reads).toEqual(['idempotency_key_ttl_hours', 'idempotency_key_ttl_hours']);
  });
});

const ADMIN = '0199d0a0-0000-7000-8000-00000000a024';
const TX = { tx: 'admin' } as never;
const KEY = 'settings-update-key-for-the-spec-02';
const REASON = 'سبب التعديل';

function administration({
  replay,
  stored = { chat_page_size: 50 },
}: { readonly replay?: unknown; readonly stored?: Record<string, unknown> } = {}) {
  const reached: unknown[][] = [];
  const keyed: IdempotentRequest[] = [];
  const lines: unknown[][] = [];
  const service = createSettingsAdministration({
    log: { info: (fields: unknown, message?: string) => void lines.push([fields, message]) },
    idempotency: {
      runOn: async <T>(
        tx: never,
        request: IdempotentRequest,
        effect: (tx: never) => Promise<T>,
      ) => {
        keyed.push(request);
        reached.push(['runOn', tx]);
        if (replay !== undefined) return { outcome: replay as T, replayed: true };
        return { outcome: await effect(tx), replayed: false };
      },
    },
    writerOn: (tx: unknown) => ({
      valuesOf: async (keys: readonly string[]) => {
        reached.push(['valuesOf', tx, keys]);
        return new Map(Object.entries(stored).filter(([key]) => keys.includes(key)));
      },
      update: async (key: string, value: unknown, adminId: string) => {
        reached.push(['update', tx, key, value, adminId]);
        return { before: stored[key] };
      },
    }),
  } as never);
  return { service, reached, keyed, lines };
}

const itemOf = (items: readonly ListedSetting[], key: string) =>
  items.find((item) => item.key === key);

describe('settings.list (T024)', () => {
  it("answers every registry key, in its order, with the registry's default, bounds, unit, group and SRS row and the value stored", async () => {
    const { service, reached } = administration({
      stored: { chat_page_size: 50, attendance_threshold_pct: 80 },
    });
    const { items } = await service.list(TX, ADMIN);
    const keys = Object.keys(SETTINGS_REGISTRY);
    expect(items.map((item) => item.key)).toEqual(keys);
    for (const item of items) {
      const entry = SETTINGS_REGISTRY[item.key]!;
      const { bounds, unit, group, srsRow } = entry;
      expect(item).toEqual({
        key: item.key,
        value: item.value,
        default: entry.default,
        bounds,
        unit,
        group,
        srsRow,
      });
    }
    expect(itemOf(items, 'chat_page_size')?.value).toBe(50);
    expect(itemOf(items, 'attendance_threshold_pct')?.value).toBe(80);
    // A key no row holds is answered null, never a stand-in value.
    expect(itemOf(items, 'join_window_minutes')?.value).toBeNull();
    expect(reached).toEqual([['valuesOf', TX, keys]]);
  });

  // B49's Q-A1 (a) (FR-624: «value, default, unit»): the default is the registry's (the seed's
  // value), never the value stored, and stands where no row holds the key.
  it('answers the default from the registry, apart from the value stored', async () => {
    const { service } = administration({ stored: { attendance_threshold_pct: 80 } });
    const { items } = await service.list(TX, ADMIN);
    expect(itemOf(items, 'attendance_threshold_pct')).toMatchObject({ value: 80, default: 70 });
    expect(itemOf(items, 'join_window_minutes')).toMatchObject({ value: null, default: 10 });
    expect(itemOf(items, 'rate_limit_settings_update')).toMatchObject({
      value: null,
      default: { limit: 10, window_seconds: 60 },
    });
  });
});

describe('settings.update (T024)', () => {
  it('writes the value through the writer with the administrator, keyed settings.update, and answers before and after', async () => {
    const { service, reached, keyed, lines } = administration();
    expect(
      await service.update(TX, ADMIN, {
        key: 'chat_page_size',
        value: 40,
        reason: REASON,
        idempotencyKey: KEY,
      }),
    ).toEqual({ key: 'chat_page_size', before: 50, after: 40, replayed: false });
    expect(keyed).toEqual([
      {
        scope: 'settings.update',
        key: KEY,
        actorId: ADMIN,
        input: { key: 'chat_page_size', value: 40, reason: REASON },
      },
    ]);
    expect(reached).toEqual([
      ['runOn', TX],
      ['update', TX, 'chat_page_size', 40, ADMIN],
    ]);
    expect(lines).toEqual([[{ adminId: ADMIN, key: 'chat_page_size' }, 'A setting was changed']]);
  });

  it('stores the value as its schema reads it', async () => {
    const { service, reached } = administration({
      stored: { rate_limit_settings_update: { limit: 10, window_seconds: 60 } },
    });
    await service.update(TX, ADMIN, {
      key: 'rate_limit_settings_update',
      value: { limit: 5, window_seconds: 60, burst: 3 },
      reason: REASON,
      idempotencyKey: KEY,
    });
    expect(reached[1]).toEqual([
      'update',
      TX,
      'rate_limit_settings_update',
      { limit: 5, window_seconds: 60 },
      ADMIN,
    ]);
  });

  it.each([
    ['unknown', 'no_such_setting', 40, 'key'],
    ['invalid', 'chat_page_size', 'forty', 'value'],
    // The schema admits 150; the percent's ceiling (100) refuses it.
    ['out_of_bounds', 'attendance_threshold_pct', 150, 'value'],
  ] as const)(
    'refuses %s VALIDATION_FAILED through settingRefusal, before anything is keyed or written, logging no value',
    async (reason, key, value, path) => {
      const { service, reached, lines } = administration();
      const failure = await service
        .update(TX, ADMIN, { key, value, reason: REASON, idempotencyKey: KEY })
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(DomainError);
      expect(failure).toMatchObject({
        code: 'VALIDATION_FAILED',
        details: [{ path, code: reason }],
      });
      expect(isRefusalLogged(failure)).toBe(true);
      expect(reached).toEqual([]);
      expect(lines).toEqual([[{ adminId: ADMIN, key, reason }, 'A setting change was refused']]);
    },
  );

  it('a replay answers the first change and writes nothing', async () => {
    const { service, reached, lines } = administration({
      replay: { key: 'chat_page_size', before: 50, after: 40 },
    });
    expect(
      await service.update(TX, ADMIN, {
        key: 'chat_page_size',
        value: 40,
        reason: REASON,
        idempotencyKey: KEY,
      }),
    ).toEqual({ key: 'chat_page_size', before: 50, after: 40, replayed: true });
    expect(reached).toEqual([['runOn', TX]]);
    expect(lines).toEqual([]);
  });
});

// 006:T002 (SRS DEC-110; the note under T002, Q-3 (a)(a)): turning `programme_enabled` from 0 to 1
// deactivates every old-style ijazah package through catalog's entry, on the change's own keyed
// transaction, after the value is written; the change answers the count for the router's second
// audit entry (`packages.retired_by_switch`) and logs one line `{ adminId, count }`. Turning it off,
// writing 1 over 1, changing another key or replaying the change retires nothing.
describe('settings.update of the programme’s switch (006:T002, Q-3)', () => {
  function switchAdministration(
    before: unknown,
    { replay, count = 3 }: { readonly replay?: unknown; readonly count?: number } = {},
  ) {
    const reached: unknown[][] = [];
    const lines: unknown[][] = [];
    const service = createSettingsAdministration({
      log: { info: (fields: unknown, message?: string) => void lines.push([fields, message]) },
      idempotency: {
        runOn: async <T>(
          tx: never,
          _request: IdempotentRequest,
          effect: (tx: never) => Promise<T>,
        ) => {
          reached.push(['runOn', tx]);
          if (replay !== undefined) return { outcome: replay as T, replayed: true };
          return { outcome: await effect(KEYED as never), replayed: false };
        },
      },
      writerOn: (tx: unknown) => ({
        valuesOf: async () => new Map(),
        update: async (key: string, value: unknown) => {
          reached.push(['update', tx, key, value]);
          return { before };
        },
      }),
      retirePreProgrammeIjazahPackages: async (tx: unknown) => {
        reached.push(['retire', tx]);
        return count;
      },
      // 006:T004 (Q-D1 (a)): the programme switch's advisory key, catalog's.
      lockProgrammeSwitch: async (tx: unknown) => {
        reached.push(['lockSwitch', tx]);
      },
    } as never);
    return { service, reached, lines };
  }

  const KEYED = { tx: 'keyed' };
  const TURN_ON = { key: 'programme_enabled', value: 1, reason: REASON, idempotencyKey: KEY };

  it('turned on from 0, retires the old ijazah packages on the keyed transaction, after the write, and answers the count', async () => {
    const { service, reached } = switchAdministration(0);
    expect(await service.update(TX, ADMIN, TURN_ON)).toEqual({
      key: 'programme_enabled',
      before: 0,
      after: 1,
      retiredPackages: 3,
      replayed: false,
    });
    expect(reached).toEqual([
      ['runOn', TX],
      ['lockSwitch', KEYED],
      ['update', KEYED, 'programme_enabled', 1],
      ['retire', KEYED],
    ]);
  });

  it('logs the turn-on’s one line, the administrator and the count, after the change’s', async () => {
    const { service, lines } = switchAdministration(0, { count: 12 });
    await service.update(TX, ADMIN, TURN_ON);
    expect(lines).toEqual([
      [{ adminId: ADMIN, key: 'programme_enabled' }, 'A setting was changed'],
      [{ adminId: ADMIN, count: 12 }, 'The programme switch deactivated the old ijazah packages'],
    ]);
  });

  it('turned on where no row held a value before, retires them too', async () => {
    const { service, reached } = switchAdministration(undefined);
    await service.update(TX, ADMIN, TURN_ON);
    expect(reached).toContainEqual(['retire', KEYED]);
  });

  it('turned off, retires nothing and answers no count', async () => {
    const { service, reached } = switchAdministration(1);
    const answer = await service.update(TX, ADMIN, { ...TURN_ON, value: 0 });
    expect(answer).toEqual({ key: 'programme_enabled', before: 1, after: 0, replayed: false });
    expect(reached).not.toContainEqual(['retire', KEYED]);
  });

  it('0 written where it was off or unset retires nothing', async () => {
    for (const before of [0, undefined]) {
      const { service, reached } = switchAdministration(before);
      await service.update(TX, ADMIN, { ...TURN_ON, value: 0 });
      expect(reached).not.toContainEqual(['retire', KEYED]);
    }
  });

  it('1 written over 1 retires nothing', async () => {
    const { service, reached } = switchAdministration(1);
    await service.update(TX, ADMIN, TURN_ON);
    expect(reached).not.toContainEqual(['retire', KEYED]);
  });

  it('another key set to 1 retires nothing', async () => {
    const { service, reached } = switchAdministration(0);
    await service.update(TX, ADMIN, { ...TURN_ON, key: 'slot_release_buffer_weeks' });
    expect(reached).not.toContainEqual(['retire', KEYED]);
  });

  // 006:T004 (Q-D1 (a), the owner's «موافق على الاتنين (أ)», 2026-11-22): every write of the switch
  // takes its advisory key on the keyed transaction before the write, so a create of an old-style
  // ijazah package, which takes it before reading the switch, never crosses the turn-on.
  it('takes the switch’s key on the keyed transaction before writing it, turned off too', async () => {
    for (const value of [0, 1]) {
      const { service, reached } = switchAdministration(value === 1 ? 0 : 1);
      await service.update(TX, ADMIN, { ...TURN_ON, value });
      expect(reached.slice(0, 3)).toEqual([
        ['runOn', TX],
        ['lockSwitch', KEYED],
        ['update', KEYED, 'programme_enabled', value],
      ]);
    }
  });

  it('takes no switch key for another key', async () => {
    const { service, reached } = switchAdministration(0);
    await service.update(TX, ADMIN, { ...TURN_ON, key: 'slot_release_buffer_weeks' });
    expect(reached).not.toContainEqual(['lockSwitch', KEYED]);
  });

  it('a replay of the turn-on retires nothing again and answers the first count', async () => {
    const first = { key: 'programme_enabled', before: 0, after: 1, retiredPackages: 3 };
    const { service, reached, lines } = switchAdministration(0, { replay: first });
    expect(await service.update(TX, ADMIN, TURN_ON)).toEqual({ ...first, replayed: true });
    expect(reached).toEqual([['runOn', TX]]);
    expect(lines).toEqual([]);
  });
});
