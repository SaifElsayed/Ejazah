// mobile/no-raw-color (R-MOBILE-4) against a table of code (T037).
//
// Colour and spacing have one source, `design/tokens.ts`, and a literal anywhere else under
// `apps/mobile/src` is a second one. The fixture proves the canonical hex colour in a style object;
// this table proves the spellings that walk around it — the short, alpha and functional colour
// notations, the same literal inside a Tailwind arbitrary value, a template chunk, a `className`
// attribute — and the numeric spacing half of the rule, in the React Native key spellings and in
// `p-[12px]`. The scope decisions recorded in the rule header get a case each: `app/` and `lib/`
// are as much feature code as `features/**`, `design/` is the one folder that may write a value,
// zero is not an amount, and a width, radius or font size is left to review rather than refused.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const styles = 'apps/mobile/src/features/student/teacher-card-styles.ts';
const screen = 'apps/mobile/src/features/student/screens/home.tsx';
const tokens = 'apps/mobile/src/design/tokens.ts';

typescriptRuleTester().run('mobile/no-raw-color', loadRule('no-raw-color.js'), {
  valid: [
    {
      name: 'a colour and a spacing value read from the tokens',
      code: "import { colors, spacing } from '../../design/tokens';\nexport const styles = { backgroundColor: colors.brand, marginTop: spacing.md };",
      filename: styles,
    },
    {
      name: 'the tokens file itself, where a value is defined',
      code: "export const colors = { brand: '#0f766e', muted: 'rgb(15, 118, 110)' };\nexport const spacing = { md: 12 };",
      filename: tokens,
    },
    {
      name: 'a file outside apps/mobile',
      code: "export const brand = '#0f766e';\nexport const layout = { marginTop: 12 };",
      filename: 'apps/api/src/modules/booking/booking.service.ts',
    },
    {
      name: 'zero, which removes spacing rather than choosing an amount',
      code: 'export const styles = { margin: 0, paddingTop: 0, gap: 0, start: -0 };',
      filename: styles,
    },
    {
      name: 'named colours and spacing scale classes, which are tokens',
      code: "export const className = 'bg-slate-500 text-red p-4 -mt-2 gap-x-3 md:ps-6';",
      filename: styles,
    },
    {
      name: 'a width, radius and font size, which are not spacing',
      code: 'export const styles = { width: 120, height: 48, borderRadius: 8, fontSize: 14 };',
      filename: styles,
    },
    {
      name: 'an arbitrary width, which is not spacing',
      code: "export const className = 'w-[120px] h-[48px]';",
      filename: styles,
    },
    {
      name: 'a hash that is not a whole hex token',
      code: "import { t } from '../../i18n';\nexport const label = t('student.home#3');\nexport const anchor = 'student.home#abc';",
      filename: styles,
    },
  ],
  invalid: [
    {
      name: 'the canonical hex colour in a style object',
      code: "export const teacherCardStyles = {\n  backgroundColor: '#0f766e',\n};",
      filename: styles,
      errors: [{ messageId: 'color', data: { value: '#0f766e' } }],
    },
    {
      name: 'a short hex colour',
      code: "export const border = '#fff';",
      filename: styles,
      errors: [{ messageId: 'color', data: { value: '#fff' } }],
    },
    {
      name: 'a hex colour with alpha',
      code: "export const overlay = '#0f766e80';",
      filename: styles,
      errors: [{ messageId: 'color', data: { value: '#0f766e80' } }],
    },
    {
      name: 'the functional notations',
      code: "export const a = 'rgb(15, 118, 110)';\nexport const b = 'hsl(174 84% 25%)';\nexport const c = 'oklch(50% 0.1 180)';",
      filename: styles,
      errors: [
        { messageId: 'color', data: { value: 'rgb(' } },
        { messageId: 'color', data: { value: 'hsl(' } },
        { messageId: 'color', data: { value: 'oklch(' } },
      ],
    },
    {
      name: 'a Tailwind arbitrary colour value',
      code: "export const className = 'bg-[#0f766e] text-[rgb(15,118,110)]';",
      filename: styles,
      errors: [{ messageId: 'color', data: { value: '#0f766e' } }],
    },
    {
      name: 'a colour in a className attribute',
      code: 'import { View } from \'react-native\';\nexport const Card = () => <View className="border-[#e2e8f0]" />;',
      filename: screen,
      errors: [{ messageId: 'color', data: { value: '#e2e8f0' } }],
    },
    {
      name: 'a colour in a template chunk',
      code: 'export const className = (extra: string) => `bg-[#0f766e] ${extra}`;',
      filename: styles,
      errors: [{ messageId: 'color', data: { value: '#0f766e' } }],
    },
    {
      name: 'a Tailwind arbitrary spacing value',
      code: "export const className = 'flex p-[12px]';",
      filename: styles,
      errors: [{ messageId: 'arbitrarySpacing', data: { value: 'p-[12px]' } }],
    },
    {
      name: 'arbitrary spacing under a variant prefix and with a negative sign',
      code: "export const a = 'md:pl-[4px]';\nexport const b = '-mt-[8]';\nexport const c = 'gap-[1.5rem]';",
      filename: styles,
      errors: [
        { messageId: 'arbitrarySpacing', data: { value: 'pl-[4px]' } },
        { messageId: 'arbitrarySpacing', data: { value: '-mt-[8]' } },
        { messageId: 'arbitrarySpacing', data: { value: 'gap-[1.5rem]' } },
      ],
    },
    {
      name: 'a numeric spacing value in a style object',
      code: 'export const styles = { marginTop: 12 };',
      filename: styles,
      errors: [{ messageId: 'spacing', data: { property: 'marginTop', value: '12' } }],
    },
    {
      name: 'a negative spacing value, read through its unary minus',
      code: 'export const styles = { marginStart: -8 };',
      filename: styles,
      errors: [{ messageId: 'spacing', data: { property: 'marginStart', value: '-8' } }],
    },
    {
      name: 'the other React Native spacing spellings, including a quoted key',
      code: "export const styles = { paddingHorizontal: 16, columnGap: 4, start: 2, 'insetInline': 1 };",
      filename: styles,
      errors: [
        { messageId: 'spacing', data: { property: 'paddingHorizontal', value: '16' } },
        { messageId: 'spacing', data: { property: 'columnGap', value: '4' } },
        { messageId: 'spacing', data: { property: 'start', value: '2' } },
        { messageId: 'spacing', data: { property: 'insetInline', value: '1' } },
      ],
    },
    {
      name: 'a route file under app/, which is feature code for this purpose',
      code: "export const headerStyle = { backgroundColor: '#ffffff' };",
      filename: 'apps/mobile/src/app/(student)/_layout.tsx',
      errors: 1,
    },
    {
      name: 'a file under lib/, which is feature code for this purpose',
      code: 'export const inset = { paddingTop: 24 };',
      filename: 'apps/mobile/src/lib/safe-area.ts',
      errors: 1,
    },
  ],
});
