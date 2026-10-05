// money/no-number-in-money-position (R-MONEY-1) against a table of code (T131).
//
// The fixture proves an interface member and a parameter. The cases that carry the rule are the
// other places a position is declared — class members, parameter properties, return types, the
// type-level function forms — the containers a plain number hides in, and the cast, which is the
// one way a branded value is turned back into a number without `toPlainNumber`.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const file = 'apps/api/src/modules/payments/package-price.ts';

typescriptRuleTester().run(
  'money/no-number-in-money-position',
  loadRule('no-number-in-money-position.js'),
  {
    valid: [
      {
        name: 'the brand at every position',
        code: [
          "import type { Piasters } from '@ijazah/money';",
          'export interface Price { readonly price_piasters: Piasters; gateway_fee_piasters: Piasters | null }',
          'export class Row { constructor(private readonly net_piasters: Piasters) {} gross_piasters?: Piasters; }',
          'export function f(price_piasters: Piasters, prices_piasters: readonly Piasters[]): Piasters { return price_piasters; }',
          'export const totalPiasters = (snapshotPricePiasters: Piasters): Piasters => snapshotPricePiasters;',
          'export type Charge = (gross_piasters: Piasters) => Promise<Piasters>;',
        ].join('\n'),
        filename: file,
      },
      {
        name: 'a plain number under a name that is not money',
        code: 'export interface Page { readonly sessionCount: number; limit: number }\nexport function f(count: number, rating: number): number { return count + rating; }',
        filename: file,
      },
      {
        name: 'the word is the suffix, not a part of the name',
        code: 'export function piastersToPounds(piastersPerPound: number): number { return piastersPerPound; }\nexport const piasters_label: number = 1;',
        filename: file,
      },
      {
        name: 'a money name that is not a number',
        code: 'export interface Row { price_piasters: bigint; label_piasters: string; has_piasters: boolean }',
        filename: file,
      },
      {
        name: 'private members typed with the brand, and a private name that is not an amount',
        code: 'export class Row {\n  #price_piasters: Piasters;\n  #piastersPerPound: number = 100;\n  #count: number = 0;\n  #total_piasters(): Piasters { return this.#price_piasters; }\n  constructor(value: Piasters) { this.#price_piasters = value; this.#count = value as unknown as number; }\n}',
        filename: file,
      },
      {
        name: 'a cast to number of something that is not money',
        code: 'export const count = raw as number;\nexport const row = { session_count: value as number };',
        filename: file,
      },
      {
        name: 'a cast of a money value to the brand, and to unknown',
        code: "import type { Piasters } from '@ijazah/money';\nexport const price_piasters = raw as Piasters;\nexport const x = price_piasters as unknown;",
        filename: file,
      },
      {
        name: 'the unwrap the money package publishes',
        code: "import { toPlainNumber, type Piasters } from '@ijazah/money';\nexport const wire = (price_piasters: Piasters): number => toPlainNumber(price_piasters);",
        filename: file,
      },
      {
        name: 'a nested function type is judged at its own names',
        code: 'export interface Deps { load_piasters: (count: number) => string }',
        filename: file,
      },
      {
        name: 'the money package is where a plain number becomes money',
        code: 'export function piasters(value_piasters: number): number { return value_piasters as number; }',
        filename: 'packages/money/src/index.ts',
      },
      {
        name: 'the money package, as the fixture tree mirrors it',
        code: 'export const a_piasters: number = 1;',
        filename: 'tests/violations/fixtures/packages/money/src/index.ts',
      },
    ],
    invalid: [
      {
        name: 'the fixture: an interface member and a parameter',
        code: 'export interface PackagePrice {\n  readonly price_piasters: number;\n}\nexport function packagePrice(price_piasters: number): PackagePrice {\n  return { price_piasters };\n}',
        filename: file,
        errors: [
          { messageId: 'plainNumber', data: { name: 'price_piasters' }, line: 2 },
          { messageId: 'plainNumber', data: { name: 'price_piasters' }, line: 4 },
        ],
      },
      {
        name: 'camelCase is the same name',
        code: 'export interface EnrollInput { readonly packagePricePiasters: number }',
        filename: 'apps/api/src/surfaces/booking.router.ts',
        errors: [{ messageId: 'plainNumber', data: { name: 'packagePricePiasters' } }],
      },
      {
        name: 'a variable, a destructured default and a rest parameter',
        code: 'export const net_piasters: number = 0;\nexport function f(fee_piasters: number = 0, ...prices_piasters: number[]) { return [fee_piasters, prices_piasters]; }',
        filename: file,
        errors: 3,
      },
      {
        name: 'a type-literal member, quoted and optional',
        code: "export type Row = { 'gross_piasters'?: number; nested: { net_piasters: number } };",
        filename: file,
        errors: 2,
      },
      {
        name: 'a nullable number',
        code: 'export interface Row { gateway_fee_piasters: number | null; net_piasters?: number | undefined }',
        filename: file,
        errors: 2,
      },
      {
        name: 'a class property, an accessor and a parameter property',
        code: 'export class Row {\n  price_piasters: number = 0;\n  static accessor net_piasters: number = 0;\n  constructor(private readonly gross_piasters: number) {}\n}',
        filename: file,
        errors: 3,
      },
      {
        name: 'a private field, a private method, a private setter and a private accessor',
        code: 'export class Row {\n  #price_piasters: number = 0;\n  #total_piasters(): number { return this.#price_piasters; }\n  set #fee_piasters(value: number) {}\n  static accessor #net_piasters: number = 0;\n}',
        filename: file,
        errors: [
          { messageId: 'plainNumber', data: { name: 'price_piasters' }, line: 2 },
          { messageId: 'plainNumberReturned', data: { name: 'total_piasters' }, line: 3 },
          { messageId: 'plainNumber', data: { name: 'fee_piasters' }, line: 4 },
          { messageId: 'plainNumber', data: { name: 'net_piasters' }, line: 5 },
        ],
      },
      {
        name: 'a cast that lands in a private member, and a private member cast back',
        code: 'export class Row {\n  #price_piasters: Piasters;\n  constructor(n: unknown) { this.#price_piasters = n as number; }\n  plain() { return this.#price_piasters as number; }\n}',
        filename: 'apps/api/src/modules/payments/payments.service.ts',
        errors: [
          { messageId: 'castToNumber', data: { name: 'price_piasters' }, line: 3 },
          { messageId: 'castToNumber', data: { name: 'price_piasters' }, line: 4 },
        ],
      },
      {
        name: 'a setter, and an abstract property',
        code: 'export abstract class Row {\n  set fee_piasters(value: number) {}\n  abstract net_piasters: number;\n}',
        filename: file,
        errors: [
          { messageId: 'plainNumber', data: { name: 'fee_piasters' }, line: 2 },
          { messageId: 'plainNumber', data: { name: 'net_piasters' }, line: 3 },
        ],
      },
      {
        name: 'a return type, on every function form',
        code: [
          'export function total_piasters(): number { return 0; }',
          'export const net_piasters = (): number => 0;',
          'export const fee_piasters = function (): number { return 0; };',
          'export class C { gross_piasters(): number { return 0; } get price_piasters(): number { return 0; } }',
          'export const o = { snapshot_price_piasters(): number { return 0; } };',
          'export declare function refund_piasters(): number;',
          'export const later_piasters = async (): Promise<number> => 0;',
        ].join('\n'),
        filename: file,
        errors: [
          { messageId: 'plainNumberReturned', data: { name: 'total_piasters' } },
          { messageId: 'plainNumberReturned', data: { name: 'net_piasters' } },
          { messageId: 'plainNumberReturned', data: { name: 'fee_piasters' } },
          { messageId: 'plainNumberReturned', data: { name: 'gross_piasters' } },
          { messageId: 'plainNumberReturned', data: { name: 'price_piasters' } },
          { messageId: 'plainNumberReturned', data: { name: 'snapshot_price_piasters' } },
          { messageId: 'plainNumberReturned', data: { name: 'refund_piasters' } },
          { messageId: 'plainNumberReturned', data: { name: 'later_piasters' } },
        ],
      },
      {
        name: 'the containers a number hides in',
        code: [
          'export interface Row {',
          '  prices_piasters: number[];',
          '  fees_piasters: Array<number>;',
          '  nets_piasters: ReadonlyArray<number>;',
          '  gross_piasters: readonly number[];',
          '  by_teacher_piasters: Record<string, number>;',
          '  by_id_piasters: Map<string, number>;',
          '  range_piasters: [number, number];',
          '  boxed_piasters: Number;',
          '}',
        ].join('\n'),
        filename: file,
        errors: 8,
      },
      {
        name: 'a decimal is not integer piasters either',
        code: "import type { Prisma } from '@prisma/client';\nexport interface Row { price_piasters: Prisma.Decimal; net_piasters: Decimal }",
        filename: 'apps/api/src/modules/payments/payments.repository.ts',
        errors: 2,
      },
      {
        name: 'the type-level function forms',
        code: [
          'export type Charge = (gross_piasters: number) => void;',
          'export type Make = new (price_piasters: number) => object;',
          'export interface Port {',
          '  (net_piasters: number): void;',
          '  new (fee_piasters: number): Port;',
          '  charge(gross_piasters: number): void;',
          '  quote_piasters(): number;',
          '  price_piasters: () => number;',
          '}',
        ].join('\n'),
        filename: file,
        errors: [
          { messageId: 'plainNumber', line: 1 },
          { messageId: 'plainNumber', line: 2 },
          { messageId: 'plainNumber', line: 4 },
          { messageId: 'plainNumber', line: 5 },
          { messageId: 'plainNumber', line: 6 },
          { messageId: 'plainNumberReturned', line: 7 },
          { messageId: 'plainNumber', line: 8 },
        ],
      },
      {
        name: 'a cast to number at a money position',
        code: [
          'export const price_piasters = raw as number;',
          'export const row = { net_piasters: value as number, "fee_piasters": <number>value };',
          'row.net_piasters = other as number;',
          'export const gross_piasters = ok ? (a as number) : (b ?? (c as number));',
        ].join('\n'),
        filename: 'apps/api/src/modules/payments/payments.service.ts',
        errors: [
          { messageId: 'castToNumber', data: { name: 'price_piasters' }, line: 1 },
          { messageId: 'castToNumber', data: { name: 'net_piasters' }, line: 2 },
          { messageId: 'castToNumber', data: { name: 'fee_piasters' }, line: 2 },
          { messageId: 'castToNumber', data: { name: 'net_piasters' }, line: 3 },
          { messageId: 'castToNumber', data: { name: 'gross_piasters' }, line: 4 },
          { messageId: 'castToNumber', data: { name: 'gross_piasters' }, line: 4 },
        ],
      },
      {
        name: 'a money value cast back to a number',
        code: "export const a = price_piasters as number;\nexport const b = row.net_piasters as number;\nexport const c = row?.['gross_piasters']! as unknown as number;",
        filename: 'apps/api/src/modules/payments/payments.service.ts',
        errors: [
          { messageId: 'castToNumber', data: { name: 'price_piasters' } },
          { messageId: 'castToNumber', data: { name: 'net_piasters' } },
          { messageId: 'castToNumber', data: { name: 'gross_piasters' } },
        ],
      },
      {
        name: 'the mobile application and the contracts package are not exempt',
        code: 'export interface PackageCard { price_piasters: number }',
        filename: 'packages/contracts/src/catalog.ts',
        errors: 1,
      },
    ],
  },
);
