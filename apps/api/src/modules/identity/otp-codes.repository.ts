// T025: the identity module's `otp_codes` rows as the `purge-otp-codes` sweep reaches them
// (R-API-6: through the module that owns the table). T047 adds the queries a one-time code needs
// (research R-104): a new code replaces the live ones of its destination and purpose, an attempt is
// counted only below the cap, and a code is consumed once. Queries only; the caller decides.
import type { Database, Transaction } from '../../platform/db/prisma.repository.js';

type Client = Pick<Database, 'otpCode'>;
type Writer = Pick<Transaction, 'otpCode'>;

/** What a code is for (ERD §2, `otp_purpose`). */
export type OtpPurpose = 'signup' | 'login' | 'password_reset' | 'account_deletion';

/** What verifying a code reads of its row. */
export interface CodeRow {
  readonly id: string;
  readonly codeHash: string;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
}

export class OtpCodesRepository {
  readonly #database: Client;

  constructor(database: Client) {
    this.#database = database;
  }

  /** Deletes the consumed codes and those expired before `expiredBefore`; how many went. */
  async removeConsumedOrExpiredBefore(expiredBefore: Date): Promise<number> {
    const { count } = await this.#database.otpCode.deleteMany({
      where: { OR: [{ consumedAt: { not: null } }, { expiresAt: { lt: expiredBefore } }] },
    });
    return count;
  }

  /** Writes a code, removing the unconsumed ones of its destination and purpose first. */
  async replace(
    tx: Writer,
    code: {
      readonly destination: string;
      readonly purpose: OtpPurpose;
      readonly codeHash: string;
      readonly expiresAt: Date;
    },
  ): Promise<void> {
    await tx.otpCode.deleteMany({
      where: { destination: code.destination, purpose: code.purpose, consumedAt: null },
    });
    await tx.otpCode.create({ data: code, select: { id: true } });
  }

  /** The newest code of a destination and purpose. */
  findLatest(destination: string, purpose: OtpPurpose): Promise<CodeRow | null> {
    return this.#database.otpCode.findFirst({
      where: { destination, purpose },
      orderBy: { createdAt: 'desc' },
      select: { id: true, codeHash: true, expiresAt: true, consumedAt: true },
    });
  }

  /** Counts one attempt, only while the row is unconsumed and below `max`; true when counted. */
  async countAttempt(id: string, max: number): Promise<boolean> {
    const { count } = await this.#database.otpCode.updateMany({
      where: { id, consumedAt: null, attemptCount: { lt: max } },
      data: { attemptCount: { increment: 1 } },
    });
    return count === 1;
  }

  /** Consumes the row once; true for the one call that did. */
  async consume(id: string, at: Date): Promise<boolean> {
    const { count } = await this.#database.otpCode.updateMany({
      where: { id, consumedAt: null },
      data: { consumedAt: at },
    });
    return count === 1;
  }
}
