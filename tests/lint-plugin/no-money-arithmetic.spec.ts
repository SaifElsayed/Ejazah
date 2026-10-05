// money/no-arithmetic-outside-package (R-MONEY-5) against a table of type-checked code (T044).
//
// The fixture proves one spelling, a binary `-` between two amounts. This table proves the other
// spellings of the same operation — compound assignment, unary and update, and the bitwise and
// shift forms that halve (`>> 1`) or truncate (`| 0`, `~~x`) an amount — and the neighbours that
// must stay legal: a comparison between amounts, arithmetic and shifts on plain numbers, and any
// arithmetic at all inside `packages/money`, which is the one place R-MONEY-5 allows it. Every
// case declares the brand the way `packages/money/src/index.ts` does, so the rule is tested
// against the real shape and not against a name. A type parameter constrained to the brand is read
// through its constraint. One valid case pins the known limits the rule header records — an
// amount widened to `number`, a template literal, `Math.max` and a `Piasters | number` union — so
// that closing one of them is a visible change to this table.

import { loadRule, typeAwareRuleTester, virtualFile } from '../support/rule-tester';

const feature = virtualFile('apps/api/src/modules/payments/receipt.ts');
const moneyPackage = virtualFile('packages/money/src/index.ts');

const brand = [
  'declare const piastersBrand: unique symbol;',
  'type Piasters = number & { readonly [piastersBrand]: true };',
].join('\n');

function withBrand(code: string): string {
  return `${brand}\n${code}`;
}

