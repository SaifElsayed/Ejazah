// T023 — money, proved by spending it wrongly (FR-013, FR-016, FR-072, SC-003).
//
// Each case is red until T131 (R-MONEY-1), T045 (R-MONEY-2), T044 (R-MONEY-5) and T035
// (R-MONEY-6) implement the rule it names. Do not weaken an assertion and do not mark a case
// skipped to make the suite green: `proc/no-focused-or-skipped-test` (R-PROC-10) exists so that
// route stays closed.
//
// R-MONEY-6 carries two prohibitions under one identifier after ADR 0007, and one rule enforces
// both: wallet, ledger, balance and escrow vocabulary is refused *anywhere*, and the gateway's
// order, gross, fee and net amounts are refused *outside* `modules/payments` and
// `platform/ports/payment`. A fixture proving one proves nothing about the other, so each half
// carries its own case — the same reason T020 declared two cases for R-API-4.
//
// R-MONEY-2 and R-MONEY-5 are type-aware (research R-10), so their fixtures live inside the
// fixture TypeScript program and import the brand from `@ijazah/money`, declared by
// `tests/violations/fixtures/types/money-brand.d.ts` (see that file for why and when to delete it).
//
// The three fixtures that legitimately name amounts live in `modules/payments`, where
// money-carrying records belong, so `boundaries/no-money-vocabulary` stays silent on them and
// each file is red for exactly one reason.

import { describeViolations, type ViolationCase } from './harness';

const moneyViolations: readonly ViolationCase[] = [
  {
    constitutionId: 'R-MONEY-1',
    ruleId: 'money/no-number-in-money-position',
    ruleSet: 'fast',
    fixture: 'apps/api/src/modules/payments/package-price.ts',
    refuses: 'a declared money position typed as a plain number rather than the brand',
  },
  {
    constitutionId: 'R-MONEY-2',
    ruleId: 'money/require-piaster-suffix',
    ruleSet: 'typeAware',
    fixture: 'apps/api/src/modules/payments/price-label.ts',
    refuses: 'an identifier whose resolved type is money but whose name lacks the suffix',
  },
  {
    constitutionId: 'R-MONEY-5',
    ruleId: 'money/no-arithmetic-outside-package',
    ruleSet: 'typeAware',
    fixture: 'apps/api/src/modules/payments/fee-check.ts',
    refuses: 'arithmetic on branded money values outside packages/money',
  },
  {
    constitutionId: 'R-MONEY-6',
    ruleId: 'boundaries/no-money-vocabulary',
    ruleSet: 'fast',
    fixture: 'apps/api/src/modules/booking/wallet-ledger.ts',
    refuses: 'wallet, escrow and ledger vocabulary, which is banned anywhere',
  },
  {
    constitutionId: 'R-MONEY-6',
    ruleId: 'boundaries/no-money-vocabulary',
    ruleSet: 'fast',
    fixture: 'apps/api/src/modules/sessions/gateway-settlement.ts',
    refuses: "the gateway's gross, fee and net read by a module other than payments",
  },
];

describeViolations('T023 money violations', moneyViolations);
