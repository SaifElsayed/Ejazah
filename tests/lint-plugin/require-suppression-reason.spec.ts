// proc/require-suppression-reason (R-PROC-7) against a table of code (T041).
//
// The fixture suppresses one rule on one line with nothing after the rule name. This table proves
// the rest of the decision: the three directive spellings and the block form are read alike, an
// `eslint-enable` needs no reason because it re-opens the wall, and the description after ESLint's
// own ` -- ` separator is held to `packages/config/eslint-plugin-ijazah/justification.js`, so a
// ticket alone, a reason alone, a constitution id or a rule id plus a ticket are each refused
// under `weakDescription` while a missing separator is `noDescription`. Words written before the
// separator are a list of rule names to ESLint, which is why the tester's own linter, not this
// rule, is what complains about them; the table keeps the rule names real for that reason.
//
// Every directive below names `no-console`, a core rule the tester does not enable, so ESLint has
// a definition to find and nothing to report about the directive itself. The fixture's own rule id
// cannot be spelled here: the tester loads one rule and no plugin, and ESLint reports a directive
// naming a rule it cannot find as a second problem the table did not ask for. A blanket
// `eslint-disable` naming no rule is absent from both tables for a different reason. It disables
// this rule too, on the very line it sits on, so the rule's own report is suppressed before the
// tester sees it, with or without a description. That hole is recorded in the rule header as a
// matter for review, and no table can close it.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const verification = 'apps/api/src/modules/verification/review-code.ts';
const boot = 'apps/api/src/main.ts';

typescriptRuleTester().run(
  'proc/require-suppression-reason',
  loadRule('require-suppression-reason.js'),
  {
    valid: [
      {
        name: 'a next-line suppression with a reason and a ticket after the separator',
        code: "// eslint-disable-next-line no-console -- the boot banner is printed on purpose, IJZ-231\nconsole.log('ready');",
        filename: boot,
      },
      {
        name: 'a same-line suppression with a reason and a ticket',
        code: "console.log('ready'); // eslint-disable-line no-console -- the boot banner is printed on purpose, T041",
        filename: boot,
      },
      {
        name: 'a block suppression with a reason and a ticket, then re-enabled',
        code: "/* eslint-disable no-console -- the boot banner is printed on purpose, #12 */\nconsole.log('ready');\n/* eslint-enable no-console */",
        filename: boot,
      },
      {
        name: 'an eslint-enable on its own, which re-opens the wall and needs no reason',
        code: '/* eslint-enable no-console */\nexport const ready = true;',
        filename: boot,
      },
      {
        name: 'prose that mentions a directive mid-sentence',
        code: '// the eslint-disable above this file was removed under T041\nexport const ready = true;',
        filename: boot,
      },
      {
        name: 'a reason written in Arabic beside the ticket',
        code: "// eslint-disable-next-line no-console -- شعار الإقلاع مقصود هنا, IJZ-231\nconsole.log('ready');",
        filename: boot,
      },
    ],
    invalid: [
      {
        name: 'the canonical next-line suppression with nothing after the rule name',
        code: 'export function reviewCode(): string {\n  // eslint-disable-next-line no-console\n  return Math.random().toString(36).slice(2);\n}',
        filename: verification,
        errors: [{ messageId: 'noDescription', data: { directive: 'eslint-disable-next-line' } }],
      },
      {
        name: 'a same-line suppression with no description',
        code: "console.log('ready'); // eslint-disable-line no-console",
        filename: boot,
        errors: [{ messageId: 'noDescription', data: { directive: 'eslint-disable-line' } }],
      },
      {
        name: 'a block suppression with no description',
        code: "/* eslint-disable no-console */\nconsole.log('ready');\n/* eslint-enable no-console */",
        filename: boot,
        errors: [{ messageId: 'noDescription', data: { directive: 'eslint-disable' } }],
      },
      {
        name: 'a block suppression naming two rules with no description',
        code: "/* eslint-disable no-console, no-alert */\nconsole.log('ready');",
        filename: boot,
        errors: [{ messageId: 'noDescription', data: { directive: 'eslint-disable' } }],
      },
      {
        name: 'a description carrying a ticket and no reason',
        code: "// eslint-disable-next-line no-console -- IJZ-231\nconsole.log('ready');",
        filename: boot,
        errors: [{ messageId: 'weakDescription', data: { directive: 'eslint-disable-next-line' } }],
      },
      {
        name: 'a description carrying a reason and no ticket',
        code: "// eslint-disable-next-line no-console -- the boot banner is printed on purpose\nconsole.log('ready');",
        filename: boot,
        errors: [{ messageId: 'weakDescription', data: { directive: 'eslint-disable-next-line' } }],
      },
      {
        name: 'a description whose only reference is a constitution id',
        code: "// eslint-disable-next-line no-console -- the boot banner is printed on purpose, R-PROC-7\nconsole.log('ready');",
        filename: boot,
        errors: [{ messageId: 'weakDescription', data: { directive: 'eslint-disable-next-line' } }],
      },
      {
        name: 'a description that repeats the rule id beside the ticket, which is not a reason',
        code: "// eslint-disable-next-line no-console -- no-console IJZ-231\nconsole.log('ready');",
        filename: boot,
        errors: [{ messageId: 'weakDescription', data: { directive: 'eslint-disable-next-line' } }],
      },
      {
        name: 'a description of one word beside the ticket, under the two-word floor',
        code: "// eslint-disable-next-line no-console -- banner, IJZ-231\nconsole.log('ready');",
        filename: boot,
        errors: [{ messageId: 'weakDescription', data: { directive: 'eslint-disable-next-line' } }],
      },
      {
        name: 'a block suppression whose description is weak',
        code: "/* eslint-disable no-console -- T041 */\nconsole.log('ready');\n/* eslint-enable no-console */",
        filename: boot,
        errors: [{ messageId: 'weakDescription', data: { directive: 'eslint-disable' } }],
      },
    ],
  },
);
