// T161: the key-parity check of R-MOBILE-7 (US1 scenario 5).
//
//   pnpm check:i18n [--ar <file>] [--en <file>]
//
// R-MOBILE-7 puts every user-facing string behind an i18n key "in both `ar.json` and `en.json`".
// The lint tier refuses a literal in JSX; this is the CI tier: the two files must hold the same
// set of keys. A key is the full path of a leaf, nested groups joined by dots (`booking.confirm`),
// so a key moved under another parent, or a string in one file that is a group in the other, is
// refused on both sides. Any value that is not a group is a leaf, a number or a list included;
// whether a leaf is a usable string is not this check's concern.
//
// Exit 0 silently when the sets are equal; 1 listing every key one file lacks, the `ar.json` side
// first, each in key order; 2 on a bad argument, or a file that cannot be read, is not JSON, or
// is not a JSON object at its top level, in which case nothing is judged.
import { readFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';

const repositoryRoot = join(__dirname, '..');

/** The two files read by default, relative to the repository root. */
export const DEFAULT_AR = 'apps/mobile/src/i18n/ar.json';
export const DEFAULT_EN = 'apps/mobile/src/i18n/en.json';

type Group = Readonly<Record<string, unknown>>;

function isGroup(value: unknown): value is Group {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every leaf key of `group`, as its full dotted path. */
function leafKeys(group: Group, prefix = ''): string[] {
  return Object.entries(group).flatMap(([key, value]) => {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    return isGroup(value) ? leafKeys(value, path) : [path];
  });
}

/** The leaf keys `from` holds and `to` lacks, in code-point order. */
export function missingKeys(from: Group, to: Group): string[] {
  const held = new Set(leafKeys(to));
  return leafKeys(from)
    .filter((key) => !held.has(key))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export interface Streams {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

function readGroup(file: string): Group {
  const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!isGroup(value)) throw new Error('its top level is not a JSON object');
  return value;
}

export function main(argv: readonly string[], cwd: string, streams: Streams): number {
  let values: { ar?: string; en?: string };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: { ar: { type: 'string' }, en: { type: 'string' } },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error: unknown) {
    streams.err(`i18n key parity: ${error instanceof Error ? error.message : 'bad arguments'}\n`);
    return 2;
  }
  if (values.ar === '' || values.en === '') {
    streams.err('i18n key parity: --ar and --en each need a file\n');
    return 2;
  }
  const arFile = resolve(cwd, values.ar ?? DEFAULT_AR);
  const enFile = resolve(cwd, values.en ?? DEFAULT_EN);
  const shown = (path: string): string => relative(cwd, path).split(sep).join('/');

  const groups: Group[] = [];
  for (const file of [arFile, enFile]) {
    try {
      groups.push(readGroup(file));
    } catch (error: unknown) {
      streams.err(
        `i18n key parity: cannot read ${shown(file)}: ${error instanceof Error ? error.message : String(error)}; no key was judged\n`,
      );
      return 2;
    }
  }
  const [ar = {}, en = {}] = groups;

  const refusals = [
    ...missingKeys(en, ar).map((key) => ({ file: arFile, other: enFile, key })),
    ...missingKeys(ar, en).map((key) => ({ file: enFile, other: arFile, key })),
  ];
  for (const { file, other, key } of refusals) {
    streams.err(
      `R-MOBILE-7: ${shown(file)} lacks the key "${key}", which ${shown(other)} has; every user-facing string has its key in both ar.json and en.json.\n`,
    );
  }
  return refusals.length === 0 ? 0 : 1;
}

// Run as a command (`pnpm check:i18n`, tsx), never when a test imports this file. tsx compiles it
// as CommonJS, so neither top-level await nor `import.meta` is available.
if (basename(process.argv[1] ?? '') === 'i18n-key-parity.ts') {
  process.exitCode = main(process.argv.slice(2), repositoryRoot, {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
}
