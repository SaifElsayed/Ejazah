// api/require-escape-hatch-reason (R-API-10) against a table of code (T041).
//
// The two fixtures prove one `as any` and one `@ts-ignore`, each with no comment at all. What
// they cannot prove is the shape of a comment that satisfies the rule, and that shape is a
// decision recorded in `packages/config/eslint-plugin-ijazah/justification.js`: a ticket (a Spec
// Kit task, a Jira-style key, a GitHub number) and at least two words of reason, in one comment
// on the hatch's own line or the line immediately above it. So this table holds the rule to that
// decision from both sides. A ticket alone is refused, a reason alone is refused, a constitution
// id is not a ticket, and a justification two lines up past unrelated code justifies something
// else. `unknown` is the honest type and is never read as a hatch, which the valid table proves so
// the double cast through it stays a review matter rather than a lint failure.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const service = 'apps/api/src/modules/notifications/payload-cast.ts';
const moderation = 'apps/api/src/modules/moderation/report-count.ts';
const spec = 'tests/ports/push.spec.ts';

typescriptRuleTester().run(
  'api/require-escape-hatch-reason',
  loadRule('require-escape-hatch-reason.js'),
  {
    valid: [
      {
        name: 'unknown, the honest type, and a double cast through it',
        code: 'export function parse(input: unknown): string {\n  return input as unknown as string;\n}',
        filename: service,
      },
      {
        name: 'a cast justified on the line above',
        code: '// gateway payloads are untyped until FR-074 lands, IJZ-231\nexport const toPayload = (input: unknown) => input as any;',
        filename: service,
      },
      {
        name: 'a cast justified on its own line, after the code',
        code: 'export const toPayload = (input: unknown) => input as any; // vendor payload is untyped, T041',
        filename: service,
      },
      {
        name: 'two hatches on one line sharing the line’s justification',
        code: '// the gateway callback is untyped, #12\nexport const echo = (input: any): any => input;',
        filename: service,
      },
      {
        name: 'a compiler suppression with the reason in the same comment',
        code: "// @ts-ignore the vendor typings omit the callback, IJZ-231\nexport const openReportCount: number = 'many';",
        filename: moderation,
      },
      {
        name: 'an expected error with the reason on the line above',
        code: "// the vendor typings omit the callback, T041\n// @ts-expect-error\nexport const openReportCount: number = 'many';",
        filename: moderation,
      },
      {
        name: 'a whole-file suppression with the reason in the same comment',
        code: '// @ts-nocheck generated vendor stubs are unchecked until FR-074 lands\nexport const stub = 1;',
        filename: moderation,
      },
      {
        name: 'a justified hatch in a test, which is read like any other file',
        code: '// reaching a private to assert the retry count, T042\nexport const inner = (port: unknown) => port as any;',
        filename: spec,
      },
    ],
    invalid: [
      {
        name: 'the canonical cast with no comment at all',
        code: 'export function toNotificationPayload(input: unknown): Record<string, unknown> {\n  return input as any;\n}',
        filename: service,
        errors: [{ messageId: 'anyWithoutReason' }],
      },
      {
        name: 'an annotation on a parameter',
        code: 'export function send(payload: any): void {\n  void payload;\n}',
        filename: service,
        errors: [{ messageId: 'anyWithoutReason' }],
      },
      {
        name: 'a type argument',
        code: 'export const payloads: Array<any> = [];',
        filename: service,
        errors: [{ messageId: 'anyWithoutReason' }],
      },
      {
        name: 'a return type',
        code: 'export function read(): any {\n  return null;\n}',
        filename: service,
        errors: [{ messageId: 'anyWithoutReason' }],
      },
      {
        name: 'an angle-bracket cast',
        code: 'export const toPayload = (input: unknown) => <any>input;',
        filename: service,
        errors: [{ messageId: 'anyWithoutReason' }],
      },
      {
        name: 'a generic default',
        code: 'export type Handler<T = any> = (input: T) => void;',
        filename: service,
        errors: [{ messageId: 'anyWithoutReason' }],
      },
      {
        name: 'a ticket alone, which says where the debt is recorded and nothing about why',
        code: '// T041\nexport const toPayload = (input: unknown) => input as any;',
        filename: service,
        errors: [{ messageId: 'anyWithoutReason' }],
      },
      {
        name: 'a reason alone, with no ticket',
        code: '// gateway payloads are untyped\nexport const toPayload = (input: unknown) => input as any;',
        filename: service,
        errors: [{ messageId: 'anyWithoutReason' }],
      },
      {
        name: 'a constitution id, which names the prohibition and not the debt record',
        code: '// R-API-10 gateway payloads are untyped\nexport const toPayload = (input: unknown) => input as any;',
        filename: service,
        errors: [{ messageId: 'anyWithoutReason' }],
      },
      {
        name: 'a justification two lines up, past unrelated code',
        code: '// gateway payloads are untyped until FR-074 lands, IJZ-231\nexport const gap = 1;\nexport const toPayload = (input: unknown) => input as any;',
        filename: service,
        errors: [{ messageId: 'anyWithoutReason' }],
      },
      {
        name: 'the canonical @ts-ignore with no comment at all',
        code: "// @ts-ignore\nexport const openReportCount: number = 'many';",
        filename: moderation,
        errors: [{ messageId: 'directiveWithoutReason', data: { directive: 'ignore' } }],
      },
      {
        name: 'a bare @ts-expect-error',
        code: "// @ts-expect-error\nexport const openReportCount: number = 'many';",
        filename: moderation,
        errors: [{ messageId: 'directiveWithoutReason', data: { directive: 'expect-error' } }],
      },
      {
        name: 'a bare @ts-nocheck',
        code: '// @ts-nocheck\nexport const stub = 1;',
        filename: moderation,
        errors: [{ messageId: 'directiveWithoutReason', data: { directive: 'nocheck' } }],
      },
      {
        name: 'a @ts-ignore carrying a ticket and no reason',
        code: "// @ts-ignore T041\nexport const openReportCount: number = 'many';",
        filename: moderation,
        errors: [{ messageId: 'directiveWithoutReason', data: { directive: 'ignore' } }],
      },
      {
        name: 'a @ts-ignore whose only words are a rule id and a path',
        code: "// @ts-ignore ijazah/db/no-weak-random apps/api/src IJZ-231\nexport const openReportCount: number = 'many';",
        filename: moderation,
        errors: [{ messageId: 'directiveWithoutReason', data: { directive: 'ignore' } }],
      },
    ],
  },
);
