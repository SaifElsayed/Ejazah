// time/no-datetime-outside-package (R-TIME-1) against a table of code (T132).
//
// The two fixtures prove one `getTime() + …` and one named import. The cases that carry the rule
// are the other shapes the same arithmetic takes (the clock, a setter, a component constructor),
// the other spellings of an import, and the valid rows: a method name alone is not a date, a
// comparison is not arithmetic, and `packages/time` is where all of it is allowed.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const file = 'apps/api/src/modules/sessions/next-occurrence.ts';
const timePackage = 'packages/time/src/resolve.ts';

typescriptRuleTester().run(
  'time/no-datetime-outside-package',
  loadRule('no-datetime-outside-package.js'),
  {
    valid: [
      {
        name: 'the time package, arithmetic and library alike',
        code: "import { Temporal } from '@js-temporal/polyfill';\nexport const f = (d: Date) => new Date(d.getTime() + 1000 * Temporal.Now.instant().epochMilliseconds);",
        filename: timePackage,
      },
      {
        name: 'the time package, as the fixture tree mirrors it',
        code: 'export const later = Date.now() + 1000;',
        filename: 'tests/violations/fixtures/packages/time/src/index.ts',
      },
      {
        name: 'reading the clock, parsing an instant and writing one',
        code: "export const now = new Date();\nexport const at = new Date('2025-04-25T07:00:00Z');\nexport const ms = Date.now();\nexport const iso = now.toISOString();\nexport const copy = new Date(at);",
        filename: file,
      },
      {
        name: 'a comparison is not arithmetic',
        code: 'export const expired = (expiresAt: Date) => expiresAt.getTime() <= Date.now() || expiresAt < new Date();',
        filename: file,
      },
      {
        name: 'arithmetic on plain numbers',
        code: 'export const week = 7 * 24 * 60 * 60 * 1000;\nexport const next = (count: number) => count + 1;',
        filename: file,
      },
      {
        name: 'a method name alone is not a date',
        code: 'export const n = items.length.valueOf() + 1;\nexport const m = box.valueOf() * 2;',
        filename: file,
      },
      {
        name: 'a setter handed a plain value',
        code: 'picker.setDate(3);\npicker.setHours(hour, minute);\nd.setTime(saved);',
        filename: file,
      },
      {
        name: 'a state setter is a function, not a Date method',
        code: 'setDate(day + 1);\nsetTime(elapsed + 1);',
        filename: 'apps/mobile/src/features/shared/calendar/hooks.ts',
      },
      {
        name: 'a local binding named Date',
        code: 'export function f(Date: { now(): number }) { return Date.now() + 1; }',
        filename: file,
      },
      {
        name: 'a monotonic duration',
        code: 'const started = performance.now();\nexport const elapsed = () => performance.now() - started;',
        filename: file,
      },
      {
        name: 'a date beside text is text, not arithmetic',
        code: "export const line = 'started at ' + new Date() + `, ${Date.now()}`;",
        filename: file,
      },
      {
        name: 'parts joined into text: a chain with a string in it is concatenation',
        code: "export const clock = (d: Date) => d.getHours() + ':' + d.getMinutes();\nexport const stamp = (d: Date) => `${d.getFullYear()}` + d.getMonth() + d.getDate();",
        filename: file,
      },
      {
        name: 'a comparator handed to sort orders two instants',
        code: 'export const byTime = (rows: Row[]) => rows.sort((a, b) => a.created_at.getTime() - b.created_at.getTime());',
        filename: file,
      },
      {
        name: 'a comparator handed to toSorted, with a block body, valueOf and a cast',
        code: 'export const newest = (rows: Row[]) => rows.toSorted(function (a, b) { return (b.at.valueOf() - a.at.valueOf()) as number; });',
        filename: file,
      },
      {
        name: 'a comparator with a tie-breaker and a direction',
        code: 'export const a = (rows: Row[]) => rows.sort((x, y) => x.at.getTime() - y.at.getTime() || x.id.localeCompare(y.id));\nexport const b = (rows: Row[], desc: boolean) => rows?.sort((x, y) => { if (x.pinned) return -1; return desc ? y.at.getTime() - x.at.getTime() : x.at.getTime() - y.at.getTime(); });',
        filename: file,
      },
      {
        name: 'a comparator over member chains, descending, optional chaining and typed parameters',
        code: [
          'export const a = (rows: Row[]) => rows.sort((a, b) => b.slot.startsAt.getTime() - a.slot.startsAt.getTime());',
          'export const b = (rows: Row[]) => rows.toSorted((a: Row, b: Row) => a?.slot?.startsAt.getTime() - b!.slot.startsAt.getTime());',
          "export const c = (rows: Row[]) => rows.sort((a, b = fallback) => a['at'].valueOf() - (b as Row).at.valueOf());",
          'export const d = (dates: Date[]) => dates.sort((a, b) => a.getTime() - b.getTime());',
        ].join('\n'),
        filename: file,
      },
      {
        name: 'a comparator whose parameters are destructured, one binding from each',
        code: [
          'export const a = (rows: Row[]) => rows.sort(({ at: x }, { at: y }) => x.getTime() - y.getTime());',
          'export const b = (pairs: [string, Date][]) => pairs.toSorted(([, x], [, y]) => y.valueOf() - x.valueOf());',
          'export const c = (rows: Row[]) => rows.sort(({ slot }, other) => slot.startsAt.getTime() - other.slot.startsAt.getTime());',
        ].join('\n'),
        filename: file,
      },
      {
        name: 'the project’s own time package and unrelated packages',
        code: "import { resolveLocalDateTime } from '@ijazah/time';\nimport ms from 'ms';\nimport momentum from 'momentum';\nimport { x } from './moment';\nexport default [resolveLocalDateTime, ms, momentum, x];",
        filename: file,
      },
      {
        name: 'a type position names no library and does no arithmetic',
        code: 'export interface Row { readonly created_at: Date }\nexport const f = (d: Date): number => d.getTime();',
        filename: file,
      },
      {
        name: 'a local binding named Temporal',
        code: 'const Temporal = { x: 1 };\nexport default Temporal.x;',
        filename: file,
      },
    ],
    invalid: [
      {
        name: 'the fixture: a week of milliseconds added to an instant',
        code: 'export function nextOccurrence(previousStartAt: Date): Date {\n  return new Date(previousStartAt.getTime() + 7 * 24 * 60 * 60 * 1000);\n}',
        filename: file,
        errors: [{ messageId: 'arithmetic', line: 2 }],
      },
      {
        name: 'the fixture: a datetime library',
        code: "import { Temporal } from '@js-temporal/polyfill';\nexport const f = (iso: string) => Temporal.Instant.from(iso).toString();",
        filename: 'apps/api/src/modules/sessions/uses-datetime-library.ts',
        errors: [{ messageId: 'library', data: { specifier: '@js-temporal/polyfill' } }],
      },
      {
        name: 'the clock plus a duration: an expiry instant',
        code: 'export const expiresAt = (ttlMs: number) => new Date(Date.now() + ttlMs);',
        filename: 'apps/api/src/modules/booking/booking.service.ts',
        errors: [{ messageId: 'arithmetic' }],
      },
      {
        name: 'two instants subtracted, where one is written as a Date',
        code: 'export const a = (start: Date) => new Date().getTime() - start.getTime();\nexport const b = (start: number) => +new Date() - start;\nexport const c = (start: number) => Number(new Date()) - start;',
        filename: file,
        errors: 3,
      },
      {
        name: 'a duration since the clock, and the clock in seconds, stay refused',
        code: 'export const elapsed = (startedAt: number) => Date.now() - startedAt;\nexport const seconds = () => Math.floor(Date.now() / 1000);',
        filename: file,
        errors: [
          { messageId: 'arithmetic', line: 1 },
          { messageId: 'arithmetic', line: 2 },
        ],
      },
      {
        name: 'arithmetic inside a chain that ends in text is still arithmetic',
        code: "export const label = (d: Date) => d.getTime() + 1000 + 'ms';",
        filename: file,
        errors: [{ messageId: 'arithmetic' }],
      },
      {
        name: 'the same subtraction where it is not what a sort comparator returns',
        code: [
          'export const byTime = (a: Date, b: Date) => a.getTime() - b.getTime();',
          'export const spans = (rows: Row[]) => rows.map((r) => r.end.getTime() - r.start.getTime());',
          'export const f = (rows: Row[]) => rows.sort((a, b) => { const gap = a.at.getTime() - b.at.getTime(); return gap; });',
          'export const g = (rows: Row[]) => rows.reduce((a, b) => a.at.getTime() - b.at.getTime(), 0);',
        ].join('\n'),
        filename: file,
        errors: [
          { messageId: 'arithmetic', line: 1 },
          { messageId: 'arithmetic', line: 2 },
          { messageId: 'arithmetic', line: 3 },
          { messageId: 'arithmetic', line: 4 },
        ],
      },
      {
        name: 'a subtraction in a sort callback that does not order the callback’s two parameters',
        code: [
          'export const a = (timer: number[], start: Date, end: Date) => timer.sort(() => end.getTime() - start.getTime());',
          'export const b = (wrap: number[], startedAt: Date, finishedAt: Date) => wrap.toSorted(() => finishedAt.getTime() - startedAt.getTime());',
          'export const c = (xs: Date[]) => xs.sort((a, b) => a.getTime() - a.getTime());',
          'export const d = (xs: Date[], end: Date) => xs.sort((a, b) => a.getTime() - end.getTime());',
          'export const e = (xs: Date[], start: Date) => xs.sort((a) => a.getTime() - start.getTime());',
          'export const f = (xs: Date[]) => xs.sort((a, b, c) => a.getTime() - b.getTime());',
          'export const g = (xs: Date[], start: Date) => xs.sort((a, b) => { { const b = start; return a.getTime() - b.getTime(); } });',
          'export const h = (xs: Row[]) => xs.sort(({ start, end }, other) => end.getTime() - start.getTime());',
          'export const i = (xs: Row[]) => xs.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());',
          'export const j = (xs: Date[], start: Date, end: Date, desc: boolean) => xs.sort((a, b) => (desc ? end.getTime() - start.getTime() : a.getTime() - b.getTime()));',
          'export const k = (xs: Date[], start: Date) => xs.sort((a, b) => a.getTime() - b.getTime() || b.getTime() - start.getTime());',
        ].join('\n'),
        filename: file,
        errors: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((line) => ({
          messageId: 'arithmetic',
          line,
        })),
      },
      {
        name: 'a sort comparator that does more than order two instants',
        code: [
          'export const a = (rows: Row[]) => rows.sort((x, y) => x.at.getTime() - Date.now());',
          'export const b = (rows: Row[]) => rows.sort((x, y) => (x.at.getTime() - y.at.getTime()) / 1000);',
          'export const c = (rows: Row[]) => rows.sort((x, y) => x.at.getTime() + y.at.getTime());',
          'export const d = (rows: Row[]) => rows.sort((x, y) => x.at.getHours() - y.at.getHours());',
        ].join('\n'),
        filename: file,
        errors: [
          { messageId: 'arithmetic', line: 1 },
          { messageId: 'arithmetic', line: 2 },
          { messageId: 'arithmetic', line: 3 },
          { messageId: 'arithmetic', line: 4 },
        ],
      },
      {
        name: 'the calendar and formatting libraries',
        code: "import moment from 'moment-hijri';\nimport { format } from 'date-fns-jalali';\nimport { CalendarDate } from '@internationalized/date';\nimport { format as tempo } from '@formkit/tempo';\nexport default [moment, format, CalendarDate, tempo];",
        filename: file,
        errors: [
          { messageId: 'library', data: { specifier: 'moment-hijri' } },
          { messageId: 'library', data: { specifier: 'date-fns-jalali' } },
          { messageId: 'library', data: { specifier: '@internationalized/date' } },
          { messageId: 'library', data: { specifier: '@formkit/tempo' } },
        ],
      },
      {
        name: 'a chain is one piece of arithmetic',
        code: 'export const f = (d: Date, a: number, b: number) => d.getTime() + a + b;',
        filename: file,
        errors: 1,
      },
      {
        name: 'optional chaining, a computed name, a cast and globalThis',
        code: "export const a = (d?: Date) => d?.getTime()! + 1;\nexport const b = (d: Date) => d['getTime']() + 1;\nexport const c = (d: Date) => (d.getTime() as number) * 2;\nexport const e = globalThis.Date.now() + 1;",
        filename: file,
        errors: 4,
      },
      {
        name: 'behind a conditional and a nullish default',
        code: 'export const f = (d: Date | null, ok: boolean) => (ok ? d!.getTime() : 0) + 1000;\nexport const g = (d?: Date) => (d?.getTime() ?? 0) + 1000;',
        filename: file,
        errors: 2,
      },
      {
        name: 'component arithmetic through the getters',
        code: 'export const f = (d: Date) => [d.getDate() + 7, d.getHours() * 60 + d.getMinutes(), d.getMonth() + 1, d.getUTCDay() - 1, d.getTimezoneOffset() * 60_000];',
        filename: file,
        errors: 5,
      },
      {
        name: 'a compound assignment',
        code: 'let deadline = 0;\ndeadline += Date.now();\ndeadline -= d.getTime();',
        filename: file,
        errors: 2,
      },
      {
        name: 'a setter handed arithmetic',
        code: 'd.setDate(d.getDate() + 7);\nd.setHours(hour + 1);\nd?.setUTCMinutes(m - 30);\nd.setTime(saved + WEEK_MS);\nd.setMonth(month++);',
        filename: file,
        // The first line is one piece of arithmetic reported once, where it is written.
        errors: [
          { messageId: 'arithmetic', line: 1 },
          { messageId: 'setter', line: 2 },
          { messageId: 'setter', line: 3 },
          { messageId: 'setter', line: 4 },
          { messageId: 'setter', line: 5 },
        ],
      },
      {
        name: 'an instant constructed from arithmetic on a number that was a date',
        code: 'const ms = d.getTime();\nexport const next = new Date(ms + WEEK_MS);',
        filename: file,
        errors: [{ messageId: 'constructed', line: 2 }],
      },
      {
        name: 'a datetime assembled as text from a local date and a local time',
        code: "export const a = (date: string, time: string) => new Date(`${date}T${time}:00`);\nexport const b = (date: string) => Date.parse(date + 'T00:00:00Z');",
        filename: file,
        errors: [
          { messageId: 'constructed', line: 1 },
          { messageId: 'constructed', line: 2 },
        ],
      },
      {
        name: 'a datetime constructed from components, in the server’s zone or in UTC',
        code: 'export const a = new Date(2025, 3, 25, 9, 0);\nexport const b = Date.UTC(2025, 3, 25);\nexport const c = new globalThis.Date(y, m, d);',
        filename: file,
        errors: [
          { messageId: 'components', line: 1 },
          { messageId: 'components', line: 2 },
          { messageId: 'components', line: 3 },
        ],
      },
      {
        name: 'every way of naming a library',
        code: [
          "import dayjs from 'dayjs';",
          "import * as luxon from 'luxon';",
          "import type { Moment } from 'moment';",
          "import utc from 'dayjs/plugin/utc';",
          "import { addDays } from 'date-fns/addDays';",
          "const tz = require('moment-timezone');",
          "import fns = require('date-fns');",
          "export const lazy = () => import('luxon');",
          "export type Z = import('@js-joda/core').ZonedDateTime;",
          "export * from 'date-fns-tz';",
          "export { Temporal } from 'temporal-polyfill';",
          'export default [dayjs, luxon, utc, addDays, tz, fns];',
        ].join('\n'),
        filename: file,
        errors: 11,
      },
      {
        name: 'the native Temporal global is the same library without an import',
        code: "export const a = Temporal.Now.instant();\nexport const b = globalThis.Temporal.PlainDate.from('2025-04-25');",
        filename: file,
        errors: [
          { messageId: 'temporalGlobal', line: 1 },
          { messageId: 'temporalGlobal', line: 2 },
        ],
      },
      {
        name: 'the mobile application is not exempt',
        code: 'export const later = Date.now() + 1000;',
        filename: 'apps/mobile/src/lib/formatters.ts',
        errors: 1,
      },
    ],
  },
);
