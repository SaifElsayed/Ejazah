// T010: the name search's one query (FR-333, research R-203; specs/003-booking/contracts/kernel.md).
// A teacher's or a student's name is matched by a prefix after the same fold on both sides,
// `ijazah_fold` (migration `20261101120000_booking_pass`): أ, إ and آ count as ا, ى and ئ as ي, ؤ as
// و, ة as ه, the diacritics and the tatweel are removed and Latin letters lose their case. The fold
// runs in the query, so nothing derived is stored (R-DB-4), and no index is built on it until a
// measured slow query asks for one (analysis C1, R-DB-9). It is raw SQL, so it lives in the kernel
// (R-API-6); a module reaches it from its own repository, on the transaction it already holds,
// with the ids it already may see, so the match never widens what a caller sees.
//
// What the person typed is text, never a pattern: `%`, `_` and the escape character are escaped by
// `like-literal.ts` before the LIKE (the owner's decision of 2026-11-01), so a typed `%` or `_`
// matches only itself. The fold leaves the three characters as they are.
import { likeLiteral } from './like-literal.js';
import type { Transaction } from './prisma.repository.js';

/** The ids among `candidateIds` whose display name, folded, begins with `typed`, folded. */
export async function idsWithFoldedNamePrefix(
  tx: Pick<Transaction, '$queryRaw'>,
  candidateIds: readonly string[],
  typed: string,
): Promise<string[]> {
  if (candidateIds.length === 0) return [];
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM users WHERE id = ANY(${candidateIds}::uuid[]) AND ijazah_fold(display_name) LIKE ijazah_fold(${likeLiteral(typed)}) || '%' ESCAPE '\\'`;
  return rows.map(({ id }) => id);
}

/**
 * Each of `texts` folded by the same `ijazah_fold`, in order (T025). Discovery compares folds of
 * what it already holds (a riwaya as transcribed, the prefixes of a name it was answered) with a
 * fold of what the student sent, so the riwaya filter and the matched length of a name use the one
 * fold and no second one is written in TypeScript (R-203). It reads no table.
 */
export async function foldedTexts(
  tx: Pick<Transaction, '$queryRaw'>,
  texts: readonly string[],
): Promise<string[]> {
  if (texts.length === 0) return [];
  const rows = await tx.$queryRaw<
    { folded: string }[]
  >`SELECT ijazah_fold(t.text) AS folded FROM unnest(${texts}::text[]) WITH ORDINALITY AS t(text, position) ORDER BY t.position`;
  return rows.map(({ folded }) => folded);
}
