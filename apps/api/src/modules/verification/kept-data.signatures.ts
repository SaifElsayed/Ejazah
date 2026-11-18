// 005:T031 of specs/005-certification (FR-631; R-411; DEC-72; the note under T031, Q-D3 (a), Q-D4 (a);
// FR-ADMIN-21): a deleted teacher's signature image, read and erased under the kept data's rules.
//
// - KEPT. A teacher ever approved keeps their signature at the deletion, with the identity, credential
//   and payout documents (`eraseAccount` leaves `teacher_signatures` alone): the row and its file stay
//   until the kept data is erased, at the administrator's date (`erase-kept-data`) or «now»
//   (`teachers.keptData.eraseNow`). No marker column: the profile's `kept_erased_at` is the marker.
// - ERASED. Once identity answers the owner erasable (`signatureErasableOwnersAmong`: deleted, and
//   either `kept_erased_at` set or never approved), the file is removed through the storage port and
//   only then the row deleted, where it still holds that key (DELETE is granted on the table), so a
//   removal that failed leaves the row for the next try. Two callers:
//   - `erase-deleted-files` every hour, as its third store (`pendingPage` and `clearKey`, bound by
//     `worker.ts`): a held owner's file waits for the last open matter, as the documents' do;
//   - the deletion's work after its commit (`eraseFilesOf`, one of the `fileErasures` `main.ts`
//     hands identity): a teacher never approved has it erased at the deletion (Q-D4 (a), built
//     defensively: the upload admits an approved teacher only, `catalog/signature-upload.controller.ts:70`,
//     whose spec refuses an applicant, `signature-upload.controller.spec.ts:289`).
// - A PAGE. `teacher_signatures` holds one row per teacher, a deleted one's only until its erasure, so
//   a page is read in id order and filtered by the owners' erasability, read again until the page is
//   full or the table ends, and the job's cursor (the last file's id) resumes after it.
//
// The key is the row's own and goes nowhere but the storage port (R-SEC-2).
import type { Database } from '../../platform/db/prisma.repository.js';
import type { StoragePort } from '../../platform/ports/storage/storage.port.js';
import {
  deleteSignatureHolding,
  type SignatureFileRow,
  signaturesPage,
  teacherSignatureOf,
} from '../catalog/index.js';
import { signatureErasableOwnersAmong } from '../identity/index.js';
import type { ErasedFile } from './document-erasure.js';

/** What the erasure reads and deletes, over catalog's and identity's entries; faked in a spec. */
export interface KeptSignatureStore {
  /** A page of every signature row, in id order after `after`. */
  page(after: string | undefined, limit: number): Promise<readonly SignatureFileRow[]>;
  /** The teacher's signature row, or null. */
  rowOf(teacherUserId: string): Promise<SignatureFileRow | null>;
  /** Of `userIds`, those whose signature is no longer kept (this file's head). */
  erasableAmong(userIds: readonly string[]): Promise<ReadonlySet<string>>;
  /** Deletes the row where it still holds the key; whether it did. */
  remove(row: Pick<SignatureFileRow, 'id' | 'storageKey'>): Promise<boolean>;
}

/** The store over the process's database (R-API-6: each table through its owner's entry). */
export function keptSignatureStoreOver(database: Database): KeptSignatureStore {
  return {
    page: (after, limit) => signaturesPage(database, after, limit),
    rowOf: async (teacherUserId) => {
      const row = await teacherSignatureOf(database, teacherUserId);
      return row === null ? null : { id: row.id, teacherUserId, storageKey: row.storageKey };
    },
    erasableAmong: (userIds) => signatureErasableOwnersAmong(database, userIds),
    remove: (row) => deleteSignatureHolding(database, row),
  };
}

/** The signature's erasure: the deletion's `FileErasure` and the `erase-deleted-files` store. */
export interface KeptSignatureErasure {
  eraseFilesOf(userId: string): Promise<void>;
  pendingPage(after: string | undefined, limit: number): Promise<readonly ErasedFile[]>;
  clearKey(file: ErasedFile): Promise<boolean>;
}

export interface KeptSignatureErasureDependencies {
  readonly database: Database;
  readonly storage: Pick<StoragePort, 'remove'>;
  readonly store?: KeptSignatureStore;
}

const fileOf = ({ id, teacherUserId, storageKey }: SignatureFileRow): ErasedFile => ({
  id,
  ownerUserId: teacherUserId,
  storageKey,
});

/**
 * The erasure over the store and the storage port (this file's head): `eraseFilesOf` for the
 * deletion's work after its commit, `pendingPage` and `clearKey` for `erase-deleted-files`.
 */
export function createKeptSignatureErasure({
  database,
  storage,
  store = keptSignatureStoreOver(database),
}: KeptSignatureErasureDependencies): KeptSignatureErasure {
  const clearKey = (file: ErasedFile) => store.remove({ id: file.id, storageKey: file.storageKey });
  return {
    eraseFilesOf: async (userId) => {
      const row = await store.rowOf(userId);
      if (row === null || !(await store.erasableAmong([userId])).has(userId)) return;
      await storage.remove(row.storageKey);
      await clearKey(fileOf(row));
    },

    pendingPage: async (after, limit) => {
      const files: ErasedFile[] = [];
      let cursor = after;
      for (;;) {
        const rows = await store.page(cursor, limit);
        if (rows.length === 0) return files;
        const erasable = await store.erasableAmong([
          ...new Set(rows.map(({ teacherUserId }) => teacherUserId)),
        ]);
        for (const row of rows) {
          if (!erasable.has(row.teacherUserId)) continue;
          files.push(fileOf(row));
          if (files.length === limit) return files;
        }
        if (rows.length < limit) return files;
        cursor = rows.at(-1)?.id;
      }
    },

    clearKey,
  };
}
