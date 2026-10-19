// T025: the identity module's `otp_codes` rows as the `purge-otp-codes` sweep reaches them
// (R-API-6: through the module that owns the table). Queries only; the sweep decides the window.
import type { Database } from '../../platform/db/prisma.repository.js';

type Client = Pick<Database, 'otpCode'>;

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
}
