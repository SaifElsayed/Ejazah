// T161 — the key-parity check of R-MOBILE-7 (US1 scenario 5, SC-003).
//
// Every user-facing string goes through an i18n key present in both `ar.json` and `en.json`. The
// check reads both files and refuses every key one has and the other lacks, nested keys included,
// naming the file that lacks it. A file it cannot read, or one that is not a JSON object, stops it
// with exit 2 and judges nothing.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { main, missingKeys } from '../../scripts/i18n-key-parity';

const root = join(__dirname, '..', '..');
const AR = 'apps/mobile/src/i18n/ar.json';
const EN = 'apps/mobile/src/i18n/en.json';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** A throwaway repository holding the two files as given (a string is written as it is). */
function repository(ar: unknown, en: unknown): string {
  const cwd = mkdtempSync(join(tmpdir(), 'ijazah-i18n-parity-'));
  directories.push(cwd);
  for (const [path, value] of [
    [AR, ar],
    [EN, en],
  ] as const) {
    if (value === undefined) continue;
    const file = join(cwd, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  }
  return cwd;
}

function run(cwd: string, argv: readonly string[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  const code = main(argv, cwd, {
    out: (text) => out.push(text),
    err: (text) => err.push(text),
  });
  return { code, out: out.join(''), err: err.join('') };
}

describe('the i18n key-parity check (T161, R-MOBILE-7)', () => {
  it('passes silently when both files hold the same keys, nested ones included', () => {
    const keys = { greeting: 'x', booking: { confirm: 'x', cancel: { title: 'x' } } };
    const result = run(repository(keys, keys));
    expect(result).toEqual({ code: 0, out: '', err: '' });
  });

  it('passes on two empty files, as the repository holds today', () => {
    expect(run(repository({}, {})).code).toBe(0);
  });

  it('refuses a key en.json lacks, naming R-MOBILE-7, the file and the key', () => {
    const result = run(
      repository({ greeting: 'أهلًا', farewell: 'مع السلامة' }, { greeting: 'Hi' }),
    );
    expect(result.code).toBe(1);
    expect(result.err).toContain('R-MOBILE-7');
    expect(result.err).toContain(`${EN} lacks the key "farewell"`);
    expect(result.err).not.toContain(`${AR} lacks`);
  });

  it('refuses a key ar.json lacks, in the other direction', () => {
    const result = run(repository({}, { settings: { title: 'Settings' } }));
    expect(result.code).toBe(1);
    expect(result.err).toContain(`${AR} lacks the key "settings.title"`);
  });

  it('reads nested keys by their full path, so a key moved to another parent is two refusals', () => {
    const result = run(repository({ booking: { confirm: 'x' } }, { session: { confirm: 'x' } }));
    expect(result.code).toBe(1);
    expect(result.err).toContain(`${EN} lacks the key "booking.confirm"`);
    expect(result.err).toContain(`${AR} lacks the key "session.confirm"`);
  });

  it('refuses a key that is a string in one file and a group in the other', () => {
    const result = run(repository({ title: 'x' }, { title: { short: 'x' } }));
    expect(result.code).toBe(1);
    expect(result.err).toContain(`${EN} lacks the key "title"`);
    expect(result.err).toContain(`${AR} lacks the key "title.short"`);
  });

  it('lists every refusal, the ar.json side first, each in key order', () => {
    const result = run(repository({ b: 'x', a: 'x' }, { d: 'x', c: 'x' }));
    const lines = result.err.trim().split('\n');
    expect(lines).toHaveLength(4);
    expect(lines.map((line) => /lacks the key "([^"]+)"/.exec(line)?.[1])).toEqual([
      'c',
      'd',
      'a',
      'b',
    ]);
  });

  it('passes on this repository as it stands', () => {
    expect(run(root).code).toBe(0);
  });

  it('reads other files when given --ar and --en', () => {
    const cwd = repository({ a: 'x' }, { a: 'x' });
    writeFileSync(join(cwd, 'other-en.json'), '{}');
    const result = run(cwd, ['--ar', AR, '--en', 'other-en.json']);
    expect(result.code).toBe(1);
    expect(result.err).toContain('other-en.json lacks the key "a"');
  });

  it.each([
    ['a missing file', undefined, {}],
    ['a file that is not JSON', '{ not json', {}],
    ['a file whose top level is an array', [], {}],
    ['a file whose top level is a string', '"text"', {}],
  ])('stops with exit 2 on %s, judging nothing', (_case, ar, en) => {
    const result = run(repository(ar, en));
    expect(result.code).toBe(2);
    expect(result.err).toContain('i18n key parity:');
    expect(result.err).not.toContain('R-MOBILE-7:');
  });

  it.each([[['--unknown']], [['positional']], [['--ar']], [['--en', '']]])(
    'stops with exit 2 on the bad arguments %j',
    (argv) => {
      expect(run(repository({}, {}), argv).code).toBe(2);
    },
  );

  it('names a key holding a non-string leaf, such as a number, as a key like any other', () => {
    expect(missingKeys({ count: 1, list: ['x'] }, {})).toEqual(['count', 'list']);
  });
});
