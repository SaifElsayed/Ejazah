// time/no-datetime-outside-package  ->  R-TIME-1  (fast)
//
// R-TIME-1: never construct or resolve a session datetime outside `packages/time`. The package is
// the one place a wall-clock time in a zone becomes an instant, and it does it through Temporal
// with an explicit disambiguation (research R-4, ADR 0009); a `new Date(ms + 7 days)` in a module
// resolves the same thing through the process zone and is wrong by an hour twice a year (FR-017).
// Display formatting is R-MOBILE-9 and `mobile/no-manual-format`.
//
// WHERE (T132): every file outside `packages/time`. The package imports the polyfill and does the
// arithmetic; nothing else does, in the API, the worker, the mobile app, the admin, the seed or
// the tests. The two halves of the mechanism each have a fixture (T024).
//
// HALF ONE — a datetime library (T132): an import, in every spelling `../specifiers.js` knows, of
// `@js-temporal/polyfill`, `temporal-polyfill`, `luxon`, `dayjs`, `moment`, `moment-timezone`,
// `date-fns`, `date-fns-tz`, `@date-fns/tz`, `@date-fns/utc`, `@internationalized/date`,
// `@js-joda/core`, `js-joda`, `chrono-node`, `spacetime`, `timezone-support`, `rrule` or
// `date-holidays`. The polyfill is confined so the swap to native Temporal stays an internal change
// (research R-4); the others are the same computation done a second way.
//
// HALF TWO — `Date` arithmetic (T132), the spellings by which a datetime is constructed or
// resolved in code that has no zone:
//
//   - an arithmetic operator (`+ - * / %`, and the compound assignments) with an operand that is
//     `Date.now()`, `new Date(…)`, `Date.parse(…)`, or a call to `getTime()` or `valueOf()` on
//     anything — the fixture's `previousStartAt.getTime() + 7 * 24 * 60 * 60 * 1000`;
//   - a `Date` constructed from parts, `new Date(y, m, d, …)` with two or more arguments, or
//     `Date.UTC(…)`: parts become an instant only through a zone, and the process zone is not one
//     the domain chose;
//   - a `Date` constructed from an arithmetic expression, `new Date(a + b)`;
//   - a mutating setter — `setDate`, `setMonth`, `setFullYear`, `setHours`, `setMinutes`,
//     `setSeconds`, `setMilliseconds`, `setTime` and their `setUTC*` twins — which is arithmetic
//     spelled as a method.
//
// Not refused: `new Date()` (now, an instant), `new Date(isoString)` and `new Date(ms)` from one
// argument (parsing a stored instant), a comparison of two `getTime()` values (ordering, not
// construction), and reading `Date.now()` on its own. A `Date.now() - started` to time a request
// is arithmetic on two instants and is refused; `performance.now()` is the tool for elapsed time
// and carries no calendar.
//
// The file is matched by its path segments, never by a path anchored at the repository root: the
// violation fixtures mirror the real tree under `tests/violations/fixtures/` (note under T035).
const { defineRule } = require('../rule');
const { isUnder } = require('../files');
const { isRequireCall, onEverySpecifier } = require('../specifiers');

const TIME_PACKAGE = 'packages/time';

const DATETIME_LIBRARIES = [
  /^@js-temporal\/polyfill(\/|$)/,
  /^temporal-polyfill(\/|$)/,
  /^luxon(\/|$)/,
  /^dayjs(\/|$)/,
  /^moment(\/|$)/,
  /^moment-timezone(\/|$)/,
  /^date-fns(\/|$)/,
  /^date-fns-tz(\/|$)/,
  /^@date-fns\//,
  /^@internationalized\/date(\/|$)/,
  /^@js-joda\//,
  /^js-joda(\/|$)/,
  /^chrono-node(\/|$)/,
  /^spacetime(\/|$)/,
  /^timezone-support(\/|$)/,
  /^rrule(\/|$)/,
  /^date-holidays(\/|$)/,
];

const ARITHMETIC = new Set(['+', '-', '*', '/', '%', '+=', '-=', '*=', '/=', '%=']);
const INSTANT_METHODS = new Set(['getTime', 'valueOf']);
const SETTERS = new Set([
  'setDate',
  'setMonth',
  'setFullYear',
  'setHours',
  'setMinutes',
  'setSeconds',
  'setMilliseconds',
  'setTime',
  'setUTCDate',
  'setUTCMonth',
  'setUTCFullYear',
  'setUTCHours',
  'setUTCMinutes',
  'setUTCSeconds',
  'setUTCMilliseconds',
]);

