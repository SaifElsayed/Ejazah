// T083 (B16 check, decision 7): the copy of the public pages the API renders, generated from the
// phone catalogue and never edited by hand (R-PROC-9, checked by `pnpm check:generated`).
//
//   pnpm web-copy:build
//
// The phone catalogue (`apps/mobile/src/i18n/{ar,en}.json`) is the one source of every user-facing
// word, the web pages' included: its `web` group holds them. The API renders the deletion pages
// (T083), so the keys they name are copied here, whole and at their own paths, into one TypeScript
// module per language under `apps/api/src/platform/web/i18n/`: the `web.deleteAccount` and
// `web.notFound` groups, and nothing else, so the copy the API renders stays closed on itself; the
// brand and the two error lines the pages share with the phone are repeated inside the group (the
// owner's answer to B16's review, 2026-10-26). `web.verify` is Phase 4's.
//
// T005 of specs/005-certification (Q5 (a)): `notifications.push` too, the seven kinds' fixed push
// titles and bodies, which the worker's `deliver-notification` renders in the user's language at send
// time (`pushCopyRenderer`).
//
// WHAT IS WRITTEN
//
//   apps/api/src/platform/web/i18n/ar.ts   `export const ar = { … }`: the Arabic keys
//   apps/api/src/platform/web/i18n/en.ts   `export const en = { … }`: the English keys
//
// A key the catalogue does not hold fails the build, naming it. Both files go through the
// repository's Prettier configuration, as the token generator's TypeScript does.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { format, resolveConfig } from 'prettier';

const repositoryRoot = join(__dirname, '..');

/** The two catalogues, the only source. */
export const WEB_COPY_SOURCES = {
  ar: 'apps/mobile/src/i18n/ar.json',
  en: 'apps/mobile/src/i18n/en.json',
} as const;

export type WebCopyLanguage = keyof typeof WEB_COPY_SOURCES;

/** The keys the API's pages render, each a group or a leaf of the catalogue, copied whole. */
export const WEB_COPY_KEYS = ['web.deleteAccount', 'web.notFound', 'notifications.push'] as const;

/** Every file this generator writes, in the order of the languages. */
export const WEB_COPY_FILES = [
  'apps/api/src/platform/web/i18n/ar.ts',
  'apps/api/src/platform/web/i18n/en.ts',
] as const;

export type WebCopyPath = (typeof WEB_COPY_FILES)[number];

const FILE_OF: Readonly<Record<WebCopyLanguage, WebCopyPath>> = {
  ar: 'apps/api/src/platform/web/i18n/ar.ts',
  en: 'apps/api/src/platform/web/i18n/en.ts',
};

type Group = { [key: string]: unknown };

function isGroup(value: unknown): value is Group {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The keys of `catalogue` named by `keys`, each at its own path; fails naming a missing key. */
export function pickCopy(catalogue: unknown, keys: readonly string[]): Group {
  const picked: Group = {};
  for (const key of keys) {
    const segments = key.split('.');
    let source: unknown = catalogue;
    for (const segment of segments) {
      source = isGroup(source) && Object.hasOwn(source, segment) ? source[segment] : undefined;
    }
    if (source === undefined) throw new Error(`web copy: the catalogue has no key ${key}`);
    let target = picked;
    for (const segment of segments.slice(0, -1)) {
      const next = target[segment];
      target = isGroup(next) ? next : (target[segment] = {});
    }
    target[segments.at(-1) ?? key] = source;
  }
  return picked;
}

function renderCopyTs(language: WebCopyLanguage, copy: Group): string {
  return `// GENERATED from ${WEB_COPY_SOURCES[language]} by scripts/build-web-copy.ts. Do not edit; run \`pnpm web-copy:build\`.
export const ${language} = ${JSON.stringify(copy, null, 2)};
`;
}

async function formatted(root: string, path: string, text: string): Promise<string> {
  const options = (await resolveConfig(join(root, path))) ?? {};
  return format(text, { ...options, filepath: join(root, path) });
}

/** Every generated file's text, keyed by its path, from the two catalogues' text. */
export async function generateWebCopy(
  root: string,
  catalogues: Readonly<Record<WebCopyLanguage, string>>,
): Promise<Record<WebCopyPath, string>> {
  const files = {} as Record<WebCopyPath, string>;
  for (const language of Object.keys(WEB_COPY_SOURCES) as WebCopyLanguage[]) {
    const copy = pickCopy(JSON.parse(catalogues[language]) as unknown, WEB_COPY_KEYS);
    const path = FILE_OF[language];
    files[path] = await formatted(root, path, renderCopyTs(language, copy));
  }
  return files;
}

/** Reads the two catalogues under `root` and returns everything they generate. */
export function generateWebCopyFromRepository(root: string): Promise<Record<WebCopyPath, string>> {
  return generateWebCopy(root, {
    ar: readFileSync(join(root, WEB_COPY_SOURCES.ar), 'utf8'),
    en: readFileSync(join(root, WEB_COPY_SOURCES.en), 'utf8'),
  });
}

async function main(): Promise<void> {
  const files = await generateWebCopyFromRepository(repositoryRoot);
  for (const path of WEB_COPY_FILES) {
    mkdirSync(dirname(join(repositoryRoot, path)), { recursive: true });
    writeFileSync(join(repositoryRoot, path), files[path]);
    process.stdout.write(`web copy: wrote ${path}\n`);
  }
}

// Run as a command (`pnpm web-copy:build`, tsx), never when a test or the generated-file check
// imports this file.
if (basename(process.argv[1] ?? '') === 'build-web-copy.ts') {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
