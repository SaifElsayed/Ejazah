// proc/no-focused-or-skipped-test  ->  R-PROC-10  (fast)
//
// R-PROC-10: never lower the coverage floor, skip a failing test, or mark a test `.skip` to get
// green. Fix or raise it. A focused test stops every other case in its file and still reports
// green; a skipped one reports green without having run. Either way the suite says something it
// did not check (FR-062).
//
// The constitution's mechanism is "`.only` and `.skip` banned", with review behind it.
//
// WHAT IS REFUSED — on Vitest's own entry points `it`, `test`, `describe`, `suite` and `bench`:
//
//   it.only(…)  describe.skip(…)               the mark, anywhere in the chain:
//   it.concurrent.only(…)  test.skip.each(…)     before or after another modifier or a call
//   it['only'](…)  it?.skip(…)                 computed with a string, optional, or behind a
//                                              TypeScript wrapper
//   const focused = it.only                    referenced without being called
//   it('name', { skip: true }, fn)             the options form: `skip` or `only` set to anything
//   it('name', { only: flag }, fn)               but the literal `false`
//
// The rule is not limited to `*.spec.*` files: a mark in a helper that a spec calls skips just as
// well.
//
// DECISION (T041) — what stays legal.
//
//   it.todo(…)          a case that does not exist yet is not a failing test silenced; the
//                       repository's placeholder specs are written this way, each naming the
//                       task that will fill it.
//   it.skipIf(…), it.runIf(…)
//                       a condition on the environment (no database, no device) is not "to get
//                       green": the case runs wherever its precondition holds. Whether a
//                       condition is honest — `skipIf(true)` is not — is review's, which is the
//                       second mechanism the constitution names for this rule.
//
// WHAT IS NOT SEEN, and is review's. An aliased entry point is not followed
// (`import { it as spec } from 'vitest'`, `const run = it`); this rule runs without types
// (research R-10). A skip requested from inside the test body through its context
// (`ctx.skip()`), which is reached through a parameter. Jasmine's `xit` / `fit`, which Vitest
// does not define, so a call to one fails the run on its own. A lowered coverage floor is a
// configuration change, read at review.
const { defineRule } = require('../rule');
const { keyName, propertyName, unwrap } = require('../syntax');

const TEST_APIS = new Set(['it', 'test', 'describe', 'suite', 'bench']);
const MARKS = { only: 'focused', skip: 'skipped' };

/** The test entry point a chain starts from (`it` in `it.concurrent.each(table).only`), or null. */
function entryPointOf(node) {
  let current = unwrap(node);
  for (;;) {
    if (current === null || current === undefined) return null;
    if (current.type === 'MemberExpression') current = unwrap(current.object);
    else if (current.type === 'CallExpression') current = unwrap(current.callee);
    else if (current.type === 'TaggedTemplateExpression') current = unwrap(current.tag);
    else break;
  }
  return current.type === 'Identifier' && TEST_APIS.has(current.name) ? current.name : null;
}

function isLiteralFalse(node) {
  const inner = unwrap(node);
  return inner.type === 'Literal' && inner.value === false;
}

module.exports = defineRule({
  constitutionId: 'R-PROC-10',
  description:
    'Bans .only and .skip, and the skip/only options, on it, test, describe, suite and bench',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    marked:
      '"{{api}}.{{mark}}" leaves a {{state}} test in the suite — fix the test or raise the failure, because a suite that is green without running a case has checked nothing',
  },
  create(context) {
    function report(node, api, mark) {
      context.report({ node, messageId: 'marked', data: { api, mark, state: MARKS[mark] } });
    }

    return {
      MemberExpression(node) {
        const mark = propertyName(node);
        if (mark === null || !Object.hasOwn(MARKS, mark)) return;
        const api = entryPointOf(node.object);
        if (api !== null) report(node.property, api, mark);
      },
      CallExpression(node) {
        const api = entryPointOf(node.callee);
        if (api === null) return;
        for (const argument of node.arguments.slice(1)) {
          const options = unwrap(argument);
          if (options.type !== 'ObjectExpression') continue;
          for (const property of options.properties) {
            if (property.type !== 'Property') continue;
            const mark = keyName(property);
            if (mark === null || !Object.hasOwn(MARKS, mark)) continue;
            if (!isLiteralFalse(property.value)) report(property, api, mark);
          }
        }
      },
    };
  },
});
