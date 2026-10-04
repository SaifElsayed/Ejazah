// time/no-datetime-outside-package  ->  R-TIME-1  (fast)
//
// R-TIME-1: never construct or resolve a session datetime outside `packages/time`. Wall-clock
// time and instants are different things; adding a week of milliseconds to an instant moves the
// lesson by an hour across a DST transition, and the bug ships silently (R-TIME-2). The
// constitution's mechanism is "`Date` arithmetic and datetime libraries banned outside the
// package" (FR-017). Display formatting is the neighbouring rule, R-MOBILE-9.
//
// WHAT IS REFUSED, in every file outside `packages/time` (matched as that pair of path segments
// anywhere in the file's path, never anchored at the repository root, so the fixture tree's
// mirror of the package is exempt too; a folder of that name elsewhere would be exempt as well,
// none exists, and creating one is review's — review of PR #29, N8):
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
//                  `@js-joda/core`, `@js-joda/timezone`, `js-joda`, `spacetime`, `rrule`,
//                  `chrono-node`, and the calendar and formatting libraries `moment-hijri`,
//                  `date-fns-jalali`, `@internationalized/date` and `@formkit/tempo` (review of
//                  PR #29, N11), by name or subpath, in every import syntax, type-only included:
//                  a type from the library is the library's object crossing the boundary (FR-017).
//                  The native `Temporal` global is the same library without an import and is
//                  refused wherever no local binding of that name exists.
//
// WHAT STAYS LEGAL. Reading the clock (`new Date()`, `Date.now()`), parsing one string
// (`new Date(iso)`), copying, comparing (`a.getTime() <= Date.now()`, `a < b`), `toISOString()`.
// A method name alone is not a date: `items.length.valueOf() + 1` is arithmetic on a length, and
// a setter handed a plain value (`picker.setDate(3)`, `d.setTime(saved)`) computes nothing. A
// bare `setDate(day + 1)` is a function — a state setter — not a Date method. `performance.now()`
// is a monotonic counter, not a datetime, and is the right tool for measuring a duration.
//
// TWO SHAPES THAT ARE NOT DATE ARITHMETIC (review of PR #29, m10):
//
//   text       a `+` is concatenation when either operand is a string literal, a template
//              literal, or a `+` chain that holds one: `d.getHours() + ':' + d.getMinutes()`
//              builds a string and computes no instant. Formatting by hand is R-MOBILE-9's, not
//              this rule's. Arithmetic inside such a chain is still arithmetic:
//              `d.getTime() + 1000 + 'ms'` is refused at `d.getTime() + 1000`.
//   ordering   `a.getTime() - b.getTime()` (or `.valueOf()` on both sides) when it is what a
//              comparator written in place returns to `.sort(…)` or `.toSorted(…)`: the body of
//              an arrow, or a `return` of the function, directly or as an arm of a conditional
//              or of `||`, `&&`, `??` (a tie-breaker), each arm under the same test. The sign of
//              the difference orders two instants; nothing is added to either.
//
//              THE SUBTRACTION MUST ORDER THE COMPARATOR'S OWN TWO VALUES (second review of
//              PR #29, minor 1). The function has exactly two parameters, and one operand's
//              receiver starts at one of them and the other operand's at the other, in either
//              order, so a descending sort is an ordering too. A receiver is the parameter or
//              a member chain on it, through optional chaining and the TypeScript wrappers:
//              `b.slot.startsAt.getTime() - a?.slot.startsAt.getTime()`. A destructured
//              parameter counts by its bindings: `({ at: x }, { at: y }) => x.getTime() -
//              y.getTime()` takes one binding from each pattern and is an ordering. The name is
//              resolved through the scopes the parser built, so a parameter shadowed inside the
//              body is not the parameter.
//
//              A COMPARATOR OVER CONSTRUCTED DATES ORDERS TOO (owner decisions, 2026-10-04).
//              Rows that hold their instants as text or as numbers are ordered by reading
//              each one as a date first, and that computes nothing either. So an operand may
//              also be `new Date(x).getTime()` (or `.valueOf()`), or `Date.parse(x)`, where
//              `x` is the ONE argument and is itself the parameter or a member chain on it,
//              under the same test as above, one operand from each parameter:
//              `(a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()`, the descending
//              form, `({ at: x }, { at: y }) => Date.parse(x) - Date.parse(y)`, and the two
//              forms mixed with a plain receiver.
//
//              Anything else in the same position is still refused. A callback that orders
//              nothing it was handed: `timer.sort(() => end.getTime() - start.getTime())` is a
//              duration computed inside a sort call. Both operands from one parameter
//              (`a.getTime() - a.getTime()`, or two bindings of one pattern), an operand from
//              outside, a function of one or three parameters. A constructed date that is not
//              one parameter's value read as a date: the clock (`new Date().getTime() -
//              new Date(b.at).getTime()`), a value from outside (`new Date(outer)`), components
//              (`new Date(a.at, 1)`), a computed argument (`new Date(a.at + offset)`,
//              `Date.parse(a.day + 'T00:00')`), and both dates constructed from one parameter.
//              Any other reading of a constructed date (`+new Date(a.at)`,
//              `Number(new Date(a.at))`, a part getter). The clock (`a.getTime() - Date.now()`),
//              a scaled or offset difference (`(a.getTime() - b.getTime()) / 1000`, `… + ttl`),
//              the same subtraction handed to `.map(…)` or written outside a comparator, and a
//              comparator defined apart and passed by name, which this rule cannot tell from a
//              duration.
//
// `Date.now() - startedAt` and `Math.floor(Date.now() / 1000)` stay refused: a duration and a
// timestamp in seconds are arithmetic on the clock, and both belong to `packages/time`.
//
// THE SYNTAX LIMIT, stated plainly. This rule runs without types (research R-10), so a Date that
// is not written as one is not seen: `a - b` on two Date variables, `+d + 1000`, and a number
// that came from a date under another name (`const ms = d.getTime(); … ms + WEEK`, unless it is
// handed straight to `new Date(…)`). NOR IS ZONE CONVERSION WITHOUT A LIBRARY (m10): formatting an
// instant in a zone and parsing the text back, `new Date(d.toLocaleString('en-US', { timeZone:
// tz }))`, and reading a zone's wall-clock parts from `Intl.DateTimeFormat(locale, { timeZone
// }).formatToParts(d)`, resolve a datetime outside `packages/time` with no arithmetic and no
// import for this rule to see. In the mobile application R-MOBILE-9 refuses both spellings
// outside `lib/` (`toLocaleString`, `Intl`); in the API nothing does, and they are review's.
// The arithmetic shapes need the operand's resolved type; a type-aware companion that asks the
// program whether an arithmetic operand is a `Date` would close them, and is not written here.
// A setter or getter name on an object that is not a Date is a false
// positive this rule accepts. Until then those shapes are review's.
//
// THE DESIGN CONSEQUENCE. `Date.now() + ttl` is refused like any other date arithmetic, so an
// expiry instant — the slot hold's TTL, `idempotency_keys.expires_at`, an order's deadline — is
// computed by a function of `packages/time`, added there with its own test by the first task
// that needs one, or by the database (`now() + interval`), never inline in a service.
const { defineRule } = require('../rule');
const { globalNamed, heldGlobal, unboundReferences } = require('../globals');
const { after, onEverySpecifier, segmentsOf } = require('../specifiers');
const {
  alternatives,
  isFunction,
  mergeVisitors,
  propertyName,
  unwrap,
  wrapped,
} = require('../syntax');

