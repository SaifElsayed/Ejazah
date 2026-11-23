// 006:T008 of specs/006-programme (FR-706b, FR-716; SRS DEC-101; PR #155's review, round 1, N4):
// «unverified in live mode», one payments entry read by T008's `pay_blocked` window and by T016's
// and T018's reads. True only when the payment mode is `live` and the teacher's payout recipient
// answers none: the same read as the checkout's split step (`checkout.service.ts`,
// `payoutRecipient`, identity's `payoutRecipientOf`), which answers a reference only while the
// gateway has verified the account (`payout_verified_at` set). In `test` mode the stand-in takes a
// checkout with no payee, so nothing is blocked and nothing is read. The mode is
// `config.PAYMENT_MODE`, handed in by the composition root; the reference is a secret of the
// gateway's and never leaves this function (R-SEC-2): only whether there is one.
import type { ColumnCipher } from '../../platform/crypto/encryption.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { payoutRecipientOf } from '../identity/index.js';

/** `config.PAYMENT_MODE` (`env.schema.ts`), which the composition root hands in. */
export type PaymentMode = 'test' | 'live';

/** «Unverified in live mode» (this file's head). */
export interface ProgrammePayee {
  unverifiedInLiveMode(tx: Transaction, teacherUserId: string): Promise<boolean>;
}

export function createProgrammePayee({
  paymentMode,
  cipher,
  recipientOf = (tx, teacherUserId) => payoutRecipientOf(tx, cipher, teacherUserId),
}: {
  readonly paymentMode: PaymentMode;
  readonly cipher: Pick<ColumnCipher, 'decrypt'>;
  /** The teacher's verified payout recipient, or null; identity's read unless a spec stands one in. */
  readonly recipientOf?: (tx: Transaction, teacherUserId: string) => Promise<string | null>;
}): ProgrammePayee {
  return {
    unverifiedInLiveMode: async (tx, teacherUserId) =>
      paymentMode === 'live' && (await recipientOf(tx, teacherUserId)) === null,
  };
}
