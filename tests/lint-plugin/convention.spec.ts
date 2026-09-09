// T034 — the plugin's naming convention, checked mechanically.
//
// FR-011 says every rule is named for the constitution rule it enforces and every message ends
// with that identifier, so a developer reading a failed build reaches the prohibition in
// `.specify/memory/constitution.md` without asking anyone. `packages/config/eslint-plugin-ijazah/rule.js`
// builds that guarantee into the rule factory; this spec is what makes a break in it loud, and
// what holds the plugin and `specs/001-foundations/contracts/lint-rules.md` to the same list.
//
// It reads declarations, never the linter, so it does not wait on T035, T036, T047, T131 or T132:
// it is green while every rule body is still a placeholder, and it goes red the moment a rule is
// registered under an id the contract does not publish, cites a constitution rule the contract
// assigns elsewhere, writes a message that does not end with its identifier, is configured in
// neither rule set or in both, or is configured in the set the contract does not put it in.
//
// The contract is parsed at test time rather than mirrored in a list here — the same reason
// `tests/violations/completeness.spec.ts` parses it. A copy would have to be edited alongside the
// contract to stay true, and a check that has to be remembered is not a check. Both specs read it
// through the one parser in `tests/support/lint-contract.ts`, for that same reason.
//
// This spec lives under `tests/` rather than beside the plugin because `packages/config` is a
// JavaScript package belonging to no TypeScript project: a `.spec.ts` inside it fails the
// type-aware lint run, while `tests/**/*.ts` is already covered by the root `tsconfig.json` and by
// the Vitest include.
//
// The six `boundaries/*` ids the contract publishes are configuration of `eslint-plugin-boundaries`
// in `packages/config/eslint.boundaries.js` (T035), not rules of this plugin, so they are excluded
// from the comparison in both directions.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  contractPathFrom,
  contractRelativePath,
  parseContractRules,
  unparsedRuleIds,
  type RuleSet,
} from '../support/lint-contract';

const require = createRequire(import.meta.url);

const specDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(specDirectory, '..', '..');

const contractPath = contractPathFrom(repositoryRoot);

const pluginRelativePath = 'packages/config/eslint-plugin-ijazah';
const pluginPath = path.join(repositoryRoot, ...pluginRelativePath.split('/'));

/** The plugin surface this spec reads. Declared here because the plugin is untyped CommonJS. */
interface PluginRule {
  readonly meta?: {
    readonly docs?: { readonly constitution?: unknown };
    readonly messages?: Readonly<Record<string, unknown>>;
  };
}

interface Plugin {
  readonly rules: Readonly<Record<string, PluginRule>>;
  readonly configs: Readonly<
    Record<RuleSet, { readonly rules: Readonly<Record<string, unknown>> }>
  >;
}

const plugin = require(pluginPath) as Plugin;

// The two set names come from the factory rather than being written out here: a third set, or a
// rename, must reach this spec instead of leaving it checking a list that no longer exists.
const { RULE_SETS } = require(path.join(pluginPath, 'rule.js')) as {
  readonly RULE_SETS: readonly RuleSet[];
};

const contractMarkdown = readFileSync(contractPath, 'utf8');
const contractRules = parseContractRules(contractMarkdown);

// `boundaries/*` is `eslint-plugin-boundaries` configuration (T035), not a rule of this plugin.
const pluginContractRules = contractRules.filter((rule) => !rule.ruleId.startsWith('boundaries/'));
const contractRuleById = new Map(pluginContractRules.map((rule) => [rule.ruleId, rule]));

const registeredIds = Object.keys(plugin.rules).sort();

function configuredSets(ruleId: string): readonly RuleSet[] {
  const namespaced = `ijazah/${ruleId}`;
  return RULE_SETS.filter((set) => Object.hasOwn(plugin.configs[set].rules, namespaced));
}

function list(lines: readonly string[]): string {
  return lines.map((line) => `\n             ${line}`).join('');
}

function report(verdict: string, detail: string): string {
  return [
    '',
    `contract     ${contractRelativePath}`,
    `plugin       ${pluginRelativePath}`,
    `verdict      ${verdict}`,
    detail,
    '',
  ].join('\n');
}

