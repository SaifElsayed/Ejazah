// PUBLIC ENTRY of the verification module (T017). Other modules import this file and nothing below it (R-API-3).
import type { EncryptedColumn } from '../../platform/crypto/encryption.js';
import type { Database } from '../../platform/db/prisma.repository.js';
import type { NodeHandler } from '../../platform/web/route.js';
import {
  DOCUMENTS_UPLOAD_PATH,
  type DocumentsUploadDependencies,
  documentsUploadRoute,
} from './uploads.controller.js';
import { VerificationRepository } from './verification.repository.js';

export { DOCUMENTS_UPLOAD_PATH };
export {
  type DocumentLink,
  type DocumentViewer,
  VerificationService,
} from './verification.service.js';

/** `POST /uploads/documents`, over this module's repository (T024). */
export function createDocumentsUploadRoute({
  database,
  ...dependencies
}: Omit<DocumentsUploadDependencies, 'documents'> & {
  readonly database: Pick<Database, 'verificationDocument'>;
}): NodeHandler {
  return documentsUploadRoute({ ...dependencies, documents: new VerificationRepository(database) });
}

/** The verification module's `_encrypted` column, for the `reencrypt-columns` job (T155, R-API-6). */
export function createEncryptedColumns(
  database: Pick<Database, 'verificationDocument'>,
): readonly EncryptedColumn[] {
  return [new VerificationRepository(database).documentStorageKeys()];
}
