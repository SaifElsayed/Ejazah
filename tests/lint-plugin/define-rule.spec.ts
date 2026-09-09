// T034 — the rule factory's own refusals.
//
// `convention.spec.ts` reads the metadata of the 24 registered rules and holds it to the
// contract. It proves the output; it never asks what happens to a bad declaration, so a factory
// that quietly stopped throwing would pass it. This spec is the other half: every branch of
// `packages/config/eslint-plugin-ijazah/rule.js` that refuses a definition has a case here, so a
// guard removed by accident is a red test rather than a rule that loads and cannot be traced.
//
// The factory refuses two kinds of thing, and both matter for FR-011. A malformed identifier, or
// one hand-written at the end of a message, breaks the trace from a build log to the constitution.
// An unrecognised `meta` key does not break the trace, it breaks the rule: dropping `fixable`
// leaves ESLint throwing at the first fix a rule tries to produce, when somebody runs `--fix`,
// rather than when the rule is loaded.
//
// It lives here, not beside the plugin, because `packages/config` is a JavaScript package
// belonging to no TypeScript project: a `.spec.ts` inside it fails the type-aware lint run, while
// `tests/**/*.ts` is already covered by the root `tsconfig.json` and by the Vitest include.

import { createRequire } from 'node:module';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repositoryRoot } from '../support/lint-contract';

const require = createRequire(import.meta.url);

const rulePath = path.join(
  repositoryRoot,
  ...'packages/config/eslint-plugin-ijazah/rule.js'.split('/'),
);

/** The factory's surface. Declared here because the plugin is untyped CommonJS. */
interface RuleModule {
  readonly meta: {
    readonly type?: unknown;
    readonly docs?: { readonly description?: unknown; readonly constitution?: unknown };
    readonly messages?: Readonly<Record<string, unknown>>;
    readonly schema?: unknown;
    readonly fixable?: unknown;
    readonly hasSuggestions?: unknown;
    readonly deprecated?: unknown;
    readonly defaultOptions?: unknown;
  };
  readonly create: unknown;
}

interface RuleFactory {
  /** `unknown` on purpose: half of this spec hands it what a rule author must not write. */
  readonly defineRule: (definition: unknown) => RuleModule;
  readonly RULE_SETS: readonly string[];
  readonly FAST: string;
  readonly TYPE_AWARE: string;
}

const { defineRule, RULE_SETS, FAST, TYPE_AWARE } = require(rulePath) as RuleFactory;

/** A declaration that passes every guard, so each case below changes exactly one thing. */
function valid(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    constitutionId: 'R-API-6',
    messages: { violation: 'a module read a table it does not own' },
    create() {
      return {};
    },
    ...overrides,
  };
}

