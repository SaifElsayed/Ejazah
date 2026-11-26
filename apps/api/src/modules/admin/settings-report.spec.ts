// 002:T180 (R2's note; SRS FR-034, §3.14): at start-up the API and the worker report every key of
// the settings registry that no row of `settings` holds, without refusing to start. The stored keys
// are read once (`SettingsRepository.storedKeys`, one statement selecting the key alone) and compared
// with `SETTINGS_REGISTRY` through `registryMismatch`; only the registry's keys missing from the
// database are reported, in one warn line `{ missing, reason: 'settings_missing' }`, sorted. A read
// that fails is one warn line `{ err, reason: 'settings_report_failed' }`, the error's name only.
// Key names only, never a value. No database: the store and the logger are stand-ins.
//
// Observed red: the stub of `settings-report.ts` (a report that logs nothing) and of `storedKeys`
// (an empty list read from nowhere); the negative cases by the mutants C-1 to C-7 (lane C's report).
import { describe, expect, it } from 'vitest';

import { SETTINGS_REGISTRY } from '../../platform/settings/registry.js';
import { reportMissingKeys, type StoredSettingKeys } from './settings-report.js';
import { SettingsRepository } from './settings.repository.js';

type Line = { readonly fields: Record<string, unknown>; readonly message: string };

function recordingLog(): {
  readonly lines: Line[];
  readonly log: Parameters<typeof reportMissingKeys>[1];
} {
  const lines: Line[] = [];
  const log = {
    warn: (fields: Record<string, unknown>, message: string) =>
      void lines.push({ fields, message }),
  } as never;
  return { lines, log };
}

const REGISTERED = Object.keys(SETTINGS_REGISTRY);

function storeOf(keys: readonly string[]): StoredSettingKeys {
  return { storedKeys: async () => keys };
}

function allBut(...absent: readonly string[]): readonly string[] {
  return REGISTERED.filter((key) => !absent.includes(key));
}

describe('the start-up report of missing settings (002:T180)', () => {
  it('names the two missing keys in one warn line, sorted, with the reason code', async () => {
    // The registry lists `join_window_minutes` before `chat_page_size`: the line sorts them.
    expect(REGISTERED.indexOf('join_window_minutes')).toBeLessThan(
      REGISTERED.indexOf('chat_page_size'),
    );
    const { lines, log } = recordingLog();
    await reportMissingKeys(storeOf(allBut('join_window_minutes', 'chat_page_size')), log);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.fields).toEqual({
      missing: ['chat_page_size', 'join_window_minutes'],
      reason: 'settings_missing',
    });
  });

  it('writes no line when every registered key is stored', async () => {
    const { lines, log } = recordingLog();
    await reportMissingKeys(storeOf(REGISTERED), log);
    expect(lines).toEqual([]);
  });

  it('does not report a stored key the registry does not name', async () => {
    const { lines, log } = recordingLog();
    await reportMissingKeys(storeOf([...REGISTERED, 'retired_setting_key']), log);
    expect(lines).toEqual([]);

    const { lines: withOneMissing, log: second } = recordingLog();
    await reportMissingKeys(storeOf([...allBut('chat_page_size'), 'retired_setting_key']), second);
    expect(withOneMissing.map(({ fields }) => fields)).toEqual([
      { missing: ['chat_page_size'], reason: 'settings_missing' },
    ]);
  });

  it('reports every registered key of an empty store, and nothing else', async () => {
    const { lines, log } = recordingLog();
    await reportMissingKeys(storeOf([]), log);
    expect(lines.map(({ fields }) => fields)).toEqual([
      { missing: REGISTERED.toSorted(), reason: 'settings_missing' },
    ]);
  });

  it('logs a failed read as one warn line with the error’s name and the reason code, and does not throw', async () => {
    const { lines, log } = recordingLog();
    const failing: StoredSettingKeys = {
      storedKeys: async () => {
        const error = new Error('connection to postgres://owner:secret@host/db refused');
        error.name = 'PrismaClientInitializationError';
        throw error;
      },
    };
    await expect(reportMissingKeys(failing, log)).resolves.toBeUndefined();
    expect(lines.map(({ fields }) => fields)).toEqual([
      { err: 'PrismaClientInitializationError', reason: 'settings_report_failed' },
    ]);
    expect(JSON.stringify(lines)).not.toContain('secret');
  });

  it('names a thrown value that is not an Error as unknown', async () => {
    const { lines, log } = recordingLog();
    const failing: StoredSettingKeys = {
      storedKeys: () => Promise.reject('refused: secret'),
    };
    await expect(reportMissingKeys(failing, log)).resolves.toBeUndefined();
    expect(lines.map(({ fields }) => fields)).toEqual([
      { err: 'unknown', reason: 'settings_report_failed' },
    ]);
  });
});

describe('SettingsRepository.storedKeys (002:T180)', () => {
  it('reads every stored key in one statement selecting the key alone, never a value', async () => {
    const calls: unknown[] = [];
    const client = {
      setting: {
        findMany: async (args: unknown) => {
          calls.push(args);
          return [{ key: 'chat_page_size' }, { key: 'join_window_minutes' }];
        },
      },
    } as unknown as ConstructorParameters<typeof SettingsRepository>[0];
    expect(await new SettingsRepository(client).storedKeys()).toEqual([
      'chat_page_size',
      'join_window_minutes',
    ]);
    expect(calls).toEqual([{ select: { key: true } }]);
  });
});
