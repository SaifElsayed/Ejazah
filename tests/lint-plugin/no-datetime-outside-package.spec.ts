// time/no-datetime-outside-package (R-TIME-1, both halves) against a table of code (T132).
//
// The two fixtures prove one polyfill import and one `getTime() + a week`. This table proves the
// rest of each half. A library is refused in every spelling `specifiers.js` knows and by every
// name on the rule's list, and is legal inside `packages/time`, the one place the computation is
// allowed to happen. Arithmetic is refused whenever an operand is an instant, whether the instant
// comes from `Date.now()`, `getTime()`, `valueOf()` or `Date.parse()`, and so are the other ways
// of resolving a datetime by hand: a `Date` built from parts or from an arithmetic expression, and
// a mutating setter. The valid table holds the honest uses: constructing now, parsing one stored
// instant, ordering two instants, reading `Date.now()` on its own, and timing a request with
// `performance.now()`, which carries no calendar.
//
// The refused arithmetic below appears inside JavaScript strings only, so this file passes the
// rule it tests when the fast set lints it.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const sessions = 'apps/api/src/modules/sessions/next-occurrence.ts';
const library = 'apps/api/src/modules/sessions/uses-datetime-library.ts';
const timePackage = 'packages/time/src/index.ts';
const screen = 'apps/mobile/src/features/student/screens/schedule.tsx';

typescriptRuleTester().run(
  'time/no-datetime-outside-package',
  loadRule('no-datetime-outside-package.js'),
  {
    valid: [
      {
        name: 'the polyfill inside the time package',
        code: "import { Temporal } from '@js-temporal/polyfill';\nexport const now = () => Temporal.Now.instant();",
        filename: timePackage,
      },
      {
        name: 'Date arithmetic inside the time package',
        code: 'export const weekLater = (d: Date) => new Date(d.getTime() + 7 * 24 * 60 * 60 * 1000);',
        filename: timePackage,
      },
      {
        name: 'now, an instant',
        code: 'export const now = () => new Date();',
        filename: sessions,
      },
      {
        name: 'one stored instant parsed from a string',
        code: 'export const parse = (iso: string) => new Date(iso);',
        filename: sessions,
      },
      {
        name: 'one stored instant parsed from milliseconds',
        code: 'export const parse = (ms: number) => new Date(ms);',
        filename: sessions,
      },
      {
        name: 'two instants ordered, which is a comparison and not a construction',
        code: 'export const before = (a: Date, b: Date) => a.getTime() < b.getTime();',
        filename: sessions,
      },
      {
        name: 'reading now on its own',
        code: 'export const stamp = () => Date.now();',
        filename: sessions,
      },
      {
        name: 'elapsed time measured with performance.now()',
        code: 'export const elapsed = (started: number) => performance.now() - started;',
        filename: sessions,
      },
      {
        name: 'arithmetic with no instant operand',
        code: 'export const next = (page: number) => page + 1;',
        filename: sessions,
      },
      {
        name: 'a package whose name merely starts alike',
        code: "import { x } from 'momentum';\nexport const y = x;",
        filename: library,
      },
    ],
    invalid: [
      {
        name: 'a datetime library reached through require',
        code: "const { DateTime } = require('luxon');\nexport default DateTime;",
        filename: library,
        errors: [{ messageId: 'library', data: { specifier: 'luxon' } }],
      },
      {
        name: 'the canonical polyfill import',
        code: "import { Temporal } from '@js-temporal/polyfill';\nexport const from = (iso: string) => Temporal.Instant.from(iso).toString();",
        filename: library,
        errors: [{ messageId: 'library', data: { specifier: '@js-temporal/polyfill' } }],
      },
      {
        name: 'luxon',
        code: "import { DateTime } from 'luxon';\nexport const d = DateTime;",
        filename: library,
        errors: [{ messageId: 'library', data: { specifier: 'luxon' } }],
      },
      {
        name: 'dayjs from a screen',
        code: "import dayjs from 'dayjs';\nexport const d = dayjs;",
        filename: screen,
        errors: [{ messageId: 'library', data: { specifier: 'dayjs' } }],
      },
      {
        name: 'a date-fns subpath',
        code: "import { format } from 'date-fns/format';\nexport const f = format;",
        filename: library,
        errors: [{ messageId: 'library', data: { specifier: 'date-fns/format' } }],
      },
      {
        name: 'moment through import = require',
        code: "import moment = require('moment');\nexport default moment;",
        filename: library,
        errors: [{ messageId: 'library', data: { specifier: 'moment' } }],
      },
      {
        name: 'a type-only import of a library',
        code: "import type { DateTime } from 'luxon';\nexport type D = DateTime;",
        filename: library,
        errors: 1,
      },
      {
        name: 'a dynamic import of a library',
        code: "export const load = () => import('dayjs');",
        filename: library,
        errors: 1,
      },
      {
        name: 'export from a library',
        code: "export { format } from 'date-fns';",
        filename: library,
        errors: 1,
      },
      {
        name: 'the canonical arithmetic on an instant',
        code: 'export function nextOccurrence(previousStartAt: Date): Date {\n  return new Date(previousStartAt.getTime() + 7 * 24 * 60 * 60 * 1000);\n}',
        filename: sessions,
        errors: [{ messageId: 'arithmetic' }],
      },
      {
        name: 'a request timed with Date.now()',
        code: 'export const elapsed = (started: number) => Date.now() - started;',
        filename: sessions,
        errors: [{ messageId: 'arithmetic' }],
      },
      {
        name: 'a Date built from an arithmetic expression with no instant operand',
        code: 'export const at = (a: number, b: number) => new Date(a + b);',
        filename: sessions,
        errors: [{ messageId: 'arithmetic' }],
      },
      {
        name: 'a Date built from parts',
        code: 'export const start = new Date(2025, 3, 18);',
        filename: sessions,
        errors: [{ messageId: 'fromParts' }],
      },
      {
        name: 'Date.UTC',
        code: 'export const start = Date.UTC(2025, 3, 18);',
        filename: sessions,
        errors: [{ messageId: 'fromParts' }],
      },
      {
        name: 'a mutating setter',
        code: 'export const weekLater = (d: Date) => d.setDate(d.getDate() + 7);',
        filename: sessions,
        errors: [{ messageId: 'setter', data: { name: 'setDate' } }],
      },
      {
        name: 'a UTC setter',
        code: 'export const midnight = (d: Date) => d.setUTCHours(0, 0, 0, 0);',
        filename: sessions,
        errors: [{ messageId: 'setter', data: { name: 'setUTCHours' } }],
      },
      {
        name: 'a compound assignment with an instant operand',
        code: 'export function total(ms: number): number {\n  ms += Date.now();\n  return ms;\n}',
        filename: sessions,
        errors: [{ messageId: 'arithmetic' }],
      },
      {
        name: 'arithmetic on a parsed instant',
        code: 'export const later = (iso: string) => Date.parse(iso) + 1000;',
        filename: sessions,
        errors: [{ messageId: 'arithmetic' }],
      },
      {
        name: 'arithmetic on valueOf',
        code: 'export const doubled = (d: Date) => d.valueOf() * 2;',
        filename: sessions,
        errors: [{ messageId: 'arithmetic' }],
      },
    ],
  },
);
