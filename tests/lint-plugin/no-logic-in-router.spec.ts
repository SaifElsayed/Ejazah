// api/no-logic-in-router (R-API-1) against a table of code (T036).
//
// The rule is a complexity ceiling of 5 per body on any `*.router.ts` file, so the cases that
// matter are the two either side of the boundary — five decisions pass, six do not — and the
// bodies that are not functions. A six-way `if / else if` chain written at the top level of a
// router file is the same business rule in the same wrong file, and it used to lint clean.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const router = 'apps/api/src/surfaces/booking.router.ts';

/** `n` `else if` branches after the first `if`, i.e. `n + 1` decisions. */
function chain(branches: number): string {
  const rest = Array.from({ length: branches }, () => ' else if (input) {}').join('');
  return `if (input) {}${rest}`;
}

typescriptRuleTester().run('api/no-logic-in-router', loadRule('no-logic-in-router.js'), {
  valid: [
    {
      name: 'a thin procedure: validate, call one service method, return',
      code: 'export const list = (input: string) => service.list(input);\ndeclare const service: { list(i: string): unknown };',
      filename: router,
    },
    {
      name: 'four decisions in a procedure, which is a complexity of five',
      code: `export function list(input: unknown) {\n  ${chain(3)}\n  return input;\n}`,
      filename: router,
    },
    {
      name: 'four decisions at the top level, which is a complexity of five',
      code: `declare const input: unknown;\n${chain(3)}\nexport const done = true;`,
      filename: router,
    },
    {
      name: 'a file that is not a router',
      code: `export function decide(input: unknown) {\n  ${chain(19)}\n  return input;\n}`,
      filename: 'apps/api/src/modules/booking/booking.service.ts',
    },
    {
      name: 'optional chaining guards a value, it does not carry a rule',
      code: 'export const first = (input?: { a?: { b?: string } }) => input?.a?.b;',
      filename: router,
    },
  ],
  invalid: [
    {
      name: 'five decisions in a procedure, one over the ceiling',
      code: `export function list(input: unknown) {\n  ${chain(4)}\n  return input;\n}`,
      filename: router,
      errors: [{ messageId: 'tooComplex', data: { name: 'list', complexity: '6', max: '5' } }],
    },
    {
      name: 'a procedure declared as a property of the router object',
      code: `export const bookingRouter = {\n  list(input: unknown) {\n    ${chain(4)}\n    return input;\n  },\n};`,
      filename: router,
      errors: [{ messageId: 'tooComplex', data: { name: 'list', complexity: '6', max: '5' } }],
    },
    {
      name: 'a chain at the top level, outside any function',
      code: `declare const input: unknown;\n${chain(5)}\nexport const done = true;`,
      filename: router,
      errors: [
        {
          messageId: 'tooComplex',
          data: { name: "the file's top level", complexity: '7', max: '5' },
        },
      ],
    },
    {
      name: 'a class static block',
      code: `export class Routes {\n  static {\n    const input = 1;\n    ${chain(5)}\n  }\n}`,
      filename: router,
      errors: [
        { messageId: 'tooComplex', data: { name: 'a static block', complexity: '7', max: '5' } },
      ],
    },
    {
      name: 'defaults on the input, which the header counts as decisions',
      code: 'export function list({ a = 1, b = 2, c = 3, d = 4, e = 5 }) {\n  return a + b + c + d + e;\n}',
      filename: router,
      errors: [{ messageId: 'tooComplex', data: { name: 'list', complexity: '6', max: '5' } }],
    },
    {
      name: 'short-circuiting operators, each of which decides',
      code: 'export const list = (a?: string, b?: string) => a ?? b ?? "x" ?? "y" ?? "z" ?? "w";',
      filename: router,
      errors: 1,
    },
    {
      name: 'a lower ceiling passed as an option',
      code: 'export function list(input: unknown) {\n  if (input) {}\n  return input;\n}',
      filename: router,
      options: [{ max: 1 }],
      errors: [{ messageId: 'tooComplex', data: { name: 'list', complexity: '2', max: '1' } }],
    },
  ],
});
