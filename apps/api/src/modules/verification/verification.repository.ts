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
//
// T056, T057 add the reads the application and the credentials make on their transaction: which of
// a set of documents a person uploaded, and the size each upload recorded.
//
// B16 (the B16 check, decision 1) adds a deleted person's documents: `erased_at` set on the
// deletion's transaction, the key left; then the documents still holding a key, by person or page,
// and the key cleared only where the row still holds the one whose file was removed. A document
// erased, or without its key, is no document to a link or to the sweep.
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
  /** The PDF's size in bytes, as the route accepted it (T057). */
  readonly sizeBytes: number;
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

/** Of `ids`, the documents `userId` uploaded, on `tx` (T056: an application names only its own). */
export async function documentsOwnedAmong(
  tx: Pick<Transaction, 'verificationDocument'>,
  userId: string,
  ids: readonly string[],
): Promise<ReadonlySet<string>> {
  const rows = await tx.verificationDocument.findMany({
    where: { id: { in: [...ids] }, userId },
    select: { id: true },
  });
  return new Set(rows.map(({ id }) => id));
}

/** The recorded size of each of `ids` that has one, on `tx` (T057). */
export async function documentSizes(
  tx: Pick<Transaction, 'verificationDocument'>,
  ids: readonly string[],
): Promise<ReadonlyMap<string, number>> {
  const rows = await tx.verificationDocument.findMany({
    where: { id: { in: [...ids] }, sizeBytes: { not: null } },
    select: { id: true, sizeBytes: true },
  });
  return new Map(
    rows.flatMap(({ id, sizeBytes }) => (sizeBytes === null ? [] : [[id, sizeBytes]])),
  );
}

/**
 * The document, on the reading transaction; null when there is none, it was erased (B16), or it is
 * kept on a deleted teacher's profile (T076 of specs/004-sessions, FR-508: every ordinary reader
 * answers a kept document as none; T077's `teachers.keptData.documentLink` is the only way to one).
 */
export async function readDocument(
  tx: Pick<Transaction, 'verificationDocument'>,
  id: string,
): Promise<StoredDocument | null> {
  const row = await tx.verificationDocument.findUnique({
    where: { id, erasedAt: null, keptAt: null },
    select: { id: true, userId: true, storageKeyEncrypted: true },
  });
  if (row?.storageKeyEncrypted == null) return null;
  return { id: row.id, userId: row.userId, storageKeyEncrypted: row.storageKeyEncrypted };
}

/**
 * T040 of specs/004-sessions (spec FR-487; research R-327, «The administrator's read», item 4): a
 * deleted person's document whose key is still held, as the dispute's held-files read lists it. The
 * two readers below are used only by `createDisputeHeldFiles()`; `readDocument` above answers an
 * erased or a kept document as none, so every other path still does.
 */
export interface HeldDocument {
  readonly id: string;
  readonly userId: string;
  readonly documentType: 'national_id' | 'passport' | 'credential' | 'other';
  readonly uploadedAt: Date;
}

/**
 * T076 of specs/004-sessions (the note under T076, Q-R9 (i)): a deleted person's document the
 * held-files read admits, erased or kept (`kept_at`; rule 34: never both), its key still held.
 */
const ERASED_OR_KEPT = { OR: [{ erasedAt: { not: null } }, { keptAt: { not: null } }] };

/**
 * The erased or kept documents of `userIds` still holding a key, in id order, on the reading
 * transaction (T040; T076, Q-R9 (i): a kept one listed inside an open matter too); no key is
 * selected.
 */
export async function heldErasedDocumentsOf(
  tx: Pick<Transaction, 'verificationDocument'>,
  userIds: readonly string[],
): Promise<HeldDocument[]> {
  return tx.verificationDocument.findMany({
    where: {
      userId: { in: [...userIds] },
      ...ERASED_OR_KEPT,
      storageKeyEncrypted: { not: null },
    },
    orderBy: { id: 'asc' },
    select: { id: true, userId: true, documentType: true, uploadedAt: true },
  });
}

/**
 * The erased or kept document `id` while it still holds a key, on the reading transaction; null
 * otherwise (T040; T076, Q-R9 (i): a kept one listed above opens there too).
 */
export async function readHeldErasedDocument(
  tx: Pick<Transaction, 'verificationDocument'>,
  id: string,
): Promise<StoredDocument | null> {
  const row = await tx.verificationDocument.findFirst({
    where: { id, ...ERASED_OR_KEPT, storageKeyEncrypted: { not: null } },
    select: { id: true, userId: true, storageKeyEncrypted: true },
  });
  if (row?.storageKeyEncrypted == null) return null;
  return { id: row.id, userId: row.userId, storageKeyEncrypted: row.storageKeyEncrypted };
}

/** A document of a deleted person whose key is still held: its file is still to be removed. */
export interface ErasedDocumentRow {
  readonly id: string;
  /** The document's owner (T004 of specs/004-sessions: a held owner's files wait). */
  readonly userId: string;
  readonly storageKeyEncrypted: Uint8Array;
}

