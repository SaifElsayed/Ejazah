// T139 — the suppression gate (FR-008, SC-003, R-PROC-7).
//
// `proc/require-suppression-reason` refuses an unjustified suppression in the ordinary lint run,
// but a file whose inline configuration switches that rule off is never judged there: ESLint
// applies the comment before any rule runs. The gate (T140) is the same rule run a second time
// with inline configuration off, so every directive is read as a plain comment and judged, and no
// comment can reach the run. These cases hold both halves of that claim: the ordinary run cannot
// see the self-disabling comment, in every spelling ESLint reads, and the gate refuses it; a
// justified directive passes the gate with no message at all; and in the type-aware set an unused
// directive is an error, while a justified one naming a type-aware rule passes both sets.
//
// Lint runs through the repository's own configuration files, as `pnpm lint` and
// `pnpm lint:types` run. Code the fast set reads is linted from memory under a repository path;
// the type-aware set needs the file in a TypeScript program, so its cases write a probe file under
// `tests/pipeline/`, which the root `tsconfig.json` includes, and remove it after.
import { randomBytes } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { ESLint } from 'eslint';
import { afterEach, describe, expect, it } from 'vitest';

import { createSuppressionGate, main, SUPPRESSION_RULE } from '../../scripts/suppression-gate';
import { TYPE_AWARE_LINT_TIMEOUT_MILLISECONDS } from '../support/rule-tester';

const root = join(__dirname, '..', '..');
const sourceFile = join(root, 'apps', 'api', 'src', 'modules', 'verification', 'review-code.ts');
const RULE = SUPPRESSION_RULE;
const reason = 'T139 the gate is probed on purpose';

function linter(config: 'eslint.config.js' | 'eslint.types.config.js'): ESLint {
  return new ESLint({ cwd: root, overrideConfigFile: join(root, config) });
}

const ordinary = linter('eslint.config.js');
const gate = createSuppressionGate();

async function messagesOf(eslint: ESLint, code: string): Promise<ESLint.LintResult['messages']> {
  const [result] = await eslint.lintText(code, { filePath: sourceFile });
  return result?.messages ?? [];
}

const errorsOf = (messages: ESLint.LintResult['messages']) =>
  messages.filter((message) => message.severity === 2);

const probes: string[] = [];
afterEach(() => {
  for (const probe of probes.splice(0)) rmSync(probe, { force: true });
});

/** A file on disk under `tests/pipeline/`, in the root project, removed after the case. */
function probeFile(code: string): string {
  const file = join(
    root,
    'tests',
    'pipeline',
    `suppression-gate-probe-${randomBytes(4).toString('hex')}.ts`,
  );
  probes.push(file);
  writeFileSync(file, code);
  return file;
}

const body = 'export const enabled = true;\n';

const selfDisabling: readonly (readonly [string, string])[] = [
  ['off', `/* eslint ${RULE}: off */\n${body}`],
  ['0', `/* eslint ${RULE}: 0 */\n${body}`],
  ['"off"', `/* eslint ${RULE}: "off" */\n${body}`],
  ['["off"]', `/* eslint ${RULE}: ["off"] */\n${body}`],
  ['no spaces', `/*eslint ${RULE}:off*/\n${body}`],
  ['tabs', `/*\teslint\t${RULE}:\toff\t*/\n${body}`],
  ['a line break inside the comment', `/* eslint\n  ${RULE}: off\n*/\n${body}`],
  ['beside another rule', `/* eslint no-console: off, ${RULE}: off */\n${body}`],
];

describe('the ordinary run cannot see a comment that switches the suppression rule off', () => {
  it.each(selfDisabling)('spelled %s: no report from the rule', async (_, code) => {
    const reports = (await messagesOf(ordinary, code)).filter((message) => message.ruleId === RULE);
    expect(reports).toEqual([]);
  });
});

describe('the gate refuses it, in each spelling ESLint reads (T140)', () => {
  it.each(selfDisabling)('spelled %s: refused, naming R-PROC-7', async (_, code) => {
    const errors = errorsOf(await messagesOf(gate, code));
    expect(errors.length).toBeGreaterThan(0);
    for (const error of errors) {
      expect(error.ruleId).toBe(RULE);
      expect(error.message.trim().endsWith('R-PROC-7')).toBe(true);
    }
  });

  it('refuses the unjustified suppression a justified self-disabling comment was hiding', async () => {
    const code = `/* eslint ${RULE}: off -- ${reason} */\n// eslint-disable-next-line no-console\nconsole.log(1);\n`;
    expect((await messagesOf(ordinary, code)).filter((m) => m.ruleId === RULE)).toEqual([]);
    const errors = errorsOf(await messagesOf(gate, code));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('line 2');
  });

  it('refuses a bare blanket disable at the first character of the file', async () => {
    expect(errorsOf(await messagesOf(gate, `/* eslint-disable */\n${body}`))).toHaveLength(1);
  });
});

