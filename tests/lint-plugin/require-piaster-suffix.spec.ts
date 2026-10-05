// money/require-piaster-suffix (R-MONEY-2) against a table of type-checked code (T045).
//
// The fixture proves one declaration, a parameter named `price`. This table proves the other
// places a name is declared — an inferred local, a destructured binding, a parameter property, a
// class field, an interface property — and the cases that must stay silent: a name that already
// carries the suffix, a `price` typed as a plain number (that is R-MONEY-1's business, T131), a
// reference narrowed to an amount inside a guard (a reference names nothing new), and a function
// whose return value is an amount. The suffix is the constitution's literal snake_case form, so a
// camelCase `amountPiasters` is refused (note under T045 and T131), and so is a name that is the
// suffix and nothing else. Since the reviews of PR #27 it also proves the two names that reach a
// response without being a variable — an object-literal key holding an amount and a getter
// returning one — and a type parameter constrained to the brand. Tuple labels and index
// signatures are valid here on purpose: the rule header records them as not covered.

import { loadRule, typeAwareRuleTester, virtualFile } from '../support/rule-tester';

const feature = virtualFile('apps/api/src/modules/payments/price-view.ts');
const moneyPackage = virtualFile('packages/money/src/index.ts');

const brand = [
  'declare const piastersBrand: unique symbol;',
  'type Piasters = number & { readonly [piastersBrand]: true };',
  'declare function isPiasters(value: number): value is Piasters;',
].join('\n');

function withBrand(code: string): string {
  return `${brand}\n${code}`;
}