const TIME_PACKAGE = ['packages', 'time'];

const DATE = new Set(['Date']);
const NUMBER = new Set(['Number']);
const TEMPORAL = new Set(['Temporal']);

const ARITHMETIC = new Set(['+', '-', '*', '/', '%', '**']);
const COMPOUND = new Set(['+=', '-=', '*=', '/=', '%=', '**=']);

const DATE_STATICS = new Set(['now', 'parse', 'UTC']);

// What a comparator reads off each of the two values it orders, and the methods it is handed to.
const ORDERED_BY = new Set(['getTime', 'valueOf']);
const PARSE = 'parse';
const SORTERS = new Set(['sort', 'toSorted']);

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
  'moment-hijri',
  'date-fns-jalali',
  '@internationalized/date',
  '@formkit/tempo',
];

function isLibrary(specifier) {
  return LIBRARIES.some((name) => specifier === name || specifier.startsWith(`${name}/`));
}

/** Text: a string or template literal, or a `+` chain that holds one, which is concatenation. */
function isText(node) {
  const inner = unwrap(node);
  if (inner.type === 'TemplateLiteral') return true;
  if (inner.type === 'Literal') return typeof inner.value === 'string';
  if (inner.type !== 'BinaryExpression' || inner.operator !== '+') return false;
  if (inner.left.type === 'PrivateIdentifier') return false;
  return isText(inner.left) || isText(inner.right);
}

