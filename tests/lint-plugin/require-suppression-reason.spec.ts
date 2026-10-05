// proc/require-suppression-reason (R-PROC-7) against a table of code and against real ESLint (T041).
//
// The fixture proves one directive that names one rule. Two things it cannot prove are proved
// here.
//
// The table proves the justification syntax: the reason has to follow ESLint's own separator, and
// a rule id standing where the ticket should be is not a ticket.
//
// The second half proves the report is DELIVERED. The table's rows name `no-console`, a rule other
// than this one, so none of them shows what happens when the directive covers this rule's own
// report; and `RuleTester` refuses a row whose directive names a rule it does not know, which the
// fixture's directive and a reason written before the separator both do. Those cases run through
// `Linter` with inline configuration on, exactly as `pnpm lint` runs: the directive is honoured,
// and the rule's report about it has to come out anyway. The same cases record the one thing
// that cannot be reported, so the limit is a tested fact rather than a sentence in a header.

import { Linter, type Rule } from 'eslint';
import { describe, expect, it } from 'vitest';

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const rule = loadRule('require-suppression-reason.js');
const file = 'apps/api/src/modules/verification/review-code.ts';

const DISABLE = 'eslint-disable';
const LINE = 'eslint-disable-line';
const NEXT = 'eslint-disable-next-line';
const reason = 'T105 the seeded generator lands there';

typescriptRuleTester().run('proc/require-suppression-reason', rule, {
  valid: [
    {
      name: 'a justified next-line directive',
      code: `// ${NEXT} no-console -- ${reason}\nconsole.log(1);`,
      filename: file,
    },
    {
      name: 'a justified line directive',
      code: `console.log(1); // ${LINE} no-console -- ${reason}`,
      filename: file,
    },
    {
      name: 'a justified block directive, and the enable that ends it',
      code: `/* ${DISABLE} no-console -- ${reason} */\nconsole.log(1);\n/* eslint-enable no-console */`,
      filename: file,
    },
    {
      name: 'a justified bare directive',
      code: `// ${NEXT} -- #123 generated block, every rule is off\nconsole.log(1);`,
      filename: file,
    },
    {
      name: 'a tracker key and a longer separator',
      code: `// ${NEXT} no-console --- SCRUM-51 vendor shim until upgraded\nconsole.log(1);`,
      filename: file,
    },
    {
      name: 'a justified inline configuration',
      code: `/* eslint no-console: off -- ${reason} */\nconsole.log(1);`,
      filename: file,
    },
    {
      name: 'eslint-enable needs no reason',
      code: '/* eslint-enable */\nconsole.log(1);',
      filename: file,
    },
    {
      name: 'a line comment opening with a plain disable is not a directive',
      code: `// ${DISABLE} this is prose to ESLint\nconsole.log(1);`,
      filename: file,
    },
    {
      name: 'a comment that mentions a directive mid-sentence',
      code: `// the ${NEXT} below is justified\nconsole.log(1);`,
      filename: file,
    },
    {
      name: 'other directive comments',
      code: '/* global window */\n/* exported x */\nexport const x = 1;',
      filename: file,
    },
  ],
  invalid: [
    {
      name: 'a next-line directive with no reason',
      code: `export function reviewCode() {\n  // ${NEXT} no-console\n  console.log(1);\n}`,
      filename: file,
      errors: [{ messageId: 'unjustified', data: { name: NEXT, line: '2' }, line: 2 }],
    },
    {
      name: 'a reason in the comment above is not in the directive',
      code: `// ${reason}\n// ${NEXT} no-console\nconsole.log(1);`,
      filename: file,
      errors: [{ messageId: 'unjustified', line: 2 }],
    },
    {
      name: 'a reason with no ticket',
      code: `// ${NEXT} no-console -- the seeded generator lands later\nconsole.log(1);`,
      filename: file,
      errors: 1,
    },
    {
      name: 'a ticket with one word of reason',
      code: `// ${NEXT} no-console -- T105 temporary\nconsole.log(1);`,
      filename: file,
      errors: 1,
    },
    {
      name: 'a rule id is not a ticket',
      code: `// ${NEXT} no-console -- R-PROC-7 allows this line here\nconsole.log(1);`,
      filename: file,
      errors: 1,
    },
    {
      name: 'a multi-segment requirement id is not a ticket',
      code: `// ${NEXT} no-console -- FR-NOTIF-4 covers this line here\nconsole.log(1);`,
      filename: file,
      errors: 1,
    },
    {
      name: 'a line directive, in both comment forms',
      code: `console.log(1); // ${LINE} no-console\nconsole.log(2); /* ${LINE} no-console */`,
      filename: file,
      errors: [
        { messageId: 'unjustified', data: { name: LINE, line: '1' } },
        { messageId: 'unjustified', data: { name: LINE, line: '2' } },
      ],
    },
    {
      name: 'a block directive naming a rule',
      code: `/* ${DISABLE} no-console */\nconsole.log(1);`,
      filename: file,
      errors: [{ messageId: 'unjustified', data: { name: DISABLE, line: '1' } }],
    },
    {
      name: 'an inline configuration with no reason',
      code: '/* eslint no-console: off */\nconsole.log(1);',
      filename: file,
      errors: [{ messageId: 'unjustified', data: { name: 'eslint', line: '1' } }],
    },
    {
      name: 'a directive in a JavaScript file',
      code: `// ${NEXT} no-console\nconsole.log(1);`,
      filename: 'scripts/x.js',
      errors: 1,
    },
  ],
});

