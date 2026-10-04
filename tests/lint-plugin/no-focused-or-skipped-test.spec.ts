// proc/no-focused-or-skipped-test (R-PROC-10) against a table of code (T041).
//
// The two fixtures prove the focused mark and the skipped mark, each directly on the entry point.
// This table proves the mark further along a chain, the options form Vitest also accepts, and the
// three neighbours that stay legal: a placeholder case, a condition on the environment, and a
// method of the same name on something that is not a test.
//
// The marks are written as constants so this file, which `pnpm lint` reads with the very rule it
// tests, carries none of its own.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const spec = 'apps/api/src/modules/reviews/reviews.service.spec.ts';

const ONLY = 'only';
const SKIP = 'skip';

typescriptRuleTester().run(
  'proc/no-focused-or-skipped-test',
  loadRule('no-focused-or-skipped-test.js'),
  {
    valid: [
      {
        name: 'plain cases',
        code: "describe('reviews', () => { it('counts', () => {}); test('counts again', () => {}); });",
        filename: spec,
      },
      {
        name: 'a placeholder case naming its task',
        code: "it.todo('T096: a repeated operation returns the first outcome');",
        filename: spec,
      },
      {
        name: 'a condition on the environment',
        code: "it.skipIf(!process.env.DATABASE_URL)('reads a row', () => {});\nit.runIf(hasDocker)('probes', () => {});",
        filename: spec,
      },
      {
        name: 'other modifiers',
        code: "it.concurrent('a', () => {});\nit.each([1, 2])('b %i', () => {});\ndescribe.sequential('c', () => {});\nit.fails('d', () => {});",
        filename: spec,
      },
      {
        name: 'the options form switched off',
        code: `it('a', { ${SKIP}: false, timeout: 100 }, () => {});`,
        filename: spec,
      },
      {
        name: 'a method of the same name on something that is not a test',
        code: `stream.${SKIP}(2);\nparser.${ONLY}('digits');\nqueue.${SKIP}?.();`,
        filename: spec,
      },
      {
        name: 'a property of the same name on something else',
        code: `export const options = { ${SKIP}: true, ${ONLY}: 'admins' };`,
        filename: spec,
      },
      {
        name: 'an options object given to something that is not a test',
        code: `paginate('reviews', { ${SKIP}: 20 });`,
        filename: spec,
      },
    ],
    invalid: [
      {
        name: 'the fixture: a focused case',
        code: `it.${ONLY}('counts only published reviews', () => {});`,
        filename: spec,
        errors: [{ messageId: 'marked', data: { api: 'it', mark: ONLY, state: 'focused' } }],
      },
      {
        name: 'the fixture: a skipped case',
        code: `it.${SKIP}('counts only unread notifications', () => {});`,
        filename: spec,
        errors: [{ messageId: 'marked', data: { api: 'it', mark: SKIP, state: 'skipped' } }],
      },
      {
        name: 'every entry point',
        code: `test.${ONLY}('a', () => {});\ndescribe.${SKIP}('b', () => {});\nsuite.${ONLY}('c', () => {});\nbench.${SKIP}('d', () => {});`,
        filename: spec,
        errors: [
          { messageId: 'marked', data: { api: 'test', mark: ONLY, state: 'focused' } },
          { messageId: 'marked', data: { api: 'describe', mark: SKIP, state: 'skipped' } },
          { messageId: 'marked', data: { api: 'suite', mark: ONLY, state: 'focused' } },
          { messageId: 'marked', data: { api: 'bench', mark: SKIP, state: 'skipped' } },
        ],
      },
      {
        name: 'the mark after another modifier',
        code: `it.concurrent.${ONLY}('a', () => {});\ndescribe.sequential.${SKIP}('b', () => {});`,
        filename: spec,
        errors: 2,
      },
      {
        name: 'the mark before another modifier',
        code: `it.${SKIP}.each([1, 2])('a %i', () => {});\ntest.${ONLY}.concurrent('b', () => {});`,
        filename: spec,
        errors: 2,
      },
      {
        name: 'the mark after a call in the chain',
        code: `it.each([1, 2]).${ONLY}('a %i', () => {});`,
        filename: spec,
        errors: 1,
      },
      {
        name: 'a computed name',
        code: `it['${ONLY}']('a', () => {});\nit[\`${SKIP}\`]('b', () => {});`,
        filename: spec,
        errors: 2,
      },
      {
        name: 'optional chaining and a cast',
        code: `it?.${ONLY}('a', () => {});\n(it as any).${SKIP}('b', () => {});\nit!.${ONLY}('c', () => {});`,
        filename: spec,
        errors: 3,
      },
      {
        name: 'the mark taken without being called',
        code: `export const focused = it.${ONLY};`,
        filename: spec,
        errors: 1,
      },
      {
        name: 'the options form',
        code: `it('a', { ${SKIP}: true }, () => {});\ntest('b', { ${ONLY}: flag }, () => {});\ndescribe('c', () => {}, { '${SKIP}': 1 });`,
        filename: spec,
        errors: 3,
      },
      {
        name: 'the options form on a modified entry point',
        code: `it.concurrent('a', { ${SKIP}: true }, () => {});`,
        filename: spec,
        errors: 1,
      },
      {
        name: 'a helper outside a spec file',
        code: `export const pending = (name: string) => it.${SKIP}(name, () => {});`,
        filename: 'tests/support/pending.ts',
        errors: 1,
      },
    ],
  },
);
