// T038 — no catalogue key holds a subject name (FR-182, ADR 0021 D1).
//
// A subject's two names are data (`subjects.name_ar`, `subjects.name_en`), served by
// `catalog.subjects.list` and shown where the page's language says; the two hint strings that
// embed one take it from the list at render time (Phase 2's Discovery). So no value of either
// phone catalogue may equal a seeded subject name, in either language: a key that held one would
// be a second copy of data, going stale on its own. The seeded names are read from `prisma/seed.ts`
// as text, so this spec needs no database and no client.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..', '..');

/** Every string value of a nested catalogue object, with the key path it sits under. */
function leaves(value: unknown, path: string[] = []): Array<[string, string]> {
  if (typeof value === 'string') return [[path.join('.'), value]];
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, inner]) => leaves(inner, [...path, key]));
}

/** The seeded subjects' names, as `prisma/seed.ts` spells them. */
function seededSubjectNames(): string[] {
  const seed = readFileSync(join(root, 'prisma', 'seed.ts'), 'utf8');
  const names = [...seed.matchAll(/name(?:Ar|En):\s*(?:'([^']+)'|"([^"]+)")/g)].map(
    ([, single, double]) => single ?? double ?? '',
  );
  return names.filter((name) => name !== '');
}

function catalogue(file: string): Array<[string, string]> {
  return leaves(
    JSON.parse(readFileSync(join(root, 'apps', 'mobile', 'src', 'i18n', file), 'utf8')),
  );
}

describe('no catalogue key holds a subject name (T038, FR-182)', () => {
  const names = seededSubjectNames();

  it('reads the seeded subjects, both names each', () => {
    expect(names.length).toBeGreaterThanOrEqual(10);
    expect(names).toContain('التجويد');
    expect(names).toContain('Tajweed');
  });

  it.each(['ar.json', 'en.json'])('%s has no value equal to a seeded subject name', (file) => {
    const offending = catalogue(file).filter(([, value]) => names.includes(value.trim()));
    expect(offending).toEqual([]);
  });
});
