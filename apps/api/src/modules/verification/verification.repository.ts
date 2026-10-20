// T155: the verification module's `_encrypted` column, `verification_documents.storage_key_encrypted`,
// as the `reencrypt-columns` job reaches it (R-API-6: through the module that owns the table), and
// (T024) the document row the uploads route writes and the link minting reads. Queries only; the
// cipher decides what is written.
//
// A page is rows in id order, after the last row of the page before. A value is replaced only where
// the row still holds the one read, so a value written meanwhile is kept.
//
// T093 adds the unreferenced documents' reads and their deletion: this table's own pointer
// (`verification_requests.document_id`) is read here, the other modules' through their entries
// (`unreferenced-documents.ts`), and a deletion another module's row would orphan is refused by its
// foreign key (`ON DELETE RESTRICT`), which `isStillPointedAt` recognises.
import { Prisma } from '@prisma/client';

import type { EncryptedColumn } from '../../platform/crypto/encryption.js';
import type { Database, Transaction } from '../../platform/db/prisma.repository.js';

const FOREIGN_KEY_VIOLATION = 'P2003';

/** Whether a document's deletion was refused because another module's row points at it (T093). */
export function isStillPointedAt(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === FOREIGN_KEY_VIOLATION
  );
}

type Client = Pick<Database, 'verificationDocument'>;

/** The column the document's storage key is encrypted in, as the cipher binds it (R-DB-8). */
export const DOCUMENT_STORAGE_KEY_COLUMN = 'verification_documents.storage_key_encrypted';

/** A document row as the uploads route writes it (T024). */
export interface NewDocument {
  readonly id: string;
  readonly userId: string;
  readonly documentType: 'credential' | 'other';
  readonly storageKeyEncrypted: Uint8Array;
}

/** A document row as the link minting reads it (T024). */
export interface StoredDocument {
  readonly id: string;
  readonly userId: string;
  readonly storageKeyEncrypted: Uint8Array;
}

/**
 * Deletes the document on `tx` while no verification request points at it (T093); whether it did.
 * A row another module points at is refused by its foreign key, which fails the transaction.
 */
export async function deleteDocumentWithoutRequest(
  tx: Pick<Transaction, 'verificationDocument'>,
  id: string,
): Promise<boolean> {
  const { count } = await tx.verificationDocument.deleteMany({
    where: { id, verificationRequests: { none: {} } },
  });
  return count === 1;
}

/** The document, on the reading transaction; null when there is none. */
export function readDocument(
  tx: Pick<Transaction, 'verificationDocument'>,
  id: string,
): Promise<StoredDocument | null> {
  return tx.verificationDocument.findUnique({
    where: { id },
    select: { id: true, userId: true, storageKeyEncrypted: true },
  });
}

export class VerificationRepository {
  readonly #database: Client;

  constructor(database: Client) {
    this.#database = database;
  }

  /** Writes the row the uploads route minted (T024). */
  async createDocument(row: NewDocument): Promise<void> {
    await this.#database.verificationDocument.create({
      data: {
        id: row.id,
        userId: row.userId,
        documentType: row.documentType,
        storageKeyEncrypted: Uint8Array.from(row.storageKeyEncrypted),
      },
    });
  }

  /**
   * The documents uploaded before `uploadedBefore` that no verification request points at (T093);
   * the other modules' pointers are theirs to read.
   */
  async listWithoutRequestUploadedBefore(uploadedBefore: Date): Promise<StoredDocument[]> {
    return this.#database.verificationDocument.findMany({
      where: { uploadedAt: { lt: uploadedBefore }, verificationRequests: { none: {} } },
      orderBy: { id: 'asc' },
      select: { id: true, userId: true, storageKeyEncrypted: true },
    });
  }

  /** The ids of `userId`'s documents that no verification request points at (T093). */
  async idsWithoutRequestOf(userId: string): Promise<string[]> {
    const rows = await this.#database.verificationDocument.findMany({
      where: { userId, verificationRequests: { none: {} } },
      select: { id: true },
    });
    return rows.map(({ id }) => id);
  }

  /** `verification_documents.storage_key_encrypted`: an identity document's storage key. */
  documentStorageKeys(): EncryptedColumn {
    const documents = this.#database.verificationDocument;
    return {
      column: DOCUMENT_STORAGE_KEY_COLUMN,
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
