// mobile/no-physical-direction (R-MOBILE-5) against a table of code (T037).
//
// A physical side pins a layout to one script, and the application renders in both. The fixture
// proves `text-left` in a `className` attribute; this table proves the spellings that walk around
// it — a variant prefix, a negative margin, a class list assembled in `cn(...)` or a template, the
// wider families the header adds (`border-l-*`, `rounded-tl-*`, `float-left`, `scroll-ml-*`) —
// and the React Native half of the rule, where the same prohibition is a style key such as
// `marginLeft` or a `textAlign` of `'left'`. Each refused thing has its logical spelling in the
// valid table, so the fix the message names is proven to lint clean. `design/` and
// `lib/direction.ts` resolve a direction on purpose and are outside the rule's scope; a class
// that merely contains an `l` or an `r` (`rounded-lg`, `text-lg`) is not a side.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const row = 'apps/mobile/src/features/teacher/lesson-row.tsx';
const styles = 'apps/mobile/src/features/teacher/lesson-row-styles.ts';
const primitives = "import { Text } from '../../design/primitives';";

typescriptRuleTester().run('mobile/no-physical-direction', loadRule('no-physical-direction.js'), {
  valid: [
    {
      name: 'domain keys that merely contain a side, which are not style keys',
      code: 'export const arrows = { RightArrow: 1, leftHanded: true, borderLeftovers: 0 };',
      filename: styles,
    },
    {
      name: 'the logical alignment the fixture should have used',
      code: `${primitives}\nexport function LessonRow(props: { readonly label: string }): unknown {\n  return <Text className="text-start">{props.label}</Text>;\n}`,
      filename: row,
    },
    {
      name: 'the logical utilities, under a variant prefix and with a negative sign too',
      code: "export const className = 'ms-2 me-4 ps-1 pe-3 start-0 end-0 text-end md:ps-6 -ms-2 border-s-2 rounded-ss-lg float-start';",
      filename: styles,
    },
    {
      name: 'classes that merely contain an l or an r',
      code: "export const className = 'rounded-lg border-2 text-lg leading-tight flex-row-reverse items-center';",
      filename: styles,
    },
    {
      name: 'the logical React Native style keys',
      code: "export const styles = {\n  marginStart: 8,\n  paddingEnd: 4,\n  start: 0,\n  end: 0,\n  borderStartWidth: 1,\n  borderTopEndRadius: 4,\n  textAlign: 'start',\n};",
      filename: styles,
    },
    {
      name: 'a textAlign that names no side',
      code: "export const styles = { textAlign: 'center' };",
      filename: styles,
    },
    {
      name: 'a primitive in design/, which composes the raw parts',
      code: "export const base = 'text-left pl-4';\nexport const styles = { marginLeft: 8 };",
      filename: 'apps/mobile/src/design/primitives/text.tsx',
    },
    {
      name: 'lib/direction.ts, where a direction is resolved on purpose',
      code: "export const side = (rtl: boolean) => (rtl ? 'right-0' : 'left-0');",
      filename: 'apps/mobile/src/lib/direction.ts',
    },
    {
      name: 'a file outside apps/mobile',
      code: "export const className = 'ml-2 text-left';\nexport const styles = { paddingRight: 4 };",
      filename: 'apps/admin/src/pages/home.tsx',
    },
  ],
  invalid: [
    {
      name: 'the canonical physical alignment in a className attribute',
      code: `${primitives}\nexport function LessonRow(props: { readonly label: string }): unknown {\n  return <Text className="text-left">{props.label}</Text>;\n}`,
      filename: row,
      errors: [
        { messageId: 'className', data: { token: 'text-left', logical: 'text-start / text-end' } },
      ],
    },
    {
      name: 'a physical margin',
      code: "export const className = 'flex ml-2';",
      filename: styles,
      errors: [{ messageId: 'className', data: { token: 'ml-2', logical: 'ms-* / me-*' } }],
    },
    {
      name: 'a physical padding under a variant prefix',
      code: "export const className = 'md:pl-4';",
      filename: styles,
      errors: [{ messageId: 'className', data: { token: 'md:pl-4', logical: 'ps-* / pe-*' } }],
    },
    {
      name: 'a negative physical margin under two variant prefixes',
      code: "export const a = '-ml-2';\nexport const b = 'md:hover:-mr-4';",
      filename: styles,
      errors: [
        { messageId: 'className', data: { token: '-ml-2', logical: 'ms-* / me-*' } },
        { messageId: 'className', data: { token: 'md:hover:-mr-4', logical: 'ms-* / me-*' } },
      ],
    },
    {
      name: 'physical offsets',
      code: "export const a = 'left-0';\nexport const b = 'right-2';",
      filename: styles,
      errors: [
        { messageId: 'className', data: { token: 'left-0', logical: 'start-*' } },
        { messageId: 'className', data: { token: 'right-2', logical: 'end-*' } },
      ],
    },
    {
      name: 'the wider families the header adds',
      code: "export const a = 'border-l-2';\nexport const b = 'rounded-tl-lg';\nexport const c = 'float-left';\nexport const d = 'scroll-ml-4';",
      filename: styles,
      errors: [
        {
          messageId: 'className',
          data: { token: 'border-l-2', logical: 'border-s-* / border-e-*' },
        },
        {
          messageId: 'className',
          data: {
            token: 'rounded-tl-lg',
            logical: 'rounded-s-* / rounded-e-* (rounded-ss-*, rounded-ee-* for a corner)',
          },
        },
        {
          messageId: 'className',
          data: { token: 'float-left', logical: 'float-start / float-end' },
        },
        {
          messageId: 'className',
          data: { token: 'scroll-ml-4', logical: 'scroll-ms-* / scroll-me-*' },
        },
      ],
    },
    {
      name: 'a class list assembled in a cn() call',
      code: "declare function cn(...classes: string[]): string;\nexport const className = cn('flex', 'mr-2');",
      filename: styles,
      errors: [{ messageId: 'className', data: { token: 'mr-2', logical: 'ms-* / me-*' } }],
    },
    {
      name: 'a class list assembled in a template',
      code: 'export const className = (extra: string) => `px-4 ${extra} pl-2`;',
      filename: styles,
      errors: [{ messageId: 'className', data: { token: 'pl-2', logical: 'ps-* / pe-*' } }],
    },
    {
      name: 'two physical sides in one string, refused once',
      code: "export const className = 'ml-2 mr-2';",
      filename: styles,
      errors: 1,
    },
    {
      name: 'a physical React Native style key',
      code: 'export const styles = { marginLeft: 8 };',
      filename: styles,
      errors: [{ messageId: 'styleKey', data: { key: 'marginLeft', logical: 'marginStart' } }],
    },
    {
      name: 'the other physical style keys, including a quoted one',
      code: "export const styles = { paddingRight: 4, left: 0, borderLeftWidth: 1, 'borderTopRightRadius': 4 };",
      filename: styles,
      errors: [
        { messageId: 'styleKey', data: { key: 'paddingRight', logical: 'paddingEnd' } },
        { messageId: 'styleKey', data: { key: 'left', logical: 'start' } },
        { messageId: 'styleKey', data: { key: 'borderLeftWidth', logical: 'borderStartWidth' } },
        {
          messageId: 'styleKey',
          data: { key: 'borderTopRightRadius', logical: 'borderTopEndRadius' },
        },
      ],
    },
    {
      name: 'a textAlign naming a side',
      code: "export const a = { textAlign: 'left' };\nexport const b = { textAlign: 'right' };",
      filename: styles,
      errors: [
        { messageId: 'textAlign', data: { value: 'left', logical: 'start' } },
        { messageId: 'textAlign', data: { value: 'right', logical: 'end' } },
      ],
    },
  ],
});
