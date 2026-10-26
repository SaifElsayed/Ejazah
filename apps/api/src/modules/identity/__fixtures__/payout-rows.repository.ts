// B15 (T075): the payout columns the payout specs read back, and nothing a request ever runs. Only
// an identity repository may reach the identity tables (R-API-6), so the specs reach them through
// this one, as `rows.repository.ts` does for the others.
import type { Database } from '../../../platform/db/prisma.repository.js';

/** The payout columns of one profile, and its id, the row a reference is bound to. */
export interface PayoutColumns {
  readonly id: string;
  readonly payoutAccountRefEncrypted: Uint8Array | null;
  readonly payoutAccountRefHash: string | null;
  readonly payoutConfiguredAt: Date | null;
  readonly payoutVerifiedAt: Date | null;
  readonly payoutRejectedReason: string | null;
}

/** The payout columns of a teacher's profile, as the specs read them back. */
export class PayoutRows {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  profile(userId: string): Promise<PayoutColumns | null> {
    return this.#database.teacherProfile.findUnique({
      where: { userId },
      select: {
        id: true,
        payoutAccountRefEncrypted: true,
        payoutAccountRefHash: true,
        payoutConfiguredAt: true,
        payoutVerifiedAt: true,
        payoutRejectedReason: true,
      },
    });
  }

  holdersOf(refHash: string): Promise<number> {
    return this.#database.teacherProfile.count({ where: { payoutAccountRefHash: refHash } });
  }
}