describe('T034 — the plugin and the published contract are the same list', () => {
  it('parses the contract at all', () => {
    expect(
      pluginContractRules.length,
      report(
        'no rule row parsed at all — the parser is broken, not the contract',
        `registered   ${registeredIds.length} rule ids`,
      ),
      // Both headings must have been recognised, or a whole table would be silently skipped.
    ).toBeGreaterThan(0);

    const bySet = new Set(pluginContractRules.map((rule) => rule.ruleSet));

    expect(
      [...bySet].sort(),
      report(
        'the contract yielded rules from fewer than both tables — a heading was renamed and a whole table is going unchecked',
        `parsed       ${pluginContractRules.length} rows`,
      ),
    ).toEqual(['fast', 'typeAware']);

    // A row can also vanish one at a time: a bolded id cell, a missing trailing pipe, a table
    // added under a heading the parser does not know. The strict parse says nothing about a rule
    // it never saw, so the file is scanned again loosely and every id it mentions must have
    // parsed. Without this, a dropped row reads as "not published" rather than as a fault.
    const unparsed = unparsedRuleIds(contractMarkdown);

    expect(
      unparsed,
      report(
        `${unparsed.length} rule ids appear in the contract but did not parse as rows — a row changed shape and is now unchecked in both directions`,
        `unparsed    ${list(unparsed)}`,
      ),
    ).toEqual([]);
  });

  it('registers every published rule the plugin owns, and nothing else', () => {
    const missing = pluginContractRules
      .map((rule) => rule.ruleId)
      .filter((ruleId) => !Object.hasOwn(plugin.rules, ruleId))
      .sort();

    expect(
      missing,
      report(
        `${missing.length} published rules are not registered by the plugin — a rule the contract publishes and the plugin does not carry cannot fire`,
        `missing     ${list(missing)}`,
      ),
    ).toEqual([]);

    const unpublished = registeredIds.filter((ruleId) => !contractRuleById.has(ruleId));

    expect(
      unpublished,
      report(
        `${unpublished.length} registered rule ids are absent from the contract — rule ids are additive-only and are published before they are registered (R-API-9)`,
        `unpublished ${list(unpublished)}`,
      ),
    ).toEqual([]);
  });

  it('names the constitution rule the contract assigns to each rule id', () => {
    const drifted = registeredIds
      .map((ruleId) => {
        const expected = contractRuleById.get(ruleId)?.constitutionId;
        const declared = plugin.rules[ruleId]?.meta?.docs?.constitution;
        if (expected === undefined || declared === expected) return undefined;
        return `${ruleId} declares ${String(declared)}, the contract says ${expected}`;
      })
      .filter((drift): drift is string => drift !== undefined);

    expect(
      drifted,
      report(
        `${drifted.length} rules cite a different constitution rule than their contract row — a build log naming the rule must reach the prohibition (FR-011)`,
        `drifted     ${list(drifted)}`,
      ),
    ).toEqual([]);
  });

  it('ends every message with the constitution identifier', () => {
    const broken: string[] = [];

    for (const ruleId of registeredIds) {
      const constitutionId = contractRuleById.get(ruleId)?.constitutionId;
      const messages = plugin.rules[ruleId]?.meta?.messages;

      if (constitutionId === undefined) continue;
      if (messages === undefined || Object.keys(messages).length === 0) {
        broken.push(`${ruleId} declares no messages — it can report nothing traceable`);
        continue;
      }

      for (const [messageId, text] of Object.entries(messages)) {
        if (typeof text !== 'string' || !text.trim().endsWith(constitutionId)) {
          broken.push(`${ruleId} message "${messageId}" does not end with ${constitutionId}`);
        }
      }
    }

    expect(
      broken,
      report(
        `${broken.length} messages do not end with their constitution identifier — this is the trace tests/violations/harness.ts asserts and the whole of FR-011`,
        `broken      ${list(broken)}`,
      ),
    ).toEqual([]);
  });

  it('configures every rule in exactly one set, the one the contract puts it in', () => {
    const misconfigured: string[] = [];

    for (const ruleId of registeredIds) {
      const expected = contractRuleById.get(ruleId)?.ruleSet;
      if (expected === undefined) continue;

      const sets = configuredSets(ruleId);
      if (sets.length !== 1) {
        misconfigured.push(
          `${ruleId} is configured in ${sets.length === 0 ? 'neither set' : `both sets (${sets.join(', ')})`}`,
        );
        continue;
      }
      if (sets[0] !== expected) {
        misconfigured.push(
          `${ruleId} is configured ${String(sets[0])}, the contract says ${expected}`,
        );
      }
    }

    expect(
      misconfigured,
      report(
        `${misconfigured.length} rules are in the wrong rule set — a type-aware rule in the fast set never gets the program it needs, and a syntax rule in the type-aware set never runs in the editor or the hook (research R-10)`,
        `misconfig   ${list(misconfigured)}`,
      ),
    ).toEqual([]);
  });

  it('configures nothing the plugin does not register', () => {
    const stray = RULE_SETS.flatMap((set) =>
      Object.keys(plugin.configs[set].rules).map((id) => ({ set, id })),
    )
      .filter(({ id }) => !Object.hasOwn(plugin.rules, id.replace(/^ijazah\//, '')))
      .map(({ set, id }) => `${id} is configured in ${set} but is not a rule of this plugin`);

    expect(
      stray,
      report(
        `${stray.length} configured ids are not registered rules — ESLint fails to load a configuration naming a rule its plugin does not define`,
        `stray       ${list(stray)}`,
      ),
    ).toEqual([]);
  });
});
