// time/no-datetime-outside-package  ->  R-TIME-1  (fast)
//
// R-TIME-1: never construct or resolve a session datetime outside `packages/time`. Wall-clock
// time and instants are different things; adding a week of milliseconds to an instant moves the
// lesson by an hour across a DST transition, and the bug ships silently (R-TIME-2). The
// constitution's mechanism is "`Date` arithmetic and datetime libraries banned outside the
// package" (FR-017). Display formatting is the neighbouring rule, R-MOBILE-9.
//
// WHAT IS REFUSED, in every file outside `packages/time`:
//
//   arithmetic     `+ - * / % **` and their compound assignments, where an operand is a date read
//                  as a number:
//                    the clock and the parsers   `Date.now()`, `Date.parse(…)`, `Date.UTC(…)`
//                    a Date written in place     `new Date(…)`, `+new Date()`, `Number(new Date())`,
//                                                `new Date(…).valueOf()`
//                    a Date's getters            `.getTime()`, `.getDate()`, `.getDay()`,
//                                                `.getHours()`, `.getMinutes()`, `.getSeconds()`,
//                                                `.getMilliseconds()`, `.getMonth()`,
//                                                `.getFullYear()`, their `getUTC…` forms and
//                                                `.getTimezoneOffset()`, on any receiver
//                  through optional chaining, the TypeScript wrappers, a computed string name, a
//                  conditional, `||`, `&&`, `??` and `globalThis.Date`. A chain (`a.getTime() + x
//                  + y`) is reported once, at the outermost operator.
//   a setter       `.setDate(…)`, `.setHours(…)`, `.setMinutes(…)`, `.setSeconds(…)`,
//                  `.setMilliseconds(…)`, `.setMonth(…)`, `.setFullYear(…)`, `.setTime(…)` and the
//                  `setUTC…` forms, handed arithmetic or `++`/`--`: `d.setHours(hour + 1)`.
//   construction   `new Date(…)` or `Date.parse(…)` handed arithmetic or a template with values in
//                  it (`new Date(ms + WEEK)`, new Date(`${date}T${time}`)), and a datetime built
//                  from components: `new Date(y, m, d, …)`, which reads them in the server's
//                  zone, and `Date.UTC(…)`.
//   a library      `@js-temporal/polyfill`, `temporal-polyfill`, `moment`, `moment-timezone`,
//                  `dayjs`, `date-fns`, `date-fns-tz`, `@date-fns/tz`, `@date-fns/utc`, `luxon`,
//                  `@js-joda/core`, `@js-joda/timezone`, `js-joda`, `spacetime`, `rrule` and
//                  `chrono-node`, by name or subpath, in every import syntax, type-only included:
//                  a type from the library is the library's object crossing the boundary (FR-017).
//                  The native `Temporal` global is the same library without an import and is
//                  refused wherever no local binding of that name exists.
//
// WHAT STAYS LEGAL. Reading the clock (`new Date()`, `Date.now()`), parsing one string
// (`new Date(iso)`), copying, comparing (`a.getTime() <= Date.now()`, `a < b`), `toISOString()`.
// A method name alone is not a date: `items.length.valueOf() + 1` is arithmetic on a length, and
// a setter handed a plain value (`picker.setDate(3)`, `d.setTime(saved)`) computes nothing. A
// bare `setDate(day + 1)` is a function — a state setter — not a Date method. `performance.now()`
// is a monotonic counter, not a datetime, and is the right tool for measuring a duration. A `+`
// with a string literal on the other side is text, which R-MOBILE-9 owns.
//
// THE SYNTAX LIMIT, stated plainly. This rule runs without types (research R-10), so a Date that
// is not written as one is not seen: `a - b` on two Date variables, `+d + 1000`, and a number
// that came from a date under another name (`const ms = d.getTime(); … ms + WEEK`, unless it is
// handed straight to `new Date(…)`). Each needs the operand's resolved type; a type-aware
// companion that asks the program whether an arithmetic operand is a `Date` would close it, and
// is not written here. A setter or getter name on an object that is not a Date is a false
// positive this rule accepts. Until then those shapes are review's.
//
// THE DESIGN CONSEQUENCE. `Date.now() + ttl` is refused like any other date arithmetic, so an
// expiry instant — the slot hold's TTL, `idempotency_keys.expires_at`, an order's deadline — is
// computed by a function of `packages/time`, added there with its own test by the first task
// that needs one, or by the database (`now() + interval`), never inline in a service.
const { defineRule } = require('../rule');
const { globalNamed, heldGlobal, unboundReferences } = require('../globals');
const { after, onEverySpecifier, segmentsOf } = require('../specifiers');
const { alternatives, mergeVisitors, propertyName, unwrap, wrapped } = require('../syntax');

