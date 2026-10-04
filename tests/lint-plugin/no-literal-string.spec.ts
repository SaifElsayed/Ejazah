// mobile/no-literal-string (R-MOBILE-7) against a table of code (T038).
//
// The fixture proves text written between two tags. This table proves the ways the same sentence
// reaches the screen without sitting between tags as text — an arm of a conditional, the fallback
// of `||` and `??`, a template literal, a joined array, a user-visible prop — and the strings a
// view legitimately carries: class names, test ids, punctuation, numbers.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const feature = 'apps/mobile/src/features/student/empty-state.tsx';

typescriptRuleTester().run('mobile/no-literal-string', loadRule('no-literal-string.js'), {
  valid: [
    {
      name: 'a translation key',
      code: "export const V = () => <Text>{t('student.empty.title')}</Text>;",
      filename: feature,
    },
    {
      name: 'a value',
      code: 'export const V = (p: { label: string }) => <Text>{p.label}</Text>;',
      filename: feature,
    },
    {
      name: 'props that carry identifiers, not prose',
      code: 'export const V = () => <Text className="text-start" testID="empty-state" key="row" nativeID="x" />;',
      filename: feature,
    },
    {
      name: 'punctuation and numbers have no letter',
      code: "export const V = () => <Text>{count} — {'12'} / {total}: {`${a} · ${b}`}</Text>;",
      filename: feature,
    },
    {
      name: 'a translated prop',
      code: "export const V = () => <Field placeholder={t('search.placeholder')} />;",
      filename: feature,
    },
    {
      name: 'a translated fallback',
      code: "export const V = () => <Text>{name ?? t('student.anonymous')}</Text>;",
      filename: feature,
    },
    {
      name: 'a string outside any text position',
      code: 'export const event = \'booking_confirmed\';\nexport const V = () => <Row variant="dense" />;',
      filename: feature,
    },
    {
      name: 'the argument of a call is a key, not text',
      code: "export const V = () => <Text>{format('student.empty.title')}</Text>;",
      filename: feature,
    },
    {
      name: 'a test file renders to no user',
      code: 'export const V = () => <Text>No teachers yet.</Text>;',
      filename: 'apps/mobile/src/features/student/empty-state.spec.tsx',
    },
    {
      name: 'a test file by its other name, and a __tests__ folder',
      code: 'export const V = () => <Text>No teachers yet.</Text>;',
      filename: 'apps/mobile/src/features/student/__tests__/empty-state.tsx',
    },
    {
      name: 'the Admin panel is English-only by decision',
      code: 'export const V = () => <h1>Verification queue</h1>;',
      filename: 'apps/admin/src/queue.tsx',
    },
  ],
  invalid: [
    {
      name: 'the fixture: text between tags',
      code: 'export const V = () => <Text>No teachers match your filters yet.</Text>;',
      filename: feature,
      errors: [{ messageId: 'literalText', data: { text: 'No teachers match your filters yet.' } }],
    },
    {
      name: 'Arabic text',
      code: 'export const V = () => <Text>لا يوجد معلمون</Text>;',
      filename: feature,
      errors: 1,
    },
    {
      name: 'a literal in an expression',
      code: "export const V = () => <Text>{'No teachers yet.'}</Text>;",
      filename: feature,
      errors: 1,
    },
    {
      name: 'both arms of a conditional',
      code: "export const V = (p: { ok: boolean }) => <Text>{p.ok ? 'Yes' : 'No'}</Text>;",
      filename: feature,
      errors: [
        { messageId: 'literalText', data: { text: 'Yes' } },
        { messageId: 'literalText', data: { text: 'No' } },
      ],
    },
    {
      name: 'a fallback after ||',
      code: "export const V = () => <Text>{t('x') || 'Fallback'}</Text>;",
      filename: feature,
      errors: [{ messageId: 'literalText', data: { text: 'Fallback' } }],
    },
    {
      name: 'a fallback after ??',
      code: "export const V = (p: { name?: string }) => <Text>{p.name ?? 'Anonymous'}</Text>;",
      filename: feature,
      errors: 1,
    },
    {
      name: 'a guarded literal after &&',
      code: "export const V = (p: { late: boolean }) => <Text>{p.late && 'Late'}</Text>;",
      filename: feature,
      errors: 1,
    },
    {
      name: 'a template literal whose text carries a letter',
      code: 'export const V = (p: { name: string }) => <Text>{`Hello ${p.name}`}</Text>;',
      filename: feature,
      errors: 1,
    },
    {
      name: 'an operand of +',
      code: "export const V = (p: { name: string }) => <Text>{'Hello ' + p.name}</Text>;",
      filename: feature,
      errors: 1,
    },
    {
      name: 'the elements of a joined array',
      code: "export const V = () => <Text>{['Mon', 'Tue'].join(', ')}</Text>;",
      filename: feature,
      errors: 2,
    },
    {
      name: 'a literal behind a const assertion and a non-null assertion',
      code: "export const V = () => <Text>{('Saved' as const)!}</Text>;",
      filename: feature,
      errors: 1,
    },
    {
      name: 'a nested conditional',
      code: "export const V = (a: boolean, b: boolean) => <Text>{a ? (b ? 'One' : t('k')) : 'Three'}</Text>;",
      filename: feature,
      errors: 2,
    },
    {
      name: 'a user-visible prop as a string',
      code: 'export const V = () => <Field placeholder="Search teachers" />;',
      filename: feature,
      errors: [
        { messageId: 'literalProp', data: { text: 'Search teachers', prop: 'placeholder' } },
      ],
    },
    {
      name: 'a user-visible prop as an expression with a fallback',
      code: "export const V = () => <Button title={t('save') || 'Save'} />;",
      filename: feature,
      errors: [{ messageId: 'literalProp', data: { text: 'Save', prop: 'title' } }],
    },
    {
      name: 'accessibility props are read aloud',
      code: 'export const V = () => <Icon accessibilityLabel="Back" aria-label="Back" />;',
      filename: feature,
      errors: 2,
    },
    {
      name: 'a fragment child',
      code: 'export const V = () => <>Loading</>;',
      filename: feature,
      errors: 1,
    },
    {
      name: 'a primitive under design/ shows its label to the same user',
      code: 'export const V = () => <Text>Retry</Text>;',
      filename: 'apps/mobile/src/design/primitives/retry.tsx',
      errors: 1,
    },
    {
      name: 'a long sentence is quoted short',
      code: 'export const V = () => <Text>This sentence is much longer than the forty characters a message quotes.</Text>;',
      filename: feature,
      errors: [
        { messageId: 'literalText', data: { text: 'This sentence is much longer than the fo…' } },
      ],
    },
  ],
});
