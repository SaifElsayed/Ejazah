// T002 of specs/005-certification (R-410; FR-624, FR-626; Q2 (a), Q3 (a) of B45's conflict check):
// the settings registry against the real seed. No database: the seed's own `seed()` runs on a
// recording stand-in, so the keys and defaults are the ones `prisma/seed.ts` plants, never a copy.
//
// The registry holds exactly the seed's keys, both ways. Every default parses under its key's schema
// and lies inside its bounds. The minimum of a bound is the read site's schema's (the schema accepts
// it and refuses below it); a maximum stands only where a document or the unit names one. Each entry
// names its SRS §3.14 row, or «§3.14, operational settings». It lives under `tests/` because
// `apps/api` compiles `src` only (rootDir), and the seed sits outside it.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { chatRetentionDays } from '../../apps/api/src/modules/chat/index.js';
import {
  disputeWindowHours,
  repeatedAbsenceFlagCount,
  restoreWindowDays,
} from '../../apps/api/src/modules/sessions/index.js';
import { rateLimitSetting } from '../../apps/api/src/platform/guards/rate-limit.guard.js';
import { uploadMaxBytes } from '../../apps/api/src/platform/guards/upload.middleware.js';
import {
  documentLinkTtl,
  liveMaxConnections,
  MIN_APP_BUILD_SETTING,
  minAppBuild,
} from '../../apps/api/src/platform/settings/keys.js';
import {
  OPERATIONAL_SETTINGS_ROW,
  registryMismatch,
  SETTINGS_REGISTRY,
  type SettingBound,
  settingRefusal,
} from '../../apps/api/src/platform/settings/registry.js';
import {
  priceAverageMinTeachers,
  teacherSharePercent,
} from '../../packages/contracts/src/index.js';
import { type Queryable, seed } from '../../prisma/seed';

/** The settings the real seed inserts, key to default, read off its INSERTs on a stand-in. */
async function seededSettings(): Promise<ReadonlyMap<string, unknown>> {
  const planted = new Map<string, unknown>();
  const recorder: Queryable = {
    query: async (text, values) => {
      if (text.includes('INSERT INTO settings') && values !== undefined) {
        planted.set(String(values[0]), JSON.parse(String(values[1])));
      }
      // The administrator's existence check answers "present", so nothing is hashed or encrypted.
      return { rows: [{}], rowCount: 1, command: '', oid: 0, fields: [] } as never;
    },
  };
  await seed(recorder, { encryptionKey: '' });
  return planted;
}

const seeded = await seededSettings();
const registryKeys = Object.keys(SETTINGS_REGISTRY);

/** The first cell of every row of SRS §3.14's table, its italic notes removed. */
function srsSettingRows(): ReadonlySet<string> {
  const srs = readFileSync(resolve(import.meta.dirname, '../../docs/SRS.md'), 'utf8');
  const section = srs.slice(
    srs.indexOf('### 3.14 '),
    srs.indexOf('\n### ', srs.indexOf('### 3.14 ') + 1),
  );
  const rows = section
    .split('\n')
    .filter(
      (line) =>
        line.startsWith('| ') && !line.startsWith('| Setting ') && !line.startsWith('| ---'),
    )
    .map((line) => (line.split('|')[1] ?? '').replace(/\s*\*\(.*?\)\*/g, '').trim());
  return new Set(rows);
}

/** For one bound: the value just below its minimum, and the least value it admits. */
function edges({ min, minExclusive }: SettingBound): { below: number; least: number } {
  return minExclusive ? { below: min, least: min + 1 } : { below: min - 1, least: min };
}

