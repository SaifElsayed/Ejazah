// T043 — the two rule sets, proved through the configuration files the pipeline runs.
//
// Research R-10 splits the plugin's rules by what they need: the syntax-only set runs in the
// editor and the pre-commit hook without a TypeScript program, and the type-aware set runs in the
// pipeline with one. `convention.spec.ts` proves the plugin sorts each rule into the set the
// contract names; it never opens `packages/config/eslint.base.js`, so a base configuration that
// enabled the wrong set, forgot to hand the type-aware set a program, or handed one to the fast
// set as well, would pass it. This spec is that missing half, and it reads the two root files —
// `eslint.config.js` and `eslint.types.config.js` — rather than the exports behind them, because
// a root file pointing at the wrong export is exactly the wiring mistake it exists to catch.
//
// The program check is behavioural, not a read of `parserOptions`: a throwaway rule is given to
// each set and records what `parserServices.program` was when it ran. Under the fast set it must
// be `null`, so the four type-aware rules can never be mistaken for runnable there; under the
// type-aware set it must be a program that contains the linted file, so the same rules resolve
// types against the file itself and not against some other project the service happened to open.
// The violation fixtures are checked the same way, with the ignore list off as the harness runs
// them, because the four type-aware fixtures (T044–T047) are the first files that will need it.
//
// This spec lives under `tests/` rather than beside the configuration because `packages/config`
// is a JavaScript package belonging to no TypeScript project (note under T034).

import { createRequire } from 'node:module';
import path from 'node:path';

import { ESLint, type Linter, type Rule } from 'eslint';
import { describe, expect, it, vi } from 'vitest';

import { repositoryRoot, type RuleSet } from '../support/lint-contract';

// 003:T080, decision 10: its type-aware program build takes 5.1 s alone and ran 39 s under load.
vi.setConfig({ testTimeout: 60_000 });

const require = createRequire(import.meta.url);

const basePath = path.join(repositoryRoot, 'packages', 'config', 'eslint.base.js');
const pluginPath = path.join(repositoryRoot, 'packages', 'config', 'eslint-plugin-ijazah');

/** The root files each rule set is run through (`pnpm lint`, `pnpm lint:types`, the harness). */
const configFiles: Readonly<Record<RuleSet, string>> = {
  fast: 'eslint.config.js',
  typeAware: 'eslint.types.config.js',
};

/** The plugin surface this spec reads. Declared here because the plugin is untyped CommonJS. */
interface Plugin {
  readonly configs: Readonly<
    Record<RuleSet, { readonly rules: Readonly<Record<string, unknown>> }>
  >;
}

const base = require(basePath) as Readonly<Record<RuleSet, readonly Linter.Config[]>>;
const plugin = require(pluginPath) as Plugin;

/** The plugin registers under `ijazah`; the contract, the harness and this spec use the bare id. */
function publishedRuleId(namespaced: string): string {
  return namespaced.startsWith('ijazah/') ? namespaced.slice('ijazah/'.length) : namespaced;
}

const fastRuleIds = Object.keys(plugin.configs.fast.rules).map(publishedRuleId).sort();
const typeAwareRuleIds = Object.keys(plugin.configs.typeAware.rules).map(publishedRuleId).sort();

/** Every id the plugin puts in the given set, plus the fast ids the type-aware set inherits. */
const expectedRuleIds: Readonly<Record<RuleSet, readonly string[]>> = {
  fast: fastRuleIds,
  typeAware: [...fastRuleIds, ...typeAwareRuleIds].sort(),
};

/** One real TypeScript file and one violation fixture — the two kinds of file the sets lint. */
const realFile = path.join(repositoryRoot, 'tests', 'support', 'lint-contract.ts');
const fixtureFile = path.join(
  repositoryRoot,
  'tests',
  'violations',
  'fixtures',
  'apps',
  'api',
  'src',
  'modules',
  'payments',
  'fee-check.ts',
);

/** Every TypeScript extension the base configuration parses; each must reach the same rules. */
const typescriptExtensions = ['ts', 'tsx', 'mts', 'cts'] as const;

