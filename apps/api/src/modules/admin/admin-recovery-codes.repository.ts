// T066 (FR-171, research R-107): an administrator's recovery codes on `admin_recovery_codes`, each a
// peppered hash in the one-time-code regime. Queries only: the service hashes and compares. The set
// is replaced whole (setup, regeneration) and emptied by a second-factor reset; the application role
// keeps DELETE on the table (data-model §2).
import type { Database, Transaction } from '../../platform/db/prisma.repository.js';

type Client = Pick<Database, 'adminRecoveryCode'>;
type Writer = Pick<Transaction, 'adminRecoveryCode'>;

export interface RecoveryCodeRow {
  readonly id: string;
  readonly codeHash: string;
}

export class AdminRecoveryCodesRepository {
  readonly #database: Client;

  constructor(database: Client) {
    this.#database = database;
  }

  /** The codes not yet used, oldest first. */
  async unused(adminId: string): Promise<readonly RecoveryCodeRow[]> {
    return this.#database.adminRecoveryCode.findMany({
      where: { adminId, usedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, codeHash: true },
    });
  }

  /** Spends a code, where it is unused; false if another request spent it first. */
  async use(tx: Writer, id: string, now: Date): Promise<boolean> {
    const { count } = await tx.adminRecoveryCode.updateMany({
      where: { id, usedAt: null },
      data: { usedAt: now },
    });
    return count === 1;
  }

  /** How many codes are left unused. */
  async countUnused(tx: Writer, adminId: string): Promise<number> {
    return tx.adminRecoveryCode.count({ where: { adminId, usedAt: null } });
  }

  /** Replaces the set with `codeHashes`. */
  async replace(tx: Writer, adminId: string, codeHashes: readonly string[]): Promise<void> {
    await tx.adminRecoveryCode.deleteMany({ where: { adminId } });
    await tx.adminRecoveryCode.createMany({
      data: codeHashes.map((codeHash) => ({ adminId, codeHash })),
    });
  }

  /** Deletes every code of the administrator (FR-173). */
  async removeAll(tx: Writer, adminId: string): Promise<void> {
    await tx.adminRecoveryCode.deleteMany({ where: { adminId } });
  }
}
