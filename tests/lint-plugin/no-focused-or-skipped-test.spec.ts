// proc/no-focused-or-skipped-test (R-PROC-10) against a table of code (T041).
//
// The two fixtures prove `.only` and `.skip` on `it` in a `*.spec.ts` file. This table proves the
// rest of the decision: the mark is read anywhere in a chain rooted at a test function, so
// `test.concurrent.only` and `it.skip.each` are the same two marks written longer, the Jasmine
// aliases `fit`, `xit` and `xdescribe` are the same marks written shorter, and the file is a test
// file by its basename or by sitting under `tests/`, never by a root-anchored path. The valid
// table holds the deliberate gaps: `it.todo` declares a probe the runner reports as pending, the
// `skipIf` and `runIf` gates are the honest spelling of "cannot run here", a `skip` on a receiver
// that is not a test function is a list method, and a service file has no test to focus.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const reviews = 'apps/api/src/modules/reviews/reviews.service.spec.ts';
const notifications = 'apps/api/src/modules/notifications/notifications.service.spec.ts';
const probe = 'tests/db-integrity/phase-two.spec.ts';
const service = 'apps/api/src/modules/booking/booking.service.ts';

typescriptRuleTester().run(
  'proc/no-focused-or-skipped-test',
  loadRule('no-focused-or-skipped-test.js'),
  {
    valid: [
      {
        name: 'a plain case and a plain suite',
        code: "describe('review summary', () => {\n  it('counts only published reviews', () => {});\n});",
        filename: reviews,
      },
      {
        name: 'a todo, which the runner reports as pending and not as green',
        code: "it.todo('rejects a session whose slot was released');",
        filename: probe,
      },
      {
        name: 'a suite gated on its environment with skipIf',
        code: "describe.skipIf(process.env.DATABASE_URL === undefined)('db integrity', () => {});",
        filename: probe,
      },
      {
        name: 'a case gated on its environment with runIf',
        code: "it.runIf(process.env.DATABASE_URL !== undefined)('reads the schema', () => {});",
        filename: probe,
      },
      {
        name: 'a skip on a receiver that is not a test function',
        code: 'export const rest = (list: { skip(n: number): unknown }) => list.skip(1);',
        filename: reviews,
      },
      {
        name: 'a concurrent case, which is a mode and not a mark',
        code: "it.concurrent('counts in parallel', () => {});",
        filename: reviews,
      },
      {
        name: 'a table-driven case without a mark',
        code: "it.each([1, 2])('counts %i', () => {});",
        filename: reviews,
      },
      {
        name: 'a service file, which has no test to focus',
        code: "declare const it: { only(name: string, run: () => void): void };\nit.only('counts', () => {});",
        filename: service,
      },
    ],
    invalid: [
      {
        name: 'the canonical focused case',
        code: "describe('review summary', () => {\n  it.only('counts only published reviews', () => {});\n});",
        filename: reviews,
        errors: [{ messageId: 'focused', data: { spelling: 'it.only' } }],
      },
      {
        name: 'the canonical skipped case',
        code: "describe('notification summary', () => {\n  it.skip('counts only unread notifications', () => {});\n});",
        filename: notifications,
        errors: [{ messageId: 'skipped', data: { spelling: 'it.skip' } }],
      },
      {
        name: 'a skipped suite',
        code: "describe.skip('review summary', () => {});",
        filename: reviews,
        errors: [{ messageId: 'skipped', data: { spelling: 'describe.skip' } }],
      },
      {
        name: 'a focus at the end of a longer chain',
        code: "test.concurrent.only('counts', () => {});",
        filename: reviews,
        errors: [{ messageId: 'focused', data: { spelling: 'test.only' } }],
      },
      {
        name: 'a skip in the middle of a longer chain',
        code: "it.skip.each([1, 2])('counts %i', () => {});",
        filename: reviews,
        errors: [{ messageId: 'skipped', data: { spelling: 'it.skip' } }],
      },
      {
        name: 'a skipped sequential suite',
        code: "describe.sequential.skip('review summary', () => {});",
        filename: reviews,
        errors: [{ messageId: 'skipped', data: { spelling: 'describe.skip' } }],
      },
      {
        name: 'a focused benchmark',
        code: "bench.only('counts', () => {});",
        filename: reviews,
        errors: [{ messageId: 'focused', data: { spelling: 'bench.only' } }],
      },
      {
        name: 'the mark written as a computed member',
        code: "it['only']('counts', () => {});",
        filename: reviews,
        errors: [{ messageId: 'focused', data: { spelling: 'it.only' } }],
      },
      {
        name: 'the Jasmine-style focused alias',
        code: "fit('counts', () => {});",
        filename: reviews,
        errors: [{ messageId: 'focused', data: { spelling: 'fit' } }],
      },
      {
        name: 'the Jasmine-style skipped alias',
        code: "xit('counts', () => {});",
        filename: reviews,
        errors: [{ messageId: 'skipped', data: { spelling: 'xit' } }],
      },
      {
        name: 'the Jasmine-style skipped suite alias',
        code: "xdescribe('review summary', () => {});",
        filename: reviews,
        errors: [{ messageId: 'skipped', data: { spelling: 'xdescribe' } }],
      },
      {
        name: 'a *.test.ts basename',
        code: "it.only('counts', () => {});",
        filename: 'apps/mobile/src/features/student/screens/checkout.test.tsx',
        errors: [{ messageId: 'focused', data: { spelling: 'it.only' } }],
      },
      {
        name: 'a file under tests/ without a test suffix',
        code: "it.skip('counts', () => {});",
        filename: 'tests/support/shared-cases.ts',
        errors: [{ messageId: 'skipped', data: { spelling: 'it.skip' } }],
      },
      {
        name: 'a focus and a skip in one file, each reported',
        code: "describe.skip('a', () => {});\nit.only('b', () => {});",
        filename: reviews,
        errors: 2,
      },
    ],
  },
);
