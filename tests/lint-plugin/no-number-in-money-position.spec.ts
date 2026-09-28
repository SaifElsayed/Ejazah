// money/no-number-in-money-position (R-MONEY-1) against a table of code (T131).
//
// The fixture proves an interface property and a parameter typed `number`. This table proves the
// rest of the positions a type is written at, in both spellings of the money word, and the
// wrappers a plain number hides inside: a nullable union, a readonly array, a promise, the
// `Number` object type, and the two cast forms that strip the brand from a value already named as
// money. The valid table holds the boundary from the other side. The brand itself and any other
// named type are legal because this fast rule cannot resolve a name, `bigint` and `string` are not
// the sidestep this rule closes, a name that does not end in the money word is not a money
// position, and `toPlainNumber` in the money package returns a number from a position typed with
// the brand, which is the one greppable place the widening is allowed.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const payments = 'apps/api/src/modules/payments/package-price.ts';
const money = 'packages/money/src/index.ts';

typescriptRuleTester().run(
  'money/no-number-in-money-position',
  loadRule('no-number-in-money-position.js'),
  {
    valid: [
      {
        name: 'a money position typed with the brand',
        code: 'export interface PackagePrice {\n  readonly price_piasters: Piasters;\n}\ndeclare type Piasters = number & { readonly brand: unique symbol };',
        filename: payments,
      },
      {
        name: 'a money position typed bigint, which does not compile against the brand',
        code: 'export interface Row {\n  readonly gross_piasters: bigint;\n}',
        filename: payments,
      },
      {
        name: 'a money position typed string, a label and not a value',
        code: 'export const price_piasters: string = "0";',
        filename: payments,
      },
      {
        name: 'a name that does not end in the money word',
        code: 'export interface Summary {\n  readonly count: number;\n  readonly piasters_per_session_count: number;\n}',
        filename: payments,
      },
      {
        name: 'the brand’s own declaration, which is a type alias and not a position',
        code: "export type Piasters = number & { readonly __brand: 'Piasters' };",
        filename: money,
      },
      {
        name: 'the one allowed widening: a number returned from a position typed with the brand',
        code: 'declare type Piasters = number & { readonly brand: unique symbol };\nexport function toPlainNumber(amount_piasters: Piasters): number {\n  return amount_piasters;\n}',
        filename: money,
      },
      {
        name: 'a function named for money returning the brand',
        code: 'declare type Piasters = number & { readonly brand: unique symbol };\nexport declare function netPiasters(): Piasters;',
        filename: payments,
      },
      {
        name: 'a cast that keeps the brand',
        code: 'declare type Piasters = number & { readonly brand: unique symbol };\nexport const price_piasters = 0 as Piasters;',
        filename: payments,
      },
    ],
    invalid: [
      {
        name: 'the canonical interface property and parameter',
        code: 'export interface PackagePrice {\n  readonly price_piasters: number;\n}\n\nexport function packagePrice(price_piasters: number): PackagePrice {\n  return { price_piasters };\n}',
        filename: payments,
        errors: [
          { messageId: 'plainNumber', data: { name: 'price_piasters' } },
          { messageId: 'plainNumber', data: { name: 'price_piasters' } },
        ],
      },
      {
        name: 'a class property',
        code: 'export class PackagePrice {\n  price_piasters: number = 0;\n}',
        filename: payments,
        errors: [{ messageId: 'plainNumber', data: { name: 'price_piasters' } }],
      },
      {
        name: 'a constructor parameter property',
        code: 'export class PackagePrice {\n  constructor(private readonly price_piasters: number) {}\n}',
        filename: payments,
        errors: [{ messageId: 'plainNumber', data: { name: 'price_piasters' } }],
      },
      {
        name: 'a variable',
        code: 'export const net_piasters: number = 0;',
        filename: payments,
        errors: [{ messageId: 'plainNumber', data: { name: 'net_piasters' } }],
      },
      {
        name: 'a nullable union',
        code: 'export interface Row {\n  readonly net_piasters: number | null;\n}',
        filename: payments,
        errors: [{ messageId: 'plainNumber', data: { name: 'net_piasters' } }],
      },
      {
        name: 'a readonly array',
        code: 'export interface Row {\n  readonly line_piasters: readonly number[];\n}',
        filename: payments,
        errors: [{ messageId: 'plainNumber', data: { name: 'line_piasters' } }],
      },
      {
        name: 'a promise',
        code: 'export interface Row {\n  readonly total_piasters: Promise<number>;\n}',
        filename: payments,
        errors: [{ messageId: 'plainNumber', data: { name: 'total_piasters' } }],
      },
      {
        name: 'the Number object type',
        code: 'export interface Row {\n  readonly total_piasters: Number;\n}',
        filename: payments,
        errors: [{ messageId: 'plainNumber', data: { name: 'total_piasters' } }],
      },
      {
        name: 'the camelCase spelling of the money word',
        code: 'export interface Row {\n  readonly netPiasters: number;\n}',
        filename: payments,
        errors: [{ messageId: 'plainNumber', data: { name: 'netPiasters' } }],
      },
      {
        name: 'a method signature returning a number',
        code: 'export interface Pricing {\n  netPiasters(): number;\n}',
        filename: payments,
        errors: [{ messageId: 'plainNumber', data: { name: 'netPiasters' } }],
      },
      {
        name: 'a function named for money returning a number',
        code: 'export function netPiasters(): number {\n  return 0;\n}',
        filename: payments,
        errors: [{ messageId: 'plainNumber', data: { name: 'netPiasters' } }],
      },
      {
        name: 'an arrow function named for money returning a number',
        code: 'export const netPiasters = (): number => 0;',
        filename: payments,
        errors: [{ messageId: 'plainNumber', data: { name: 'netPiasters' } }],
      },
      {
        name: 'a cast that strips the brand',
        code: 'declare const price_piasters: unknown;\nexport const plain = price_piasters as number;',
        filename: payments,
        errors: [{ messageId: 'strippedBrand', data: { name: 'price_piasters' } }],
      },
      {
        name: 'an angle-bracket cast on a member named for money',
        code: 'declare const row: { price_piasters: unknown };\nexport const plain = <number>row.price_piasters;',
        filename: payments,
        errors: [{ messageId: 'strippedBrand', data: { name: 'price_piasters' } }],
      },
    ],
  },
);
