// R3 T183 (Q-5 (a)): one redaction list for every crash report. The phone's and the panel's
// reporting modules each carry a copy of the API's list (`apps/api/src/platform/logging/logger.ts`
// `redactedKeys`), since neither app can import the API's code; this spec keeps the three lists
// equal as sets, so a key added to or removed from one fails here until the others follow.
//
// The two copies are read from their source, not imported: the modules load the Sentry SDKs, which
// only their apps' own runners can load. The list's initializer is plain JavaScript (strings,
// spreads, `map`), evaluated here as `build-tokens.spec.ts` evaluates a token's value.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { redactedKeys } from '../../apps/api/src/platform/logging/logger';

const root = join(__dirname, '..', '..');

const COPIES = ['apps/mobile/src/lib/reporting.ts', 'apps/admin/src/lib/reporting.ts'] as const;

const DECLARATION = 'export const redactedKeys: readonly (readonly string[])[] = [';
const END = '\n];\n';

/** The list a reporting module declares, evaluated from its source. */
function listIn(file: string): readonly (readonly string[])[] {
  const source = readFileSync(join(root, file), 'utf8').replace(/\r\n/g, '\n');
  const start = source.indexOf(DECLARATION);
  expect(start, `${file} declares redactedKeys`).toBeGreaterThanOrEqual(0);
  const open = start + DECLARATION.length - 1;
  const close = source.indexOf(END, open);
  expect(close, `${file} closes the list`).toBeGreaterThan(open);
  const list: unknown = runInNewContext(`(${source.slice(open, close + 2)})`);
  expect(Array.isArray(list)).toBe(true);
  return list as readonly (readonly string[])[];
}

/** A list as a set of entries, each entry its words in order. */
function asSet(list: readonly (readonly string[])[]): string[] {
  return [...new Set(list.map((words) => words.join(' ')))].sort();
}

describe('the crash reports’ redaction list', () => {
  it('is the API’s, word for word, on the phone and in the panel', () => {
    const api = asSet(redactedKeys);
    expect(api.length).toBeGreaterThan(0);
    for (const file of COPIES) {
      expect(asSet(listIn(file)), file).toEqual(api);
    }
  });
});