const TIME_PACKAGE = ['packages', 'time'];

const DATE = new Set(['Date']);
const NUMBER = new Set(['Number']);
const TEMPORAL = new Set(['Temporal']);

const ARITHMETIC = new Set(['+', '-', '*', '/', '%', '**']);
const COMPOUND = new Set(['+=', '-=', '*=', '/=', '%=', '**=']);

const DATE_STATICS = new Set(['now', 'parse', 'UTC']);

const PARTS = ['Date', 'Day', 'FullYear', 'Hours', 'Milliseconds', 'Minutes', 'Month', 'Seconds'];
const GETTERS = new Set([
  'getTime',
  'getTimezoneOffset',
  ...PARTS.flatMap((part) => [`get${part}`, `getUTC${part}`]),
]);
const SETTERS = new Set([
  'setTime',
  ...PARTS.filter((part) => part !== 'Day').flatMap((part) => [`set${part}`, `setUTC${part}`]),
]);

const LIBRARIES = [
  '@js-temporal/polyfill',
  'temporal-polyfill',
  'moment',
  'moment-timezone',
  'dayjs',
  'date-fns',
  'date-fns-tz',
  '@date-fns/tz',
  '@date-fns/utc',
  'luxon',
  '@js-joda/core',
  '@js-joda/timezone',
  'js-joda',
  'spacetime',
  'rrule',
  'chrono-node',
];

function isLibrary(specifier) {
  return LIBRARIES.some((name) => specifier === name || specifier.startsWith(`${name}/`));
}

function isText(node) {
  const inner = unwrap(node);
  if (inner.type === 'TemplateLiteral') return true;
  return inner.type === 'Literal' && typeof inner.value === 'string';
}

