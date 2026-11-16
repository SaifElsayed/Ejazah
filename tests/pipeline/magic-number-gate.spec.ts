// T157 — the R-MONEY-12 magic-number gate (FR-034, SC-003).
//
// Every operational number — a threshold, a window, an offset, a limit — is read from `settings`
// when it is needed and never exists as a constant in code (FR-034). The gate reads every
// TypeScript source file under `apps/api/src/modules/`, specs excluded, and refuses each numeric
// literal other than 0 and 1, naming R-MONEY-12, the file, the line and column, and the literal.
// It reads the TypeScript syntax tree, never the text, so a number in a comment, a string, a
// template's text or a regular expression is never read: comments here carry task and rule ids.
//
// Each case builds a throwaway tree, except the two that run the gate over this repository: the
// real modules pass as they stand, and `tests/violations/fixtures/**`, whose T024 fixture carries
// `7 * 24 * 60 * 60 * 1000` under a `modules/` path on purpose (note under T081, PR #11), lies
// outside the default root and is never read.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { findMagicNumbers, main } from '../../scripts/magic-number-gate';

const root = join(__dirname, '..', '..');
const MODULES = 'apps/api/src/modules';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function write(cwd: string, path: string, text: string): void {
  const file = join(cwd, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/** A throwaway repository: the given files, written under it. */
function repository(files: Readonly<Record<string, string>>): string {
  const cwd = mkdtempSync(join(tmpdir(), 'ijazah-magic-numbers-'));
  directories.push(cwd);
  for (const [path, text] of Object.entries(files)) write(cwd, path, text);
  return cwd;
}

/** The literals the gate refuses in one file's text, as written. */
function literalsIn(text: string, fileName = 'booking.service.ts'): string[] {
  return findMagicNumbers(text, fileName).map((refusal) => refusal.literal);
}

/** The 1-based line and column of the first occurrence of `needle` in `text`. */
function positionOf(text: string, needle: string): string {
  const offset = text.indexOf(needle);
  expect(offset, `${needle} is in the text`).toBeGreaterThanOrEqual(0);
  const before = text.slice(0, offset).split('\n');
  return `${before.length}:${(before.at(-1) ?? '').length + 1}`;
}

const output = { out: '', err: '' };
const streams = {
  out: (text: string) => {
    output.out += text;
  },
  err: (text: string) => {
    output.err += text;
  },
};
afterEach(() => {
  output.out = '';
  output.err = '';
});

describe('a number used as a threshold, a limit or a window is refused, naming R-MONEY-12 (FR-034)', () => {
  it('refuses a threshold in a service, naming the file, the line and column, and settings', () => {
    const service = [
      '// T157 — an attendance check',
      'export function isAttended(connectedPercent: number): boolean {',
      '  return connectedPercent >= 70;',
      '}',
      '',
    ].join('\n');
    const cwd = repository({ [`${MODULES}/sessions/sessions.service.ts`]: service });
    expect(main([], cwd, streams)).toBe(1);
    expect(output.out).toBe('');
    const lines = output.err.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('R-MONEY-12');
    expect(lines[0]).toContain(
      `${MODULES}/sessions/sessions.service.ts:${positionOf(service, '70')}`,
    );
    expect(lines[0]).toContain('70');
    expect(lines[0]).toContain('settings');
    expect(lines[0]).toContain('FR-034');
  });

  it('refuses a single-digit limit, `limit: 5`', () => {
    expect(literalsIn('export const page = { limit: 5 };\n')).toEqual(['5']);
  });

  it('refuses both factors of a window such as `15 * 60`', () => {
    expect(literalsIn('export const holdSeconds = 15 * 60;\n')).toEqual(['15', '60']);
  });

  it('refuses an offset, a fraction and a negative number, judged on the literal', () => {
    expect(
      literalsIn('export const a = start + 2;\nexport const b = 0.7;\nexport const c = -5;\n'),
    ).toEqual(['2', '0.7', '5']);
  });

  it('refuses a literal wherever it is written: a literal type, an enum member, a readonly class property, an array index', () => {
    const text = [
      'export type Limit = 5;',
      'export enum Tier { Gold = 3 }',
      'export class Pager { readonly #size = 20; }',
      'export const third = (rows: readonly string[]) => rows[2];',
      '',
    ].join('\n');
    expect(literalsIn(text)).toEqual(['5', '3', '20', '2']);
  });

  it('refuses a BigInt literal and a literal written with numeric separators, quoting it as written', () => {
    expect(
      literalsIn('export const a = 30n;\nexport const b = 86_400;\nexport const c = 0x10;\n'),
    ).toEqual(['30n', '86_400', '0x10']);
  });
});

describe('what the gate accepts', () => {
  it('accepts 0 and 1, in any spelling, and -1, whose literal is 1', () => {
    const text = [
      'export function last<T>(items: readonly T[]): T | undefined {',
      '  if (items.length === 0) return undefined;',
      '  return items[items.length - 1] ?? items.at(-1);',
      '}',
      'export const next = (count: number) => count + 1;',
      'export const none = 0n + 1n;',
      'export const spelled = [0.0, 1.0, 0x1, 1e0, 0b1];',
      '',
    ].join('\n');
    expect(literalsIn(text)).toEqual([]);
  });

  it('accepts a number inside a comment, which carries task and rule ids', () => {
    const text = [
      '// T024, R-MONEY-12: wait 15 minutes, 7 * 24 * 60 * 60 * 1000',
      '/* FR-034 limit: 5 */',
      '/** @see SRS §3.14, default 72 hours */',
      'export {};',
      '',
    ].join('\n');
    expect(literalsIn(text)).toEqual([]);
  });

  it('accepts a number inside a string, a template’s text or a regular expression', () => {
    const text = [
      "export const label = 'retry in 15 minutes (R-MONEY-12)';",
      'export const sentence = (count: number) => `${count} of 10 within 24h`;',
      'export const taskId = /^T\\d{3,}$/;',
      '',
    ].join('\n');
    expect(literalsIn(text)).toEqual([]);
  });

  it('accepts the text of a JSX element in a .tsx file and refuses a literal in its expression', () => {
    const text = 'export const notice = <p title="15">15 minutes {count + 2}</p>;\n';
    expect(literalsIn(text, 'notice.tsx')).toEqual(['2']);
  });
});

describe('which files are read', () => {
  it('reads .ts, .tsx, .mts and .cts sources and skips specs, tests, __fixtures__ and other files', () => {
    const cwd = repository({
      [`${MODULES}/booking/booking.service.ts`]: 'export const a = 2;\n',
      [`${MODULES}/booking/view.tsx`]: 'export const b = 3;\n',
      [`${MODULES}/booking/esm.mts`]: 'export const c = 4;\n',
      [`${MODULES}/booking/cjs.cts`]: 'export const d = 5;\n',
      [`${MODULES}/booking/booking.service.spec.ts`]: 'export const e = 6;\n',
      [`${MODULES}/booking/booking.service.test.ts`]: 'export const f = 7;\n',
      [`${MODULES}/booking/view.spec.tsx`]: 'export const g = 8;\n',
      [`${MODULES}/booking/__fixtures__/slot.ts`]: 'export const h = 9;\n',
      [`${MODULES}/booking/legacy.js`]: 'export const i = 10;\n',
      [`${MODULES}/booking/README.md`]: 'Hold for 15 minutes.\n',
      [`${MODULES}/booking/defaults.json`]: '{ "ttl": 10 }\n',
    });
    expect(main([], cwd, streams)).toBe(1);
    const files = output.err
      .trim()
      .split('\n')
      .map((line) => /(apps\/\S+):\d+:\d+/.exec(line)?.[1]);
    expect(files).toEqual([
      `${MODULES}/booking/booking.service.ts`,
      `${MODULES}/booking/cjs.cts`,
      `${MODULES}/booking/esm.mts`,
      `${MODULES}/booking/view.tsx`,
    ]);
  });

  it('lists every refusal, across files, in path and position order', () => {
    const cwd = repository({
      [`${MODULES}/sessions/evaluate.ts`]:
        'export const graceMinutes = 2;\nexport const joinWindow = 10 * 60;\n',
      [`${MODULES}/booking/hold.ts`]: 'export const ttl = 15;\n',
    });
    expect(main([], cwd, streams)).toBe(1);
    const lines = output.err.trim().split('\n');
    expect(lines).toHaveLength(4);
    expect(lines.every((line) => line.startsWith('R-MONEY-12'))).toBe(true);
    expect(lines.map((line) => /modules\/(\S+:\d+:\d+)/.exec(line)?.[1])).toEqual([
      'booking/hold.ts:1:20',
      'sessions/evaluate.ts:1:29',
      'sessions/evaluate.ts:2:27',
      'sessions/evaluate.ts:2:32',
    ]);
  });

  it('passes a clean tree silently, with exit 0', () => {
    const cwd = repository({
      [`${MODULES}/booking/index.ts`]: '// PUBLIC ENTRY (T017, R-API-3)\nexport {};\n',
    });
    expect(main([], cwd, streams)).toBe(0);
    expect(output).toEqual({ out: '', err: '' });
  });

  // T053 (FR-497; the note under T053, B43): Phase 3's two modules are under the default root, so a
  // narrowed `DEFAULT_ROOT` turns this case red before any module could carry a number unseen.
  it('reads modules/sessions and modules/chat by default (T053)', () => {
    const cwd = repository({
      'apps/api/src/modules/sessions/evaluation.service.ts': 'export const graceMinutes = 2;\n',
      'apps/api/src/modules/chat/chat.service.ts': 'export const maxFiles = 3;\n',
    });
    expect(main([], cwd, streams)).toBe(1);
    const files = output.err
      .trim()
      .split('\n')
      .map((line) => /(apps\/\S+):\d+:\d+/.exec(line)?.[1]);
    expect(files).toEqual([
      'apps/api/src/modules/chat/chat.service.ts',
      'apps/api/src/modules/sessions/evaluation.service.ts',
    ]);
  });

  it('reads the tree --root names instead of the default', () => {
    const cwd = repository({
      [`${MODULES}/booking/index.ts`]: 'export {};\n',
      'elsewhere/limits.ts': 'export const limit = 5;\n',
    });
    expect(main([], cwd, streams)).toBe(0);
    expect(main(['--root', 'elsewhere'], cwd, streams)).toBe(1);
    expect(output.err).toContain('elsewhere/limits.ts:1:22');
  });
});

describe('tests/violations/fixtures/** is never read (note under T081, PR #11)', () => {
  it('passes a repository whose only magic number sits in a fixture tree under a modules/ path', () => {
    const cwd = repository({
      [`${MODULES}/sessions/index.ts`]: 'export {};\n',
      [`tests/violations/fixtures/${MODULES}/sessions/next-occurrence.ts`]:
        'export const week = 7 * 24 * 60 * 60 * 1000;\n',
    });
    expect(main([], cwd, streams)).toBe(0);
    expect(output.err).toBe('');
  });

  it('passes this repository, although the T024 fixture it holds is refused when the gate is pointed at it', () => {
    const fixtures = `tests/violations/fixtures/${MODULES}/sessions`;
    expect(main(['--root', fixtures], root, streams)).toBe(1);
    const fixtureLines = output.err
      .split('\n')
      .filter((line) => line.includes(`${fixtures}/next-occurrence.ts:`));
    expect(fixtureLines.map((line) => / literal (\S+) /.exec(line)?.[1])).toEqual([
      '7',
      '24',
      '60',
      '60',
      '1000',
    ]);
    output.err = '';
    expect(main([], root, streams)).toBe(0);
    expect(output).toEqual({ out: '', err: '' });
  });
});

describe('the command', () => {
  it('exits 2 when the root cannot be read: missing, or a file', () => {
    const cwd = repository({ 'not-a-folder.ts': 'export {};\n' });
    expect(main([], cwd, streams)).toBe(2);
    expect(output.err).toContain(MODULES);
    output.err = '';
    expect(main(['--root', 'not-a-folder.ts'], cwd, streams)).toBe(2);
    expect(output.err).toContain('not-a-folder.ts');
  });

  it('exits 2 on a bad argument', () => {
    const cwd = repository({ [`${MODULES}/booking/index.ts`]: 'export {};\n' });
    expect(main(['--base', 'develop'], cwd, streams)).toBe(2);
    expect(main(['apps'], cwd, streams)).toBe(2);
    expect(main(['--root'], cwd, streams)).toBe(2);
    expect(main(['--root', ''], cwd, streams)).toBe(2);
    expect(output.out).toBe('');
  });
});