typeAwareRuleTester().run('money/require-piaster-suffix', loadRule('require-piaster-suffix.js'), {
  valid: [
    {
      name: 'a parameter carrying the suffix',
      code: withBrand(
        'export const show = (price_piasters: Piasters): string => String(price_piasters);',
      ),
      filename: feature,
    },
    {
      name: 'a plain number named price, which is R-MONEY-1 and not this rule',
      code: 'export const show = (price: number): string => String(price);',
      filename: feature,
    },
    {
      name: 'a reference narrowed to an amount inside a guard declares nothing',
      code: withBrand(
        'export function check(candidate: number): number { if (isPiasters(candidate)) { return candidate; } return 0; }',
      ),
      filename: feature,
    },
    {
      name: 'a function returning an amount is not a money variable',
      code: withBrand('export declare function priceOf(packageId: string): Piasters;'),
      filename: feature,
    },
    {
      name: 'an array of amounts is not one amount',
      code: withBrand('export declare const prices: readonly Piasters[];'),
      filename: feature,
    },
    {
      name: 'a nullable interface field carrying the suffix',
      code: withBrand('export interface Row { readonly gross_piasters: Piasters | null }'),
      filename: feature,
    },
    {
      name: 'an object-literal key carrying the suffix, a shorthand one and a computed one',
      code: withBrand(
        'declare const key: string;\nexport const view = (price_piasters: Piasters) => ({ gross_piasters: price_piasters, price_piasters, [key]: price_piasters });',
      ),
      filename: feature,
    },
    {
      name: 'an object-literal key holding a function or a plain number',
      code: withBrand(
        'export const view = (price_piasters: Piasters) => ({ price: (): Piasters => price_piasters, count: 2, total(): Piasters { return price_piasters; } });',
      ),
      filename: feature,
    },
    {
      name: 'a getter carrying the suffix',
      code: withBrand(
        'export class Quote { constructor(private readonly gross_piasters: Piasters) {} get net_piasters(): Piasters { return this.gross_piasters; } }',
      ),
      filename: feature,
    },
    {
      name: 'tuple labels and an index signature are not covered',
      code: withBrand(
        'export type Split = [gross: Piasters, fee: Piasters];\nexport interface ByPackage { readonly [packageId: string]: Piasters }',
      ),
      filename: feature,
    },
    {
      name: 'a suffixed destructured rename',
      code: withBrand(
        'declare const row: Record<"price", Piasters>;\nexport const { price: price_piasters } = row;',
      ),
      filename: feature,
    },
  ],
  invalid: [
    {
      name: 'a parameter named price',
      code: withBrand('export const show = (price: Piasters): string => String(price);'),
      filename: feature,
      errors: [{ messageId: 'missingSuffix', data: { name: 'price' } }],
    },
    {
      name: 'camelCase is not the constitution’s spelling',
      code: withBrand(
        'export const show = (amountPiasters: Piasters): string => String(amountPiasters);',
      ),
      filename: feature,
      errors: [{ messageId: 'missingSuffix', data: { name: 'amountPiasters' } }],
    },
    {
      name: 'a bare piasters',
      code: withBrand('export const show = (piasters: Piasters): string => String(piasters);'),
      filename: feature,
      errors: [{ messageId: 'missingSuffix', data: { name: 'piasters' } }],
    },
    {
      name: 'an inferred local, decided by its type and not its name',
      code: withBrand(
        'export function copy(price_piasters: Piasters): Piasters { const total = price_piasters; return total; }',
      ),
      filename: feature,
      errors: [{ messageId: 'missingSuffix', data: { name: 'total' } }],
    },
    {
      name: 'a destructured binding',
      code: withBrand('declare const row: Record<"fee", Piasters>;\nexport const { fee } = row;'),
      filename: feature,
      errors: [{ messageId: 'missingSuffix', data: { name: 'fee' } }],
    },
    {
      name: 'a destructured parameter',
      code: withBrand(
        'export const show = ({ net }: Record<"net", Piasters>): string => String(net);',
      ),
      filename: feature,
      errors: [{ messageId: 'missingSuffix', data: { name: 'net' } }],
    },
    {
      name: 'a destructured parameter and the inline property type it reads, one report each',
      code: withBrand('export const show = ({ net }: { net: Piasters }): string => String(net);'),
      filename: feature,
      errors: [
        { messageId: 'missingSuffix', data: { name: 'net' } },
        { messageId: 'missingSuffix', data: { name: 'net' } },
      ],
    },
    {
      name: 'a constructor parameter property',
      code: withBrand('export class Quote { constructor(readonly price: Piasters) {} }'),
      filename: feature,
      errors: [{ messageId: 'missingSuffix', data: { name: 'price' } }],
    },
    {
      name: 'a class field',
      code: withBrand('export class Quote { price: Piasters | undefined; }'),
      filename: feature,
      errors: [{ messageId: 'missingSuffix', data: { name: 'price' } }],
    },
    {
      name: 'an optional interface property',
      code: withBrand('export interface PackageRow { readonly price?: Piasters }'),
      filename: feature,
      errors: [{ messageId: 'missingSuffix', data: { name: 'price' } }],
    },
    {
      name: 'a type-literal property and a method-signature parameter',
      code: withBrand('export type Pricing = { gross: Piasters; charge(amount: Piasters): void };'),
      filename: feature,
      errors: [
        { messageId: 'missingSuffix', data: { name: 'gross' } },
        { messageId: 'missingSuffix', data: { name: 'amount' } },
      ],
    },
    {
      name: 'a name that is the suffix and nothing else (Saif 19)',
      code: withBrand('export const show = (_piasters: Piasters): string => String(_piasters);'),
      filename: feature,
      errors: [{ messageId: 'missingSuffix', data: { name: '_piasters' } }],
    },
    {
      name: 'an object-literal key holding an amount, which is what a router returns (Omar 7, Saif 13)',
      code: withBrand(
        'export const view = (price_piasters: Piasters) => ({ price: price_piasters });',
      ),
      filename: feature,
      errors: [{ messageId: 'missingSuffix', data: { name: 'price' } }],
    },
    {
      name: 'a quoted object-literal key and a nested one, holding a nullable amount',
      code: withBrand(
        "declare const fee_piasters: Piasters | null;\nexport const row = { 'fee': fee_piasters, nested: { net: fee_piasters } };",
      ),
      filename: feature,
      errors: [
        { messageId: 'missingSuffix', data: { name: 'fee' } },
        { messageId: 'missingSuffix', data: { name: 'net' } },
      ],
    },
    {
      name: 'a class getter returning an amount (Omar 7, Saif 13)',
      code: withBrand(
        'export class Quote { constructor(private readonly gross_piasters: Piasters) {} get price(): Piasters { return this.gross_piasters; } }',
      ),
      filename: feature,
      errors: [{ messageId: 'missingSuffix', data: { name: 'price' } }],
    },
    {
      name: 'a getter in an object literal, an abstract class and an interface',
      code: withBrand(
        'declare const gross_piasters: Piasters;\nexport const quote = { get price() { return gross_piasters; } };\nexport abstract class Priced { abstract get amount(): Piasters; }\nexport interface Charged { get total(): Piasters }',
      ),
      filename: feature,
      errors: [
        { messageId: 'missingSuffix', data: { name: 'price' } },
        { messageId: 'missingSuffix', data: { name: 'amount' } },
        { messageId: 'missingSuffix', data: { name: 'total' } },
      ],
    },
    {
      name: 'a type parameter constrained to the brand is read through its constraint (Saif 11)',
      code: withBrand(
        'export const show = <T extends Piasters>(value: T): string => String(value);',
      ),
      filename: feature,
      errors: [{ messageId: 'missingSuffix', data: { name: 'value' } }],
    },
    {
      name: 'packages/money is not exempt from R-MONEY-2',
      code: withBrand('export const unwrap = (value: Piasters): number => value;'),
      filename: moneyPackage,
      errors: [{ messageId: 'missingSuffix', data: { name: 'value' } }],
    },
  ],
});
