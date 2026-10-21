// T051 (FR-AUTH-10, FR-126): writes the city list the time-zone picker shows,
// `packages/time/src/time-zone-cities.ts`, from three files of the Unicode CLDR.
//
//   pnpm exec tsx scripts/dev/build-time-zone-cities.ts --ar <path> --en <path> --bcp47 <path>
//
// THE SOURCE (owner's decision, 2026-10-21: three pinned files rather than the 95 MB
// `cldr-dates-full` package, so nothing is installed and the pipeline downloads nothing). CLDR
// 48.2.0 as `cldr-json` publishes it; the Unicode License v3 covers the data, Copyright © 1991-2025
// Unicode, Inc.: https://github.com/unicode-org/cldr-json/blob/48.2.0/LICENSE
//
//   https://raw.githubusercontent.com/unicode-org/cldr-json/48.2.0/cldr-json/cldr-dates-full/main/ar/timeZoneNames.json
//   88,001 bytes, SHA-256 7946e70865655858b964a18697f3267857acfd76d2d94738f32dee77c3456699
//   https://raw.githubusercontent.com/unicode-org/cldr-json/48.2.0/cldr-json/cldr-dates-full/main/en/timeZoneNames.json
//   44,939 bytes, SHA-256 db04305a4bac1389b965e71974adf174adc4130f38b86dfcf1f4e2eec343a174
//   https://raw.githubusercontent.com/unicode-org/cldr-json/48.2.0/cldr-json/cldr-bcp47/bcp47/timezone.json
//   59,702 bytes, SHA-256 c11423884420f00cf52733c854de5c898ddb6657ce560334c638a2bd994a1448
//
// The script does not fetch, as `build-breached-list.ts` does not: the files are downloaded by hand,
// their hashes checked against the ones above, and handed in, so a changed upstream file is refused
// rather than built. Replacing them is a new source here, a new run and one commit.
//
// WHAT IT WRITES. One row per zone a person may live by: the zone's current IANA name (CLDR's
// `_iana`, else its first alias), its exemplar city in Arabic and in English, and the older names
// a device may still report (`Asia/Calcutta` for `Asia/Kolkata`). English carries an exemplar city
// only where it differs from the zone's last segment, so the segment, underscores as spaces, is the
// English name otherwise (CLDR's own fallback). A zone `assertTimeZone` refuses (`Etc/*`, `UTC`, a
// zone the time package does not know) is left out, so the list is the zones `onboarding.complete`
// and `account.setTimezone` accept.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';

import { format, resolveConfig } from 'prettier';

import { assertTimeZone } from '../../packages/time/src/index';

const SOURCES = {
  ar: '7946e70865655858b964a18697f3267857acfd76d2d94738f32dee77c3456699',
  en: 'db04305a4bac1389b965e71974adf174adc4130f38b86dfcf1f4e2eec343a174',
  bcp47: 'c11423884420f00cf52733c854de5c898ddb6657ce560334c638a2bd994a1448',
} as const;

const OUTPUT = join(__dirname, '..', '..', 'packages', 'time', 'src', 'time-zone-cities.ts');

/** A zone and its city as the picker shows it. */
export interface CityRow {
  readonly zone: string;
  readonly ar: string;
  readonly en: string;
  readonly aliases: readonly string[];
}

type ZoneNames = Record<string, { readonly exemplarCity?: string }>;

/** CLDR's `zone` tree flattened to `Area/Location` keys. */
function flatten(tree: Record<string, unknown>, prefix = ''): ZoneNames {
  const out: Record<string, { exemplarCity?: string }> = {};
  for (const [key, value] of Object.entries(tree)) {
    const id = prefix === '' ? key : `${prefix}/${key}`;
    if (typeof value !== 'object' || value === null) continue;
    if ('_type' in value || 'exemplarCity' in value || 'long' in value) {
      out[id] = value as { exemplarCity?: string };
    } else {
      Object.assign(out, flatten(value as Record<string, unknown>, id));
    }
  }
  return out;
}

function zonesOf(file: unknown, locale: 'ar' | 'en'): ZoneNames {
  const main = (file as { main: Record<string, { dates: { timeZoneNames: { zone: object } } }> })
    .main[locale];
  if (main === undefined) throw new Error(`build-time-zone-cities: no ${locale} in its file`);
  return flatten(main.dates.timeZoneNames.zone as Record<string, unknown>);
}

