// mobile/no-manual-format  ->  R-MOBILE-9  (fast)
//
// R-MOBILE-9: never format a date, time or number for display by hand. Locale-aware formatters
// from `lib/` only. A date formatted at the call site picks its own locale, calendar and digits —
// and Arabic changes all three — so the same instant reads differently on two screens (FR-006,
// NFR-USE-3). Constructing or resolving a datetime is a different prohibition, R-TIME-1.
//
// DECISION (T038) — where it applies. The cell says "banned outside `lib/`": every file under
// `apps/mobile/src` is read except those under `lib/`, where the shared formatters live
// (`lib/formatters.ts`).
//
// WHAT IS REFUSED — a reference, called or not, to:
//
//   .toLocaleDateString  .toLocaleTimeString  .toLocaleString     the constitution's own example
//   .toDateString  .toTimeString  .toUTCString                    fixed English display forms
//   .toFixed  .toPrecision  .toExponential                        a number shaped for display
//   Intl                                                          the formatter family itself
//
// on any receiver, dotted or computed with a string (`d['toLocaleDateString']`), through optional
// chaining and the TypeScript wrappers. `globalThis.Intl`, `window.Intl`, `self.Intl` and
// `global.Intl` are `Intl`; a local binding or a parameter named `Intl` is not.
//
// WHAT IS NOT REFUSED. `.toISOString()` and `.toJSON()`: those serialise for a machine, they do
// not display. A formatting library (`date-fns`, `dayjs`): every datetime library is already
// refused outside `packages/time` by R-TIME-1. A date assembled from its parts with a template
// literal or `padStart` is not seen by this rule — arithmetic on the parts (`getMonth() + 1`) is
// refused by R-TIME-1, and the rest is review's. A method reached through a variable
// (`const f = n.toFixed; f.call(n, 2)`) is seen at the reference, never at the call.
//
// The file is matched by path segments, never by a root-anchored path (note under T035).
const { defineRule } = require('../rule');
const { heldGlobal, unboundReferences } = require('../globals');
const { mobileFile } = require('../mobile');
const { propertyName } = require('../syntax');

const FORMAT_METHODS = new Set([
  'toLocaleDateString',
  'toLocaleTimeString',
  'toLocaleString',
  'toDateString',
  'toTimeString',
  'toUTCString',
  'toFixed',
  'toPrecision',
  'toExponential',
]);

const FORMATTER_GLOBALS = new Set(['Intl']);

module.exports = defineRule({
  constitutionId: 'R-MOBILE-9',
  description: 'Bans hand-written date, time and number formatting in apps/mobile/src outside lib/',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    manualFormat:
      '"{{name}}" formats a date, time or number by hand — use the locale-aware formatters in lib/, because a format chosen at the call site picks its own locale, calendar and digits',
  },
  create(context) {
    const file = mobileFile(context.filename);
    if (file === null || file.area === 'lib') return {};

    const { sourceCode } = context;

    function report(node, name) {
      context.report({ node, messageId: 'manualFormat', data: { name } });
    }

    return {
      Program() {
        for (const identifier of unboundReferences(sourceCode, FORMATTER_GLOBALS)) {
          report(identifier, identifier.name);
        }
      },
      MemberExpression(node) {
        const held = heldGlobal(sourceCode, node, FORMATTER_GLOBALS);
        if (held !== null) {
          report(node, held);
          return;
        }
        const name = propertyName(node);
        if (name !== null && FORMAT_METHODS.has(name)) report(node.property, name);
      },
    };
  },
});
