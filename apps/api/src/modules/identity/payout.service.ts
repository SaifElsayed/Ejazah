// T077 (FR-190 to FR-194, research R-114): payout setup. The specs are T075's identity half
// (payout.service.spec.ts) and the router's refusals (payout.router.spec.ts).
//
// - `register` hands the details to the payment port outside any database transaction (B15 check,
//   decision 5), then stores the gateway's recipient reference encrypted and bound to the profile's
//   row with its lookup hash, sets `payout_configured_at` and clears `payout_verified_at` and the
//   last rejection, keyed through the kernel's idempotency (FR-106): the transaction only writes the
//   row. It serves the first setup and a replacement (FR-193). The details are never stored or
//   logged; only the reference the port answered is kept (FR-PAYG-13, R-DB-8).
//   Phase 2 note: a retry with the same key asks the port again before it is answered from the
//   stored row, so the gateway holds a recipient nobody refers to; harmless with the stand-in, and
//   the gateway task decides whether its gateway needs that recipient removed.
// - `markPayoutVerified` and `markPayoutRejected` are the payments module's two entries, called on
//   its transaction with the hash of the reference the signed event carried (R-114, R-121: payments
//   calls identity, never back). Each answers false for a hash no teacher holds and changes no row,
//   so a verdict for an account a replacement retired changes nothing. The gateway's latest verdict
//   stands: a rejection leaves even a verified account unverified, a verification clears the
//   rejection, and a second verification keeps the first instant. A reason is kept as plain text,
//   control characters made spaces and cut to the contract's length; a rejection with no reason is
//   kept as an empty one, so it still reads as a rejection.
// - `get` reads the four states; a verified instant reads as verified whatever else the row holds,
//   as the standing the session resolves does (FR-192).
import { createHash } from 'node:crypto';

import {
  PAYOUT_REJECTED_REASON_MAX_LENGTH,
  type PayoutGetOutput,
  type PayoutRegisterInput,
} from '@ijazah/contracts';

import { ColumnCipher } from '../../platform/crypto/encryption.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import type { PaymentPort } from '../../platform/ports/payment/payment.port.js';
import {
  markRejected,
  markVerified,
  type PayoutRow,
  PayoutRepository,
} from './payout.repository.js';
import type { IdentityDependencies } from './session.service.js';

/** The column the recipient reference is encrypted under, bound to the profile's id (R-DB-8). */
export const PAYOUT_ACCOUNT_REF_COLUMN = 'teacher_profiles.payout_account_ref_encrypted';

/** What payout setup is built over, beside the module's own dependencies. */
export interface PayoutDependencies extends IdentityDependencies {
  readonly payment: Pick<PaymentPort, 'registerPayoutRecipient'>;
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'run'>;
}

/** The SHA-256 lookup hash of a gateway recipient reference, as stored beside it (R-114). */
export function payoutRefHash(recipientRef: string): string {
  return createHash('sha256').update(recipientRef, 'utf8').digest('hex');
}

function stateOf(row: PayoutRow | null): PayoutGetOutput {
  if (row?.payoutVerifiedAt != null) {
    return {
      state: 'verified',
      ...(row.payoutConfiguredAt === null
        ? {}
        : { configuredAt: row.payoutConfiguredAt.toISOString() }),
      verifiedAt: row.payoutVerifiedAt.toISOString(),
    };
  }
  if (row?.payoutConfiguredAt == null) return { state: 'not_configured' };
  const configuredAt = row.payoutConfiguredAt.toISOString();
  if (row.payoutRejectedReason === null) return { state: 'pending_verification', configuredAt };
  return {
    state: 'rejected',
    configuredAt,
    ...(row.payoutRejectedReason === '' ? {} : { rejectedReason: row.payoutRejectedReason }),
  };
}

export class PayoutService {
  readonly #payouts: PayoutRepository;
  readonly #cipher: ColumnCipher;
  readonly #payment: PayoutDependencies['payment'];
  readonly #idempotency: PayoutDependencies['idempotency'];
  readonly #now: () => Date;

  constructor(dependencies: PayoutDependencies) {
    this.#payouts = new PayoutRepository(dependencies.database);
    this.#cipher = new ColumnCipher(dependencies.encryptionKey);
    this.#payment = dependencies.payment;
    this.#idempotency = dependencies.idempotency;
    this.#now = dependencies.now ?? (() => new Date());
  }

  /** `teacher.payout.get`: the state the four payout screens show. */
  async get(teacherUserId: string): Promise<PayoutGetOutput> {
    return stateOf(await this.#payouts.stateOf(teacherUserId));
  }

  /** `teacher.payout.register`: the first setup or a replacement. */
  async register(
    teacherUserId: string,
    { details, idempotencyKey }: PayoutRegisterInput,
  ): Promise<void> {
    const profileId = await this.#payouts.profileIdOf(teacherUserId);
    if (profileId === null) throw new DomainError('FORBIDDEN');
    const recipientRef = await this.#payment.registerPayoutRecipient(teacherUserId, details);
    const recipient = {
      encrypted: this.#cipher.encrypt(recipientRef, PAYOUT_ACCOUNT_REF_COLUMN, profileId),
      refHash: payoutRefHash(recipientRef),
      configuredAt: this.#now(),
    };
    await this.#idempotency.run(
      {
        scope: 'teacher.payout.register',
        key: idempotencyKey,
        actorId: teacherUserId,
        input: { details },
      },
      async (tx) => {
        // A profile is never hard-deleted, so the row read above is still there.
        if (!(await this.#payouts.storeRecipient(tx, profileId, recipient))) {
          throw new Error('payout: the teacher profile disappeared during registration');
        }
        return null;
      },
    );
  }
}

type Writer = Pick<Transaction, 'teacherProfile'>;

/** The gateway verified the recipient whose reference hashes to `refHash`; false if no teacher holds it. */
export function markPayoutVerified(tx: Writer, refHash: string, at: Date): Promise<boolean> {
  return markVerified(tx, refHash, at);
}

/** The gateway rejected that recipient, with its reason where it sent one; false if no teacher holds it. */
export function markPayoutRejected(
  tx: Writer,
  refHash: string,
  reason: string | undefined,
): Promise<boolean> {
  return markRejected(tx, refHash, plainReason(reason));
}

/**
 * The reason as it is kept and shown: plain text on one line, control characters and runs of
 * spaces made one space, cut to the contract's length without splitting a character; empty when
 * the gateway sent none.
 */
function plainReason(reason: string | undefined): string {
  const text = (reason ?? '').replace(/[\p{Cc}\s]+/gu, ' ').trim();
  let cut = '';
  for (const character of text) {
    if (cut.length + character.length > PAYOUT_REJECTED_REASON_MAX_LENGTH) break;
    cut += character;
  }
  return cut.trimEnd();
}