describe('the settings registry (T002, R-410)', () => {
  it('read the seed: it plants settings', () => {
    expect(seeded.size).toBeGreaterThan(0);
  });

  it('holds exactly the seed’s keys, both ways', () => {
    expect([...registryKeys].sort()).toEqual([...seeded.keys()].sort());
    expect(registryMismatch(seeded.keys())).toEqual({ notInRegistry: [], notSeeded: [] });
  });

  it('names a seed key the registry lacks, and a registry key the seed lacks (fixtures)', () => {
    const withExtra = [...seeded.keys(), 'fixture_key_the_registry_lacks'];
    expect(registryMismatch(withExtra)).toEqual({
      notInRegistry: ['fixture_key_the_registry_lacks'],
      notSeeded: [],
    });
    const [dropped, ...rest] = [...seeded.keys()];
    expect(registryMismatch(rest)).toEqual({ notInRegistry: [], notSeeded: [dropped] });
  });

  // 005:T024 (B49, Q-A1 (a); FR-624: «value, default, unit»): the registry carries each key's
  // default, and it is the value the seed plants, so the panel's default is never a second copy that
  // drifts from the seed. `SettingEntry.default` is required: an entry without one fails the type check.
  it('carries every key’s default, equal to the value the seed plants', () => {
    const defaults = Object.fromEntries(
      Object.entries(SETTINGS_REGISTRY).map(([key, entry]) => [key, entry.default]),
    );
    expect(defaults).toStrictEqual(Object.fromEntries(seeded));
  });

  it('parses every seed default under its schema, inside its bounds', () => {
    const refused = [...seeded].flatMap(([key, value]) => {
      const entry = SETTINGS_REGISTRY[key];
      if (entry === undefined) return [`${key}: no entry`];
      if (!entry.schema.safeParse(value).success) return [`${key}: schema`];
      const refusal = settingRefusal(key, value);
      return refusal === undefined ? [] : [`${key}: ${refusal}`];
    });
    expect(refused).toEqual([]);
  });

  it('takes each minimum from the read site’s schema: admitted at it, refused below it', () => {
    const wrong: string[] = [];
    let checked = 0;
    for (const [key, entry] of Object.entries(SETTINGS_REGISTRY)) {
      const fallback = seeded.get(key);
      const probes: { readonly bound: SettingBound; readonly at: (n: number) => unknown }[] = [];
      const { bounds } = entry;
      if (bounds.shape === 'number') probes.push({ bound: bounds.value, at: (n) => n });
      if (bounds.shape === 'list') probes.push({ bound: bounds.each, at: (n) => [n] });
      if (bounds.shape === 'rate_limit') {
        const base = fallback as Record<string, unknown>;
        probes.push({ bound: bounds.limit, at: (n) => ({ ...base, limit: n }) });
        probes.push({ bound: bounds.windowSeconds, at: (n) => ({ ...base, window_seconds: n }) });
      }
      for (const { bound, at } of probes) {
        const { below, least } = edges(bound);
        if (entry.schema.safeParse(at(below)).success) wrong.push(`${key}: admits ${below}`);
        if (!entry.schema.safeParse(at(least)).success) wrong.push(`${key}: refuses ${least}`);
        checked += 1;
      }
    }
    expect(wrong).toEqual([]);
    expect(checked).toBeGreaterThan(0);
  });

  it('refuses an unknown key, a value its schema refuses, and a number past a bound', () => {
    expect(settingRefusal('no_such_setting', 1)).toBe('unknown');
    expect(settingRefusal('attendance_threshold_pct', '70')).toBe('invalid');
    expect(settingRefusal('attendance_threshold_pct', 0)).toBe('invalid');
    expect(settingRefusal('attendance_threshold_pct', 101)).toBe('out_of_bounds');
    expect(settingRefusal('attendance_threshold_pct', 100)).toBeUndefined();
    expect(settingRefusal('rate_limit_signed_in_default', { limit: 201, window_seconds: 60 })).toBe(
      'out_of_bounds',
    );
    expect(
      settingRefusal('rate_limit_signed_in_default', { limit: 200, window_seconds: 60 }),
    ).toBeUndefined();
    expect(settingRefusal('document_link_ttl_seconds', 604_801)).toBe('out_of_bounds');
    expect(settingRefusal('reminder_offsets_minutes', [1440, 0])).toBe('invalid');
  });

  it('names a §3.14 row for every entry, or the operational settings paragraph', () => {
    const rows = srsSettingRows();
    const unnamed = Object.entries(SETTINGS_REGISTRY)
      .filter(([, { srsRow }]) => srsRow !== OPERATIONAL_SETTINGS_ROW && !rows.has(srsRow))
      .map(([key, { srsRow }]) => `${key}: ${srsRow}`);
    expect(unnamed).toEqual([]);
    expect(registryKeys.length).toBeGreaterThan(0);
  });

  it('reads with the very schema each platform read site uses', () => {
    const rateLimitKeys = registryKeys.filter((key) => key.startsWith('rate_limit_'));
    expect(rateLimitKeys.length).toBeGreaterThan(0);
    for (const key of rateLimitKeys) expect(SETTINGS_REGISTRY[key]?.schema).toBe(rateLimitSetting);
    expect(SETTINGS_REGISTRY['upload_max_bytes']?.schema).toBe(uploadMaxBytes);
    expect(SETTINGS_REGISTRY['document_link_ttl_seconds']?.schema).toBe(documentLinkTtl);
    expect(SETTINGS_REGISTRY['live_channel_max_connections_per_user']?.schema).toBe(
      liveMaxConnections,
    );
    // Track 2's two keys (003:T104, T113), read with the contracts' schemas (B45's merge of develop).
    expect(SETTINGS_REGISTRY['teacher_share_percent']?.schema).toBe(teacherSharePercent);
    expect(SETTINGS_REGISTRY['price_average_min_teachers']?.schema).toBe(priceAverageMinTeachers);
  });

  it('agrees with every read-site schema a module’s public entry exports', () => {
    const exported = {
      chat_retention_days: chatRetentionDays,
      dispute_window_hours: disputeWindowHours,
      repeated_absence_flag_count: repeatedAbsenceFlagCount,
      enrollment_restore_window_days: restoreWindowDays,
      ban_restore_window_days: restoreWindowDays,
    } as const;
    const probes = [-1, 0, 1, 1.5, 72, '1', null];
    for (const [key, readSite] of Object.entries(exported)) {
      const entry = SETTINGS_REGISTRY[key];
      expect(entry, key).toBeDefined();
      for (const probe of probes) {
        expect(entry?.schema.safeParse(probe).success, `${key} ${String(probe)}`).toBe(
          readSite.safeParse(probe).success,
        );
      }
    }
  });
});

