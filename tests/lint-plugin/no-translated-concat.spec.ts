// mobile/no-translated-concat (R-MOBILE-8) against a table of code (T038).
//
// The fixture proves `t(…) + t(…)`. This table proves the other ways a fragment is joined to
// something — `+=`, a template literal, a joined array, `.concat` — the spellings of the call
// itself (`i18n.t`, `t?.()`), and the one form the rule asks for instead: a single key handed its
// values.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const feature = 'apps/mobile/src/features/shared/greeting.ts';

typescriptRuleTester().run('mobile/no-translated-concat', loadRule('no-translated-concat.js'), {
  valid: [
    {
      name: 'one key with interpolation',
      code: "export const g = (name: string) => t('shared.greeting', { name });",
      filename: feature,
    },
    {
      name: 'a translation alone in a template literal',
      code: "export const g = () => `${t('shared.greeting')}`;",
      filename: feature,
    },
    {
      name: 'concatenation with no translation in it',
      code: "export const id = (a: string, b: string) => a + ':' + b;",
      filename: feature,
    },
    {
      name: 'a template literal with no translation in it',
      code: 'export const key = (a: string) => `session.${a}`;',
      filename: feature,
    },
    {
      name: 'a translation chosen by a conditional',
      code: "export const g = (am: boolean) => (am ? t('morning') : t('evening'));",
      filename: feature,
    },
    {
      name: 'a joined array with no translation in it',
      code: "export const c = ['flex', 'gap-2'].join(' ');",
      filename: feature,
    },
    {
      name: 'a list of translations that is not joined',
      code: "export const days = [t('mon'), t('tue')];",
      filename: feature,
    },
    {
      name: 'a list extended with a translated item',
      code: "export const items = [t('a')].concat(t('b'));",
      filename: feature,
    },
    {
      name: 'a call to something else named like a word starting with t',
      code: "export const x = translate('a') + suffix;",
      filename: feature,
    },
    {
      name: 'a file outside the mobile application',
      code: "export const g = () => t('a') + t('b');",
      filename: 'apps/admin/src/x.ts',
    },
  ],
  invalid: [
    {
      name: 'the fixture: two fragments joined by +',
      code: "export const g = () => t('shared.greeting.hello') + t('shared.greeting.name');",
      filename: feature,
      errors: [{ messageId: 'concatenated', data: { how: '"+"' } }],
    },
    {
      name: 'a fragment joined to a value, reported once for the chain',
      code: "export const g = (name: string) => t('hello') + ' ' + name + '!';",
      filename: feature,
      errors: 1,
    },
    {
      name: 'a fragment on the right',
      code: "export const g = (name: string) => name + t('suffix');",
      filename: feature,
      errors: 1,
    },
    {
      name: 'i18n.t',
      code: "export const g = (name: string) => i18n.t('hello') + name;",
      filename: feature,
      errors: 1,
    },
    {
      name: 'a computed method name',
      code: "export const g = (name: string) => i18n['t']('hello') + name;",
      filename: feature,
      errors: 1,
    },
    {
      name: 'optional call',
      code: "export const g = (name: string) => t?.('hello') + name;",
      filename: feature,
      errors: 1,
    },
    {
      name: 'optional member and a non-null assertion',
      code: "export const g = (name: string) => i18n?.t('hello')! + name;",
      filename: feature,
      errors: 1,
    },
    {
      name: 'a fragment behind a cast',
      code: "export const g = (name: string) => (t('hello') as string) + name;",
      filename: feature,
      errors: 1,
    },
    {
      name: 'a fragment inside a conditional operand',
      code: "export const g = (am: boolean, name: string) => (am ? t('morning') : t('evening')) + name;",
      filename: feature,
      errors: 1,
    },
    {
      name: 'a fragment with a fallback, then joined',
      code: "export const g = (name: string) => (t('hello') ?? '') + name;",
      filename: feature,
      errors: 1,
    },
    {
      name: '+=',
      code: "export function g(name: string) { let s = name; s += t('suffix'); return s; }",
      filename: feature,
      errors: [{ messageId: 'concatenated', data: { how: '"+="' } }],
    },
    {
      name: 'a template literal with text beside the fragment',
      code: "export const g = (name: string) => `${t('hello')}, ${name}`;",
      filename: feature,
      errors: [{ messageId: 'concatenated', data: { how: 'a template literal' } }],
    },
    {
      name: 'a template literal of two fragments and nothing else',
      code: "export const g = () => `${t('hello')}${t('name')}`;",
      filename: feature,
      errors: 1,
    },
    {
      name: 'a template literal with only a trailing mark',
      code: "export const g = () => `${i18n.t('hello')}!`;",
      filename: feature,
      errors: 1,
    },
    {
      name: 'a joined array',
      code: "export const g = (name: string) => [t('hello'), name].join(' ');",
      filename: feature,
      errors: [{ messageId: 'concatenated', data: { how: '".join()"' } }],
    },
    {
      name: '.concat on a fragment',
      code: "export const g = (name: string) => t('hello').concat(' ', name);",
      filename: feature,
      errors: [{ messageId: 'concatenated', data: { how: '".concat()"' } }],
    },
    {
      name: '.concat with a fragment as the argument',
      code: "export const g = (name: string) => name.concat(t('suffix'));",
      filename: feature,
      errors: 1,
    },
  ],
});
