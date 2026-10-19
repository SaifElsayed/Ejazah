// T155: the admin module's `_encrypted` column, `admin_users.mfa_secret_encrypted`, as the
// `reencrypt-columns` job reaches it (R-API-6: through the module that owns the table). Queries
// only; the cipher decides what is written.
//
// A page is rows in id order, after the last row of the page before. A value is replaced only where
// the row still holds the one read, so a value written meanwhile is kept.
import type { EncryptedColumn } from '../../platform/crypto/encryption.js';
import type { Database, Transaction } from '../../platform/db/prisma.repository.js';

type Client = Pick<Database, 'adminUser'>;

/** An administrator's display name at read time, for the audit pages (T021, FR-181); null if none. */
export async function readAdministratorName(
  tx: Pick<Transaction, 'adminUser'>,
  adminId: string,
): Promise<string | null> {
  const row = await tx.adminUser.findUnique({
    where: { id: adminId },
    select: { displayName: true },
  });
  return row?.displayName ?? null;
}

export class AdminUsersRepository {
  readonly #database: Client;

  constructor(database: Client) {
    this.#database = database;
  }

  /** `admin_users.mfa_secret_encrypted`: every administrator's MFA secret (NFR-SEC-6). */
  mfaSecrets(): EncryptedColumn {
    const admins = this.#database.adminUser;
    return {
      column: 'admin_users.mfa_secret_encrypted',
      page: async (after, limit) => {
        const rows = await admins.findMany({
          where: after === undefined ? {} : { id: { gt: after } },
          orderBy: { id: 'asc' },
          take: limit,
          select: { id: true, mfaSecretEncrypted: true },
        });
        return rows.map(({ id, mfaSecretEncrypted: value }) => ({ id, value }));
      },
      replace: async (id, stored, next) => {
        const { count } = await admins.updateMany({
          where: { id, mfaSecretEncrypted: { equals: Uint8Array.from(stored) } },
          data: { mfaSecretEncrypted: Uint8Array.from(next) },
        });
        return count === 1;
      },
    };
  }
}