/** The identifier a member chain starts at: `a` in `a.slot.startsAt`. Null for anything else. */
function chainRoot(node) {
  let current = unwrap(node);
  while (current.type === 'MemberExpression') current = unwrap(current.object);
  return current.type === 'Identifier' ? current : null;
}

/** Where the one argument of `new Date(x)` or `Date.parse(x)` starts; null unless exactly one. */
function soleArgumentRoot(node) {
  if (node.arguments.length !== 1 || node.arguments[0].type === 'SpreadElement') return null;
  return chainRoot(node.arguments[0]);
}

/**
 * The identifier one operand of a comparator's subtraction reads its instant from: `a` in
 * `a.slot.startsAt.getTime()`, in `new Date(a.at).getTime()` and in `Date.parse(a.at)`
 * (`.valueOf()` reads the same as `.getTime()`). Null for every other expression: another call,
 * a receiver that is not a member chain, a Date constructed from no argument, from several, or
 * from one that is not itself a member chain.
 */
function orderingRoot(node, isGlobalDate) {
  const call = unwrap(node);
  if (call.type !== 'CallExpression') return null;
  const callee = unwrap(call.callee);
  if (callee.type !== 'MemberExpression') return null;
  const name = propertyName(callee);
  if (name === null) return null;

  if (name === PARSE && isGlobalDate(callee.object)) return soleArgumentRoot(call);
  if (!ORDERED_BY.has(name) || call.arguments.length !== 0) return null;

  const receiver = unwrap(callee.object);
  if (receiver.type !== 'NewExpression') return chainRoot(receiver);
  return isGlobalDate(receiver.callee) ? soleArgumentRoot(receiver) : null;
}

/** Which parameter of the function binds the identifier, by position, or -1 when none does. */
function parameterIndex(sourceCode, fn, identifier) {
  let scope = sourceCode.getScope(identifier);
  while (scope !== null && scope !== undefined) {
    const variable = scope.set.get(identifier.name);
    if (variable !== undefined && variable.defs.length > 0) {
      const binding = variable.defs.find((def) => def.type === 'Parameter' && def.node === fn);
      if (binding === undefined) return -1;
      const [start, end] = binding.name.range;
      return fn.params.findIndex((param) => param.range[0] <= start && end <= param.range[1]);
    }
    scope = scope.upper;
  }
  return -1;
}

/**
 * `a.getTime() - b.getTime()` as what a comparator written in place returns to `.sort(…)` or
 * `.toSorted(…)`, where `a` and `b` are that comparator's two parameters, each read as it is or
 * through `new Date(…)` or `Date.parse(…)`: an ordering of two instants, not a datetime (header,
 * "ordering").
 */
function isSortComparison(sourceCode, binary, isGlobalDate) {
  if (binary.operator !== '-') return false;
  const left = orderingRoot(binary.left, isGlobalDate);
  const right = orderingRoot(binary.right, isGlobalDate);
  if (left === null || right === null) return false;

  // Up through the choices the returned expression can be an arm of.
  let value = wrapped(binary);
  for (;;) {
    const { parent } = value;
    if (parent.type === 'ConditionalExpression' && parent.test !== value) value = wrapped(parent);
    else if (parent.type === 'LogicalExpression') value = wrapped(parent);
    else break;
  }

  let fn = value.parent;
  if (fn.type === 'ReturnStatement') {
    while (fn !== null && fn !== undefined && !isFunction(fn)) fn = fn.parent;
  } else if (fn.type !== 'ArrowFunctionExpression' || fn.body !== value) {
    return false;
  }
  if (!isFunction(fn)) return false;

  const comparator = wrapped(fn);
  const call = comparator.parent;
  if (call.type !== 'CallExpression' || call.arguments[0] !== comparator) return false;
  const callee = unwrap(call.callee);
  if (callee.type !== 'MemberExpression') return false;
  const method = propertyName(callee);
  if (method === null || !SORTERS.has(method)) return false;

  // The two operands are the comparator's own two values, one each.
  if (fn.params.length !== 2) return false;
  const first = parameterIndex(sourceCode, fn, left);
  const second = parameterIndex(sourceCode, fn, right);
  return first !== -1 && second !== -1 && first !== second;
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
      if (isSortComparison(sourceCode, binary, isGlobalDate)) return false;
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
