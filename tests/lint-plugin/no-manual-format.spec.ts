// mobile/no-manual-format (R-MOBILE-9) against a table of code (T038).
//
// A `toLocaleDateString('ar-EG')` in a screen picks a locale, a calendar and a digit system on that
// one line, and `lib/formatters.ts` is where the choice is made once. The fixture proves that
// call; this table proves the rest of the header's list — the other locale methods and the
// un-localised `toDateString`, `toFixed` and `toPrecision`, the five `Intl` constructors, the
// `Date` part getters and their `getUTC*` twins — in the spellings that walk around a name match:
// a computed member, an optional call, a constructor used without `new`. The legal side proves the
// formatter from `lib/`, `lib/` itself calling anything below, the wire formats `toISOString` and
// `toJSON`, `getTime` and `Date.now`, which read no display part, and a file outside `apps/mobile`.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const label = 'apps/mobile/src/features/teacher/session-date.ts';

typescriptRuleTester().run('mobile/no-manual-format', loadRule('no-manual-format.js'), {
  valid: [
    {
      name: 'the formatter from lib/, which the fixture should have called',
      code: "import { formatDate } from '../../lib/formatters';\nexport const sessionDateLabel = (scheduledStartAt: Date) => formatDate(scheduledStartAt);",
      filename: label,
    },
    {
      name: 'lib/formatters.ts itself, where the locale is decided',
      code: "export const formatDate = (d: Date) => d.toLocaleDateString('ar-EG');\nexport const formatMoney = (n: number) => new Intl.NumberFormat('ar-EG').format(n);\nexport const hour = (d: Date) => d.getHours();",
      filename: 'apps/mobile/src/lib/formatters.ts',
    },
    {
      name: 'a file under lib/ other than the formatters',
      code: 'export const round = (n: number) => n.toFixed(2);',
      filename: 'apps/mobile/src/lib/money.ts',
    },
    {
      name: 'a file outside apps/mobile',
      code: "export const label = (d: Date) => d.toLocaleDateString('ar-EG');\nexport const f = new Intl.DateTimeFormat('ar-EG');",
      filename: 'apps/api/src/modules/booking/booking.service.ts',
    },
    {
      name: 'the wire formats',
      code: 'export const wire = (d: Date) => ({ iso: d.toISOString(), json: d.toJSON() });',
      filename: label,
    },
    {
      name: 'an instant read as a number, which is no display part',
      code: 'export const elapsed = (d: Date) => Date.now() - d.getTime();',
      filename: label,
    },
    {
      name: 'an Intl member that formats nothing for display',
      code: "export const collator = new Intl.Collator('ar');",
      filename: label,
    },
    {
      name: 'a method of one’s own that merely sounds alike',
      code: 'declare const money: { toDisplay(): string; format(): string };\nexport const label = money.toDisplay() + money.format();',
      filename: label,
    },
  ],
  invalid: [
    {
      name: 'the canonical locale date string',
      code: "export function sessionDateLabel(scheduledStartAt: Date): string {\n  return scheduledStartAt.toLocaleDateString('ar-EG');\n}",
      filename: label,
      errors: [{ messageId: 'method', data: { name: 'toLocaleDateString', kind: 'a date' } }],
    },
    {
      name: 'the other locale methods',
      code: "export const a = (d: Date) => d.toLocaleTimeString('ar-EG');\nexport const b = (d: Date) => d.toLocaleString('ar-EG');",
      filename: label,
      errors: [
        { messageId: 'method', data: { name: 'toLocaleTimeString', kind: 'a time' } },
        { messageId: 'method', data: { name: 'toLocaleString', kind: 'a date or number' } },
      ],
    },
    {
      name: 'the un-localised date and time strings',
      code: 'export const a = (d: Date) => d.toDateString();\nexport const b = (d: Date) => d.toTimeString();',
      filename: label,
      errors: [
        { messageId: 'method', data: { name: 'toDateString', kind: 'a date' } },
        { messageId: 'method', data: { name: 'toTimeString', kind: 'a time' } },
      ],
    },
    {
      name: 'a number rendered by hand',
      code: 'export const a = (n: number) => n.toFixed(2);\nexport const b = (n: number) => n.toPrecision(3);',
      filename: label,
      errors: [
        { messageId: 'method', data: { name: 'toFixed', kind: 'a number' } },
        { messageId: 'method', data: { name: 'toPrecision', kind: 'a number' } },
      ],
    },
    {
      name: 'toFixed on any receiver, since the fast set has no types',
      code: 'declare const price: { toFixed(digits: number): string };\nexport const label = price.toFixed(2);',
      filename: label,
      errors: 1,
    },
    {
      name: 'an Intl constructor, with new',
      code: "export const label = (d: Date) => new Intl.DateTimeFormat('ar-EG').format(d);",
      filename: label,
      errors: [{ messageId: 'intl', data: { name: 'DateTimeFormat' } }],
    },
    {
      name: 'the other Intl constructors, without new',
      code: "export const a = Intl.NumberFormat('ar-EG');\nexport const b = Intl.RelativeTimeFormat('ar');\nexport const c = Intl.ListFormat('ar');\nexport const d = Intl.PluralRules('ar');",
      filename: label,
      errors: [
        { messageId: 'intl', data: { name: 'NumberFormat' } },
        { messageId: 'intl', data: { name: 'RelativeTimeFormat' } },
        { messageId: 'intl', data: { name: 'ListFormat' } },
        { messageId: 'intl', data: { name: 'PluralRules' } },
      ],
    },
    {
      name: 'an Intl constructor reached through a computed member',
      code: "export const f = new Intl['NumberFormat']('ar-EG');",
      filename: label,
      errors: [{ messageId: 'intl', data: { name: 'NumberFormat' } }],
    },
    {
      name: 'the Date part getters, where a hand-built time starts',
      code: 'export const hm = (d: Date) => `${d.getHours()}:${d.getMinutes()}`;\nexport const ymd = (d: Date) => [d.getFullYear(), d.getMonth(), d.getDate(), d.getDay()];',
      filename: label,
      errors: [
        { messageId: 'method', data: { name: 'getHours', kind: 'a time' } },
        { messageId: 'method', data: { name: 'getMinutes', kind: 'a time' } },
        { messageId: 'method', data: { name: 'getFullYear', kind: 'a date' } },
        { messageId: 'method', data: { name: 'getMonth', kind: 'a date' } },
        { messageId: 'method', data: { name: 'getDate', kind: 'a date' } },
        { messageId: 'method', data: { name: 'getDay', kind: 'a date' } },
      ],
    },
    {
      name: 'the getUTC twins',
      code: 'export const a = (d: Date) => d.getUTCHours();\nexport const b = (d: Date) => d.getUTCFullYear();',
      filename: label,
      errors: [
        { messageId: 'method', data: { name: 'getUTCHours', kind: 'a time' } },
        { messageId: 'method', data: { name: 'getUTCFullYear', kind: 'a date' } },
      ],
    },
    {
      name: 'a method reached through a computed member or an optional call',
      code: "export const a = (d: Date) => d['toLocaleDateString']('ar-EG');\nexport const b = (d?: Date) => d?.toFixed(2);",
      filename: label,
      errors: [
        { messageId: 'method', data: { name: 'toLocaleDateString', kind: 'a date' } },
        { messageId: 'method', data: { name: 'toFixed', kind: 'a number' } },
      ],
    },
    {
      name: 'a route file under app/, which is outside lib/',
      code: "export const title = (d: Date) => d.toLocaleDateString('ar-EG');",
      filename: 'apps/mobile/src/app/(teacher)/sessions.tsx',
      errors: 1,
    },
    {
      name: 'a primitive in design/, which is outside lib/',
      code: 'export const price = (n: number) => n.toFixed(2);',
      filename: 'apps/mobile/src/design/primitives/price.tsx',
      errors: 1,
    },
  ],
});
