// T003 of specs/005-certification: the teacher's signature (FR-601, SRS FR-IJAZAH-12; research R-411;
// R-SEC-2, R-SEC-3). One current `teacher_signatures` row per teacher, replaced on upload, and the
// signed link `teacher.signature.get` answers.
//
// THE REPLACE PATH, in this order:
//   1. the file, a PNG or JPEG the kernel's guard typed by its content (R-SEC-4), stored under a key
//      the server mints, `signatures/<teacher>/<uuid>.png` or `.jpg`, outside any transaction, so no
//      lock waits on the storage port;
//   2. in one transaction: the teacher's `users` row locked first (the one order's head, T005; the
//      row references it, as `teacher.packages.create` locks it before its insert), then the current
//      row read and written by the teacher's unique, its instant the database's clock. The lock makes
//      the read of the old key and the write one decision, so two uploads of one teacher never both
//      read the same old key; the unique is the database's second line;
//   3. a refusal or a failure of step 2, its commit included, removes the new file and leaves the
//      old row and the old file as they were;
//   4. AFTER THE COMMIT, never before, the old file erased: irreversible, so a transaction that might
//      still roll back never loses the signature the row would then name. A failed erasure leaves
//      the new row and the answer and writes one warning of ids; the file is then left over in
//      storage, as the photo route leaves a replaced photo it could not remove
//      (`identity/photo-upload.controller.ts`).
// Every line names the teacher and the row by id, never a key (R-SEC-2).
//
// THE LINK: the current file's signed link living `document_link_ttl_seconds` (FR-151), and the
// instant; the null pair while none is held.
import { randomUUID } from 'node:crypto';

import type { SignatureUploadOutput, TeacherSignatureGetOutput } from '@ijazah/contracts';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { Transactions } from '../../platform/db/transaction.repository.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { StoragePort } from '../../platform/ports/storage/storage.port.js';
import { DOCUMENT_LINK_TTL_SETTING, documentLinkTtl } from '../../platform/settings/keys.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { SignatureRow, SignatureWrite } from './teacher-signature.repository.js';

/** The two types a signature may be, as the `signature` kind admits them. */
export type SignatureType = 'image/png' | 'image/jpeg';

const EXTENSION_OF = { 'image/png': 'png', 'image/jpeg': 'jpg' } as const satisfies Record<
  SignatureType,
  string
>;

/** What the service asks of the rows and the account, each on the caller's transaction. */
export interface TeacherSignatureStore {
  /** Locks the teacher's `users` row until the transaction ends (identity's entry). */
  lockAccount(tx: Transaction, userId: string): Promise<void>;
  current(tx: Transaction, teacherUserId: string): Promise<SignatureRow | null>;
  write(tx: Transaction, write: SignatureWrite): Promise<SignatureRow>;
}

export interface TeacherSignatureDependencies {
  readonly transactions: Transactions;
  readonly store: TeacherSignatureStore;
  readonly storage: Pick<StoragePort, 'put' | 'remove' | 'temporaryLink'>;
  readonly settings: SettingsReader;
  readonly log: Logger;
  /** The database's clock on the transaction (`clock_timestamp()`). */
  readonly clock: (tx: Transaction) => Promise<Date>;
}

/** An admitted signature file: its type by content and its bytes. */
export interface SignatureFile {
  readonly type: SignatureType;
  readonly bytes: Uint8Array;
}

export class TeacherSignatureService {
  readonly #dependencies: TeacherSignatureDependencies;

  constructor(dependencies: TeacherSignatureDependencies) {
    this.#dependencies = dependencies;
  }

  /** Makes `file` the teacher's one current signature; answers when it was uploaded. */
  async replace(teacherUserId: string, file: SignatureFile): Promise<SignatureUploadOutput> {
    const { transactions, store, storage, log, clock } = this.#dependencies;
    const key = `signatures/${teacherUserId}/${randomUUID()}.${EXTENSION_OF[file.type]}`;
    await storage.put(key, file.bytes, file.type);
    let replaced: { readonly row: SignatureRow; readonly previous: SignatureRow | null };
    try {
      replaced = await transactions.run(async (tx) => {
        await store.lockAccount(tx, teacherUserId);
        const previous = await store.current(tx, teacherUserId);
        const uploadedAt = await clock(tx);
        const row = await store.write(tx, { teacherUserId, storageKey: key, uploadedAt });
        return { row, previous };
      });
    } catch (error: unknown) {
      await storage.remove(key).catch(() => {
        // An orphan file: named by the teacher alone, never its key (R-SEC-2).
        log.warn({ teacherUserId }, 'A refused signature file could not be removed from storage');
      });
      throw error;
    }
    // After the commit: the old file erased (irreversible), never before.
    const { row, previous } = replaced;
    if (previous !== null && previous.storageKey !== key) {
      const ids = { teacherUserId, signatureId: previous.id };
      try {
        await storage.remove(previous.storageKey);
        log.info(ids, 'The replaced signature file was erased');
      } catch {
        log.warn(ids, 'The replaced signature file could not be erased');
      }
    }
    return { uploadedAt: row.uploadedAt.toISOString() };
  }

  /** The teacher's current signature as a signed link and its instant; the null pair without one. */
  async get(teacherUserId: string): Promise<TeacherSignatureGetOutput> {
    const { transactions, store, storage, settings } = this.#dependencies;
    const row = await transactions.run((tx) => store.current(tx, teacherUserId));
    if (row === null) return { link: null, uploadedAt: null };
    const ttl = await settings.read(DOCUMENT_LINK_TTL_SETTING, documentLinkTtl);
    return {
      link: await storage.temporaryLink(row.storageKey, ttl),
      uploadedAt: row.uploadedAt.toISOString(),
    };
  }
}
