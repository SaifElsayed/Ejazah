// T078 (FR-190, FR-194): what `PayoutStart` sends on a development build. The gateway's hosted
// recipient onboarding is Phase 2's; until then the stand-in has none, so the button sends these
// fixed provisional details to `teacher.payout.register` (contracts/ports.md "PaymentPort — the
// recipient operations"; quickstart §6). The board draws no form, so nothing is typed. A release
// build never offers the button: `__DEV__` is false there.
import type { PayoutDetailsInput } from '@ijazah/contracts';

/** True in a development build, where the button registers the provisional details. */
export function devRegistrationEnabled(): boolean {
  return __DEV__;
}

/** The stand-in's provisional details (OPEN-11), valid under the contract's `payoutDetails`. */
export const PROVISIONAL_PAYOUT_DETAILS: PayoutDetailsInput = {
  holderName: 'Development Teacher',
  method: 'bank_account',
  accountNumber: 'EG0000DEV0000001',
};
