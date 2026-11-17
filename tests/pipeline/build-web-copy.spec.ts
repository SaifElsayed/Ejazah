// T083 (B16 check, decision 7) — the web pages' copy, generated from the phone catalogue.
//
// The phone catalogue is the one source of the deletion pages' words: `scripts/build-web-copy.ts`
// copies the keys the API renders, in both languages, into `apps/api/src/platform/web/i18n/`, and
// `pnpm check:generated` refuses a copy that differs from what the catalogue generates now (R-PROC-9).
// The keys are taken whole and at their own paths, so a page names a key exactly as the phone does.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { pushCopyRenderer } from '../../apps/api/src/jobs/deliver-notification';
import { NOTIFICATION_KINDS } from '../../apps/api/src/modules/notifications/index';
import { copyOf } from '../../apps/api/src/platform/web/copy';
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
  web: {
    deleteAccount: { title: 't', brandName: 'إجازة', done: { lede: 'l' } },
    notFound: { title: 'n' },
    verify: {},
  },
  student: { home: 'not copied' },
  notifications: { push: { session_reminder: { title: 'p' } }, title: 'not copied' },
};

describe('the keys taken from the catalogue', () => {
  it('takes the deletion and not-found groups and the push texts, and nothing else, at their own paths', () => {
    expect(WEB_COPY_KEYS).toEqual(['web.deleteAccount', 'web.notFound', 'notifications.push']);
    expect(pickCopy(catalogue, WEB_COPY_KEYS)).toEqual({
      web: {
        deleteAccount: { title: 't', brandName: 'إجازة', done: { lede: 'l' } },
        notFound: { title: 'n' },
      },
      notifications: { push: { session_reminder: { title: 'p' } } },
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
      en: JSON.stringify({
        ...catalogue,
        web: {
          ...catalogue.web,
          deleteAccount: { ...catalogue.web.deleteAccount, brandName: 'Ijazah' },
        },
      }),
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

// T005 of specs/005-certification (Q5 (a); R-HONEST-5's note of 2026-11-17; `002:T123`): the push's
// fixed title and body of each of the seven kinds, which `deliver-notification`'s renderer reads from
// the generated copy in the user's language. Each is in both catalogues, holds no placeholder (no
// name, amount or date), and the Arabic opens with one right-to-left mark: the device lays the push
// out itself, outside the phone's `translate` that adds the mark in the application, and takes its
// direction from the first strong character. The English carries none.
describe('the push texts (T005)', () => {
  const catalogueOf = (language: 'ar' | 'en'): unknown =>
    JSON.parse(readFileSync(join(root, `apps/mobile/src/i18n/${language}.json`), 'utf8'));
  const textAt = (catalogue: unknown, key: string): unknown =>
    key
      .split('.')
      .reduce<unknown>(
        (node, part) =>
          typeof node === 'object' && node !== null
            ? (node as Record<string, unknown>)[part]
            : undefined,
        catalogue,
      );
  const keys = NOTIFICATION_KINDS.flatMap((kind) =>
    (['title', 'body'] as const).map((part) => `notifications.push.${kind}.${part}`),
  );

  it('holds a fixed title and body for each of the seven kinds in both languages', () => {
    expect(keys).toHaveLength(14);
    for (const language of ['ar', 'en'] as const) {
      const catalogue = catalogueOf(language);
      const unfit = keys.filter((key) => {
        const text = textAt(catalogue, key);
        return typeof text !== 'string' || text.trim().length === 0 || /[{}]/.test(text);
      });
      expect(unfit, language).toEqual([]);
    }
  });

  it('opens each Arabic text with one right-to-left mark, and no English one with any', () => {
    const arabic = catalogueOf('ar');
    const english = catalogueOf('en');
    expect(keys.filter((key) => !/^\u200F(?!\u200F)/u.test(String(textAt(arabic, key))))).toEqual(
      [],
    );
    expect(keys.filter((key) => String(textAt(english, key)).includes('\u200F'))).toEqual([]);
  });

  it('builds the worker’s renderer over the generated copy, as worker.ts binds it', () => {
    const render = pushCopyRenderer({ ar: copyOf('ar'), en: copyOf('en') });
    expect(render('session_reminder', 'ar').title.startsWith('\u200F')).toBe(true);
    expect(render('payment_failed', 'en')).toEqual({
      title: 'Payment failed',
      body: 'Your payment did not go through. Try again from the app.',
    });
  });

  it('reaches the API through the generated copy', () => {
    for (const language of ['ar', 'en'] as const) {
      expect(pickCopy(catalogueOf(language), WEB_COPY_KEYS)).toMatchObject({
        notifications: { push: textAt(catalogueOf(language), 'notifications.push') },
      });
    }
  });
});
