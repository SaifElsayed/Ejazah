// T174 (the note under T174, (3); Q-2 (a), the owner's addition): no code path but the erasure of a
// teacher never approved deletes from `teacher_credential_history`. Rule 69 keeps DELETE granted to
// `ijazah_app` for that erasure alone, so the source of `apps/api/src` is read here: every delete
// through the Prisma delegate (`teacherCredentialHistory.delete` / `.deleteMany`) and every raw
// `DELETE FROM teacher_credential_history` is found, and the only one is inside `eraseOfTeacher`
// (`credentials-history.repository.ts`). Specs are not code paths and are left out.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SOURCE = fileURLToPath(new URL('../../', import.meta.url));
const ERASURE_FILE = 'modules/catalog/credentials-history.repository.ts';
const DELETES = [
  /teacherCredentialHistory\s*\.\s*delete(?:Many)?\b/g,
  /DELETE\s+FROM\s+"?teacher_credential_history"?/gi,
  // A delete through a parent's relation (PR #157's review, round 1, Minor 1): the credential's
  // `history`, or the administrator's `credentialHistory`.
  /\b(?:history|credentialHistory)\s*:\s*\{[^}]*\bdelete(?:Many)?\b/g,
];

/** Every `.ts` file under `directory`, specs left out, as paths relative to `apps/api/src`. */
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

interface Found {
  readonly file: string;
  readonly offset: number;
}

function deletesIn(file: string): Found[] {
  const text = readFileSync(file, 'utf8');
  const name = relative(SOURCE, file).split('\\').join('/');
  return DELETES.flatMap((pattern) =>
    [...text.matchAll(pattern)].map((match) => ({ file: name, offset: match.index })),
  );
}

/** Where `eraseOfTeacher`'s body runs in its file: from its declaration to its closing brace. */
function erasureBody(): { readonly from: number; readonly to: number } {
  const text = readFileSync(join(SOURCE, ERASURE_FILE), 'utf8');
  const from = text.indexOf('async function eraseOfTeacher(');
  const to = text.indexOf('\n}\n', from);
  if (from < 0 || to < 0) throw new Error('eraseOfTeacher is not where the spec reads it');
  return { from, to };
}

describe("the credential history's one delete path (T174, rule 69)", () => {
  it('finds exactly one delete in apps/api/src, inside eraseOfTeacher', () => {
    const found = sourceFiles(SOURCE).flatMap(deletesIn);
    const { from, to } = erasureBody();
    expect(found.map(({ file }) => file)).toEqual([ERASURE_FILE]);
    const [only] = found;
    expect(only !== undefined && only.offset > from && only.offset < to).toBe(true);
  });
});
