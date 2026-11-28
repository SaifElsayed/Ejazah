// 005:T024 (B49; FR-624; R-410; the note under T024, Q-S1 (a)): the panel's settings page names every
// key of the API's settings registry and every group, in Arabic and in English. The page reads a
// key's label at `admin.settings.keys.<key>` and a group's at `admin.settings.groups.<group>`
// (`apps/admin/src/pages/settings/words.ts`); the contract's `settingKey` is only a pattern, so the
// keys are the registry's own (`apps/api/src/platform/settings/registry.ts`), as
// `tests/seed/settings-registry.spec.ts` reads them. No label names a key the registry lacks (the
// stale `noShowTermination` is gone), and `attendanceThreshold.error` states the registry's bound.
// It lives under `tests/` because the panel's project cannot import the API.
// 006:T021 (B-P4's conflict check, Q-7, the owner's design, 2026-11-25: «لكل الزراير»): every key also
// has its explanation, the «i» button's dialog, at `admin.settings.explain.<key>`, its own leaves
// beside `keys`, and no explanation names a key the registry lacks; `programme_enabled`'s says on,
// off, and ⚠️ that off reactivates no package, one paragraph each. A setting another batch adds turns
// this red until its explanation is written.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SETTINGS_REGISTRY } from '../../apps/api/src/platform/settings/registry.js';
import { settingGroup } from '../../packages/contracts/src/admin/settings.js';

type Group = Readonly<Record<string, unknown>>;

function settingsCatalogue(locale: 'ar' | 'en'): Group {
  const file = resolve(import.meta.dirname, `../../apps/admin/src/i18n/${locale}.json`);
  const catalogue = JSON.parse(readFileSync(file, 'utf8')) as { admin: { settings: Group } };
  return catalogue.admin.settings;
}

const isLabel = (value: unknown) => typeof value === 'string' && value.trim() !== '';

const registryKeys = Object.keys(SETTINGS_REGISTRY);
const registryGroups = [
  ...new Set([...settingGroup.options, ...Object.values(SETTINGS_REGISTRY).map((e) => e.group)]),
];

describe.each(['ar', 'en'] as const)('the settings page labels in %s', (locale) => {
  const settings = settingsCatalogue(locale);
  const keys = (settings['keys'] ?? {}) as Group;
  const groups = (settings['groups'] ?? {}) as Group;
  const explanations = (settings['explain'] ?? {}) as Group;

  it('labels every key of the registry', () => {
    expect(registryKeys.filter((key) => !isLabel(keys[key]))).toEqual([]);
  });

  it('labels no key the registry lacks', () => {
    expect(Object.keys(keys).filter((key) => !registryKeys.includes(key))).toEqual([]);
  });

  it('explains every key of the registry, one explanation each (006:T021, Q-7)', () => {
    expect(registryKeys.filter((key) => !isLabel(explanations[key]))).toEqual([]);
  });

  it('explains no key the registry lacks (006:T021, Q-7)', () => {
    expect(Object.keys(explanations).filter((key) => !registryKeys.includes(key))).toEqual([]);
  });

  it("explains the programme's switch on, off, and that off reactivates no package (006:T021)", () => {
    const paragraphs = String(explanations['programme_enabled']).split('\n');
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[2]?.startsWith('⚠️')).toBe(true);
  });

  // 002:T184 (R3; the owner's «Forced update» answer; DEC-109): what the floor is, 0 = none, the
  // rule for raising it (a security, money or contract reason; 100% on every Play track; release
  // health in Sentry; never with a minSdk change), and ⚠️ that a raise is final for older phones.
  it("explains the build floor, 0 as none, the rule for raising it, and ⚠️ that a raise is final (002:T184)", () => {
    const paragraphs = String(explanations['min_app_build']).split('\n');
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0]).toContain('0');
    expect(paragraphs[1]).toContain('100%');
    expect(paragraphs[1]).toContain('Sentry');
    expect(paragraphs[1]).toContain('minSdk');
    expect(paragraphs[2]?.startsWith('⚠️')).toBe(true);
  });

  it('labels every group, the three added ones included', () => {
    expect(registryGroups).toEqual(expect.arrayContaining(['accounts', 'admin', 'rateLimits']));
    expect(registryGroups.filter((group) => !isLabel(groups[group]))).toEqual([]);
  });

  it('holds no stale noShowTermination entry', () => {
    expect(settings).not.toHaveProperty('noShowTermination');
  });

  it("states the attendance threshold's bound as the registry does: above 0, up to 100", () => {
    const { bounds } = SETTINGS_REGISTRY['attendance_threshold_pct'] as {
      bounds: { shape: 'number'; value: { min: number; minExclusive: boolean; max: number } };
    };
    expect(bounds.value).toEqual({ min: 0, minExclusive: true, max: 100 });
    const error = (settings['attendanceThreshold'] as Group)['error'] as string;
    expect(error).toContain(String(bounds.value.min));
    expect(error).toContain(String(bounds.value.max));
    expect(error).not.toMatch(/\b1 to 100\b|من 1 إلى 100/);
  });
});
