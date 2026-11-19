// T024 of specs/005-certification — the administrator's `settings` schemas of
// contracts/admin-surface.md (FR-624; SRS FR-ADMIN-9, §3.14; research R-410; the note under T024,
// Q-S1 (a)). Written before the schemas, and run red first against a stub.
//
// `list` answers every registry key with its value, default (B49's Q-A1 (a): the registry's, which is
// the seed's), bounds, unit, group and SRS row; `update`
// takes a key, a value, a reason and a key of idempotency, and answers the key and the value
// stored. The units, groups and bounds are the registry's (`platform/settings/registry.ts`), and a
// refusal names one of the registry's three reasons (`settingRefusal`).
import { describe, expect, it } from 'vitest';

import { isIdempotentProcedure } from '../idempotent-procedures.js';
import {
  adminSettingsListOutput,
  adminSettingsUpdateInput,
  adminSettingsUpdateOutput,
  settingGroup,
  settingUnit,
  settingUpdateRefusal,
} from './settings.js';

const KEY = 'settings-update-key-for-the-spec-01';
const REASON = 'تعديل بعد مراجعة الإدارة';

const BOUND = { min: 1, minExclusive: false, max: null };

const NUMBER_ITEM = {
  key: 'chat_page_size',
  value: 50,
  default: 50,
  bounds: { shape: 'number', value: BOUND },
  unit: 'count',
  group: 'general',
  srsRow: 'Chat page size',
};

const UPDATE = { key: 'chat_page_size', value: 40, reason: REASON, idempotencyKey: KEY };

describe('the registry’s words', () => {
  it('a unit, a group and a refusal are the registry’s own', () => {
    expect(settingUnit.options).toEqual([
      'percent',
      'seconds',
      'minutes',
      'hours',
      'days',
      'weeks',
      'count',
      'bytes',
      'rate_limit',
      'version',
    ]);
    expect(settingGroup.options).toEqual([
      'booking',
      'sessions',
      'notifications',
      'general',
      'accounts',
      'admin',
      'rateLimits',
    ]);
    expect(settingUpdateRefusal.options).toEqual(['unknown', 'invalid', 'out_of_bounds']);
  });
});

describe('settings.list', () => {
  it('answers each key with its value (null where no row holds it), its default, bounds of each of the four shapes, unit, group and SRS row', () => {
    const items = [
      NUMBER_ITEM,
      {
        key: 'attendance_threshold_pct',
        value: 80,
        default: 70,
        bounds: { shape: 'number', value: { min: 0, minExclusive: true, max: 100 } },
        unit: 'percent',
        group: 'sessions',
        srsRow: 'Attendance threshold (%)',
      },
      {
        key: 'reminder_offsets_minutes',
        value: [1440, 60],
        default: [1440, 15],
        bounds: { shape: 'list', each: BOUND },
        unit: 'minutes',
        group: 'notifications',
        srsRow: 'Reminder offsets (minutes)',
      },
      {
        key: 'rate_limit_settings_update',
        value: { limit: 10, window_seconds: 60 },
        default: { limit: 10, window_seconds: 60 },
        bounds: { shape: 'rate_limit', limit: BOUND, windowSeconds: BOUND },
        unit: 'rate_limit',
        group: 'rateLimits',
        srsRow: 'Settings change rate limit (per Administrator, per window)',
      },
      {
        key: 'terms_version',
        value: null,
        default: '2026-10',
        bounds: { shape: 'text' },
        unit: 'version',
        group: 'accounts',
        srsRow: 'Terms version',
      },
    ];
    expect(adminSettingsListOutput.parse({ items })).toEqual({ items });
  });

  // B49's Q-A1 (a) (FR-624: «value, default, unit»): the default is the registry's, the seed's value,
  // in the value's JSON shapes, and never null: every key has one.
  it('refuses an item without its default, or with a null default', () => {
    const { default: _default, ...noDefault } = NUMBER_ITEM;
    expect(adminSettingsListOutput.safeParse({ items: [noDefault] }).success).toBe(false);
    expect(
      adminSettingsListOutput.safeParse({ items: [{ ...NUMBER_ITEM, default: null }] }).success,
    ).toBe(false);
  });

  it('refuses an item without its group, its SRS row or a known bounds shape', () => {
    expect(adminSettingsListOutput.safeParse({ items: [NUMBER_ITEM] }).success).toBe(true);
    const { group: _group, ...noGroup } = NUMBER_ITEM;
    const { srsRow: _srsRow, ...noRow } = NUMBER_ITEM;
    for (const item of [
      noGroup,
      noRow,
      { ...NUMBER_ITEM, bounds: { shape: 'range', value: BOUND } },
      { ...NUMBER_ITEM, unit: 'piasters' },
    ]) {
      expect(adminSettingsListOutput.safeParse({ items: [item] }).success).toBe(false);
    }
  });
});

describe('settings.update', () => {
  it('takes a key, a value of any of the registry’s shapes, a reason and a key of idempotency', () => {
    for (const value of [40, [1440, 60], { limit: 10, window_seconds: 60 }, '2026-10-01']) {
      expect(adminSettingsUpdateInput.parse({ ...UPDATE, value })).toEqual({ ...UPDATE, value });
    }
  });

  it('requires a reason, trimmed and not blank', () => {
    expect(adminSettingsUpdateInput.safeParse(UPDATE).success).toBe(true);
    const { reason: _reason, ...noReason } = UPDATE;
    expect(adminSettingsUpdateInput.safeParse(noReason).success).toBe(false);
    expect(adminSettingsUpdateInput.safeParse({ ...UPDATE, reason: '   ' }).success).toBe(false);
    expect(adminSettingsUpdateInput.parse({ ...UPDATE, reason: `  ${REASON} ` }).reason).toBe(
      REASON,
    );
  });

  it('requires a key of idempotency and a setting key in the registry’s spelling', () => {
    expect(adminSettingsUpdateInput.safeParse(UPDATE).success).toBe(true);
    const { idempotencyKey: _key, ...noKey } = UPDATE;
    expect(adminSettingsUpdateInput.safeParse(noKey).success).toBe(false);
    for (const key of ['', 'Chat Page Size', 'chat-page-size', '9_lives', 'a'.repeat(101)]) {
      expect(adminSettingsUpdateInput.safeParse({ ...UPDATE, key }).success).toBe(false);
    }
  });

  it('answers the key and the value stored', () => {
    expect(adminSettingsUpdateOutput.parse({ key: 'chat_page_size', value: 40 })).toEqual({
      key: 'chat_page_size',
      value: 40,
    });
    expect(adminSettingsUpdateOutput.safeParse({ value: 40 }).success).toBe(false);
  });

  it('is a keyed procedure', () => {
    expect(isIdempotentProcedure('settings.update')).toBe(true);
  });
});
