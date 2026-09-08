// Inverted suite harness (T019): introduce a deliberate violation, assert the build refuses it,
// and assert the message ends with the constitution rule id (SC-003, FR-011).
//
// The cases this harness runs are expected to be RED until the rule each one names exists.
// That is the deliverable, not a defect: SC-003 counts a rule claiming a machine mechanism with
// no reproducible failing case as unproven, and a case that only goes green once the rule lands
// is the proof. So the harness must never let a case pass for a reason other than the rule
// firing, and must say which of the two happened when it fails:
//
//   - the fixture reached the linter and the rule stayed silent  -> the rule is missing (expected today)
//   - the fixture never reached the linter, or would not parse   -> the harness is broken (never acceptable)
//
// Fixtures are linted through the project's own configuration files, not a subset assembled here.
// A fixture linted by rules the pipeline does not run proves nothing about the pipeline.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const harnessDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(harnessDirectory, '..', '..');

export const fixturesRoot = path.join(harnessDirectory, 'fixtures');

/**
 * Which of the two rule sets must refuse the fixture (research R-10, R-13). `fast` is the
 * syntax-only set the editor and the pre-commit hook run; `typeAware` needs the TypeScript
 * program and runs in the pipeline only.
 */
export type RuleSet = 'fast' | 'typeAware';

export interface ViolationCase {
  /** Constitution rule id from `.specify/memory/constitution.md`, e.g. `R-MOBILE-1`. */
  readonly constitutionId: string;
  /** ESLint rule id as published in `specs/001-foundations/contracts/lint-rules.md`. */
  readonly ruleId: string;
  /** Fixture path relative to `tests/violations/fixtures`. */
  readonly fixture: string;
  /** The rule set that must refuse it. */
  readonly ruleSet: RuleSet;
  /** One line naming what the fixture does wrong, printed when the case is red. */
  readonly refuses: string;
}

const configFiles: Readonly<Record<RuleSet, string>> = {
  fast: 'eslint.config.js',
  typeAware: 'eslint.types.config.js',
};

const linters = new Map<RuleSet, ESLint>();

function linterFor(ruleSet: RuleSet): ESLint {
  const existing = linters.get(ruleSet);
  if (existing) return existing;

  const linter = new ESLint({
    cwd: repositoryRoot,
    overrideConfigFile: path.join(repositoryRoot, configFiles[ruleSet]),
    // `packages/config/eslint.base.js` ignores the fixture directory so `pnpm lint` does not
    // fail on code that is broken on purpose. This suite is the one caller that must see it.
    ignore: false,
    errorOnUnmatchedPattern: false,
  });

  linters.set(ruleSet, linter);
  return linter;
}

/**
 * The internal plugin is registered under the name `ijazah`, so ESLint reports
 * `ijazah/api/table-ownership` where the contract publishes `api/table-ownership`. The
 * contract's ids are the ones a build log has to be traceable to, so they are what a case
 * declares; the namespace is stripped here rather than smuggled into every declaration.
 */
function publishedRuleId(reported: string | null): string | null {
  if (reported === null) return null;
  return reported.startsWith('ijazah/') ? reported.slice('ijazah/'.length) : reported;
}

export function fixturePath(fixture: string): string {
  return path.join(fixturesRoot, fixture);
}

export async function lintFixture(violation: ViolationCase): Promise<ESLint.LintResult[]> {
  return linterFor(violation.ruleSet).lintFiles([fixturePath(violation.fixture)]);
}

function report(violation: ViolationCase, verdict: string, observed: string): string {
  return [
    '',
    `fixture      tests/violations/fixtures/${violation.fixture.split(path.sep).join('/')}`,
    `expected     ${violation.ruleId} (${violation.ruleSet} rule set)`,
    `message      must end with "${violation.constitutionId}" (FR-011)`,
    `refuses      ${violation.refuses}`,
    `verdict      ${verdict}`,
    `reported     ${observed}`,
    '',
  ].join('\n');
}

function describeProblems(results: readonly ESLint.LintResult[]): string {
  const messages = results.flatMap((result) => result.messages);
  if (messages.length === 0) return 'nothing — the fixture linted clean';
  return messages
    .map((message) => `${message.ruleId ?? '<no rule>'}: ${message.message}`)
    .join('\n             ');
}

/**
 * Asserts the two halves SC-003 and FR-011 ask for together: the configuration refused the
 * fixture with an error attributable to the named rule, and the refusal names the prohibition.
 */
export async function assertRefused(violation: ViolationCase): Promise<void> {
  const results = await lintFixture(violation);

  // Infrastructure failures first, so a red run is never ambiguous about which kind it is.
  expect(
    results.length,
    report(violation, 'HARNESS BROKEN — the fixture was never linted', 'no lint result at all'),
  ).toBeGreaterThan(0);

  const problems = results.flatMap((result) => result.messages);
  const unparsed = problems.filter((message) => message.fatal === true);
  expect(
    unparsed.length,
    report(violation, 'HARNESS BROKEN — the fixture did not parse', describeProblems(results)),
  ).toBe(0);

  const attributed = problems.filter(
    (message) => message.severity === 2 && publishedRuleId(message.ruleId) === violation.ruleId,
  );
  expect(
    attributed.length,
    report(violation, 'the rule did not refuse the fixture', describeProblems(results)),
  ).toBeGreaterThan(0);

  for (const message of attributed) {
    expect(
      message.message.trim().endsWith(violation.constitutionId),
      report(
        violation,
        'the refusal does not name the prohibition',
        `${message.ruleId}: ${message.message}`,
      ),
    ).toBe(true);
  }
}

const registry: ViolationCase[] = [];
let registrationOnly = false;

/**
 * Every declared case, in declaration order. T027's completeness check reads this to prove no
 * rule id in `contracts/lint-rules.md` is left without a fixture, which is how SC-003's count of
 * unproven rules is held at zero.
 */
export function registeredViolations(): readonly ViolationCase[] {
  return registry;
}

/**
 * Imports a spec module for its declarations alone. `describeViolations` registers the cases
 * and skips the `describe`, so a reader of the registry does not re-collect somebody else's
 * tests into its own file.
 */
export async function withRegistrationOnly<T>(collect: () => Promise<T>): Promise<T> {
  registrationOnly = true;
  try {
    return await collect();
  } finally {
    registrationOnly = false;
  }
}

export function describeViolations(title: string, cases: readonly ViolationCase[]): void {
  registry.push(...cases);
  if (registrationOnly) return;

  describe(title, () => {
    for (const violation of cases) {
      it(`refuses ${violation.refuses} — ${violation.ruleId} names ${violation.constitutionId}`, async () => {
        await assertRefused(violation);
      });
    }
  });
}
