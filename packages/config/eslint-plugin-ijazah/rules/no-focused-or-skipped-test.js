// proc/no-focused-or-skipped-test  ->  R-PROC-10  (fast)
//
// R-PROC-10: never lower the coverage floor, skip a failing test or mark a test `.skip` to get
// green. Fix or raise it. A `.only` leaves the file reporting green while every other case in it
// stops running; a `.skip` is a failing test with the failure hidden. Both are how a red suite
// turns green without anything being fixed (FR-062). The coverage floor is a pipeline gate (T086);
// this rule is the lint half.
//
// WHERE (T041): test files — `*.spec.*`, `*.test.*`, or any file under `tests/`, `test/` or
// `__tests__/` — matched on the basename and the segments (`../files.js`), never on a root-anchored
// path, because the two fixtures are real `*.spec.ts` files under `tests/violations/fixtures/`
// (note under T025–T026). A non-test file has no test to focus.
//
// WHAT IS REFUSED (T041): a member named `only` or `skip` anywhere in a chain rooted at `it`,
// `test`, `describe`, `suite` or `bench` — `it.only`, `describe.skip`, `test.concurrent.only`,
// `describe.sequential.skip`, `it.skip.each` — and the Jasmine-style aliases `fit`, `fdescribe`,
// `xit`, `xtest`, `xdescribe`, which are the same two marks under shorter names.
//
// WHAT IS NOT (T041): `it.todo`, which declares a test that does not exist yet and is how
// `tests/db-integrity/` names its Phase 2 probes — a todo is reported by the runner as pending,
// not as green. `describe.skipIf(...)` and `it.runIf(...)`, which gate a suite on its environment
// (a database that is not there) rather than on a failure; they are the honest spelling of
// "cannot run here", and review reads for a condition that is really "is failing". A bare
// `skip` on a receiver that is not a test function (`list.skip(1)`) is not read.
const { defineRule } = require('../rule');
const { isTestFile } = require('../files');

const TEST_FUNCTIONS = new Set(['it', 'test', 'describe', 'suite', 'bench']);
const MARKS = new Set(['only', 'skip']);

const ALIASES = new Map([
  ['fit', 'only'],
  ['fdescribe', 'only'],
  ['xit', 'skip'],
  ['xtest', 'skip'],
  ['xdescribe', 'skip'],
]);

function propertyName(node) {
  if (node.computed) {
    return node.property.type === 'Literal' && typeof node.property.value === 'string'
      ? node.property.value
      : null;
  }
  return node.property.type === 'Identifier' ? node.property.name : null;
}

/** The identifier at the root of a member chain: `it` in `it.concurrent.only`. */
function rootOf(node) {
  let current = node;
  while (current.type === 'MemberExpression') current = current.object;
  return current.type === 'Identifier' ? current.name : null;
}

module.exports = defineRule({
  constitutionId: 'R-PROC-10',
  description: 'Bans a focused (.only) or skipped (.skip) test in a test file',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    focused:
      '"{{spelling}}" runs this case alone and silently stops every other case in the file — remove the focus before committing',
    skipped:
      '"{{spelling}}" hides a case instead of fixing it — a skipped test is a failing test with the failure hidden, so fix it, or delete it with the reason in the commit',
  },
  create(context) {
    if (!isTestFile(context.filename)) return {};

    function report(node, mark, spelling) {
      context.report({
        node,
        messageId: mark === 'only' ? 'focused' : 'skipped',
        data: { spelling },
      });
    }

    return {
      MemberExpression: (node) => {
        const name = propertyName(node);
        if (name === null || !MARKS.has(name)) return;
        const root = rootOf(node);
        if (root === null || !TEST_FUNCTIONS.has(root)) return;
        report(node.property, name, `${root}.${name}`);
      },
      CallExpression: (node) => {
        if (node.callee.type !== 'Identifier') return;
        const mark = ALIASES.get(node.callee.name);
        if (mark === undefined) return;
        report(node.callee, mark, node.callee.name);
      },
    };
  },
});
