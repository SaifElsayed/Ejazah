// B16 (T082; the B16 check, decision 1, the owner's decision 2026-10-26 on the reviewer's advice;
// ADR 0015 D3, FR-141, Egypt PDPL): a deleted person's documents.
//
// - IN THE DELETION'S TRANSACTION. `documentErasureConsequence` is this module's subscriber to the
//   identity module's consequences registry (R-121: verification imports identity's entry, never the
//   reverse). On `account_deleted` it sets `erased_at` on every document of the person and leaves
//   every key, so a rolled-back deletion leaves the documents as they were and a committed one has
//   already made them unreadable (`readDocument` answers an erased document as none). The rows
//   stay: profiles and credentials point at them (ON DELETE RESTRICT).
// - AFTER THE COMMIT. `eraseFilesOf(userId)` removes each erased document's file through the storage
//   port and clears its key only once the removal succeeded, where the row still holds the key whose
//   file was removed. A removal that fails throws, so the deletion reports it; the key stays.
// - THE JOB. `pendingPage` and `clearKey` are the `erase-deleted-files` sweep's store: every erased
//   document still holding a key, in id order, and the conditional clear. So no identity document
//   outlives its key unseen (rule 34 holds that a key never goes without `erased_at`).
//
// The key is decrypted for the one removal and goes nowhere else (R-DB-8, R-SEC-2).
import type { ColumnCipher } from '../../platform/crypto/encryption.js';
import type { Database } from '../../platform/db/prisma.repository.js';
import type { StoragePort } from '../../platform/ports/storage/storage.port.js';
import type { AccountConsequence } from '../identity/index.js';
import {
  DOCUMENT_STORAGE_KEY_COLUMN,
  type ErasedDocumentRow,
  markDocumentsErased,
  VerificationRepository,
} from './verification.repository.js';

/** A file still to be removed: the row's id and its storage key, decrypted. */
export interface ErasedFile {
  readonly id: string;
  readonly storageKey: string;
}

/** The subscriber the composition adds to the consequences registry (`main.ts`). */
export function documentErasureConsequence(now: () => Date = () => new Date()): AccountConsequence {
  return async (tx, userId, cause) => {
    if (cause !== 'account_deleted') return;
    await markDocumentsErased(tx, userId, now());
  };
}

export interface DocumentErasureDependencies {
  readonly database: Database;
  readonly cipher: Pick<ColumnCipher, 'decrypt'>;
  readonly storage: Pick<StoragePort, 'remove'>;
}

export class DocumentErasure {
  readonly #documents: VerificationRepository;
  readonly #cipher: Pick<ColumnCipher, 'decrypt'>;
  readonly #storage: Pick<StoragePort, 'remove'>;

  constructor(dependencies: DocumentErasureDependencies) {
    this.#documents = new VerificationRepository(dependencies.database);
    this.#cipher = dependencies.cipher;
    this.#storage = dependencies.storage;
  }

  /** Removes the files of `userId`'s erased documents, each key cleared once its file is gone. */
  async eraseFilesOf(userId: string): Promise<void> {
    const rows = await this.#documents.erasedWithKeyOf(userId);
    const failures: unknown[] = [];
    for (const file of rows.map((row) => this.#decrypted(row))) {
      try {
        await this.#storage.remove(file.storageKey);
        await this.clearKey(file);
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'A deleted person’s document could not be removed.');
    }
  }

  /** A page of every erased document still holding a key, keys decrypted (the job's store). */
  async pendingPage(after: string | undefined, limit: number): Promise<readonly ErasedFile[]> {
    const rows = await this.#documents.erasedWithKeyPage(after, limit);
    return rows.map((row) => this.#decrypted(row));
  }

  /** Clears the key once its file is gone, only where the row still holds it; whether it did. */
  async clearKey(file: ErasedFile): Promise<boolean> {
    const row = await this.#documents.erasedWithKey(file.id);
    if (row === null || this.#decrypted(row).storageKey !== file.storageKey) return false;
    return this.#documents.clearErasedKey(row.id, row.storageKeyEncrypted);
  }

  #decrypted({ id, storageKeyEncrypted }: ErasedDocumentRow): ErasedFile {
    return {
      id,
      storageKey: this.#cipher.decrypt(storageKeyEncrypted, DOCUMENT_STORAGE_KEY_COLUMN, id),
    };
  }
}
