// api/require-escape-hatch-reason (R-API-10) against a table of code (T041).
//
// The two fixtures prove a bare `as any` and a bare compiler directive. This table proves the
// syntax T041 decided for a justification — a ticket plus two words of reason — by the things
// that are nearly one and are not: a rule id standing where the ticket should be, a multi-segment
// requirement id, one word of reason, and a comment that trails the line above.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const file = 'apps/api/src/modules/notifications/payload-cast.ts';

typescriptRuleTester().run(
  'api/require-escape-hatch-reason',
  loadRule('require-escape-hatch-reason.js'),
  {
    valid: [
      {
        name: 'a task id and a reason on the line above',
        code: '// T119: the push port has no payload type until that task lands\nexport const p = input as any;',
        filename: file,
      },
      {
        name: 'a trailing comment on the same line',
        code: 'export const p = input as any; // T119 the port type lands there',
        filename: file,
      },
      {
        name: 'a GitHub reference',
        code: '// #123 upstream types are wrong here\nexport const p: any = input;',
        filename: file,
      },
      {
        name: 'a tracker key',
        code: '// SCRUM-51 vendor typings are missing\nexport const p: any = input;',
        filename: file,
      },
      {
        name: 'another tracker key shape',
        code: '// IJZ-231: vendor typings are missing\nexport const p: any = input;',
        filename: file,
      },
      {
        name: 'a task range',
        code: '// T044-T047 replace this with the branded type\nexport const p: any = input;',
        filename: file,
      },
      {
        name: 'a block comment above',
        code: '/* T119 the port type lands there */\nexport const p: any = input;',
        filename: file,
      },
      {
        name: 'several stand-alone comment lines directly above, the ticket on the first',
        code: '// T119: the push port has no payload type yet,\n// so the cast stays until it does.\nexport const p = input as any;',
        filename: file,
      },
      {
        name: 'a ticket beside a requirement id',
        code: '// T030/FR-012: the brand is asserted against any on purpose\nexport type A = any;',
        filename: file,
      },
      {
        name: 'a justified @ts-expect-error, as packages/money writes it',
        code: '// @ts-expect-error T030/FR-012: a plain number is not assignable to Piasters.\nexport const p: string = 1;',
        filename: file,
      },
      {
        name: 'a justified @ts-ignore in a block comment',
        code: '/* @ts-ignore T119 the port type lands there */\nexport const p: string = 1;',
        filename: file,
      },
      {
        name: 'a justified @ts-nocheck',
        code: '// @ts-nocheck T084 generated snapshot, checked by its generator\nexport const p = 1;',
        filename: file,
      },
      {
        name: 'unknown is not an escape hatch',
        code: 'export const p = (input: unknown) => input as unknown as string;',
        filename: file,
      },
      {
        name: 'the word in prose and in a name',
        code: '// any value is accepted here\nexport const anyOf = (values: readonly string[]) => values[0];',
        filename: file,
      },
      {
        name: 'a comment that merely mentions a directive',
        code: '// see how `@ts-ignore` is refused below\nexport const p = 1;',
        filename: file,
      },
      {
        name: '@ts-check suppresses nothing',
        code: '// @ts-check\nexport const p = 1;',
        filename: 'scripts/x.js',
      },
    ],
    invalid: [
      {
        name: 'the fixture: a bare cast',
        code: 'export function toPayload(input: unknown): Record<string, unknown> {\n  return input as any;\n}',
        filename: file,
        errors: [{ messageId: 'unjustifiedAny', line: 2 }],
      },
      {
        name: 'the fixture: a bare @ts-ignore',
        code: "// @ts-ignore\nexport const openReportCount: number = 'many';",
        filename: 'apps/api/src/modules/moderation/report-count.ts',
        errors: [{ messageId: 'unjustifiedDirective', data: { name: '@ts-ignore' }, line: 1 }],
      },
      {
        name: 'every position any is written in',
        code: 'export const a: any = 1;\nexport const b = <any>a;\nexport const c: Array<any> = [];\nexport const d: Record<string, any> = {};\nexport function e(x: any): any { return x; }\nexport type F<T = any> = T;',
        filename: file,
        errors: 7,
      },
      {
        name: 'a reason with no ticket',
        code: '// the port has no payload type yet\nexport const p = input as any;',
        filename: file,
        errors: 1,
      },
      {
        name: 'a ticket with no reason',
        code: '// T119\nexport const p = input as any;',
        filename: file,
        errors: 1,
      },
      {
        name: 'a ticket with one word of reason',
        code: '// T119 temporary\nexport const p = input as any;',
        filename: file,
        errors: 1,
      },
      {
        name: 'a constitution rule id is not a ticket',
        code: '// R-API-10 allows this cast here\nexport const p = input as any;',
        filename: file,
        errors: 1,
      },
      {
        name: 'requirement, criterion, decision and open-item ids are not tickets',
        code: [
          '// FR-012 needs this cast here',
          'export const a = input as any;',
          '// NFR-SEC-2 needs this cast here',
          'export const b = input as any;',
          '// SC-003 needs this cast here',
          'export const c = input as any;',
          '// ADR-0007 needs this cast here',
          'export const d = input as any;',
          '// OPEN-11 needs this cast here',
          'export const e = input as any;',
          '// DEC-48 needs this cast here',
          'export const f = input as any;',
        ].join('\n'),
        filename: file,
        errors: 6,
      },
      {
        name: 'a multi-segment requirement id does not fall apart into a ticket',
        code: '// FR-NOTIF-4 says delivery is queued\nexport const p = input as any;',
        filename: file,
        errors: 1,
      },
      {
        name: 'a standards name is not a ticket',
        code: '// UTF-8 bytes arrive untyped here\nexport const p = input as any;',
        filename: file,
        errors: 1,
      },
      {
        name: 'a comment that trails the line above justifies that line only',
        code: 'export const a = 1; // T119 the port type lands there\nexport const p = input as any;',
        filename: file,
        errors: [{ messageId: 'unjustifiedAny', line: 2 }],
      },
      {
        name: 'a blank line separates the comment from the cast',
        code: '// T119 the port type lands there\n\nexport const p = input as any;',
        filename: file,
        errors: 1,
      },
      {
        name: 'code between the comment and the cast',
        code: '// T119 the port type lands there\nexport const a = 1;\nexport const p = input as any;',
        filename: file,
        errors: 1,
      },
      {
        name: 'a justification on the first line does not cover a later line of the statement',
        code: '// T119 the port type lands there\nexport const p = {\n  a: 1,\n  b: input as any,\n};',
        filename: file,
        errors: [{ messageId: 'unjustifiedAny', line: 4 }],
      },
      {
        name: 'a bare @ts-expect-error',
        code: '// @ts-expect-error\nexport const p: string = 1;',
        filename: file,
        errors: [{ messageId: 'unjustifiedDirective', data: { name: '@ts-expect-error' } }],
      },
      {
        name: 'a bare @ts-nocheck',
        code: '// @ts-nocheck\nexport const p = 1;',
        filename: file,
        errors: [{ messageId: 'unjustifiedDirective', data: { name: '@ts-nocheck' } }],
      },
      {
        name: 'a directive in a block comment, and one after three slashes',
        code: '/* @ts-ignore */\nexport const a: string = 1;\n/// @ts-ignore\nexport const b: string = 2;',
        filename: file,
        errors: 2,
      },
      {
        name: 'a directive whose description cites only a rule',
        code: '// @ts-ignore R-API-10 says a reason is needed\nexport const p: string = 1;',
        filename: file,
        errors: 1,
      },
      {
        name: 'a directive justified only by the comment above it',
        code: '// T119 the port type lands there\n// @ts-ignore\nexport const p: string = 1;',
        filename: file,
        errors: [{ messageId: 'unjustifiedDirective', line: 2 }],
      },
      {
        name: 'a directive in a JavaScript file',
        code: '// @ts-ignore\nexports.p = 1;',
        filename: 'scripts/x.js',
        errors: 1,
      },
    ],
  },
);
