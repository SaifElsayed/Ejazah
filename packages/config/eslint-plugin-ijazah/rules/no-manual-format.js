// mobile/no-manual-format  ->  R-MOBILE-9  (fast)
//
// R-MOBILE-9: never format a date, time or number for display by hand. Locale-aware formatters from
// `lib/` only. A `toLocaleDateString('ar-EG')` in a screen picks a locale, a calendar and a digit
// system on that one line, and the next screen picks differently; `lib/formatters.ts` is where
// the choice is made once (FR-006). Domain resolution of a datetime is R-TIME-1 and is refused by
// `time/no-datetime-outside-package`; this rule is about display.
//
// WHERE (T038): every file under `apps/mobile/src` that is not under `apps/mobile/src/lib`, the
// constitution's own scope ("banned outside `lib/`"). The formatters live in `lib/formatters.ts`
// and may call anything below; everything else calls them.
//
// WHAT IS MANUAL FORMATTING (T038):
//
//   - the locale methods: `toLocaleDateString`, `toLocaleTimeString`, `toLocaleString`, and the
//     un-localised `toDateString` and `toTimeString`, which render in English whatever the user
//     chose;
//   - `toFixed` and `toPrecision`, which render a number with a Latin decimal point and no
//     grouping — the Arabic-Indic digits and the grouping separator are the formatter's job;
//   - the `Intl` constructors — `Intl.DateTimeFormat`, `Intl.NumberFormat`,
//     `Intl.RelativeTimeFormat`, `Intl.ListFormat`, `Intl.PluralRules` — which are the right tool
//     in the wrong place: they belong inside `lib/`, behind one locale decision;
//   - the `Date` part getters — `getHours`, `getMinutes`, `getSeconds`, `getDate`, `getDay`,
//     `getMonth`, `getFullYear` and their `getUTC*` twins — because reading the parts is how a
//     hand-built `${h}:${m}` starts, and there is no display reason to read them outside `lib/`.
//
// Methods are matched by name on any receiver, since the fast set has no types (research R-10):
// a `toFixed` on something that is not a number is still a hand-written format. `toISOString`
// and `toJSON` are machine formats for the wire and are legal.
//
// The file is matched by its path segments, never by a path anchored at the repository root: the
// violation fixtures mirror the real tree under `tests/violations/fixtures/` (note under T035).
const { defineRule } = require('../rule');
const { isUnder } = require('../files');

const MOBILE_TREE = 'apps/mobile/src';
const LIB_TREE = 'apps/mobile/src/lib';

const FORMAT_METHODS = new Map([
  ['toLocaleDateString', 'a date'],
  ['toLocaleTimeString', 'a time'],
  ['toLocaleString', 'a date or number'],
  ['toDateString', 'a date'],
  ['toTimeString', 'a time'],
  ['toFixed', 'a number'],
  ['toPrecision', 'a number'],
  ['getHours', 'a time'],
  ['getMinutes', 'a time'],
  ['getSeconds', 'a time'],
  ['getDate', 'a date'],
  ['getDay', 'a date'],
  ['getMonth', 'a date'],
  ['getFullYear', 'a date'],
  ['getUTCHours', 'a time'],
  ['getUTCMinutes', 'a time'],
  ['getUTCSeconds', 'a time'],
  ['getUTCDate', 'a date'],
  ['getUTCDay', 'a date'],
  ['getUTCMonth', 'a date'],
  ['getUTCFullYear', 'a date'],
]);

const INTL_FORMATTERS = new Set([
  'DateTimeFormat',
  'NumberFormat',
  'RelativeTimeFormat',
  'ListFormat',
  'PluralRules',
]);

function memberName(node) {
  if (node.type !== 'MemberExpression') return null;
  if (node.computed) {
    return node.property.type === 'Literal' && typeof node.property.value === 'string'
      ? node.property.value
      : null;
  }
  return node.property.type === 'Identifier' ? node.property.name : null;
}

module.exports = defineRule({
  constitutionId: 'R-MOBILE-9',
  description:
    'Bans hand-written date, time and number formatting in apps/mobile outside lib/, where the locale-aware formatters live',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    method:
      '"{{name}}" formats {{kind}} by hand — the locale, calendar and digits are decided once in lib/formatters.ts, so call the formatter from lib/ instead',
    intl: '"Intl.{{name}}" is constructed outside lib/ — the locale, calendar and digits are decided once in lib/formatters.ts, so call the formatter from lib/ instead',
  },
  create(context) {
    if (!isUnder(context.filename, MOBILE_TREE)) return {};
    if (isUnder(context.filename, LIB_TREE)) return {};

    return {
      CallExpression: (node) => {
        const name = memberName(node.callee);
        if (name === null || !FORMAT_METHODS.has(name)) return;
        context.report({
          node: node.callee.property,
          messageId: 'method',
          data: { name, kind: FORMAT_METHODS.get(name) },
        });
      },
      MemberExpression: (node) => {
        if (node.object.type !== 'Identifier' || node.object.name !== 'Intl') return;
        const name = memberName(node);
        if (name === null || !INTL_FORMATTERS.has(name)) return;
        context.report({ node, messageId: 'intl', data: { name } });
      },
    };
  },
});
