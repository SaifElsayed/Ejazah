// mobile/no-literal-string (R-MOBILE-7) against a table of code (T038).
//
// A literal in a view ships untranslatable text to every user. The fixture proves JSX text between
// tags; this table proves the other two text positions the header names — a string or
// expression-free template written as a child in braces, and the attributes a user reads or hears
// (`placeholder`, `accessibilityLabel`, `aria-label`, `headerTitle`, …) whether written as a
// string or in braces — plus an Arabic literal, which is hardcoded in exactly the same way, and a
// primitive in `design/`, since the constitution names no exempt folder. The legal side proves
// what the header deliberately leaves alone: `t()` in a child or an attribute, whitespace-only JSX
// text, a string with no letter in any script (`·`, `12:00`, `%`), a template with a computed
// part, and the machine-read attributes `testID`, `className`, `key` and `name`.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const screen = 'apps/mobile/src/features/student/empty-state.tsx';
const support =
  "import { Text, Field } from '../../design/primitives';\nimport { t } from '../../i18n';";

typescriptRuleTester().run('mobile/no-literal-string', loadRule('no-literal-string.js'), {
  valid: [
    {
      name: 'the translated text the fixture should have rendered',
      code: `${support}\nexport function EmptyState(): unknown {\n  return <Text>{t('student.home.empty')}</Text>;\n}`,
      filename: screen,
    },
    {
      name: 'a translated attribute',
      code: `${support}\nexport const Search = () => <Field placeholder={t('student.search.placeholder')} />;`,
      filename: screen,
    },
    {
      name: 'whitespace-only JSX text, which is layout',
      code: `${support}\nexport const Two = () => (\n  <Text>\n    <Text>{t('a')}</Text>{' '}\n    <Text>{t('b')}</Text>\n  </Text>\n);`,
      filename: screen,
    },
    {
      name: 'punctuation and numbers, which carry no letter in any script',
      code: `${support}\nexport const Meta = () => (\n  <Text>\n    <Text>·</Text>\n    <Text>{'—'}</Text>\n    <Text>12:00</Text>\n    <Text>%</Text>\n    <Text>{\`/\`}</Text>\n  </Text>\n);`,
      filename: screen,
    },
    {
      name: 'a template with a computed part, which is not a literal',
      code: `${support}\nexport const Count = (props: { readonly count: number }) => <Text>{\`\${props.count}\`}</Text>;`,
      filename: screen,
    },
    {
      name: 'attributes read by a machine',
      code: `${support}\nexport const Home = () => (\n  <Field testID="home-search" className="flex-1" key="search" name="query" />\n);`,
      filename: screen,
    },
    {
      name: 'an attribute holding a variable',
      code: `${support}\nexport const Close = (props: { readonly label: string }) => (\n  <Field accessibilityLabel={props.label} />\n);`,
      filename: screen,
    },
    {
      name: 'a string outside any text position',
      code: "export const key = 'student.home.empty';\nexport const title = 'No teachers yet.';",
      filename: 'apps/mobile/src/features/student/keys.ts',
    },
    {
      name: 'a file outside apps/mobile',
      code: 'export const Empty = () => <p title="No teachers yet.">No teachers yet.</p>;',
      filename: 'apps/admin/src/pages/empty.tsx',
    },
  ],
  invalid: [
    {
      name: 'the canonical JSX text between tags',
      code: `${support}\nexport function EmptyState(): unknown {\n  return <Text>No teachers match your filters yet.</Text>;\n}`,
      filename: screen,
      errors: [{ messageId: 'text', data: { text: 'No teachers match your filters yet.' } }],
    },
    {
      name: 'a string child in braces',
      code: `${support}\nexport const Empty = () => <Text>{'No teachers yet.'}</Text>;`,
      filename: screen,
      errors: [{ messageId: 'text', data: { text: 'No teachers yet.' } }],
    },
    {
      name: 'an expression-free template child in braces',
      code: `${support}\nexport const Empty = () => <Text>{\`No teachers yet.\`}</Text>;`,
      filename: screen,
      errors: [{ messageId: 'text', data: { text: 'No teachers yet.' } }],
    },
    {
      name: 'JSX text across lines, quoted trimmed',
      code: `${support}\nexport const Empty = () => (\n  <Text>\n    No teachers\n    yet.\n  </Text>\n);`,
      filename: screen,
      errors: [{ messageId: 'text', data: { text: 'No teachers yet.' } }],
    },
    {
      name: 'an Arabic literal, hardcoded in exactly the same way',
      code: `${support}\nexport const Empty = () => <Text>لا يوجد معلمون بعد</Text>;`,
      filename: screen,
      errors: [{ messageId: 'text', data: { text: 'لا يوجد معلمون بعد' } }],
    },
    {
      name: 'a number with a unit word',
      code: `${support}\nexport const Count = () => <Text>12 lessons</Text>;`,
      filename: screen,
      errors: [{ messageId: 'text', data: { text: '12 lessons' } }],
    },
    {
      name: 'a child of a fragment',
      code: `${support}\nexport const Empty = () => <>{'No teachers yet.'}</>;`,
      filename: screen,
      errors: [{ messageId: 'text', data: { text: 'No teachers yet.' } }],
    },
    {
      name: 'a placeholder attribute',
      code: `${support}\nexport const Search = () => <Field placeholder="Search teachers" />;`,
      filename: screen,
      errors: [
        { messageId: 'attribute', data: { text: 'Search teachers', attribute: 'placeholder' } },
      ],
    },
    {
      name: 'a placeholder attribute written in braces',
      code: `${support}\nexport const Search = () => <Field placeholder={'Search teachers'} />;`,
      filename: screen,
      errors: [
        { messageId: 'attribute', data: { text: 'Search teachers', attribute: 'placeholder' } },
      ],
    },
    {
      name: 'the attributes a user hears',
      code: `${support}\nexport const Close = () => <Field accessibilityLabel="Close" accessibilityHint="Closes the sheet" aria-label="Close" />;`,
      filename: screen,
      errors: [
        { messageId: 'attribute', data: { text: 'Close', attribute: 'accessibilityLabel' } },
        {
          messageId: 'attribute',
          data: { text: 'Closes the sheet', attribute: 'accessibilityHint' },
        },
        { messageId: 'attribute', data: { text: 'Close', attribute: 'aria-label' } },
      ],
    },
    {
      name: 'the navigation and form attributes',
      code: `${support}\nexport const Screen = () => (\n  <Field title="Home" headerTitle="Home" tabBarLabel="Home" label="Name" helperText="Required" errorMessage="Too short" />\n);`,
      filename: screen,
      errors: 6,
    },
    {
      name: 'a long text, quoted to forty characters',
      code: `${support}\nexport const Empty = () => <Text>No teachers match the filters you have chosen so far.</Text>;`,
      filename: screen,
      errors: [{ messageId: 'text', data: { text: 'No teachers match the filters you hav...' } }],
    },
    {
      name: 'a primitive in design/, which the constitution does not exempt',
      code: 'import { TextInput } from \'react-native\';\nexport const Field = () => <TextInput placeholder="Search" />;',
      filename: 'apps/mobile/src/design/primitives/field.tsx',
      errors: [{ messageId: 'attribute', data: { text: 'Search', attribute: 'placeholder' } }],
    },
    {
      name: 'a route file under app/',
      code: "import { Text } from 'react-native';\nexport default function Layout(): unknown {\n  return <Text>Home</Text>;\n}",
      filename: 'apps/mobile/src/app/(student)/_layout.tsx',
      errors: 1,
    },
  ],
});
