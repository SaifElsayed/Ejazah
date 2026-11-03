// T077: the payout columns of `teacher_profiles` (FR-190 to FR-194, research R-114). Queries only;
// the service decides what is written, and the cipher what the reference is stored as. Each change
// is one conditional `updateMany`, so a verdict for a hash no teacher holds changes nothing and is
// told so by a false.
import type { Database, Transaction } from '../../platform/db/prisma.repository.js';

type Client = Pick<Database, 'teacherProfile'>;
type Writer = Pick<Transaction, 'teacherProfile'>;

/** What `teacher.payout.get` reads of a teacher's profile. */
export interface PayoutRow {
  readonly payoutConfiguredAt: Date | null;
  readonly payoutVerifiedAt: Date | null;
  readonly payoutRejectedReason: string | null;
}

/** A registration as it is stored: the encrypted reference, its lookup hash, the instant. */
export interface StoredRecipient {
  readonly encrypted: Uint8Array;
  readonly refHash: string;
  readonly configuredAt: Date;
}

export class PayoutRepository {
  readonly #database: Client;

  constructor(database: Client) {
    this.#database = database;
  }

  /** The id of the teacher's profile, the row a reference is bound to; null when there is none. */
  async profileIdOf(teacherUserId: string): Promise<string | null> {
    const row = await this.#database.teacherProfile.findUnique({
      where: { userId: teacherUserId },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  /** The teacher's payout state; null when there is no profile. */
  stateOf(teacherUserId: string): Promise<PayoutRow | null> {
    return this.#database.teacherProfile.findUnique({
      where: { userId: teacherUserId },
      select: { payoutConfiguredAt: true, payoutVerifiedAt: true, payoutRejectedReason: true },
    });
  }

  /**
   * Stores a registration on the profile, the first or a replacement: the account is unverified and
   * the last rejection gone until the gateway speaks of the new reference. False if the row is gone.
   */
  async storeRecipient(
    tx: Writer,
    profileId: string,
    recipient: StoredRecipient,
  ): Promise<boolean> {
    const { count } = await tx.teacherProfile.updateMany({
      where: { id: profileId },
      data: {
        payoutAccountRefEncrypted: Uint8Array.from(recipient.encrypted),
        payoutAccountRefHash: recipient.refHash,
        payoutConfiguredAt: recipient.configuredAt,
        payoutVerifiedAt: null,
        payoutRejectedReason: null,
      },
    });
    return count === 1;
  }
}

/**
 * Sets the verified instant where the reference hashing to `refHash` is not verified yet, and clears
 * the last rejection. True when a teacher holds the hash, a verified one included (its first instant
 * is kept); false when none does.
 */
export async function markVerified(tx: Writer, refHash: string, at: Date): Promise<boolean> {
  const { count } = await tx.teacherProfile.updateMany({
    where: { payoutAccountRefHash: refHash, payoutVerifiedAt: null },
    data: { payoutVerifiedAt: at, payoutRejectedReason: null },
  });
  if (count === 1) return true;
  return (await tx.teacherProfile.count({ where: { payoutAccountRefHash: refHash } })) === 1;
}

/** Keeps the rejection's reason and leaves the account unverified; false when no teacher holds the hash. */
export async function markRejected(tx: Writer, refHash: string, reason: string): Promise<boolean> {
  const { count } = await tx.teacherProfile.updateMany({
    where: { payoutAccountRefHash: refHash },
    data: { payoutVerifiedAt: null, payoutRejectedReason: reason },
  });
  return count === 1;
}

/** The account of the teacher holding the reference hashing to `refHash`; null when none does. */
export async function payoutHolderOf(tx: Writer, refHash: string): Promise<string | null> {
  const row = await tx.teacherProfile.findFirst({
    where: { payoutAccountRefHash: refHash },
    select: { userId: true },
  });
  return row?.userId ?? null;
}
