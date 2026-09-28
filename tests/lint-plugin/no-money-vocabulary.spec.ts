// boundaries/no-money-vocabulary (R-MONEY-6, both halves) against a table of code (T035).
//
// This rule refuses two different things and has to stay silent on a third, so a table is the only
// honest way to hold it: held-funds vocabulary is refused anywhere, the gateway's amounts are
// refused outside the two payment folders, and `payout` — the teacher payout account of the ADR
// 0007 model, and `payout_verified_at`, the discovery gate — is legal everywhere.
//
// Half (b) recognises a gateway amount by its words (gross, fee or net with an amount marker), which
// is how the ERD names all three gateway columns: `gross_piasters`, `gateway_fee_piasters`,
// `net_piasters`. So the valid table names a generic `amountPiasters` and a gateway order id, and no
// folder beyond the two payment folders is exempt, the money package included.
// Money identifiers here are snake_case with `_piasters`, the repository's spelling (note under
// T035).

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const sessions = 'apps/api/src/modules/sessions/attendance.ts';
const payments = 'apps/api/src/modules/payments/payments.repository.ts';
const port = 'apps/api/src/platform/ports/payment/payment.port.ts';
const screen = 'apps/mobile/src/features/student/screens/checkout.tsx';
const money = 'packages/money/src/index.ts';
const formatter = 'apps/mobile/src/lib/format.ts';

typescriptRuleTester().run('boundaries/no-money-vocabulary', loadRule('no-money-vocabulary.js'), {
  valid: [
    {
      name: 'payout_verified_at, the discovery gate',
      code: 'export declare const payout_verified_at: Date | null;',
      filename: sessions,
    },
    {
      name: 'a teacher payout account',
      code: 'export interface PayoutAccount { readonly recipient_ref: string }',
      filename: sessions,
    },
    {
      name: 'the gateway’s amounts inside the payments module',
      code: 'export interface Row { readonly gross_piasters: bigint; readonly gateway_fee_piasters: bigint; readonly net_piasters: bigint }',
      filename: payments,
    },
    {
      name: 'the gateway’s amounts inside the payment port',
      code: 'export declare function gross_piasters(): bigint;',
      filename: port,
    },
    {
      name: 'a generic amount in the money package, which is not a gateway word',
      code: 'export function toPlainNumber(amount_piasters: number): number { return amount_piasters; }',
      filename: money,
    },
    {
      name: 'a generic amount in a display formatter (R-MOBILE-9)',
      code: 'export function formatPiasters(amountPiasters: number): string { return String(amountPiasters); }',
      filename: formatter,
    },
    {
      name: 'a gateway order reference, which is not an amount',
      code: 'export interface CheckoutRef { readonly gateway_order_id: string }',
      filename: 'packages/contracts/src/checkout.ts',
    },
    {
      name: 'prose is not a declaration',
      code: "export const note = 'the platform holds no balance and keeps no ledger';",
      filename: sessions,
    },
  ],
  invalid: [
    {
      name: 'held-funds vocabulary is still refused in the money package',
      code: 'export const walletId = "w";',
      filename: money,
      errors: [{ messageId: 'vocabulary', data: { name: 'walletId', term: 'wallet' } }],
    },
    {
      name: 'a wallet identifier',
      code: 'export const walletId = "w";',
      filename: sessions,
      errors: [{ messageId: 'vocabulary', data: { name: 'walletId', term: 'wallet' } }],
    },
    {
      name: 'a banned name is reported at its binding, once, not at every use',
      code: 'const walletId = "w";\nexport const pair = [walletId, walletId];',
      filename: sessions,
      errors: 1,
    },
    {
      name: 'heldFund — singular on the name’s side, plural in the configured term',
      code: 'export const heldFund = 0;',
      filename: sessions,
      errors: [{ messageId: 'vocabulary', data: { name: 'heldFund', term: 'held_funds' } }],
    },
    {
      name: 'a quoted property key',
      code: "export const row = { 'ledger_entry_id': 1 };",
      filename: sessions,
      errors: 1,
    },
    {
      name: 'a computed table access',
      code: "declare const db: Record<string, unknown>;\nexport const rows = db['wallets'];",
      filename: sessions,
      errors: 1,
    },
    {
      name: 'a JSX element naming a banned concept',
      code: 'export const Screen = () => <WalletBalance />;',
      filename: screen,
      errors: 1,
    },
    {
      name: 'an import specifier, half (a) reading the module name',
      code: "import { credit } from './wallet-ledger';\nexport const c = credit;",
      filename: sessions,
      errors: 1,
    },
    {
      name: 'require, which the five path rules read and this one used to miss',
      code: "const linked = require('./wallet-ledger');\nexport default linked;",
      filename: sessions,
      errors: 1,
    },
    {
      name: 'import = require',
      code: "import linked = require('./wallet-ledger');\nexport default linked;",
      filename: sessions,
      errors: 1,
    },
    {
      name: 'export * from',
      code: "export * from './wallet-ledger';",
      filename: sessions,
      errors: 1,
    },
    {
      name: 'the gross column, outside payments',
      code: 'export interface Row { readonly gross_piasters: bigint }',
      filename: sessions,
      errors: [{ messageId: 'confinement', data: { name: 'gross_piasters' } }],
    },
    {
      name: 'net computed in the money package, which ADR 0007 forbids anywhere',
      code: 'export const net_piasters = 0;',
      filename: money,
      errors: [{ messageId: 'confinement', data: { name: 'net_piasters' } }],
    },
    {
      name: 'the gateway fee column, outside payments',
      code: 'export interface Row { readonly gateway_fee_piasters: bigint }',
      filename: sessions,
      errors: 1,
    },
    {
      name: 'a gateway word beside an amount marker',
      code: 'export declare const net_total: bigint;',
      filename: sessions,
      errors: 1,
    },
  ],
});
