// mobile/no-physical-direction (R-MOBILE-5) against a table of code (T037).
//
// The fixture proves `text-left` in one class attribute. This table proves the other seven
// utilities, their variant, important and negative forms, the style-key half — where a cast was
// enough to walk around a rule that compared the value node directly — and the names that only
// look like a class: an icon called `left-arrow` is not a direction.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const feature = 'apps/mobile/src/features/teacher/lesson-row.tsx';
const primitive = 'apps/mobile/src/design/primitives/row.tsx';

typescriptRuleTester().run('mobile/no-physical-direction', loadRule('no-physical-direction.js'), {
  valid: [
    {
      name: 'the logical utilities',
      code: 'export const c = "ms-4 me-2 ps-1 pe-3 start-0 end-0 text-start text-end";',
      filename: feature,
    },
    {
      name: 'an icon name that starts like a class',
      code: "export const icon = 'left-arrow';",
      filename: feature,
    },
    {
      name: 'names that carry the word and no Tailwind value',
      code: "export const names = ['right-aligned-icon', 'ml-model', 'pl-sql', 'left-of-centre'];",
      filename: feature,
    },
    {
      name: 'symmetric utilities',
      code: 'export const c = "mx-4 px-2 inset-x-0 text-center";',
      filename: feature,
    },
    {
      name: 'a file outside the mobile application',
      code: 'export const c = "ml-4 text-left";',
      filename: 'apps/admin/src/table.tsx',
    },
    {
      name: 'logical style keys',
      code: "export const s = { marginStart: a, paddingEnd: b, start: 0, end: 0, textAlign: 'auto' };",
      filename: feature,
    },
    {
      name: 'a pair of operands spelled left and right',
      code: 'export const pair = { left: a, right: b };',
      filename: feature,
    },
    {
      name: 'a destructured pair',
      code: 'export function f({ left, right }: Pair) { return [left, right]; }',
      filename: feature,
    },
    {
      name: 'the insets of a touch target have no logical keys',
      code: 'export const V = () => <Tap hitSlop={{ top: 8, left: 8, bottom: 8, right: 8 }} pressRetentionOffset={{ left: 20, right: 20 }} />;',
      filename: feature,
    },
    {
      name: 'insets held in a constant, an object key and a conditional',
      code: 'export const HIT_SLOP = { top: 8, left: 8, bottom: 8, right: 8 } as const;\nexport const props = (wide: boolean) => ({ hitSlop: wide ? { left: 12, right: 12 } : { left: 4, right: 4 } });',
      filename: feature,
    },
    {
      name: 'text aligned from a token',
      code: 'export const s = { textAlign: alignment };',
      filename: feature,
    },
  ],
  invalid: [
    {
      name: 'the fixture: text-left in a class attribute',
      code: 'export const R = () => <Text className="text-left">{label}</Text>;',
      filename: feature,
      errors: [{ messageId: 'physicalClass', data: { found: 'text-left', logical: 'text-start' } }],
    },
    {
      name: 'text-right',
      code: 'export const c = "text-right";',
      filename: feature,
      errors: [{ messageId: 'physicalClass', data: { found: 'text-right', logical: 'text-end' } }],
    },
    {
      name: 'the four margin and padding utilities',
      code: 'export const c = ["ml-4", "mr-2", "pl-1", "pr-0.5"];',
      filename: feature,
      errors: [
        { messageId: 'physicalClass', data: { found: 'ml-4', logical: 'ms-4' } },
        { messageId: 'physicalClass', data: { found: 'mr-2', logical: 'me-2' } },
        { messageId: 'physicalClass', data: { found: 'pl-1', logical: 'ps-1' } },
        { messageId: 'physicalClass', data: { found: 'pr-0.5', logical: 'pe-0.5' } },
      ],
    },
    {
      name: 'the two inset utilities, with every kind of value',
      code: 'export const c = ["left-0", "right-1/2", "left-px", "right-auto", "left-full", "right-[3px]"];',
      filename: feature,
      errors: 6,
    },
    {
      name: 'a variant, an important mark and a negative',
      code: 'export const c = ["md:ml-4", "rtl:hover:pr-2", "!ml-4", "-ml-4", "md:-left-2"];',
      filename: feature,
      errors: 5,
    },
    {
      name: 'one physical class among logical ones',
      code: 'export const c = "ms-4 flex ml-auto";',
      filename: feature,
      errors: [{ messageId: 'physicalClass', data: { found: 'ml-auto', logical: 'ms-auto' } }],
    },
    {
      name: 'a class in a template literal',
      code: 'export const c = (on: boolean) => `flex ml-4 ${on ? "a" : "b"}`;',
      filename: feature,
      errors: 1,
    },
    {
      name: 'a class handed to a helper',
      code: 'export const c = clsx("flex", active && "pr-2");',
      filename: feature,
      errors: 1,
    },
    {
      name: 'a primitive under design/ is not exempt',
      code: 'export const c = "ml-4";',
      filename: primitive,
      errors: 1,
    },
    {
      name: 'physical margin and padding style keys',
      code: 'export const s = { marginLeft: a, marginRight: b, paddingLeft: c, paddingRight: d };',
      filename: feature,
      errors: [
        { messageId: 'physicalStyle', data: { found: 'marginLeft', logical: 'marginStart' } },
        { messageId: 'physicalStyle', data: { found: 'marginRight', logical: 'marginEnd' } },
        { messageId: 'physicalStyle', data: { found: 'paddingLeft', logical: 'paddingStart' } },
        { messageId: 'physicalStyle', data: { found: 'paddingRight', logical: 'paddingEnd' } },
      ],
    },
    {
      name: 'left and right holding a position',
      code: "export const s = { position: 'absolute', left: 0, right: '10%' };",
      filename: feature,
      errors: [
        { messageId: 'physicalStyle', data: { found: 'left', logical: 'start' } },
        { messageId: 'physicalStyle', data: { found: 'right', logical: 'end' } },
      ],
    },
    {
      name: 'a negative position and a conditional one',
      code: 'export const s = (on: boolean) => ({ left: -4, right: on ? 0 : offset });',
      filename: feature,
      errors: 2,
    },
    {
      name: 'a style beside the insets is not exempt',
      code: 'export const V = () => <Tap style={{ left: 8 }} hitSlop={{ left: 8 }} />;',
      filename: feature,
      errors: [{ messageId: 'physicalStyle', data: { found: 'left', logical: 'start' } }],
    },
    {
      name: 'an object under another name is not insets',
      code: 'export const slop = { left: 8 };\nexport const hitSlopStyle = { marginLeft: 8 };',
      filename: feature,
      errors: 2,
    },
    {
      name: 'a quoted style key',
      code: "export const s = { 'marginLeft': a };",
      filename: feature,
      errors: 1,
    },
    {
      name: 'textAlign left',
      code: "export const s = { textAlign: 'left' };",
      filename: feature,
      errors: [
        {
          messageId: 'physicalStyle',
          data: { found: "textAlign: 'left'", logical: "textAlign: 'start'" },
        },
      ],
    },
    {
      name: 'textAlign left behind a const assertion',
      code: "export const s = { textAlign: 'left' as const };",
      filename: feature,
      errors: 1,
    },
    {
      name: 'textAlign right behind satisfies and a non-null assertion',
      code: "export const s = { textAlign: ('right' satisfies string)! };",
      filename: feature,
      errors: 1,
    },
    {
      name: 'textAlign chosen by a conditional',
      code: "export const s = (rtl: boolean) => ({ textAlign: rtl ? 'right' : 'start' });",
      filename: feature,
      errors: 1,
    },
    {
      name: 'textAlign with a fallback',
      code: "export const s = (a?: string) => ({ textAlign: a ?? 'left' });",
      filename: feature,
      errors: 1,
    },
    {
      name: 'JSX props',
      code: 'export const V = () => <Box marginLeft={space} textAlign="right" left={0} />;',
      filename: feature,
      errors: 3,
    },
  ],
});
