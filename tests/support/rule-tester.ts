// The one way the plugin's rules are exercised in isolation (T035, T036).
//
// `tests/violations/` proves that a rule refuses one file, through the real configuration, which
// is what SC-003 asks for. It says nothing about the file the rule must stay silent on, or about
// the second spelling of the same violation, and those are where a wall actually fails: a rule
// that refuses `../teacher/x` and shrugs at `@/features/teacher/x` passes every fixture and holds
// nothing back. ESLint's own `RuleTester` is what compares a rule against a table of code, so each
// rule gets a spec beside this file with the valid and invalid cases its logic earns.
//
// Two details this helper exists to get right once:
//
//   - the parser. `@typescript-eslint/parser` is a dependency of `packages/config`, the package
//     that owns the linting configuration, and this file borrows it from there through that
//     package's own resolution rather than declaring a second copy at the root. The rules read
//     TypeScript-only syntax (`import type`, `import x = require(…)`, `import('…')` in a type)
//     and JSX, so the default parser would prove nothing about most of the cases.
//   - the filename. Every rule here keys on the path — `.router`, `.repository`, the role tree,
//     the module root — so a case without a filename tests the rule's `return {}` and nothing
//     else. Filenames below are written as repository-relative paths, which is exactly how the
//     violation fixtures are matched (note under T035).
//
// The rules are CommonJS in a JavaScript package, so they are loaded through `createRequire`
// rather than imported, the same way `tests/lint-plugin/define-rule.spec.ts` loads the factory.

import { createRequire } from 'node:module';
import path from 'node:path';

import { RuleTester, type Rule } from 'eslint';
import { describe, it } from 'vitest';

import { repositoryRoot } from './lint-contract';

/** Resolution from inside `packages/config`, so its devDependencies are the ones that answer. */
const configRequire = createRequire(
  path.join(repositoryRoot, 'packages', 'config', 'eslint.base.js'),
);

const pluginRoot = path.join(repositoryRoot, 'packages', 'config', 'eslint-plugin-ijazah');

/** Reports land in Vitest's own tree, one test per case, rather than in one thrown assertion. */
RuleTester.describe = describe;
RuleTester.it = it;

/** A rule of the internal plugin, by the file name it lives under in `rules/`. */
export function loadRule(fileName: string): Rule.RuleModule {
  return configRequire(path.join(pluginRoot, 'rules', fileName)) as Rule.RuleModule;
}

/** A tester that parses TypeScript and JSX, which is what every rule here has to read. */
export function typescriptRuleTester(): RuleTester {
  return new RuleTester({
    languageOptions: {
      parser: configRequire('@typescript-eslint/parser') as never,
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  });
}
