// T083 (B16 check, decision 7) — the web pages' copy, generated from the phone catalogue.
//
// The phone catalogue is the one source of the deletion pages' words: `scripts/build-web-copy.ts`
// copies the keys the API renders, in both languages, into `apps/api/src/platform/web/i18n/`, and
// `pnpm check:generated` refuses a copy that differs from what the catalogue generates now (R-PROC-9).
// The keys are taken whole and at their own paths, so a page names a key exactly as the phone does.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  generateWebCopy,
  generateWebCopyFromRepository,
  pickCopy,
  WEB_COPY_FILES,
  WEB_COPY_KEYS,
} from '../../scripts/build-web-copy';
import { checkWebCopy, describeDrift } from '../../scripts/generated-file-check';

const root = join(__dirname, '..', '..');

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function rootHolding(files: Readonly<Record<string, string>>): string {
  const directory = mkdtempSync(join(tmpdir(), 'ijazah-web-copy-'));
  directories.push(directory);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), text);
  }
  return directory;
}

const catalogue = {
  common: { brand: { mark: 'إ', name: 'إجازة' }, other: 'not copied' },
  auth: { field: { emailInvalid: 'e' }, otp: { invalid: 'o', title: 'not copied' } },
  web: { deleteAccount: { title: 't', done: { lede: 'l' } }, notFound: { title: 'n' }, verify: {} },
  student: { home: 'not copied' },
};

describe('the keys taken from the catalogue', () => {
  it('takes the deletion and not-found groups and the shared keys the pages name, at their own paths', () => {
    expect(WEB_COPY_KEYS).toEqual([
      'common.brand',
      'auth.field.emailInvalid',
      'auth.otp.invalid',
      'web.deleteAccount',
      'web.notFound',
    ]);
    expect(pickCopy(catalogue, WEB_COPY_KEYS)).toEqual({
      common: { brand: { mark: 'إ', name: 'إجازة' } },
      auth: { field: { emailInvalid: 'e' }, otp: { invalid: 'o' } },
      web: { deleteAccount: { title: 't', done: { lede: 'l' } }, notFound: { title: 'n' } },
    });
  });

  it('fails on a key the catalogue does not hold, naming it', () => {
    expect(() =>
      pickCopy({ common: { brand: {} } }, ['common.brand', 'web.deleteAccount']),
    ).toThrow(/web\.deleteAccount/);
  });
});

describe('the generated files', () => {
  it('writes one TypeScript module per language, marked generated, from its own catalogue', async () => {
    const files = await generateWebCopy(root, {
      ar: JSON.stringify(catalogue),
      en: JSON.stringify({ ...catalogue, common: { brand: { mark: 'I', name: 'Ijazah' } } }),
    });
    expect(Object.keys(files)).toEqual([...WEB_COPY_FILES]);
    const [arabic, english] = WEB_COPY_FILES.map((path) => files[path] ?? '');
    expect(arabic).toMatch(/^\/\/ GENERATED from apps\/mobile\/src\/i18n\/ar\.json/);
    expect(arabic).toContain('pnpm web-copy:build');
    expect(arabic).toContain('export const ar = {');
    expect(arabic).toContain('إجازة');
    expect(arabic).not.toContain('not copied');
    expect(english).toContain('export const en = {');
    expect(english).toContain('Ijazah');
  });

  it('are what this repository’s catalogue generates, and carry the honest copy of decision 4', async () => {
    const files = await generateWebCopyFromRepository(root);
    expect(files['apps/api/src/platform/web/i18n/ar.ts']).toContain('honest');
    expect(await checkWebCopy(root)).toEqual([]);
  });
});

describe('the drift check (R-PROC-9)', () => {
  const generated = Object.fromEntries(WEB_COPY_FILES.map((path) => [path, `// ${path}\n`]));
  const generate = (): Promise<Readonly<Record<string, string>>> => Promise.resolve(generated);

  it('passes copies that are what the catalogue generates', async () => {
    expect(await checkWebCopy(rootHolding(generated), generate)).toEqual([]);
  });

  it('fails a copy edited by hand and a copy missing, naming R-PROC-9 and the command to run', async () => {
    const [first, second] = WEB_COPY_FILES;
    const drifts = await checkWebCopy(rootHolding({ [first]: '// edited by hand\n' }), generate);
    expect(drifts.map((drift) => drift.path)).toEqual([first, second]);
    expect(drifts[0]?.problem).toContain('differs from what apps/mobile/src/i18n');
    expect(drifts[1]?.problem).toBe('is missing');
    const message = describeDrift(drifts[0] ?? { path: '', problem: '', command: '' });
    expect(message).toContain('R-PROC-9');
    expect(message).toContain('pnpm web-copy:build');
  });
});
