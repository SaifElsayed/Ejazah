// T093: the documents nothing points at (PR #80 review, finding 9; owner's decision 2026-10-19).
//
// A document is unreferenced when no `teacher_profiles.identity_document_id` (identity),
// `teacher_credentials.document_id` (catalog) or `verification_requests.document_id` (this module)
// points at it. This module reads its own pointer and asks the two other modules through the
// `DocumentReferences` their entries build, which `worker.ts` and `main.ts` hand in, so no module
// reaches another's table (R-API-6). Two readers use it: the `purge-unreferenced-documents` sweep
// (its `UnreferencedDocumentStore`), and the uploads route's per-user cap (`countOf`).
//
// A removal runs in one transaction: the row is deleted only while no request points at it, the
// object is removed through the callback, and the deletion commits only then. A row another
// module's row points at meanwhile is refused by its foreign key and answered false, its object
// untouched; an object that cannot be removed rolls the deletion back, so the next run retries it.
// The storage key is decrypted for the one `remove` and goes nowhere else (R-DB-8).
import type { ColumnCipher } from '../../platform/crypto/encryption.js';
import type { Database } from '../../platform/db/prisma.repository.js';
import { transactionsOver } from '../../platform/db/transaction.repository.js';
import {
  deleteDocumentWithoutRequest,
  DOCUMENT_STORAGE_KEY_COLUMN,
  isStillPointedAt,
  VerificationRepository,
} from './verification.repository.js';

/** What another module answers about the documents its rows point at. */
export interface DocumentReferences {
  /** Of `documentIds`, those a row of the module points at. */
  referencedAmong(documentIds: readonly string[]): Promise<ReadonlySet<string>>;
}

/** A document nothing points at, its storage key decrypted. */
export interface UnreferencedDocument {
  readonly id: string;
  readonly storageKey: string;
}

export interface UnreferencedDocumentsDependencies {
  readonly database: Database;
  readonly cipher: Pick<ColumnCipher, 'decrypt'>;
  /** The other modules' pointers: identity's and catalog's entries. */
  readonly references: readonly DocumentReferences[];
}

export class UnreferencedDocuments {
  readonly #documents: VerificationRepository;
  readonly #transactions;
  readonly #cipher: Pick<ColumnCipher, 'decrypt'>;
  readonly #references: readonly DocumentReferences[];

  constructor(dependencies: UnreferencedDocumentsDependencies) {
    this.#documents = new VerificationRepository(dependencies.database);
    this.#transactions = transactionsOver(dependencies.database);
    this.#cipher = dependencies.cipher;
    this.#references = dependencies.references;
  }

  /** The documents uploaded before `uploadedBefore` that nothing points at, keys decrypted. */
  async listUnreferencedUploadedBefore(
    uploadedBefore: Date,
  ): Promise<readonly UnreferencedDocument[]> {
    const candidates = await this.#documents.listWithoutRequestUploadedBefore(uploadedBefore);
    const pointed = await this.#pointedAmong(candidates.map(({ id }) => id));
    return candidates
      .filter(({ id }) => !pointed.has(id))
      .map(({ id, storageKeyEncrypted }) => ({
        id,
        storageKey: this.#cipher.decrypt(storageKeyEncrypted, DOCUMENT_STORAGE_KEY_COLUMN, id),
      }));
  }

  /** Deletes the row while nothing points at it, the object removed inside the deletion. */
  async removeUnreferenced(
    document: UnreferencedDocument,
    removeObject: (storageKey: string) => Promise<void>,
  ): Promise<boolean> {
    try {
      return await this.#transactions.run(async (tx) => {
        if (!(await deleteDocumentWithoutRequest(tx, document.id))) return false;
        await removeObject(document.storageKey);
        return true;
      });
    } catch (error: unknown) {
      if (isStillPointedAt(error)) return false;
      throw error;
    }
  }

  /** How many of `userId`'s documents nothing points at, of any age (the uploads cap). */
  async countOf(userId: string): Promise<number> {
    const ids = await this.#documents.idsWithoutRequestOf(userId);
    const pointed = await this.#pointedAmong(ids);
    return ids.filter((id) => !pointed.has(id)).length;
  }

  async #pointedAmong(ids: readonly string[]): Promise<ReadonlySet<string>> {
    if (ids.length === 0) return new Set();
    const answers = await Promise.all(this.#references.map((each) => each.referencedAmong(ids)));
    return new Set(answers.flatMap((answer) => [...answer]));
  }
}
