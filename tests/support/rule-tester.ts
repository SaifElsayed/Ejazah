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
//
// The four type-aware rules (T044–T047) need a TypeScript program, which a string of code does not
// have until something hands it to the project service. `typeAwareRuleTester` does that through
// the same `projectService` the type-aware set uses (T043), with one difference: the code of each
// case exists only in memory, under a virtual tree (`virtualFile`) below `tests/lint-plugin/virtual/`
// that mirrors the real one. Two files under that tree do exist on disk, and stay, both for the
// specs of T046: `apps/api/src/platform/guards/requester-gender.ts`, the stub declaring the
// requester's gender brand, because `gender/require-requester-gender` recognises the brand by the
// path of the file that declares it and a case can only import a type the compiler can read
// (contracts/lint-rules.md); and `apps/api/src/modules/catalog/catalog.base.ts`, the declarations
// its multi-file cases import (a base class, an interface, an object, a function). Both are files
// of the root project like any other under `tests/`; no case is ever opened at either path. No
// tsconfig claims a file that is not on disk, so each case is opened
// in the project service's default project, whose compiler options are the root `tsconfig.json`'s
// (strict, like the real code). The default project is allowed for the few folder shapes listed in
// `virtualFolders` and nothing wider: typescript-eslint refuses a `**` glob there and caps the
// files one process may open that way at eight, so each spec keeps to a handful of file names.
// Every case declares the types it needs — the brand, the gender union, a small client — in its
// own code, so the specs never depend on a real package being built or generated.

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

/** The in-memory tree the type-aware specs write to; only the two T046 files under it exist on disk. */
const virtualRoot = path.join(repositoryRoot, 'tests', 'lint-plugin', 'virtual');

/** The folder shapes a virtual file may take, relative to `virtualRoot`. Kept narrow on purpose. */
const virtualFolders = [
  'apps/api/src/*.ts',
  'apps/api/src/*/*.ts',
  'apps/api/src/modules/*/*.ts',
  'apps/api/src/platform/*/*.ts',
  'packages/*/src/*.ts',
  'prisma/*.ts',
];

/** An absolute path under the virtual tree, written as the repository-relative path it mirrors. */
export function virtualFile(relativePath: string): string {
  return path.join(virtualRoot, relativePath);
}

/** A tester whose cases are type-checked, for the four rules that need the program (T044–T047). */
export function typeAwareRuleTester(): RuleTester {
  const virtualPrefix = path.relative(repositoryRoot, virtualRoot).split(path.sep).join('/');
  return new RuleTester({
    languageOptions: {
      parser: configRequire('@typescript-eslint/parser') as never,
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        tsconfigRootDir: repositoryRoot,
        projectService: {
          allowDefaultProject: virtualFolders.map((folder) => `${virtualPrefix}/${folder}`),
        },
      },
    },
  });
}
