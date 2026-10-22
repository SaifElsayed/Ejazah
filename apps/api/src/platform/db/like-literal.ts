// T067: a search the admin pages send is the text typed, never a pattern (owner's decision
// 2026-10-21 at the conflict check of B12b). Prisma builds a LIKE pattern from `contains` without
// escaping, so `%`, `_` and the escape character itself are escaped here before they reach it. In the
// kernel since T069, whose credential queue searches the same way from the catalog module.

/** `text`, each LIKE wildcard and the escape character escaped, for Prisma's `contains`. */
export function likeLiteral(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}