// ---------------------------------------------------------------------------------------------
// Delivered through real ESLint, inline configuration on.
// ---------------------------------------------------------------------------------------------

const ruleId = 'ijazah/proc/require-suppression-reason';

function lint(code: string): { line: number; column: number; message: string }[] {
  const linter = new Linter();
  const messages = linter.verify(
    code,
    [
      {
        plugins: {
          ijazah: { rules: { 'proc/require-suppression-reason': rule as Rule.RuleModule } },
        },
        rules: { [ruleId]: 'error' },
        linterOptions: { reportUnusedDisableDirectives: 'off' },
      },
    ],
    'file.js',
  );
  return messages
    .filter((message) => message.ruleId === ruleId)
    .map(({ line, column, message }) => ({ line, column, message }));
}

describe('proc/require-suppression-reason — the report survives the directive it is about', () => {
  it('reports the fixture: a next-line directive naming a plugin rule, with no reason', () => {
    const reports = lint(
      `export function reviewCode() {\n  // ${NEXT} ijazah/db/no-weak-random\n  return Math.random().toString(36);\n}\n`,
    );

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ line: 2, column: 3 });
  });

  it('reports a reason written before the separator, which ESLint reads as a rule name', () => {
    const reports = lint(`// ${NEXT} no-console ${reason}\nconsole.log(1);\n`);

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ line: 1 });
  });

  it('reports a bare line directive on the line above it, which the directive does not cover', () => {
    const reports = lint(`a();\nb(); // ${LINE}\n`);

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ line: 1, column: 1 });
    expect(reports[0]?.message).toContain(`"${LINE}" on line 2`);
  });

  it('reports a bare block directive just before the comment', () => {
    const reports = lint(`a(); /* ${DISABLE} */ b();\nc();\n`);

    expect(reports).toHaveLength(1);
    // The comment opens at column 6 (1-based); the report sits one character before it.
    expect(reports[0]).toMatchObject({ line: 1, column: 5 });
  });

  it('reports a bare block directive that opens a line on the line above', () => {
    const reports = lint(`a();\n/* ${DISABLE} */\nb();\n`);

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ line: 1, column: 1 });
    expect(reports[0]?.message).toContain('on line 2');
  });

  it('reports a bare next-line directive on the directive itself', () => {
    const reports = lint(`// ${NEXT}\na();\n`);

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ line: 1, column: 1 });
  });

  it('reports a directive that names this very rule', () => {
    const reports = lint(`a();\nb(); // ${LINE} ${ruleId}\n`);

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ line: 1 });
  });

  it('reports two bare line directives on consecutive lines, both above the pair', () => {
    const reports = lint(`a();\nb(); // ${LINE}\nc(); // ${LINE}\n`);

    expect(reports).toHaveLength(2);
    expect(reports.map((report) => report.line)).toEqual([1, 1]);
    expect(reports[0]?.message).toContain('on line 2');
    expect(reports[1]?.message).toContain('on line 3');
  });

  it('reports a bare directive inside a region another bare directive already disabled', () => {
    const reports = lint(`a();\n/* ${DISABLE} */\nb(); // ${LINE}\n`);

    expect(reports).toHaveLength(2);
    expect(reports.map((report) => report.line)).toEqual([1, 1]);
  });

  it('reports again after the region is re-enabled, at the directive’s own line', () => {
    const reports = lint(
      `/* ${DISABLE} -- ${reason} */\na();\n/* eslint-enable */\n// ${NEXT}\nb();\n`,
    );

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ line: 4 });
  });

  // Found by experiment against ESLint 10 (T041): a report located before the first character is
  // covered by no directive. If a later ESLint starts validating report locations, these two go
  // red, which is the alarm the header promises.
  it('reports a bare block directive at the very first character of the file', () => {
    const reports = lint(`/* ${DISABLE} */\na();\n`);

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ line: 1, column: 0 });
    expect(reports[0]?.message).toContain(`"${DISABLE}" on line 1`);
  });

  it('reports a bare line directive on line 1', () => {
    const reports = lint(`a(); // ${LINE}\n`);

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ line: 1, column: 0 });
  });

  it('stays silent on a justified bare directive at the first character', () => {
    expect(lint(`/* ${DISABLE} -- ${reason} */\na();\n`)).toEqual([]);
  });

  // The one hole, recorded as a fact. ESLint applies an inline configuration before any rule
  // runs, so a comment that switches this rule off means the rule never executes in that file.
  // Closing it needs a text gate in the pipeline, outside this rule (header; note under T041).
  it('cannot report in a file whose inline configuration switches this rule off', () => {
    expect(lint(`/* eslint ${ruleId}: off */\n// ${NEXT}\na();\n`)).toEqual([]);
  });
});
