// T027 — the coverage assertion: no published rule is left unproven (FR-011, SC-003).
//
// Every other spec in this directory proves one family of rules by breaking it. This one proves
// nothing about any single rule; it proves the set is complete. SC-003 counts a rule that claims
// a machine mechanism and carries no reproducible failing case as unproven and holds that count
// at zero, so the contract and the fixtures have to be the same list, read in both directions:
//
//   - a rule published in contracts/lint-rules.md with no case   -> the rule is unproven (SC-003)
//   - a case naming a rule the contract does not publish         -> it proves nothing traceable
//   - a case whose constitution id differs from the contract row -> the FR-011 trace is broken
//
// This is the one spec here that is expected to go GREEN before the rules exist: it reads
// declarations, never the linter, so it does not wait on T035, T036, T043 or T047. It went green
// the moment T025 and T026 landed (PR #15): 30 published ids, 30 registered. While it was being
// written it was red by those eight ids, plus `api/no-push-outside-job` (R-API-15), which had no
// fixture task at all; that case was added to layers.spec.ts with T027 so the count could reach
// zero. If it is red again, the failure names the ids.
//
// The contract is parsed at test time rather than mirrored in a list here. A copy of the list
// would have to be edited alongside the contract to stay true, and a check that has to be
// remembered is not a check: adding a row with no fixture must turn this suite red by itself. The
// parser itself is shared with `tests/lint-plugin/convention.spec.ts` — it lives in
// `tests/support/lint-contract.ts` — for exactly the same reason.
//
// Do not weaken an assertion and do not mark a case skipped to make the suite green:
// `proc/no-focused-or-skipped-test` (R-PROC-10) exists so that route stays closed.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  contractPathFrom,
  contractRelativePath,
  parseContractRules,
} from '../support/lint-contract';

import { registeredViolations, withRegistrationOnly, type ViolationCase } from './harness';

const specFile = fileURLToPath(import.meta.url);
const specDirectory = path.dirname(specFile);
const repositoryRoot = path.resolve(specDirectory, '..', '..');

const contractPath = contractPathFrom(repositoryRoot);

const contractRules = parseContractRules(readFileSync(contractPath, 'utf8'));
const constitutionIdFor = new Map(contractRules.map((rule) => [rule.ruleId, rule.constitutionId]));

// Sibling specs are discovered rather than listed, so a family added later is counted without
// editing this file — the same reason the contract is parsed instead of copied.
const siblingSpecs = readdirSync(specDirectory)
  .filter((entry) => entry.endsWith('.spec.ts') && entry !== path.basename(specFile))
  .sort()
  .map((entry) => pathToFileURL(path.join(specDirectory, entry)).href);

await withRegistrationOnly(async () => {
  // Sequentially: `withRegistrationOnly` guards one module-level flag, and the registry is read
  // in declaration order, which stays stable only if the modules evaluate in a fixed order.
  // `@vite-ignore` because the specifier is a resolved absolute URL: asking the bundler to
  // rewrite it into a glob of this very directory is what it warns about, and there is nothing
  // to rewrite. It is a resolution hint, not a suppressed check.
  for (const sibling of siblingSpecs) {
    await import(/* @vite-ignore */ sibling);
  }
});

const registeredCases = registeredViolations();
const registeredIds = new Set(registeredCases.map((violation) => violation.ruleId));

function list(ids: readonly string[]): string {
  return ids.map((id) => `\n             ${id}`).join('');
}

function report(verdict: string, detail: string): string {
  return ['', `contract     ${contractRelativePath}`, `verdict      ${verdict}`, detail, ''].join(
    '\n',
  );
}

function describeDrift(violation: ViolationCase, expected: string): string {
  return `${violation.ruleId} declares ${violation.constitutionId}, the contract says ${expected} (fixture ${violation.fixture})`;
}

describe('T027 — the published rules and the fixtures are the same list', () => {
  it('proves every rule the contract publishes with at least one failing case', () => {
    expect(
      contractRules.length,
      report(
        'no rule row parsed at all — the parser is broken, not the contract',
        `registered   ${registeredIds.size} rule ids`,
      ),
    ).toBeGreaterThan(0);

    const unproven = contractRules
      .map((rule) => rule.ruleId)
      .filter((ruleId) => !registeredIds.has(ruleId));

    expect(
      unproven,
      report(
        `${unproven.length} of ${contractRules.length} published rules have no fixture — a rule claiming a machine mechanism with no reproducible failing case is unproven (SC-003)`,
        `unproven    ${list(unproven)}`,
      ),
    ).toEqual([]);
  });

  it('declares no rule id the contract does not publish', () => {
    const unpublished = [...registeredIds]
      .filter((ruleId) => !constitutionIdFor.has(ruleId))
      .sort();

    expect(
      unpublished,
      report(
        `${unpublished.length} declared rule ids are absent from the contract — a fixture may not prove a rule the contract does not publish, and rule ids are additive-only (R-API-9)`,
        `unpublished ${list(unpublished)}`,
      ),
    ).toEqual([]);
  });

  it('names the constitution rule the contract assigns to each rule id', () => {
    // Ids the contract does not publish are the previous case's finding; reporting them here too
    // would turn one fault into two red tests naming the same thing.
    const drifted = registeredCases
      .filter((violation) => {
        const expected = constitutionIdFor.get(violation.ruleId);
        return expected !== undefined && expected !== violation.constitutionId;
      })
      .map((violation) => describeDrift(violation, constitutionIdFor.get(violation.ruleId) ?? ''));

    expect(
      drifted,
      report(
        `${drifted.length} cases name a different constitution rule than the contract row does — a build log naming the rule must reach the prohibition (FR-011)`,
        `drifted     ${list(drifted)}`,
      ),
    ).toEqual([]);
  });
});
