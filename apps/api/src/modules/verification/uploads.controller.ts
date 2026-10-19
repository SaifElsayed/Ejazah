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
import { randomUUID } from 'node:crypto';
import type { ColumnCipher } from '../../platform/crypto/encryption.js';
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

/** What the route asks of the verification repository. */
export interface DocumentsWriter {
  createDocument(row: NewDocument): Promise<void>;
}

export interface DocumentsUploadDependencies extends UploadRouteDependencies {
  readonly storage: Pick<StoragePort, 'put' | 'remove'>;
  readonly cipher: Pick<ColumnCipher, 'encrypt'>;
  readonly documents: DocumentsWriter;
}

export function documentsUploadRoute({
  storage,
  cipher,
  documents,
  ...dependencies
}: DocumentsUploadDependencies): NodeHandler {
  return uploadRoute<DocumentKind>(dependencies, {
    kindOf: kindField(DOCUMENT_KINDS),
    refuses: ['banned'],
    handle: async ({ uploader, kind, type, bytes }) => {
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