describe('T034 — the rule factory refuses what it cannot trace', () => {
  it('refuses a definition that is not an object', () => {
    expect(() => defineRule(undefined)).toThrow(/no definition object/);
    expect(() => defineRule(null)).toThrow(/no definition object/);
    expect(() => defineRule('R-API-6')).toThrow(/no definition object/);
    expect(() => defineRule([valid()])).toThrow(/no definition object/);
  });

  it('refuses a constitution identifier the constitution does not use', () => {
    expect(() => defineRule(valid({ constitutionId: undefined }))).toThrow(/FR-011/);
    expect(() => defineRule(valid({ constitutionId: 'R-API' }))).toThrow(/FR-011/);
    expect(() => defineRule(valid({ constitutionId: 'api/no-logic-in-router' }))).toThrow(/FR-011/);
    expect(() => defineRule(valid({ constitutionId: 'r-api-6' }))).toThrow(/FR-011/);
    // A leading zero is a different string from the identifier the constitution publishes, and a
    // build log carrying it cannot be searched for.
    expect(() => defineRule(valid({ constitutionId: 'R-API-02' }))).toThrow(/FR-011/);
    expect(() => defineRule(valid({ constitutionId: 'R-API-0' }))).toThrow(/FR-011/);
  });

  it('refuses a rule with no body', () => {
    expect(() => defineRule(valid({ create: undefined }))).toThrow(/no create/);
    expect(() => defineRule(valid({ create: {} }))).toThrow(/no create/);
  });

  it('refuses messages that are not a map of message id to text', () => {
    expect(() => defineRule(valid({ messages: undefined }))).toThrow(/no messages/);
    expect(() => defineRule(valid({ messages: null }))).toThrow(/no messages/);
    expect(() => defineRule(valid({ messages: 'a table was read' }))).toThrow(/no messages/);
    // An array would otherwise register a message under the id "0", which no rule can report.
    expect(() => defineRule(valid({ messages: ['a table was read'] }))).toThrow(/no messages/);
    expect(() => defineRule(valid({ messages: {} }))).toThrow(/no messages/);
  });

  it('refuses a message with no text', () => {
    expect(() => defineRule(valid({ messages: { violation: '' } }))).toThrow(/has no text/);
    expect(() => defineRule(valid({ messages: { violation: '   ' } }))).toThrow(/has no text/);
    expect(() => defineRule(valid({ messages: { violation: 42 } }))).toThrow(/has no text/);
    expect(() => defineRule(valid({ messages: { violation: undefined } }))).toThrow(/has no text/);
  });

  it('refuses a message that ends with the identifier it would be given', () => {
    expect(() =>
      defineRule(valid({ messages: { violation: 'a table it does not own R-API-6' } })),
    ).toThrow(/ends with the identifier itself/);
    // Trailing whitespace does not hide it.
    expect(() =>
      defineRule(valid({ messages: { violation: 'a table it does not own R-API-6  ' } })),
    ).toThrow(/ends with the identifier itself/);
  });

  it('allows a message that cites a different rule', () => {
    // The contract itself cross-references rules (R-API-10 and R-PROC-7). Only the end of the
    // text is the mistake this guard is for, so a mention elsewhere must survive.
    const rule = defineRule(
      valid({
        constitutionId: 'R-API-1',
        messages: { violation: 'move this to the service; R-API-15 covers the queued half' },
      }),
    );

    expect(rule.meta.messages?.violation).toBe(
      'move this to the service; R-API-15 covers the queued half R-API-1',
    );

    // And the same pair the other way round, which a prefix check would have refused.
    const longer = defineRule(
      valid({ constitutionId: 'R-API-15', messages: { violation: 'R-API-1 is the router half' } }),
    );

    expect(longer.meta.messages?.violation).toBe('R-API-1 is the router half R-API-15');
  });

  it('refuses a key it does not understand', () => {
    expect(() => defineRule(valid({ meta: { fixable: 'code' } }))).toThrow(/unknown key "meta"/);
    expect(() => defineRule(valid({ ruleId: 'api/table-ownership' }))).toThrow(/unknown key/);
    // The point of refusing: a typo in an accepted key is a load failure, not a silent drop.
    expect(() => defineRule(valid({ fixible: 'code' }))).toThrow(/unknown key "fixible"/);
  });

  it('refuses a fixable value ESLint does not accept', () => {
    expect(() => defineRule(valid({ fixable: true }))).toThrow(/fixable must be/);
    expect(() => defineRule(valid({ fixable: 'yes' }))).toThrow(/fixable must be/);
    expect(() => defineRule(valid({ fixable: 'CODE' }))).toThrow(/fixable must be/);
  });

  it('refuses an accepted key carrying a shape ESLint does not read', () => {
    // The rule would load and ESLint would ignore the metadata, which is the unknown-key failure
    // one step later. Each accepted key is checked for the one shape ESLint honours.
    expect(() => defineRule(valid({ type: 'x' }))).toThrow(
      /type must be problem, suggestion, layout/,
    );
    expect(() => defineRule(valid({ hasSuggestions: 'true' }))).toThrow(
      /hasSuggestions must be a boolean/,
    );
    expect(() => defineRule(valid({ description: 42 }))).toThrow(/description must be a string/);
    expect(() => defineRule(valid({ schema: 'x' }))).toThrow(
      /schema must be an array or an object/,
    );
    expect(() => defineRule(valid({ deprecated: 'yes' }))).toThrow(
      /deprecated must be a boolean or an object/,
    );
    expect(() => defineRule(valid({ defaultOptions: {} }))).toThrow(
      /defaultOptions must be an array/,
    );
  });

  it('appends the identifier to every message, trimmed, exactly once', () => {
    const rule = defineRule(
      valid({
        messages: {
          violation: '  a module read a table it does not own  ',
          hint: 'ask the owning module for the value',
        },
      }),
    );

    expect(rule.meta.messages).toEqual({
      violation: 'a module read a table it does not own R-API-6',
      hint: 'ask the owning module for the value R-API-6',
    });
  });

  it('defaults the type, the description and the option schema', () => {
    const rule = defineRule(valid());

    expect(rule.meta.type).toBe('problem');
    expect(rule.meta.docs).toEqual({ description: 'Enforces R-API-6', constitution: 'R-API-6' });
    expect(rule.meta.schema).toEqual([]);

    const declared = defineRule(
      valid({ type: 'suggestion', description: 'Refuses a cross-module table read' }),
    );

    expect(declared.meta.type).toBe('suggestion');
    expect(declared.meta.docs?.description).toBe('Refuses a cross-module table read');
  });

  it('gives every rule its own option schema', () => {
    const first = defineRule(valid());
    const second = defineRule(valid());

    // A shared default array would let one rule's options land on every other rule declared with
    // no schema of its own.
    expect(first.meta.schema).not.toBe(second.meta.schema);

    (first.meta.schema as unknown[]).push({ type: 'object' });

    expect(second.meta.schema).toEqual([]);
  });

  it('forwards the metadata ESLint requires before a rule may fix or suggest', () => {
    const plain = defineRule(valid());

    // Absent, not undefined: ESLint reads these keys, and so does a comparison of rule objects.
    expect(Object.hasOwn(plain.meta, 'fixable')).toBe(false);
    expect(Object.hasOwn(plain.meta, 'hasSuggestions')).toBe(false);

    const fixer = defineRule(valid({ fixable: 'code', hasSuggestions: true }));

    expect(fixer.meta.fixable).toBe('code');
    expect(fixer.meta.hasSuggestions).toBe(true);
    expect(defineRule(valid({ fixable: 'whitespace' })).meta.fixable).toBe('whitespace');

    // `replacedBy` lives inside `deprecated` since ESLint 9.21; the top-level form is refused with
    // a hint rather than forwarded to a key ESLint no longer reads.
    const retired = defineRule(
      valid({
        deprecated: { replacedBy: [{ rule: { name: 'ijazah/api/table-ownership' } }] },
        defaultOptions: [{}],
      }),
    );

    expect(retired.meta.deprecated).toEqual({
      replacedBy: [{ rule: { name: 'ijazah/api/table-ownership' } }],
    });
    expect(retired.meta.defaultOptions).toEqual([{}]);
    expect(() => defineRule(valid({ replacedBy: ['x'] }))).toThrow(
      /unknown key "replacedBy" — use deprecated: { replacedBy/,
    );
  });

  it('publishes the two rule sets the configs are built from', () => {
    expect(RULE_SETS).toEqual([FAST, TYPE_AWARE]);
  });
});