/** The rows, sorted by zone, from the three parsed files; `accepts` is the time package's check. */
export function buildCityRows(
  arFile: unknown,
  enFile: unknown,
  bcp47File: unknown,
  accepts: (zone: string) => boolean,
): CityRow[] {
  const ar = zonesOf(arFile, 'ar');
  const en = zonesOf(enFile, 'en');
  const keys = (bcp47File as { keyword: { u: { tz: Record<string, unknown> } } }).keyword.u.tz;
  const rows: CityRow[] = [];
  for (const [key, entry] of Object.entries(keys)) {
    if (key.startsWith('_') || typeof entry !== 'object' || entry === null) continue;
    const { _alias, _iana, _deprecated } = entry as {
      _alias?: string;
      _iana?: string;
      _deprecated?: boolean;
    };
    if (_deprecated === true || _alias === undefined) continue;
    const names = _alias.split(' ');
    const cldrId = names[0];
    if (cldrId === undefined) continue;
    const zone = _iana ?? cldrId;
    if (!accepts(zone)) continue;
    const arabic = ar[cldrId]?.exemplarCity;
    if (arabic === undefined) throw new Error(`build-time-zone-cities: no Arabic city for ${zone}`);
    const english =
      en[cldrId]?.exemplarCity ?? (cldrId.split('/').at(-1) ?? cldrId).replaceAll('_', ' ');
    const aliases = names.filter((name) => name !== zone && name.includes('/') && accepts(name));
    rows.push({ zone, ar: arabic, en: english, aliases: aliases.sort() });
  }
  return rows.sort((a, b) => (a.zone < b.zone ? -1 : a.zone > b.zone ? 1 : 0));
}

function render(rows: readonly CityRow[]): string {
  const lines = rows.map(
    ({ zone, ar, en, aliases }) =>
      `  { zone: ${JSON.stringify(zone)}, ar: ${JSON.stringify(ar)}, en: ${JSON.stringify(en)}, aliases: ${JSON.stringify(aliases)} },`,
  );
  return [
    '// GENERATED by scripts/dev/build-time-zone-cities.ts from CLDR 48.2.0 (Unicode License v3,',
    '// Copyright © 1991-2025 Unicode, Inc.). Never edit by hand: rerun the script (its header names the',
    '// three files and their hashes) and commit the result.',
    "import type { TimeZoneCity } from './cities.js';",
    '',
    '/** Every zone a person may live by, its city in Arabic and English, sorted by zone. */',
    'export const TIME_ZONE_CITIES: readonly TimeZoneCity[] = [',
    ...lines,
    '];',
    '',
  ].join('\n');
}

function accepts(zone: string): boolean {
  try {
    assertTimeZone('timezone', zone);
    return true;
  } catch {
    return false;
  }
}

function readPinned(path: string, name: keyof typeof SOURCES): unknown {
  const source = readFileSync(path);
  const digest = createHash('sha256').update(source).digest('hex');
  if (digest !== SOURCES[name]) {
    throw new Error(
      `the ${name} file's SHA-256 is ${digest}, not the recorded ${SOURCES[name]}; nothing was written`,
    );
  }
  return JSON.parse(source.toString('utf8'));
}

async function main(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: { ar: { type: 'string' }, en: { type: 'string' }, bcp47: { type: 'string' } },
  });
  if (values.ar === undefined || values.en === undefined || values.bcp47 === undefined) {
    process.stderr.write('build-time-zone-cities: --ar, --en and --bcp47 are required\n');
    return 2;
  }
  try {
    const rows = buildCityRows(
      readPinned(values.ar, 'ar'),
      readPinned(values.en, 'en'),
      readPinned(values.bcp47, 'bcp47'),
      accepts,
    );
    const options = (await resolveConfig(OUTPUT)) ?? {};
    writeFileSync(OUTPUT, await format(render(rows), { ...options, filepath: OUTPUT }));
    process.stdout.write(`build-time-zone-cities: wrote ${rows.length} zones\n`);
    return 0;
  } catch (error: unknown) {
    process.stderr.write(`build-time-zone-cities: ${(error as Error).message}\n`);
    return 1;
  }
}

// Run as a command (tsx), never when a test imports this file.
if (basename(process.argv[1] ?? '') === 'build-time-zone-cities.ts') {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
