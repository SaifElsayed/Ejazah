// mobile/no-translated-concat (R-MOBILE-8) against a table of code (T038).
//
// Concatenation fixes the order of a sentence's parts in code, and word order is what each
// language needs to be free to change. The fixture proves `t('a') + t('b')`; this table proves the
// other shapes the header names — a translation anywhere in a longer `+` chain, `+=`, the member
// spellings `i18n.t()` and `useTranslation().t()`, a template that carries a translation and
// anything else, and an array of translations that is joined — and that a chain is reported once
// at its outermost `+`, not once per operator. The legal side proves interpolation within one
// key, a lone translation wrapped in a template, concatenation that involves no translation, and
// the dynamic key `t('teacher.' + kind)`, which is a different problem and is not this rule's.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const greeting = 'apps/mobile/src/features/shared/greeting.ts';
const t = "import { t } from '../../i18n';";

typescriptRuleTester().run('mobile/no-translated-concat', loadRule('no-translated-concat.js'), {
  valid: [
    {
      name: 'interpolation within one key, the fix the message names',
      code: `${t}\nexport const greeting = (name: string) => t('shared.greeting.hello', { name });`,
      filename: greeting,
    },
    {
      name: 'a lone translation wrapped in a template, with or without whitespace around it',
      code: `${t}\nexport const a = \`\${t('shared.greeting.hello')}\`;\nexport const b = \` \${t('shared.greeting.hello')} \`;`,
      filename: greeting,
    },
    {
      name: 'concatenation that involves no translation',
      code: "export const label = (first: string, last: string) => first + ' ' + last;\nexport const next = (count: number) => count + 1;",
      filename: greeting,
    },
    {
      name: 'a dynamic key, which is a different problem',
      code: `${t}\nexport const label = (kind: string) => t('teacher.' + kind);`,
      filename: greeting,
    },
    {
      name: 'a template and a join with no translation in them',
      code: "export const a = (name: string, count: number) => `${name} ${count}`;\nexport const b = (parts: string[]) => [parts[0], parts[1]].join(' ');",
      filename: greeting,
    },
    {
      name: 'a compound assignment of untranslated text',
      code: "export function label(name: string): string {\n  let out = '';\n  out += name;\n  return out;\n}",
      filename: greeting,
    },
    {
      name: 'the member spellings used on their own',
      code: "declare const i18n: { t(key: string): string };\ndeclare function useTranslation(): { t(key: string): string };\nexport const a = i18n.t('a');\nexport const b = useTranslation().t('b');",
      filename: greeting,
    },
    {
      name: 'a file outside apps/mobile',
      code: "declare function t(key: string): string;\nexport const greeting = t('hello') + t('name');",
      filename: 'apps/api/src/modules/notification/notification.service.ts',
    },
  ],
  invalid: [
    {
      name: 'a += whose right-hand side is itself a chain, reported once',
      code: `${t}\nexport function label(name: string): string {\n  let out = name;\n  out += ' ' + t('shared.greeting.suffix');\n  return out;\n}`,
      filename: greeting,
      errors: [{ messageId: 'concatenation' }],
    },
    {
      name: 'the canonical two translations joined with +',
      code: `${t}\nexport function greeting(): string {\n  return t('shared.greeting.hello') + t('shared.greeting.name');\n}`,
      filename: greeting,
      errors: [{ messageId: 'concatenation' }],
    },
    {
      name: 'a translation at the start of a longer chain, reported once',
      code: `${t}\nexport const greeting = (name: string) => t('shared.greeting.hello') + ' ' + name;`,
      filename: greeting,
      errors: [{ messageId: 'concatenation' }],
    },
    {
      name: 'a translation at the end of a chain',
      code: `${t}\nexport const greeting = (name: string) => 'Hello, ' + name + t('shared.greeting.suffix');`,
      filename: greeting,
      errors: [{ messageId: 'concatenation' }],
    },
    {
      name: 'a compound assignment',
      code: `${t}\nexport function label(name: string): string {\n  let out = name;\n  out += t('shared.greeting.suffix');\n  return out;\n}`,
      filename: greeting,
      errors: [{ messageId: 'concatenation' }],
    },
    {
      name: 'the member spelling i18n.t()',
      code: "declare const i18n: { t(key: string): string };\nexport const greeting = (name: string) => i18n.t('hello') + name;",
      filename: greeting,
      errors: [{ messageId: 'concatenation' }],
    },
    {
      name: 'the member spelling useTranslation().t()',
      code: "declare function useTranslation(): { t(key: string): string };\nexport const greeting = () => useTranslation().t('hello') + '!';",
      filename: greeting,
      errors: [{ messageId: 'concatenation' }],
    },
    {
      name: 'a translation in a template with another expression',
      code: `${t}\nexport const greeting = (name: string) => \`\${t('shared.greeting.hello')} \${name}\`;`,
      filename: greeting,
      errors: [{ messageId: 'template' }],
    },
    {
      name: 'a translation in a template with other text',
      code: `${t}\nexport const greeting = () => \`\${t('shared.greeting.hello')}!\`;`,
      filename: greeting,
      errors: [{ messageId: 'template' }],
    },
    {
      name: 'two translations in one template',
      code: `${t}\nexport const greeting = () => \`\${t('shared.greeting.hello')}\${t('shared.greeting.name')}\`;`,
      filename: greeting,
      errors: [{ messageId: 'template' }],
    },
    {
      name: 'translations joined from an array',
      code: `${t}\nexport const greeting = () => [t('shared.greeting.hello'), t('shared.greeting.name')].join(' ');`,
      filename: greeting,
      errors: [{ messageId: 'joined' }],
    },
    {
      name: 'a translation joined with a variable',
      code: `${t}\nexport const greeting = (name: string) => [t('shared.greeting.hello'), name].join(' ');`,
      filename: greeting,
      errors: [{ messageId: 'joined' }],
    },
    {
      name: 'a screen under app/',
      code: `${t}\nexport const title = t('a') + t('b');`,
      filename: 'apps/mobile/src/app/(student)/index.tsx',
      errors: 1,
    },
  ],
});