function linterFor(ruleSet: RuleSet, overrides: Partial<ESLint.Options> = {}): ESLint {
  return new ESLint({
    cwd: repositoryRoot,
    overrideConfigFile: path.join(repositoryRoot, configFiles[ruleSet]),
    errorOnUnmatchedPattern: false,
    ...overrides,
  });
}

/** The plugin's rule ids enabled as errors for a file, as ESLint resolves them. */
async function enabledPluginRules(ruleSet: RuleSet, filePath: string): Promise<string[]> {
  const config = (await linterFor(ruleSet).calculateConfigForFile(filePath)) as
    Linter.Config | undefined;
  const rules = config?.rules ?? {};

  return Object.entries(rules)
    .filter(([ruleId, entry]) => {
      const severity = Array.isArray(entry) ? entry[0] : entry;
      return ruleId.startsWith('ijazah/') && (severity === 2 || severity === 'error');
    })
    .map(([ruleId]) => publishedRuleId(ruleId))
    .sort();
}

/** What a rule saw in `parserServices.program` for one file, recorded as it ran. */
interface ProgramSighting {
  /** `null` is the parser's own answer when no project is configured; `undefined` means absent. */
  readonly program: 'null' | 'undefined' | 'program' | 'other';
  /** Whether the program that was handed over contains the linted file. */
  readonly containsFile: boolean;
}

interface ProgramLike {
  getTypeChecker?: unknown;
  getSourceFile?: (fileName: string) => unknown;
}

function sightingOf(services: unknown, filename: string): ProgramSighting {
  const program: unknown =
    services !== null && typeof services === 'object' && 'program' in services
      ? (services as { program: unknown }).program
      : undefined;

  if (program === null) return { program: 'null', containsFile: false };
  if (program === undefined) return { program: 'undefined', containsFile: false };

  const candidate = program as ProgramLike;
  if (
    typeof candidate.getTypeChecker !== 'function' ||
    typeof candidate.getSourceFile !== 'function'
  ) {
    return { program: 'other', containsFile: false };
  }
  return { program: 'program', containsFile: candidate.getSourceFile(filename) !== undefined };
}

/**
 * Lints the files through the real configuration file of the set, with one extra rule that does
 * nothing but record `parserServices.program`. Fatal messages are returned too: a file that did
 * not parse never ran the rule, and that has to read as a failure of the set, not as "no program".
 */
async function observePrograms(
  ruleSet: RuleSet,
  files: readonly string[],
): Promise<{ sightings: Map<string, ProgramSighting>; fatal: string[] }> {
  const sightings = new Map<string, ProgramSighting>();

  const probe: Rule.RuleModule = {
    meta: { type: 'problem', schema: [] },
    create(context) {
      return {
        Program() {
          sightings.set(
            context.filename,
            sightingOf(context.sourceCode.parserServices, context.filename),
          );
        },
      };
    },
  };

  const linter = linterFor(ruleSet, {
    // The fixtures are ignored by the base configuration so `pnpm lint` never reads them; the
    // harness switches the list off, and so does this spec, for the same reason.
    ignore: false,
    overrideConfig: [
      {
        files: [`**/*.{${typescriptExtensions.join(',')}}`],
        plugins: { 't043-probe': { rules: { program: probe } } },
        rules: { 't043-probe/program': 'error' },
      },
    ],
  });

  const results = await linter.lintFiles([...files]);
  const fatal = results.flatMap((result) =>
    result.messages
      .filter((message) => message.fatal === true)
      .map((message) => `${path.relative(repositoryRoot, result.filePath)}: ${message.message}`),
  );

  return { sightings, fatal };
}

function list(lines: readonly string[]): string {
  return lines.map((line) => `\n             ${line}`).join('');
}

function report(ruleSet: RuleSet, verdict: string, detail: string): string {
  return [
    '',
    `config       ${configFiles[ruleSet]} (the ${ruleSet} set of packages/config/eslint.base.js)`,
    `verdict      ${verdict}`,
    detail,
    '',
  ].join('\n');
}

