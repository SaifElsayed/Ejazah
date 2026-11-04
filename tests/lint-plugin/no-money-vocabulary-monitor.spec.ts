// boundaries/no-money-vocabulary's one leave for the admin's payments monitor (T052; the owner's
// decision of 2026-11-04, R-MONEY-6, ADR 0007).
//
// FR-400 asks the monitor for gross, fee and net as the gateway reported them, so `paymentFolders`
// widens by the narrowest leave: the one contracts file `packages/contracts/src/admin/payments.ts`
// and the one panel folder `apps/admin/src/pages/payments/`. Those two only show the reported
// figures. Every other file stays refused, the student's screens and `checkout.status` above all,
// and a file whose name merely starts like the allowed one is not it.

import { loadRule, typescriptRuleTester } from '../support/rule-tester';

const contract = 'packages/contracts/src/admin/payments.ts';
const page = 'apps/admin/src/pages/payments/AdminPayments.tsx';
const panel = 'apps/admin/src/pages/payments/PaymentPanel.tsx';

const amounts =
  'export interface Row { readonly grossPiasters: number; readonly gatewayFeePiasters: number; readonly netPiasters: number }';
const snakeAmounts =
  'export interface Row { readonly gross_piasters: number; readonly gatewayFee_piasters: number; readonly net_piasters: number }';

/** Every file the leave must not reach, each refused on the gross amount. */
const refused: readonly (readonly [string, string])[] = [
  ['a student screen', 'apps/mobile/src/features/student/checkout/screens/Checkout.tsx'],
  ['a teacher screen', 'apps/mobile/src/features/teacher/payout-setup/screens/Payout.tsx'],
  ['checkout.status’ contract', 'packages/contracts/src/checkout.ts'],
  ['another admin contracts file', 'packages/contracts/src/admin/credentials.ts'],
  ['a payments contracts file outside admin', 'packages/contracts/src/payments.ts'],
  ['the contracts package’s entry', 'packages/contracts/src/admin/index.ts'],
  ['another panel page folder', 'apps/admin/src/pages/audit/AdminAudit.tsx'],
  ['the panel’s formatter', 'apps/admin/src/lib/format.ts'],
  ['the panel’s design components', 'apps/admin/src/design/components/DataTable.tsx'],
  ['a payments folder below another page', 'apps/admin/src/pages/home/payments/Row.tsx'],
  ['a folder that starts like the allowed one', 'apps/admin/src/pages/payments-old/Row.tsx'],
  ['a file that starts like the allowed one', 'packages/contracts/src/admin/payments.ts.bak'],
  ['a file whose name extends the allowed one', 'packages/contracts/src/admin/payments-extra.ts'],
  ['a folder of the allowed file’s name', 'packages/contracts/src/admin/payments/row.ts'],
];

typescriptRuleTester().run(
  'boundaries/no-money-vocabulary (the monitor’s leave)',
  loadRule('no-money-vocabulary.js'),
  {
    valid: [
      { name: 'the monitor’s contracts, camelCase', code: amounts, filename: contract },
      {
        name: 'the monitor’s contracts, the `_piasters` spelling',
        code: snakeAmounts,
        filename: contract,
      },
      {
        name: 'the gross column’s own name in the monitor’s contracts',
        code: 'export const row = { gross_piasters: 0 };',
        filename: contract,
      },
      { name: 'the monitor’s page', code: amounts, filename: page },
      { name: 'the monitor’s detail panel', code: snakeAmounts, filename: panel },
      {
        name: 'a JSX element in the monitor’s folder',
        code: 'export const Cell = () => <NetPiasters />;',
        filename: page,
      },
    ],
    invalid: [
      ...refused.map(([name, filename]) => ({
        name: `${name} is still refused`,
        code: 'export interface Row { readonly gross_piasters: number }',
        filename,
        errors: [{ messageId: 'confinement' as const, data: { name: 'gross_piasters' } }],
      })),
      {
        name: 'every gateway amount is still refused on a student screen',
        code: amounts,
        filename: 'apps/mobile/src/features/student/checkout/screens/Checkout.tsx',
        errors: [
          { messageId: 'confinement', data: { name: 'grossPiasters' } },
          { messageId: 'confinement', data: { name: 'gatewayFeePiasters' } },
          { messageId: 'confinement', data: { name: 'netPiasters' } },
        ],
      },
      {
        name: 'the leave is for the amounts only: held-funds vocabulary is refused in the monitor’s contracts',
        code: 'export const walletId = "w";',
        filename: contract,
        errors: [{ messageId: 'vocabulary', data: { name: 'walletId', term: 'wallet' } }],
      },
      {
        name: 'and in the monitor’s folder',
        code: 'export const ledgerRow = 1;',
        filename: page,
        errors: [{ messageId: 'vocabulary', data: { name: 'ledgerRow', term: 'ledger' } }],
      },
    ],
  },
);