// 006:T002 (research R-515; spec.md FR-732; SRS §3.14's eight programme rows, DEC-93, DEC-94; I-3,
// P1 (a)): the programme's eight keys in track 2's block, each with its unit, its bounds, its group
// and its §3.14 row; `programme_enabled` a `count` of 0 or 1 (the bounds shapes hold no boolean),
// off; the assessment's fee in the new unit `piasters`, 0 = unset (named `_price_`, B-P1 Q-B4
// (a)); the retries at most four increasing days.
describe('the programme’s eight settings (006:T002, R-515)', () => {
  const at = (key: string) => SETTINGS_REGISTRY[key];
  const atLeast = (min: number, max: number | null = null) => ({ min, minExclusive: false, max });

  it.each([
    ['programme_enabled', 'count', { shape: 'number', value: atLeast(0, 1) }, 0],
    ['assessment_price_piasters', 'piasters', { shape: 'number', value: atLeast(0) }, 0],
    ['assessment_duration_minutes', 'minutes', { shape: 'number', value: atLeast(30, 60) }, 30],
    ['programme_offer_hours', 'hours', { shape: 'number', value: atLeast(1) }, 24],
    ['programme_pay_rest_hours', 'hours', { shape: 'number', value: atLeast(1) }, 48],
    ['programme_stop_request_days', 'days', { shape: 'number', value: atLeast(1) }, 7],
    ['programme_renew_early_days', 'days', { shape: 'number', value: atLeast(0) }, 3],
    ['programme_charge_retry_days', 'days', { shape: 'list', each: atLeast(1) }, [1, 3, 5, 7]],
  ] as const)('%s: unit %s, its bounds, group booking, default %j', (key, unit, bounds, value) => {
    expect(at(key)).toMatchObject({ unit, bounds, group: 'booking', default: value });
  });

  it('binds each key to its own §3.14 row', () => {
    expect(
      Object.fromEntries(
        [
          'programme_enabled',
          'assessment_price_piasters',
          'assessment_duration_minutes',
          'programme_offer_hours',
          'programme_pay_rest_hours',
          'programme_stop_request_days',
          'programme_renew_early_days',
          'programme_charge_retry_days',
          'programme_charge_inquiry_tries',
        ].map((key) => [key, at(key)?.srsRow]),
      ),
    ).toEqual({
      programme_enabled:
        'Programme: the programme turned on (off: ijazah-track Packages sold as before)',
      assessment_price_piasters:
        "Programme: the assessment's fee (EGP, one amount for every ijazah-track Teacher; an ijazah-track Package is not published while it is unset)",
      assessment_duration_minutes:
        "Programme: the assessment session's length (minutes: 30, 45 or 60)",
      programme_offer_hours:
        'Programme: time for the Teacher to send the offer after the assessment (hours; none sent: an Administrator item)',
      programme_pay_rest_hours: 'Programme: time to pay the rest after the assessment (hours)',
      programme_stop_request_days: 'Programme: pause before a Teacher may request a stop (days)',
      programme_renew_early_days:
        'Programme: days before a paid month ends that a Student without a saved card may renew (days)',
      programme_charge_retry_days:
        'Programme: retries of a failed automatic charge on a soft decline (count, and days after the failure)',
      programme_charge_inquiry_tries:
        'Programme: unanswered asks about an automatic charge before an Administrator item (count; asked every checkout lifetime)',
    });
  });

  // 006:T014 (SRS DEC-113): a count of asks, at least one, 6 by default.
  it('takes the inquiry tries as a whole count of at least 1, defaulting to 6', () => {
    expect(at('programme_charge_inquiry_tries')).toMatchObject({
      unit: 'count',
      group: 'booking',
      default: 6,
    });
    expect(settingRefusal('programme_charge_inquiry_tries', 1)).toBeUndefined();
    expect(settingRefusal('programme_charge_inquiry_tries', 0)).not.toBeUndefined();
    expect(settingRefusal('programme_charge_inquiry_tries', 1.5)).toBe('invalid');
  });

  // 006:T019 (B-P4's conflict check, Q-5 (b), the owner, 2026-11-25; SRS DEC-114, §3.14): the hours
  // before `payBy` the student's «pay before» line shows from, 12 by default, 1 to 47 (below the 48
  // hours to pay the rest), on the panel's booking page, bound to its own §3.14 row.
  it('takes the reminder’s hours as a whole number from 1 to 47, defaulting to 12 (DEC-114)', () => {
    expect(at('programme_pay_reminder_hours')).toMatchObject({
      unit: 'hours',
      bounds: { shape: 'number', value: atLeast(1, 47) },
      group: 'booking',
      default: 12,
      srsRow:
        "Programme: hours before the deadline to pay the rest that the Student's reminder line shows (hours, 1 to 47)",
    });
    expect(seeded.get('programme_pay_reminder_hours')).toBe(12);
    expect(settingRefusal('programme_pay_reminder_hours', 1)).toBeUndefined();
    expect(settingRefusal('programme_pay_reminder_hours', 47)).toBeUndefined();
    expect(settingRefusal('programme_pay_reminder_hours', 0)).not.toBeUndefined();
    expect(settingRefusal('programme_pay_reminder_hours', 48)).not.toBeUndefined();
    expect(settingRefusal('programme_pay_reminder_hours', 1.5)).toBe('invalid');
  });

  it('takes the switch as 0 or 1 only: 1 admitted, 2 refused by the read site’s schema', () => {
    expect(settingRefusal('programme_enabled', 1)).toBeUndefined();
    expect(settingRefusal('programme_enabled', 2)).toBe('invalid');
  });

  it('refuses the switch as a boolean or a fraction', () => {
    expect(settingRefusal('programme_enabled', true)).toBe('invalid');
    expect(settingRefusal('programme_enabled', 0.5)).toBe('invalid');
  });

  it('takes the fee in whole piasters: 20 000 admitted, a fraction of a piaster refused', () => {
    expect(settingRefusal('assessment_price_piasters', 20_000)).toBeUndefined();
    expect(settingRefusal('assessment_price_piasters', 150.5)).toBe('invalid');
  });

  it('takes the assessment’s length as 30, 45 or 60 only', () => {
    expect(settingRefusal('assessment_duration_minutes', 45)).toBeUndefined();
    expect(settingRefusal('assessment_duration_minutes', 40)).toBe('invalid');
  });

  it('takes the retries as at most four increasing days', () => {
    expect(settingRefusal('programme_charge_retry_days', [2, 4])).toBeUndefined();
    expect(settingRefusal('programme_charge_retry_days', [1, 3, 5, 7, 9])).toBe('invalid');
  });

  it('refuses retries that do not increase', () => {
    expect(settingRefusal('programme_charge_retry_days', [3, 1])).toBe('invalid');
    expect(settingRefusal('programme_charge_retry_days', [3, 3])).toBe('invalid');
  });
});

