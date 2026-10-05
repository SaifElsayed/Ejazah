// mobile/no-manual-format (R-MOBILE-9) against a table of code (T038).
//
// The fixture proves `toLocaleDateString`. This table proves the rest of the family, the `Intl`
// global under every name it answers to, and the two things that share a name with it and are
// not it: a local binding called `Intl`, and the serialisers, which format for a machine.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const feature = 'apps/mobile/src/features/teacher/session-date.ts';
const formatters = 'apps/mobile/src/lib/formatters.ts';

typescriptRuleTester().run('mobile/no-manual-format', loadRule('no-manual-format.js'), {
  valid: [
    {
      name: 'lib/ is where the formatters live',
      code: "export const formatDate = (d: Date) => new Intl.DateTimeFormat('ar-EG').format(d) + d.toLocaleDateString();",
      filename: formatters,
    },
    {
      name: 'a feature calling the shared formatter',
      code: "import { formatDate } from '../../lib/formatters';\nexport const label = (d: Date) => formatDate(d);",
      filename: feature,
    },
    {
      name: 'serialising for a machine',
      code: 'export const wire = (d: Date) => [d.toISOString(), d.toJSON(), String(n), n.toString()];',
      filename: feature,
    },
    {
      name: 'a parameter named Intl is not the global',
      code: 'export const f = (Intl: { format(n: number): string }) => Intl.format(1);',
      filename: feature,
    },
    {
      name: 'an import named Intl is not the global',
      code: "import { Intl } from '../../lib/formatters';\nexport const f = () => Intl.format(1);",
      filename: feature,
    },
    {
      name: 'a type position names no formatter',
      code: 'export type Options = Intl.DateTimeFormatOptions;',
      filename: feature,
    },
    {
      name: 'a property that merely shares a name with the global',
      code: 'export const f = (lib: { Intl: unknown }) => lib.Intl;',
      filename: feature,
    },
    {
      name: 'a file outside the mobile application',
      code: 'export const f = (d: Date) => d.toLocaleDateString();',
      filename: 'apps/admin/src/x.ts',
    },
  ],
  invalid: [
    {
      name: 'the fixture: toLocaleDateString',
      code: "export const label = (d: Date) => d.toLocaleDateString('ar-EG');",
      filename: feature,
      errors: [{ messageId: 'manualFormat', data: { name: 'toLocaleDateString' } }],
    },
    {
      name: 'the rest of the date family',
      code: 'export const f = (d: Date) => [d.toLocaleTimeString(), d.toLocaleString(), d.toDateString(), d.toTimeString(), d.toUTCString()];',
      filename: feature,
      errors: 5,
    },
    {
      name: 'a number shaped for display',
      code: 'export const f = (n: number) => [n.toFixed(2), n.toPrecision(3), n.toExponential(1)];',
      filename: feature,
      errors: 3,
    },
    {
      name: 'a computed method name',
      code: "export const f = (d: Date) => d['toLocaleDateString']();",
      filename: feature,
      errors: 1,
    },
    {
      name: 'optional chaining and a non-null assertion',
      code: 'export const f = (d?: Date, n?: number) => [d?.toLocaleDateString(), n!.toFixed(2)];',
      filename: feature,
      errors: 2,
    },
    {
      name: 'a method taken without being called',
      code: 'export const f = (n: number) => n.toFixed.call(n, 2);',
      filename: feature,
      errors: 1,
    },
    {
      name: 'Intl',
      code: "export const f = (n: number) => new Intl.NumberFormat('ar-EG').format(n);",
      filename: feature,
      errors: [{ messageId: 'manualFormat', data: { name: 'Intl' } }],
    },
    {
      name: 'globalThis.Intl is Intl',
      code: "export const f = (n: number) => new globalThis.Intl.NumberFormat('ar-EG').format(n);",
      filename: feature,
      errors: [{ messageId: 'manualFormat', data: { name: 'Intl' } }],
    },
    {
      name: 'the other holders of the global, dotted and computed',
      code: "export const a = window.Intl;\nexport const b = self['Intl'];\nexport const c = global?.Intl;",
      filename: feature,
      errors: 3,
    },
    {
      name: 'Intl handed on as a value',
      code: 'export const formatter = Intl;',
      filename: feature,
      errors: 1,
    },
    {
      name: 'a route file under app/ is outside lib/ too',
      code: 'export const f = (n: number) => n.toFixed(1);',
      filename: 'apps/mobile/src/app/(teacher)/index.tsx',
      errors: 1,
    },
  ],
});
