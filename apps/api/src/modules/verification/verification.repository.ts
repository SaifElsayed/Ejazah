// T155: the verification module's `_encrypted` column, `verification_documents.storage_key_encrypted`,
// as the `reencrypt-columns` job reaches it (R-API-6: through the module that owns the table).
// Queries only; the cipher decides what is written.
//
// A page is rows in id order, after the last row of the page before. A value is replaced only where
// the row still holds the one read, so a value written meanwhile is kept.
import type { EncryptedColumn } from '../../platform/crypto/encryption.js';
import type { Database } from '../../platform/db/prisma.repository.js';

type Client = Pick<Database, 'verificationDocument'>;

export class VerificationRepository {
  readonly #database: Client;

  constructor(database: Client) {
    this.#database = database;
  }

  /** `verification_documents.storage_key_encrypted`: an identity document's storage key. */
  documentStorageKeys(): EncryptedColumn {
    const documents = this.#database.verificationDocument;
    return {
      column: 'verification_documents.storage_key_encrypted',
      page: async (after, limit) => {
        const rows = await documents.findMany({
          where: after === undefined ? {} : { id: { gt: after } },
          orderBy: { id: 'asc' },
          take: limit,
          select: { id: true, storageKeyEncrypted: true },
        });
        return rows.map(({ id, storageKeyEncrypted: value }) => ({ id, value }));
      },
      replace: async (id, stored, next) => {
        const { count } = await documents.updateMany({
          where: { id, storageKeyEncrypted: { equals: Uint8Array.from(stored) } },
          data: { storageKeyEncrypted: Uint8Array.from(next) },
        });
        return count === 1;
      },
    };
  }
}
