// mobile/no-raw-color (R-MOBILE-4) against a table of code (T037).
//
// The fixture proves one hex colour in one feature file. This table proves the two things a
// fixture cannot: the places a `#` is not a colour — a URL fragment, a deep link, a sentence —
// and the spellings of raw spacing that reach a style without looking like a number in a style
// object, a conditional, a nullish default, a cast and an arbitrary Tailwind class.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const feature = 'apps/mobile/src/features/student/teacher-card.tsx';
const route = 'apps/mobile/src/app/(student)/index.tsx';
const design = 'apps/mobile/src/design/tokens.ts';

typescriptRuleTester().run('mobile/no-raw-color', loadRule('no-raw-color.js'), {
  valid: [
    {
      name: 'design/ is where a colour lives',
      code: "export const brand = '#0f766e';",
      filename: design,
    },
    {
      name: 'a file outside the mobile application',
      code: "export const brand = '#0f766e';",
      filename: 'apps/admin/src/theme.ts',
    },
    {
      name: 'the Expo configuration beside src, where a splash colour is a platform requirement',
      code: "export default { splash: { backgroundColor: '#ffffff' } };",
      filename: 'apps/mobile/app.config.ts',
    },
    {
      name: 'a token',
      code: "import { colors, spacing } from '../../design/tokens';\nexport const s = { color: colors.brand, padding: spacing.md };",
      filename: feature,
    },
    {
      name: 'a URL fragment',
      code: "export const help = 'https://example.invalid/help#faq';",
      filename: feature,
    },
    {
      name: 'a deep link whose fragment is three hex digits',
      code: "export const link = 'ijazah://session/#abc';",
      filename: feature,
    },
    {
      name: 'a hash route',
      code: "export const path = '/#/add';",
      filename: feature,
    },
    {
      name: 'prose naming an order number',
      code: "export const key = 'Order #123 was confirmed';",
      filename: feature,
    },
    {
      name: 'a hashtag after a word',
      code: "export const tag = 'see #bad for the rest';",
      filename: feature,
    },
    {
      name: 'a hex run of a length no colour has',
      code: "export const id = '#12345';",
      filename: feature,
    },
    {
      name: 'a hex run continued by a word',
      code: "export const anchor = '#faceoff';",
      filename: feature,
    },
    {
      name: 'zero is no spacing',
      code: 'export const s = { margin: 0, padding: -0, gap: 0 };',
      filename: feature,
    },
    {
      name: 'a percentage is a proportion',
      code: "export const s = { paddingHorizontal: '10%' };",
      filename: feature,
    },
    {
      name: 'a scale class is a token',
      code: 'export const c = "p-4 mx-2 gap-3 md:px-6";',
      filename: feature,
    },
    {
      name: 'an arbitrary value that is not spacing',
      code: 'export const c = "w-[37px] grid-cols-[1fr_2fr]";',
      filename: feature,
    },
    {
      name: 'a number on a key that is not spacing',
      code: 'export const s = { flex: 1, opacity: 0.5, zIndex: 10 };',
      filename: feature,
    },
    {
      name: 'a name that only starts with margin or padding is not a spacing key',
      code: 'export const s = { paddingToken: 4, marginOfError: 0.5, paddingless: 2, marginTopOffset: 3 };',
      filename: feature,
    },
    {
      name: 'a destructured name is not a style',
      code: 'export function f({ padding = 4 }: { padding?: number }) { return padding; }',
      filename: feature,
    },
  ],
  invalid: [
    {
      name: 'the fixture: a hex colour as a style value',
      code: "export const s = { backgroundColor: '#0f766e' };",
      filename: feature,
      errors: [{ messageId: 'rawColor', data: { value: '#0f766e' } }],
    },
    {
      name: 'a route file under app/ is outside design/ too',
      code: "export const s = { color: '#fff' };",
      filename: route,
      errors: [{ messageId: 'rawColor', data: { value: '#fff' } }],
    },
    {
      name: 'a file directly under src',
      code: "export const c = '#000000';",
      filename: 'apps/mobile/src/theme.ts',
      errors: 1,
    },
    {
      name: 'three, four and eight digits',
      code: "export const c = ['#abc', '#abcd', '#aabbccdd'];",
      filename: feature,
      errors: 3,
    },
    {
      name: 'upper case',
      code: "export const c = '#0F766E';",
      filename: feature,
      errors: 1,
    },
    {
      name: 'a Tailwind arbitrary colour',
      code: 'export const c = "bg-[#0f766e] text-white";',
      filename: feature,
      errors: [{ messageId: 'rawColor', data: { value: '#0f766e' } }],
    },
    {
      name: 'a colour after a border style',
      code: "export const b = '1px solid #ccc';",
      filename: feature,
      errors: 1,
    },
    {
      name: 'a colour after a property',
      code: "export const css = 'color: #333';",
      filename: feature,
      errors: 1,
    },
    {
      name: 'a colour inside a gradient',
      code: "export const g = 'linear-gradient(#fff, #000)';",
      filename: feature,
      errors: 1,
    },
    {
      name: 'a colour in a template literal',
      code: 'export const c = (w: number) => `${w}px solid #ccc`;',
      filename: feature,
      errors: 1,
    },
    {
      name: 'rgb',
      code: "export const c = 'rgb(15, 118, 110)';",
      filename: feature,
      errors: [{ messageId: 'rawColor', data: { value: 'rgb(' } }],
    },
    {
      name: 'rgba, upper case',
      code: "export const c = 'RGBA(0,0,0,0.5)';",
      filename: feature,
      errors: 1,
    },
    {
      name: 'hsl and hsla',
      code: "export const c = ['hsl(174 77% 26%)', 'hsla(174, 77%, 26%, 0.5)'];",
      filename: feature,
      errors: 2,
    },
    {
      name: 'a raw number on a spacing key',
      code: 'export const s = { padding: 16 };',
      filename: feature,
      errors: [{ messageId: 'rawSpacing', data: { value: '16', name: 'padding' } }],
    },
    {
      name: 'every spacing key family',
      code: 'export const s = { marginTop: 8, paddingHorizontal: 12, gap: 4, rowGap: 2, columnGap: 2 };',
      filename: feature,
      errors: 5,
    },
    {
      name: 'every direction after margin and padding',
      code: 'export const s = { marginTop: 1, marginBottom: 1, paddingLeft: 1, paddingRight: 1, marginStart: 1, marginEnd: 1, paddingHorizontal: 1, paddingVertical: 1, marginBlock: 1, marginInline: 1, paddingBlockStart: 1, paddingBlockEnd: 1, marginInlineStart: 1, marginInlineEnd: 1 };',
      filename: feature,
      errors: 14,
    },
    {
      name: 'a negative number',
      code: 'export const s = { marginTop: -8 };',
      filename: feature,
      errors: [{ messageId: 'rawSpacing', data: { value: '-8', name: 'marginTop' } }],
    },
    {
      name: 'a quoted key',
      code: "export const s = { 'padding': 16 };",
      filename: feature,
      errors: 1,
    },
    {
      name: 'a conditional',
      code: 'export const s = (dense: boolean) => ({ padding: dense ? 8 : 16 });',
      filename: feature,
      errors: 1,
    },
    {
      name: 'a nullish default',
      code: 'export const s = (p?: number) => ({ padding: p ?? 16 });',
      filename: feature,
      errors: 1,
    },
    {
      name: 'a cast and a satisfies',
      code: 'export const s = { padding: 16 as number, margin: (12 satisfies number) };',
      filename: feature,
      errors: 2,
    },
    {
      name: 'a number with a unit, as a string',
      code: "export const s = { padding: '16px', margin: '1.5rem' };",
      filename: feature,
      errors: 2,
    },
    {
      name: 'a JSX prop',
      code: 'export const V = () => <Stack gap={8} padding="12" />;',
      filename: feature,
      errors: 2,
    },
    {
      name: 'an inline style',
      code: 'export const V = () => <View style={{ marginBottom: 24 }} />;',
      filename: feature,
      errors: 1,
    },
    {
      name: 'arbitrary spacing classes',
      code: 'export const c = ["p-[13px]", "md:-mx-[7px]", "!gap-[3px]", "space-x-[5px]"];',
      filename: feature,
      errors: [
        { messageId: 'arbitrarySpacing', data: { value: 'p-[13px]' } },
        { messageId: 'arbitrarySpacing', data: { value: 'md:-mx-[7px]' } },
        { messageId: 'arbitrarySpacing', data: { value: '!gap-[3px]' } },
        { messageId: 'arbitrarySpacing', data: { value: 'space-x-[5px]' } },
      ],
    },
  ],
});