const heldKeys = (
  rows: readonly {
    readonly id: string;
    readonly userId: string;
    readonly storageKeyEncrypted: Uint8Array | null;
  }[],
): ErasedDocumentRow[] =>
  rows.flatMap(({ id, userId, storageKeyEncrypted }) =>
    storageKeyEncrypted === null ? [] : [{ id, userId, storageKeyEncrypted }],
  );

/**
 * Marks every document of `userId` neither erased nor kept as erased at `at`, on the deletion's
 * transaction; the keys stay. A kept document is left as it is (rule 34: never both).
 */
export async function markDocumentsErased(
  tx: Pick<Transaction, 'verificationDocument'>,
  userId: string,
  at: Date,
): Promise<number> {
  const { count } = await tx.verificationDocument.updateMany({
    where: { userId, erasedAt: null, keptAt: null },
    data: { erasedAt: at },
  });
  return count;
}

/**
 * T076 of specs/004-sessions (FR-508; SRS DEC-67; Q-A (b), Q-B (b)): the kinds a teacher ever
 * approved keeps after the deletion, the identity documents and every credential document.
 */
export const KEPT_DOCUMENT_TYPES = ['national_id', 'passport', 'credential'] as const;

/**
 * Marks every document of `userId` of a kept kind, neither erased nor kept, as kept at `at`, on the
 * deletion's transaction; the keys stay (rule 34's first check), so no file erasure touches them.
 */
export async function markDocumentsKept(
  tx: Pick<Transaction, 'verificationDocument'>,
  userId: string,
  at: Date,
): Promise<number> {
  const { count } = await tx.verificationDocument.updateMany({
    where: {
      userId,
      documentType: { in: [...KEPT_DOCUMENT_TYPES] },
      erasedAt: null,
      keptAt: null,
    },
    data: { keptAt: at },
  });
  return count;
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
        sizeBytes: row.sizeBytes,
      },
    });
  }

  /**
   * The documents uploaded before `uploadedBefore` that no verification request points at (T093);
   * the other modules' pointers are theirs to read. A row whose key is gone holds no file (B16).
   */
  async listWithoutRequestUploadedBefore(uploadedBefore: Date): Promise<StoredDocument[]> {
    const rows = await this.#database.verificationDocument.findMany({
      where: {
        uploadedAt: { lt: uploadedBefore },
        verificationRequests: { none: {} },
        storageKeyEncrypted: { not: null },
        // T076 of specs/004-sessions (Q-O8 (a)): an ordinary reader, so a kept document nothing
        // points at is never removed automatically.
        keptAt: null,
      },
      orderBy: { id: 'asc' },
      select: { id: true, userId: true, storageKeyEncrypted: true },
    });
    return rows.flatMap(({ id, userId, storageKeyEncrypted }) =>
      storageKeyEncrypted === null ? [] : [{ id, userId, storageKeyEncrypted }],
    );
  }

  /** The erased documents of `userId` still holding a key (B16: removed after the deletion's commit). */
  async erasedWithKeyOf(userId: string): Promise<ErasedDocumentRow[]> {
    return heldKeys(
      await this.#database.verificationDocument.findMany({
        where: { userId, erasedAt: { not: null }, storageKeyEncrypted: { not: null } },
        orderBy: { id: 'asc' },
        select: { id: true, userId: true, storageKeyEncrypted: true },
      }),
    );
  }

  /** The erased document `id` while it still holds a key; null otherwise. */
  async erasedWithKey(id: string): Promise<ErasedDocumentRow | null> {
    const row = await this.#database.verificationDocument.findFirst({
      where: { id, erasedAt: { not: null }, storageKeyEncrypted: { not: null } },
      select: { id: true, userId: true, storageKeyEncrypted: true },
    });
    return row === null ? null : (heldKeys([row])[0] ?? null);
  }

  /** A page of every erased document still holding a key, in id order after `after` (B16's job). */
  async erasedWithKeyPage(after: string | undefined, limit: number): Promise<ErasedDocumentRow[]> {
    return heldKeys(
      await this.#database.verificationDocument.findMany({
        where: {
          erasedAt: { not: null },
          storageKeyEncrypted: { not: null },
          ...(after === undefined ? {} : { id: { gt: after } }),
        },
        orderBy: { id: 'asc' },
        take: limit,
        select: { id: true, userId: true, storageKeyEncrypted: true },
      }),
    );
  }

  /** Clears an erased document's key, only where it still holds `stored`; whether it did. */
  async clearErasedKey(id: string, stored: Uint8Array): Promise<boolean> {
    const { count } = await this.#database.verificationDocument.updateMany({
      where: {
        id,
        erasedAt: { not: null },
        storageKeyEncrypted: { equals: Uint8Array.from(stored) },
      },
      data: { storageKeyEncrypted: null },
    });
    return count === 1;
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
          where: {
            storageKeyEncrypted: { not: null },
            ...(after === undefined ? {} : { id: { gt: after } }),
          },
          orderBy: { id: 'asc' },
          take: limit,
          select: { id: true, userId: true, storageKeyEncrypted: true },
        });
        return heldKeys(rows).map(({ id, storageKeyEncrypted: value }) => ({ id, value }));
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
