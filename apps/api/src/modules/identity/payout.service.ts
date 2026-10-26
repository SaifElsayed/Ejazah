// T077 (FR-190 to FR-194, research R-114): payout setup. B15's step zero fixes the shapes the
// router, the payments module and the phone build against; lane A of B15 builds the bodies from
// T075's specs.
//
// - `register` hands the details to the payment port outside any database transaction (B15 check,
//   decision 5), then stores the gateway's recipient reference encrypted and row-bound with its
//   lookup hash, sets `payout_configured_at` and clears `payout_verified_at` and the last rejection,
//   keyed through the kernel's idempotency (FR-106). It serves the first setup and a replacement.
// - `markPayoutVerified` and `markPayoutRejected` are the payments module's two entries, called on
//   its transaction with the hash of the reference the signed event carried (R-114, R-121: payments
//   calls identity, never back). Each answers false for a hash no teacher holds.
import { createHash } from 'node:crypto';

import type { PayoutGetOutput, PayoutRegisterInput } from '@ijazah/contracts';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import type { PaymentPort } from '../../platform/ports/payment/payment.port.js';
import type { IdentityDependencies } from './session.service.js';

/** What payout setup is built over, beside the module's own dependencies. */
export interface PayoutDependencies extends IdentityDependencies {
  readonly payment: Pick<PaymentPort, 'registerPayoutRecipient'>;
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'run'>;
}

/** The SHA-256 lookup hash of a gateway recipient reference, as stored beside it (R-114). */
export function payoutRefHash(recipientRef: string): string {
  return createHash('sha256').update(recipientRef, 'utf8').digest('hex');
}

export class PayoutService {
  constructor(_dependencies: PayoutDependencies) {}

  /** `teacher.payout.get`: the state the four payout screens show. */
  get(_teacherUserId: string): Promise<PayoutGetOutput> {
    return Promise.reject(new Error('T077: payout setup is built by lane A of B15.'));
  }

  /** `teacher.payout.register`: the first setup or a replacement. */
  register(_teacherUserId: string, _input: PayoutRegisterInput): Promise<void> {
    return Promise.reject(new Error('T077: payout setup is built by lane A of B15.'));
  }
}

type Writer = Pick<Transaction, 'teacherProfile'>;

/** The gateway verified the recipient whose reference hashes to `refHash`; false if no teacher holds it. */
export function markPayoutVerified(_tx: Writer, _refHash: string, _at: Date): Promise<boolean> {
  return Promise.reject(new Error('T077: built by lane A of B15.'));
}

/** The gateway rejected that recipient, with its reason where it sent one; false if no teacher holds it. */
export function markPayoutRejected(
  _tx: Writer,
  _refHash: string,
  _reason: string | undefined,
): Promise<boolean> {
  return Promise.reject(new Error('T077: built by lane A of B15.'));
}
