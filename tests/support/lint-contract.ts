// The one parser for `specs/001-foundations/contracts/lint-rules.md` (T027, T034).
//
// Two specs read the published contract and hold something to it: `tests/violations/
// completeness.spec.ts` checks that every published rule has a failing fixture (SC-003), and
// `tests/lint-plugin/convention.spec.ts` checks that the plugin registers and configures exactly
// the rules the contract publishes (FR-011). They parsed the same tables with two copies of the
// same regexes; a check that has to be edited in two places to stay true is one edit away from
// being wrong in one of them. The parser lives here instead, and neither spec owns it.
//
// This file is not a test: `tests/**/*.ts` is compiled by the root `tsconfig.json`, while Vitest
// collects `tests/**/*.spec.ts` only, so it is type-checked and linted without being run.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The rule sets `packages/config/eslint.base.js` consumes, and the tables that decide them. */
export type RuleSet = 'fast' | 'typeAware';

export interface ContractRule {
  /** ESLint rule id as published, without the `ijazah/` plugin namespace. */
  readonly ruleId: string;
  /** The constitution rule the row's last column assigns to it. */
  readonly constitutionId: string;
  /** Which of the two rule tables the row sits in, which is the rule set it belongs to. */
  readonly ruleSet: RuleSet;
}

export const contractRelativePath = 'specs/001-foundations/contracts/lint-rules.md';

/** The repository root, resolved once here: this file sits at `tests/support/`. */
export const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

/** The contract file itself, so no caller has to resolve the root a second time. */
export const contractPath = path.join(repositoryRoot, ...contractRelativePath.split('/'));

// A published rule is a table row whose first cell is a backticked `<group>/<name>` id. That
// shape separates the two rule tables from the "Rules held elsewhere" table, whose first cell
// names a mechanism, and from prose citing rule ids outside any table. The constitution id is the
// last cell either way, so the three-column syntax-only table and the four-column type-aware one
// parse alike. The heading above the row is what says which set the rule belongs to.
export const publishedRuleId = /^`([a-z]+\/[a-z][a-z-]*)`$/;

const heading = /^##\s+(.+?)\s*$/;

const ruleSetForHeading = new Map<string, RuleSet>([
  ['Syntax-only rules', 'fast'],
  ['Type-aware rules', 'typeAware'],
]);

// The loose scan behind `unparsedRuleIds`: every backticked `<group>/<name>` token anywhere in
// the file, table or prose, anchored to nothing. The hyphen is optional, because a future rule
// named `api/foo` is exactly the row this scan exists to notice. What keeps the source paths the
// contract cites in prose out of the set is their first segment, not their shape.
const mentionedRuleId = /`([a-z]+\/[a-z][a-z-]*)`/g;

// The first segments the contract uses for source paths rather than rule groups. A rule group is
// never one of these, so excluding them by name costs one line per path the contract starts
// citing and never hides a rule id.
const SOURCE_PATH_GROUPS = new Set([
  'modules',
  'packages',
  'platform',
  'apps',
  'src',
  'tests',
  'prisma',
  'docs',
  'specs',
]);

/**
 * Every rule row of the two rule tables, in file order.
 *
 * Rows under any other heading are ignored by design — the "Rules held elsewhere" table publishes
 * mechanisms, not rules. `unparsedRuleIds` is what makes that silence loud when a row that should
 * have parsed did not.
 */
export function parseContractRules(markdown: string): readonly ContractRule[] {
  const rules: ContractRule[] = [];
  let ruleSet: RuleSet | undefined;

  for (const line of markdown.split('\n')) {
    const section = heading.exec(line);
    if (section !== null) {
      const title = section[1];
      ruleSet = title === undefined ? undefined : ruleSetForHeading.get(title);
      continue;
    }

    const row = line.trim();
    if (ruleSet === undefined || !row.startsWith('|') || !row.endsWith('|')) continue;

    const cells = row
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim());
    const first = cells.at(0);
    const last = cells.at(-1);
    if (first === undefined || last === undefined) continue;

    const published = publishedRuleId.exec(first);
    if (published === null) continue;

    const ruleId = published[1];
    if (ruleId === undefined) continue;

    rules.push({ ruleId, constitutionId: last, ruleSet });
  }

  return rules;
}

/**
 * Rule ids the file mentions that `parseContractRules` did not return — a row whose id cell is
 * bolded, a row missing its trailing pipe, a table added under a heading this parser does not
 * know. Every one of those disappears from the strict parse without a word, and a rule that
 * silently stops being published can never be reported as unproven or unregistered.
 */
export function unparsedRuleIds(markdown: string): readonly string[] {
  const parsed = new Set(parseContractRules(markdown).map((rule) => rule.ruleId));
  const mentioned = new Set(
    [...markdown.matchAll(mentionedRuleId)]
      .map((match) => match[1])
      .filter((ruleId): ruleId is string => ruleId !== undefined)
      .filter((ruleId) => !SOURCE_PATH_GROUPS.has(ruleId.slice(0, ruleId.indexOf('/')))),
  );

  return [...mentioned].filter((ruleId) => !parsed.has(ruleId)).sort();
}