function propertyName(node) {
  if (node.computed) {
    return node.property.type === 'Literal' && typeof node.property.value === 'string'
      ? node.property.value
      : null;
  }
  return node.property.type === 'Identifier' ? node.property.name : null;
}

function isDateStatic(node, method) {
  return (
    node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    node.callee.object.type === 'Identifier' &&
    node.callee.object.name === 'Date' &&
    propertyName(node.callee) === method
  );
}

function isNewDate(node) {
  return (
    node.type === 'NewExpression' &&
    node.callee.type === 'Identifier' &&
    node.callee.name === 'Date'
  );
}

/** An expression that is an instant in milliseconds: the raw material of Date arithmetic. */
function isInstantValue(node) {
  let value = node;
  while (
    value.type === 'TSAsExpression' ||
    value.type === 'TSNonNullExpression' ||
    value.type === 'UnaryExpression'
  ) {
    value = value.type === 'UnaryExpression' ? value.argument : value.expression;
  }
  if (isNewDate(value) || isDateStatic(value, 'now') || isDateStatic(value, 'parse')) return true;
  return (
    value.type === 'CallExpression' &&
    value.callee.type === 'MemberExpression' &&
    INSTANT_METHODS.has(propertyName(value.callee) ?? '')
  );
}

function isArithmetic(node) {
  return (
    (node.type === 'BinaryExpression' || node.type === 'AssignmentExpression') &&
    ARITHMETIC.has(node.operator)
  );
}

module.exports = defineRule({
  constitutionId: 'R-TIME-1',
  description:
    'Bans Date arithmetic and datetime library imports outside packages/time, where every domain datetime is constructed and resolved',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    library:
      '"{{specifier}}" is a datetime library imported outside packages/time — every domain datetime is constructed and resolved there, behind the project’s own types, so the library stays an internal choice of the package',
    arithmetic:
      'Date arithmetic outside packages/time — adding to an instant in a zone-less process is wrong by an hour across a DST transition; resolve each occurrence through packages/time (elapsed time is performance.now())',
    fromParts:
      'a Date built from parts outside packages/time — parts become an instant only through a zone, and the process zone is not one the domain chose; resolve it through packages/time',
    setter:
      '"{{name}}" mutates a Date outside packages/time — a setter is arithmetic spelled as a method, and it resolves through the process zone; resolve the occurrence through packages/time',
  },
  create(context) {
    if (isUnder(context.filename, TIME_PACKAGE)) return {};

    function checkSpecifier(sourceNode) {
      if (sourceNode === null || sourceNode === undefined) return;
      const specifier = sourceNode.value;
      if (typeof specifier !== 'string') return;
      if (!DATETIME_LIBRARIES.some((library) => library.test(specifier))) return;
      context.report({ node: sourceNode, messageId: 'library', data: { specifier } });
    }

    function checkArithmetic(node) {
      if (!isArithmetic(node)) return;
      const operands = node.type === 'BinaryExpression' ? [node.left, node.right] : [node.right];
      if (!operands.some(isInstantValue)) return;
      context.report({ node, messageId: 'arithmetic' });
    }

    return {
      ...onEverySpecifier(checkSpecifier),
      BinaryExpression: checkArithmetic,
      AssignmentExpression: checkArithmetic,
      NewExpression: (node) => {
        if (!isNewDate(node)) return;
        if (node.arguments.length >= 2) {
          context.report({ node, messageId: 'fromParts' });
          return;
        }
        // `new Date(a + b)` where the arithmetic itself carries no instant operand is still an
        // instant computed by hand; the arithmetic visitor covers the case where one does.
        const [argument] = node.arguments;
        if (
          argument !== undefined &&
          isArithmetic(argument) &&
          ![argument.left, argument.right].some(isInstantValue)
        ) {
          context.report({ node, messageId: 'arithmetic' });
        }
      },
      CallExpression: (node) => {
        // The spread above also reads `CallExpression` for `require('luxon')`; this handler
        // replaces it, so the require check is repeated here rather than lost.
        if (isRequireCall(node)) {
          checkSpecifier(node.arguments[0]);
          return;
        }
        if (isDateStatic(node, 'UTC')) {
          context.report({ node, messageId: 'fromParts' });
          return;
        }
        if (node.callee.type !== 'MemberExpression') return;
        const name = propertyName(node.callee);
        if (name === null || !SETTERS.has(name)) return;
        context.report({ node: node.callee.property, messageId: 'setter', data: { name } });
      },
    };
  },
});