typeAwareRuleTester().run(
  'money/no-arithmetic-outside-package',
  loadRule('no-money-arithmetic.js'),
  {
    valid: [
      {
        name: 'a comparison between amounts is not arithmetic',
        code: withBrand(
          'export const isAbove = (gross_piasters: Piasters, fee_piasters: Piasters): boolean => gross_piasters > fee_piasters;',
        ),
        filename: feature,
      },
      {
        name: 'equality between amounts',
        code: withBrand(
          'export const same = (a_piasters: Piasters, b_piasters: Piasters): boolean => a_piasters === b_piasters;',
        ),
        filename: feature,
      },
      {
        name: 'arithmetic on plain numbers',
        code: 'export const total = (count: number, size: number): number => count * size + 1;',
        filename: feature,
      },
      {
        name: 'arithmetic inside packages/money, the one place it is allowed',
        code: withBrand(
          'export const sum = (a_piasters: Piasters, b_piasters: Piasters): number => a_piasters + b_piasters;',
        ),
        filename: moneyPackage,
      },
      {
        name: 'a string concatenation with no amount in it',
        code: "export const label = (name: string): string => 'Teacher ' + name;",
        filename: feature,
      },
      {
        name: 'known limits: an amount widened to number, a template literal, Math.max, a union with number',
        code: withBrand(
          [
            'export const cast = (price_piasters: Piasters): number => (price_piasters as number) * 2;',
            'export const converted = (price_piasters: Piasters): number => Number(price_piasters) * 2;',
            'export function assigned(price_piasters: Piasters): number { const plain: number = price_piasters; return plain * 2; }',
            'export const label = (price_piasters: Piasters): string => `EGP ${price_piasters}`;',
            'export const larger = (a_piasters: Piasters, b_piasters: Piasters): number => Math.max(a_piasters, b_piasters);',
            'export const mixed = (amount: Piasters | number): number => amount * 2;',
          ].join('\n'),
        ),
        filename: feature,
      },
      {
        name: 'a shift and a mask on plain numbers, so the brand and not the operator decides',
        code: 'export const flags = (mask: number, bit: number): number => (mask >> bit) | 0;',
        filename: feature,
      },
    ],
    invalid: [
      {
        name: 'a binary operator between two amounts, reported once',
        code: withBrand(
          'export const net = (gross_piasters: Piasters, fee_piasters: Piasters): number => gross_piasters - fee_piasters;',
        ),
        filename: feature,
        errors: [{ messageId: 'arithmetic', data: { operand: 'gross_piasters', operator: '-' } }],
      },
      {
        name: 'an amount multiplied by a plain number',
        code: withBrand(
          'export const share = (price_piasters: Piasters): number => price_piasters * 0.2;',
        ),
        filename: feature,
        errors: [{ messageId: 'arithmetic', data: { operand: 'price_piasters', operator: '*' } }],
      },
      {
        name: 'a plain number divided by an amount',
        code: withBrand(
          'export const ratio = (price_piasters: Piasters): number => 100 / price_piasters;',
        ),
        filename: feature,
        errors: [{ messageId: 'arithmetic', data: { operand: 'price_piasters', operator: '/' } }],
      },
      {
        name: 'an amount narrowed out of a nullable one',
        code: withBrand(
          'export function half(price_piasters: Piasters | null): number { return price_piasters === null ? 0 : price_piasters % 2; }',
        ),
        filename: feature,
        errors: [{ messageId: 'arithmetic', data: { operand: 'price_piasters', operator: '%' } }],
      },
      {
        name: 'an operand whose type is still the nullable amount',
        code: withBrand(
          "declare const maybe_piasters: Piasters | null;\nexport const label = 'EGP ' + maybe_piasters;",
        ),
        filename: feature,
        errors: [{ messageId: 'arithmetic', data: { operand: 'maybe_piasters', operator: '+' } }],
      },
      {
        name: 'an exponent',
        code: withBrand(
          'export const squared = (price_piasters: Piasters): number => price_piasters ** 2;',
        ),
        filename: feature,
        errors: [{ messageId: 'arithmetic', data: { operand: 'price_piasters', operator: '**' } }],
      },
      {
        name: 'a compound assignment',
        code: withBrand(
          'export function add(total: number, price_piasters: Piasters): number { total += price_piasters; return total; }',
        ),
        filename: feature,
        errors: [{ messageId: 'arithmetic', data: { operand: 'price_piasters', operator: '+=' } }],
      },
      {
        name: 'a unary minus',
        code: withBrand(
          'export const refund = (price_piasters: Piasters): number => -price_piasters;',
        ),
        filename: feature,
        errors: [{ messageId: 'arithmetic', data: { operand: 'price_piasters', operator: '-' } }],
      },
      {
        name: 'an update expression',
        code: withBrand(
          'export function bump(price_piasters: Piasters): Piasters { price_piasters++; return price_piasters; }',
        ),
        filename: feature,
        errors: [{ messageId: 'arithmetic', data: { operand: 'price_piasters', operator: '++' } }],
      },
      {
        name: 'a string concatenation with an amount',
        code: withBrand(
          "export const label = (price_piasters: Piasters): string => 'EGP ' + price_piasters;",
        ),
        filename: feature,
        errors: [{ messageId: 'arithmetic', data: { operand: 'price_piasters', operator: '+' } }],
      },
      {
        name: 'an amount reached through an inferred local, decided by type and not by name',
        code: withBrand(
          'export function twice(price_piasters: Piasters): number { const copy = price_piasters; return copy * 2; }',
        ),
        filename: feature,
        errors: [{ messageId: 'arithmetic', data: { operand: 'copy', operator: '*' } }],
      },
      {
        name: 'a type parameter constrained to the brand is read through its constraint (Saif 11)',
        code: withBrand(
          'export function difference<T extends Piasters>(a_piasters: T, b_piasters: T): number { return a_piasters - b_piasters; }',
        ),
        filename: feature,
        errors: [{ messageId: 'arithmetic', data: { operand: 'a_piasters', operator: '-' } }],
      },
      {
        name: 'an amount read out of a row through a constrained key (Saif 11)',
        code: withBrand(
          "interface Row { readonly gross_piasters: Piasters; readonly net_piasters: Piasters }\nexport function twice<K extends 'gross_piasters' | 'net_piasters'>(row: Row, key: K): number { return row[key] * 2; }",
        ),
        filename: feature,
        errors: [{ messageId: 'arithmetic', data: { operand: 'row[key]', operator: '*' } }],
      },
      {
        name: 'a right shift, which halves an amount',
        code: withBrand(
          'export const half = (price_piasters: Piasters): number => price_piasters >> 1;',
        ),
        filename: feature,
        errors: [{ messageId: 'arithmetic', data: { operand: 'price_piasters', operator: '>>' } }],
      },
      {
        name: 'a bitwise or with zero, which truncates an amount',
        code: withBrand(
          'export const whole = (price_piasters: Piasters): number => price_piasters | 0;',
        ),
        filename: feature,
        errors: [{ messageId: 'arithmetic', data: { operand: 'price_piasters', operator: '|' } }],
      },
      {
        name: 'a double bitwise not, which truncates an amount, reported once for the inner operator',
        code: withBrand(
          'export const whole = (price_piasters: Piasters): number => ~~price_piasters;',
        ),
        filename: feature,
        errors: [{ messageId: 'arithmetic', data: { operand: 'price_piasters', operator: '~' } }],
      },
      {
        name: 'a compound shift assignment',
        code: withBrand(
          'export function shrink(total: number, price_piasters: Piasters): number { total <<= price_piasters; return total; }',
        ),
        filename: feature,
        errors: [{ messageId: 'arithmetic', data: { operand: 'price_piasters', operator: '<<=' } }],
      },
    ],
  },
);
