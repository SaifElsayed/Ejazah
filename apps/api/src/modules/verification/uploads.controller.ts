// T024: `POST /uploads/documents` (FR-151, R-SEC-3, R-SEC-4, R-DB-8; public-pages.md "The uploads
// route"). Behind the user bearer of any standing but banned (an applicant under an identity
// request must still upload, FR-137), a PDF of kind `identity` or `credential`, decided by content
// through T020's guard, is stored through the storage port under a server-minted key, the
// `verification_documents` row is written with the key encrypted in its column, bound to the row
// (R-DB-8), and the caller as `user_id`, and the answer carries the id only: a link to the file is
// minted on demand by the procedures that may show it (`verification.service.ts`).
//
// The row's `document_type` is what the upload knows: `credential` for a credential, `other` for an
// identity document, whose kind (`national_id`, `passport`) the person declares with the submission
// that points at it (`teacher.application.submit`, `account.identityVerification.submit`) and which
// is recorded on the pointing row. The object is stored before the row and removed again when the
// row cannot be written, so no key names a stored file nobody owns.
//
// T093: before anything is stored, the route counts the uploader's documents nothing points at and
// refuses a further one with `CONFLICT` (`documents`, `too_many`) once they hold
// `document_unreferenced_max_per_user`, read on every upload (FR-034). The sweep
// `purge-unreferenced-documents` removes those left unsubmitted. Two uploads at the same instant may
// both pass the count; the cap bounds an abuse, it is not an exact quota.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import type { ColumnCipher } from '../../platform/crypto/encryption.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { StoragePort } from '../../platform/ports/storage/storage.port.js';
import type { NodeHandler } from '../../platform/web/route.js';
import {
  kindField,
  uploadRoute,
  type UploadRouteDependencies,
} from '../../surfaces/upload-route.js';
import { DOCUMENT_STORAGE_KEY_COLUMN, type NewDocument } from './verification.repository.js';

export type { NewDocument };

/** Where the documents route is served (public-pages.md). */
export const DOCUMENTS_UPLOAD_PATH = '/uploads/documents';

/** The kinds this route takes: PDF only, each (T020). */
const DOCUMENT_KINDS = ['identity', 'credential'] as const;
type DocumentKind = (typeof DOCUMENT_KINDS)[number];

const documentTypeOf: Readonly<Record<DocumentKind, NewDocument['documentType']>> = {
  identity: 'other',
  credential: 'credential',
};

/** The settings key of how many unreferenced documents a person may hold (T093, data-model §4). */
export const DOCUMENT_UNREFERENCED_MAX_PER_USER_SETTING = 'document_unreferenced_max_per_user';

/** What the route asks of the verification module: the row it writes and the uploader's count. */
export interface DocumentsWriter {
  createDocument(row: NewDocument): Promise<void>;
  /** How many of the person's documents nothing points at (T093). */
  countUnreferencedOf(userId: string): Promise<number>;
}

export interface DocumentsUploadDependencies extends UploadRouteDependencies {
  readonly storage: Pick<StoragePort, 'put' | 'remove'>;
  readonly cipher: Pick<ColumnCipher, 'encrypt'>;
  readonly documents: DocumentsWriter;
  readonly settings: SettingsReader;
}

export function documentsUploadRoute({
  storage,
  cipher,
  documents,
  settings,
  ...dependencies
}: DocumentsUploadDependencies): NodeHandler {
  return uploadRoute<DocumentKind>(dependencies, {
    kindOf: kindField(DOCUMENT_KINDS),
    refuses: ['banned'],
    handle: async ({ uploader, kind, type, bytes }) => {
      // Read before the object is stored, so a refused upload leaves nothing behind (T093).
      const most = await settings.read(
        DOCUMENT_UNREFERENCED_MAX_PER_USER_SETTING,
        z.int().positive(),
      );
      if ((await documents.countUnreferencedOf(uploader.userId)) >= most) {
        throw new DomainError('CONFLICT', undefined, {
          details: [{ path: 'documents', code: 'too_many' }],
        });
      }
      const documentId = randomUUID();
      const key = `documents/${documentId}.pdf`;
      await storage.put(key, bytes, type);
      try {
        await documents.createDocument({
          id: documentId,
          userId: uploader.userId,
          documentType: documentTypeOf[kind],
          storageKeyEncrypted: cipher.encrypt(key, DOCUMENT_STORAGE_KEY_COLUMN, documentId),
        });
      } catch (error: unknown) {
        await storage.remove(key).catch(() => undefined);
        throw error;
      }
      return { documentId };
    },
  });
}
