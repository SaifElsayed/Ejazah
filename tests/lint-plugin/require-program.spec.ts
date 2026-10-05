// The four type-aware rules refuse to run without a program (T044–T047, gap closed 2026-09-28).
//
// `requireProgram` in `packages/config/eslint-plugin-ijazah/types.js` throws when the parser was
// given no TypeScript program, so a type-aware rule wired into the fast set by mistake fails the
// run instead of silently reporting nothing (research R-10). `rule-sets.spec.ts` proves the fast
// set carries no program; nothing proved what a rule does when it meets that state. This spec runs
// every rule the plugin's catalog marks type-aware through the syntax-only parser — the same parser
// `typescriptRuleTester()` uses, with no project — and asserts the throw and its message: it names
// the rule id, says type information is needed and points at the type-aware configuration file.
// The rules are read from the plugin's own type-aware set rather than listed here, so a fifth
// type-aware rule is covered the day it is registered — the first test asserts that the four of
// T044–T047 are in that set, not that they are the whole of it — and a rule that passed
// `requireProgram` an id other than its published one is caught by the id assertion.
//
// ESLint wraps a throw from a rule's `create` in its own "Error while loading rule" message and
// rethrows it, so the assertion reads the text of what reaches the caller; a `RuleTester` case
// could only say that something threw.

import { createRequire } from 'node:module';
import path from 'node:path';

import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';

import { repositoryRoot } from '../support/lint-contract';

const require = createRequire(import.meta.url);

/** Resolution from inside `packages/config`, so its own parser answers (as `rule-tester.ts` does). */
const configRequire = createRequire(
  path.join(repositoryRoot, 'packages', 'config', 'eslint.base.js'),
);

/** The plugin surface this spec reads. Declared here because the plugin is untyped CommonJS. */
interface Plugin {
  readonly configs: {
    readonly typeAware: { readonly rules: Readonly<Record<string, unknown>> };
  };
}

const plugin = require(
  path.join(repositoryRoot, 'packages', 'config', 'eslint-plugin-ijazah'),
) as Plugin;

/** The plugin registers under `ijazah`; the contract and `requireProgram` use the bare id. */
const typeAwareRuleIds = Object.keys(plugin.configs.typeAware.rules)
  .map((namespaced) => namespaced.slice('ijazah/'.length))
  .sort();

/** A file every one of the four rules would otherwise inspect: inside apps/api, a repository. */
const filename = path.join(
  repositoryRoot,
  'apps',
  'api',
  'src',
  'modules',
  'payments',
  'payments.repository.ts',
);

/** Lints one line through one rule with the syntax-only parser, which hands the rule no program. */
function lintWithoutProgram(ruleId: string): void {
  new Linter().verify(
    'export const answer = 1;',
    [
      {
        files: ['**/*.ts'],
        languageOptions: {
          parser: configRequire('@typescript-eslint/parser') as never,
          ecmaVersion: 'latest',
          sourceType: 'module',
        },
        plugins: { ijazah: plugin as never },
        rules: { [`ijazah/${ruleId}`]: 'error' },
      },
    ],
    { filename },
  );
}

function thrownBy(run: () => void): Error {
  try {
    run();
  } catch (error: unknown) {
    if (error instanceof Error) return error;
    throw new Error(`threw something that is not an Error: ${String(error)}`);
  }
  throw new Error('did not throw');
}

describe('the type-aware rules refuse to run without a program (requireProgram)', () => {
  it('finds the four type-aware rules in the plugin’s own set', () => {
    expect(typeAwareRuleIds).toEqual(
      expect.arrayContaining([
        'api/table-ownership',
        'gender/require-requester-gender',
        'money/no-arithmetic-outside-package',
        'money/require-piaster-suffix',
      ]),
    );
  });

  for (const ruleId of typeAwareRuleIds) {
    it(`${ruleId} throws, naming itself and asking for type information`, () => {
      const error = thrownBy(() => lintWithoutProgram(ruleId));

      expect(error.message).toContain(`eslint-plugin-ijazah (${ruleId})`);
      expect(error.message).toContain('needs type information');
      expect(error.message).toContain('eslint.types.config.js');
    });
  }
});