module.exports = defineRule({
  constitutionId: 'R-TIME-1',
  description: 'Bans Date arithmetic and datetime libraries outside packages/time',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    arithmetic:
      'This is arithmetic on a date — resolve the datetime in packages/time, because elapsed time added to an instant moves the wall-clock hour across a DST transition',
    setter:
      '"{{method}}" is handed a computed value — resolve the datetime in packages/time, because stepping a Date by its components is date arithmetic in the server’s zone',
    constructed:
      'This datetime is constructed from computed parts — resolve it in packages/time, which takes the local date, the local time and the zone and answers with the instant',
    components:
      'This datetime is constructed from components — resolve it in packages/time, because components are read in a zone the call does not name',
    library:
      '"{{specifier}}" is a datetime library — it is confined to packages/time, whose own types are what the rest of the code holds',
    temporalGlobal:
      'The Temporal global is a datetime library without an import — it is confined to packages/time, whose own types are what the rest of the code holds',
  },
  create(context) {
    if (after(segmentsOf(context.filename), TIME_PACKAGE) !== -1) return {};

    const { sourceCode } = context;

    const isGlobalDate = (node) => globalNamed(sourceCode, node, DATE) !== null;

    function isNewDate(node) {
      const inner = unwrap(node);
      return inner.type === 'NewExpression' && isGlobalDate(inner.callee);
    }

    /** `Date.now`, `Date.parse`, `Date.UTC`, by any spelling of the member: the name, or null. */
    function dateStatic(callee) {
      const member = unwrap(callee);
      if (member.type !== 'MemberExpression') return null;
      const name = propertyName(member);
      if (name === null || !DATE_STATICS.has(name)) return null;
      return isGlobalDate(member.object) ? name : null;
    }

    function isDateCall(call) {
      if (dateStatic(call.callee) !== null) return true;
      const callee = unwrap(call.callee);
      if (callee.type === 'MemberExpression') {
        const name = propertyName(callee);
        if (name !== null && GETTERS.has(name)) return true;
        return name === 'valueOf' && isNewDate(callee.object);
      }
      // `Number(new Date())`
      return (
        globalNamed(sourceCode, callee, NUMBER) !== null &&
        call.arguments.length > 0 &&
        call.arguments[0].type !== 'SpreadElement' &&
        isDateNumber(call.arguments[0])
      );
    }

    /** True when the expression can turn out to be a date read as a number. */
    function isDateNumber(node) {
      return alternatives(node).some((leaf) => {
        if (leaf.type === 'UnaryExpression') {
          return (leaf.operator === '+' || leaf.operator === '-') && isDateNumber(leaf.argument);
        }
        if (leaf.type === 'NewExpression') return isGlobalDate(leaf.callee);
        if (leaf.type === 'CallExpression') return isDateCall(leaf);
        if (leaf.type === 'BinaryExpression') return isDateArithmetic(leaf);
        return false;
      });
    }

    function isDateArithmetic(binary) {
      if (!ARITHMETIC.has(binary.operator)) return false;
      if (binary.left.type === 'PrivateIdentifier') return false;
      if (binary.operator === '+' && (isText(binary.left) || isText(binary.right))) return false;
      return isDateNumber(binary.left) || isDateNumber(binary.right);
    }

    /** True when an enclosing operator already reports this expression as its operand. */
    function isReportedAbove(node) {
      let current = wrapped(node);
      for (;;) {
        const { parent } = current;
        if (parent.type === 'ConditionalExpression' && parent.test !== current) {
          current = wrapped(parent);
        } else if (parent.type === 'LogicalExpression') {
          current = wrapped(parent);
        } else if (parent.type === 'UnaryExpression' && ['+', '-'].includes(parent.operator)) {
          current = wrapped(parent);
        } else if (parent.type === 'BinaryExpression') {
          return isDateArithmetic(parent);
        } else if (parent.type === 'AssignmentExpression') {
          return COMPOUND.has(parent.operator) && parent.right === current;
        } else {
          return false;
        }
      }
    }

    /** Arithmetic, `++`/`--` or a template with values in it, that no date-arithmetic report covers. */
    function isComputed(argument) {
      if (argument.type === 'SpreadElement') return false;
      const inner = unwrap(argument);
      if (inner.type === 'UpdateExpression') return true;
      if (inner.type === 'TemplateLiteral') return inner.expressions.length > 0;
      if (inner.type !== 'BinaryExpression' || !ARITHMETIC.has(inner.operator)) return false;
      return !isDateArithmetic(inner);
    }

    const own = {
      BinaryExpression(node) {
        if (isDateArithmetic(node) && !isReportedAbove(node)) {
          context.report({ node, messageId: 'arithmetic' });
        }
      },
      AssignmentExpression(node) {
        if (COMPOUND.has(node.operator) && isDateNumber(node.right)) {
          context.report({ node, messageId: 'arithmetic' });
        }
      },
      NewExpression(node) {
        if (!isGlobalDate(node.callee)) return;
        if (node.arguments.length > 1) {
          context.report({ node, messageId: 'components' });
        } else if (node.arguments.length === 1 && isComputed(node.arguments[0])) {
          context.report({ node, messageId: 'constructed' });
        }
      },
      CallExpression(node) {
        const statik = dateStatic(node.callee);
        if (statik === 'UTC') {
          context.report({ node, messageId: 'components' });
          return;
        }
        if (statik === 'parse') {
          if (node.arguments.length > 0 && isComputed(node.arguments[0])) {
            context.report({ node, messageId: 'constructed' });
          }
          return;
        }

        const callee = unwrap(node.callee);
        if (callee.type !== 'MemberExpression') return;
        const method = propertyName(callee);
        if (method === null || !SETTERS.has(method)) return;
        if (node.arguments.some(isComputed)) {
          context.report({ node, messageId: 'setter', data: { method } });
        }
      },
      MemberExpression(node) {
        if (heldGlobal(sourceCode, node, TEMPORAL) !== null) {
          context.report({ node, messageId: 'temporalGlobal' });
        }
      },
      'Program:exit'() {
        for (const identifier of unboundReferences(sourceCode, TEMPORAL)) {
          context.report({ node: identifier, messageId: 'temporalGlobal' });
        }
      },
    };

    const imports = onEverySpecifier((sourceNode) => {
      if (sourceNode === null || sourceNode === undefined) return;
      const specifier = sourceNode.value;
      if (typeof specifier === 'string' && isLibrary(specifier)) {
        context.report({ node: sourceNode, messageId: 'library', data: { specifier } });
      }
    });

    return mergeVisitors(imports, own);
  },
});