describe('the gate passes a justified directive, with no message at all', () => {
  it.each([
    ['an inline configuration', `/* eslint no-console: off -- ${reason} */\n${body}`],
    [
      'an eslint-disable and the enable that ends it',
      `/* eslint-disable no-console -- ${reason} */\n${body}/* eslint-enable no-console */\n`,
    ],
    [
      'an eslint-disable-line',
      `export const enabled = true; // eslint-disable-line no-console -- ${reason}\n`,
    ],
    ['an eslint-disable-next-line', `// eslint-disable-next-line no-console -- ${reason}\n${body}`],
    [
      'a justified suppression of the rule itself',
      `/* eslint ${RULE}: off -- ${reason} */\n${body}`,
    ],
  ])('%s', async (_, code) => {
    expect(await messagesOf(gate, code)).toEqual([]);
  });
});

describe('the gate reads exactly the files `pnpm lint` reads', () => {
  it.each([
    [
      'a violation fixture',
      'tests/violations/fixtures/apps/api/src/modules/sessions/next-occurrence.ts',
      true,
    ],
    ['a document', 'docs/design/frames/frame.ts', true],
    [
      'a plugin spec, which quotes these comments inside strings',
      'tests/lint-plugin/require-suppression-reason.spec.ts',
      false,
    ],
    ['a module file', 'apps/api/src/main.ts', false],
  ])('%s', async (_, path, ignored) => {
    const file = join(root, path);
    expect(await gate.isPathIgnored(file)).toBe(ignored);
    expect(await ordinary.isPathIgnored(file)).toBe(ignored);
  });

  it('finds nothing in a plugin spec that holds directives inside strings', async () => {
    const results = await gate.lintFiles([
      join(root, 'tests', 'lint-plugin', 'require-suppression-reason.spec.ts'),
    ]);
    expect(results.flatMap((result) => result.messages)).toEqual([]);
  });
});

describe('an unused directive fails `pnpm lint:types`, and only there (FR-008)', () => {
  const types = linter('eslint.types.config.js');
  const money = [
    'declare const piastersBrand: unique symbol;',
    'type Piasters = number & { readonly [piastersBrand]: true };',
    '',
  ].join('\n');

  it(
    'passes a justified eslint-disable-next-line naming a type-aware rule, in both sets and the gate',
    async () => {
      const file = probeFile(
        `${money}// eslint-disable-next-line ijazah/money/require-piaster-suffix -- ${reason}\nexport const label = (price: Piasters): string => String(price);\n`,
      );
      const [fast] = await ordinary.lintFiles([file]);
      expect(fast?.errorCount, JSON.stringify(fast?.messages)).toBe(0);
      const [typed] = await types.lintFiles([file]);
      expect(typed?.messages, 'the directive is used, so nothing is reported').toEqual([]);
      const [gated] = await gate.lintFiles([file]);
      expect(gated?.messages).toEqual([]);
    },
    TYPE_AWARE_LINT_TIMEOUT_MILLISECONDS,
  );

  it(
    'fails a directive that suppresses nothing; the fast set leaves it a warning',
    async () => {
      const file = probeFile(
        `// eslint-disable-next-line ijazah/money/require-piaster-suffix -- ${reason}\n${body}`,
      );
      const [typed] = await types.lintFiles([file]);
      const unused = errorsOf(typed?.messages ?? []);
      expect(unused).toHaveLength(1);
      expect(unused[0]?.message).toMatch(/Unused eslint-disable directive/);
      const [fast] = await ordinary.lintFiles([file]);
      expect(fast?.errorCount).toBe(0);
      expect(fast?.warningCount).toBe(1);
    },
    TYPE_AWARE_LINT_TIMEOUT_MILLISECONDS,
  );

  it(
    'fails a justified eslint-disable naming the suppression rule itself, which never suppresses anything',
    async () => {
      const file = probeFile(`// eslint-disable-next-line ${RULE} -- ${reason}\n${body}`);
      const [typed] = await types.lintFiles([file]);
      const unused = errorsOf(typed?.messages ?? []);
      expect(unused).toHaveLength(1);
      expect(unused[0]?.message).toMatch(/Unused eslint-disable directive/);
    },
    TYPE_AWARE_LINT_TIMEOUT_MILLISECONDS,
  );
});

describe('the command (`pnpm check:suppressions`)', () => {
  const output = { out: '', err: '' };
  const streams = {
    out: (text: string) => {
      output.out += text;
    },
    err: (text: string) => {
      output.err += text;
    },
  };
  afterEach(() => {
    output.out = '';
    output.err = '';
  });

  it('exits 1 naming R-PROC-7 and the file when the gate finds an error', async () => {
    const file = probeFile(`/* eslint ${RULE}: off */\n${body}`);
    expect(await main([file], streams)).toBe(1);
    expect(output.err).toContain('R-PROC-7');
    expect(output.err).toContain(relative(root, file).split('\\').join('/'));
  });

  it('exits 0 when every suppression is justified', async () => {
    const file = probeFile(`/* eslint no-console: off -- ${reason} */\n${body}`);
    expect(await main([file], streams)).toBe(0);
    expect(output.err).toBe('');
  });
});