describe('T043 — the fast and type-aware sets are split as research R-10 says', () => {
  it('runs each root configuration file straight from the matching export', () => {
    // Identity, not equality: the root file must re-export the very array, so there is one
    // definition of each set and nothing at the root can drift away from it.
    for (const ruleSet of ['fast', 'typeAware'] as const) {
      const rootConfig = require(path.join(repositoryRoot, configFiles[ruleSet])) as unknown;

      expect(
        rootConfig,
        report(
          ruleSet,
          `${configFiles[ruleSet]} does not export the \`${ruleSet}\` set of eslint.base.js — the pipeline would run a configuration the plugin's split says nothing about`,
          `exports      ${basePath}`,
        ),
      ).toBe(base[ruleSet]);
    }
  });

  it('enables exactly the syntax-only rules in the fast set', async () => {
    const enabled = await enabledPluginRules('fast', realFile);

    expect(
      enabled,
      report(
        'fast',
        'the fast set does not enable exactly the plugin rules the catalog marks FAST — a type-aware rule here would run without the program it needs, a missing syntax rule would never run in the editor or the hook',
        `enabled     ${list(enabled)}`,
      ),
    ).toEqual(expectedRuleIds.fast);
  });

  it('enables the syntax-only rules plus exactly the type-aware rules in the type-aware set', async () => {
    const enabled = await enabledPluginRules('typeAware', realFile);

    expect(
      enabled,
      report(
        'typeAware',
        'the type-aware set does not enable the FAST ids plus the TYPE_AWARE ids — the pipeline is the one place both sets run, so anything missing here is never checked at all',
        `enabled     ${list(enabled)}`,
      ),
    ).toEqual(expectedRuleIds.typeAware);

    expect(typeAwareRuleIds, 'the catalog has stopped marking any rule type-aware').not.toEqual([]);
  });

  it('reaches every TypeScript extension it parses with the same rules', async () => {
    // A block that parses `.mts` but enables rules for `.ts` only lints that file for nothing.
    // Hypothetical paths are enough: ESLint resolves a configuration from the path alone.
    for (const ruleSet of ['fast', 'typeAware'] as const) {
      for (const extension of typescriptExtensions) {
        const hypothetical = path.join(repositoryRoot, 'apps', 'api', 'src', `t043.${extension}`);
        const enabled = await enabledPluginRules(ruleSet, hypothetical);

        expect(
          enabled,
          report(
            ruleSet,
            `a \`.${extension}\` file does not receive the ${ruleSet} set's rules — the parser block and the rules block name different extensions, so such a file is parsed and then checked against nothing`,
            `file         apps/api/src/t043.${extension}\n             enabled     ${list(enabled)}`,
          ),
        ).toEqual(expectedRuleIds[ruleSet]);
      }
    }
  });

  it('never hands the fast set a program', async () => {
    const { sightings, fatal } = await observePrograms('fast', [realFile, fixtureFile]);

    expect(fatal, report('fast', 'a file did not parse', `fatal       ${list(fatal)}`)).toEqual([]);

    for (const file of [realFile, fixtureFile]) {
      const seen = sightings.get(file);

      expect(
        seen?.program,
        report(
          'fast',
          `\`parserServices.program\` is ${seen?.program ?? 'unrecorded'} under the fast set — the syntax-only set must never carry a program, or it stops being the set an editor and a pre-commit hook can afford (research R-10)`,
          `file         ${path.relative(repositoryRoot, file)}`,
        ),
      ).toBe('null');
    }
  });

  // The one test here that builds two TypeScript programs with the four type-aware rules loaded;
  // the file's timeout above is for it.
  it('hands the type-aware set a program containing the linted file, fixtures included', async () => {
    const { sightings, fatal } = await observePrograms('typeAware', [realFile, fixtureFile]);

    expect(
      fatal,
      report(
        'typeAware',
        'a file was not found by the project service — it sits outside every tsconfig the type-aware set can reach, so the four type-aware rules cannot run over it',
        `fatal       ${list(fatal)}`,
      ),
    ).toEqual([]);

    for (const file of [realFile, fixtureFile]) {
      const seen = sightings.get(file);

      expect(
        seen,
        report(
          'typeAware',
          `the type-aware set handed the rule ${seen?.program ?? 'nothing'} for a file the program ${seen?.containsFile ? 'contains' : 'does not contain'} — the four type-aware rules resolve types against the file itself, so the program must be one that includes it`,
          `file         ${path.relative(repositoryRoot, file)}`,
        ),
      ).toEqual({ program: 'program', containsFile: true });
    }
  });
});