// 002:T184 (R3; SRS §3.14 «Minimum app build admitted», DEC-99, DEC-109): the build floor, a build
// number shown bare as `terms_version` is, on the panel's general page; seeded 0, no floor.
describe('the build floor’s setting (002:T184)', () => {
  it('is `min_app_build`: unit version, group general, from 0, default 0, its own §3.14 row', () => {
    expect(MIN_APP_BUILD_SETTING).toBe('min_app_build');
    expect(SETTINGS_REGISTRY[MIN_APP_BUILD_SETTING]).toStrictEqual({
      schema: minAppBuild,
      bounds: { shape: 'number', value: { min: 0, minExclusive: false, max: null } },
      unit: 'version',
      group: 'general',
      srsRow: 'Minimum app build admitted (build number)',
      default: 0,
    });
    expect(seeded.get(MIN_APP_BUILD_SETTING)).toBe(0);
  });

  it('takes a whole build number, 0 included: a negative or a fraction refused', () => {
    expect(settingRefusal(MIN_APP_BUILD_SETTING, 0)).toBeUndefined();
    expect(settingRefusal(MIN_APP_BUILD_SETTING, 42)).toBeUndefined();
    expect(settingRefusal(MIN_APP_BUILD_SETTING, -1)).toBe('invalid');
    expect(settingRefusal(MIN_APP_BUILD_SETTING, 1.5)).toBe('invalid');
    expect(settingRefusal(MIN_APP_BUILD_SETTING, '3')).toBe('invalid');
  });
});
