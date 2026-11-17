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
import { documentLinkTtl, liveMaxConnections } from '../../apps/api/src/platform/settings/keys.js';
import {
  OPERATIONAL_SETTINGS_ROW,
  registryMismatch,
  SETTINGS_REGISTRY,
  type SettingBound,
  settingRefusal,
} from '../../apps/api/src/platform/settings/registry.js';
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
