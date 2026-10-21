// PUBLIC ENTRY of the verification module (T017). Other modules import this file and nothing below it (R-API-3).
import type { ColumnCipher, EncryptedColumn } from '../../platform/crypto/encryption.js';
import type { Database } from '../../platform/db/prisma.repository.js';
import type { NodeHandler } from '../../platform/web/route.js';
import {
  DOCUMENTS_UPLOAD_PATH,
  type DocumentsUploadDependencies,
  documentsUploadRoute,
} from './uploads.controller.js';
import {
  type DocumentReferences,
  UnreferencedDocuments,
  type UnreferencedDocumentsDependencies,
} from './unreferenced-documents.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import type { StoragePort } from '../../platform/ports/storage/storage.port.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { ApplicationService } from './application.service.js';
import { CredentialsService } from './credentials.service.js';
import { createVerificationStores } from './stores.js';
import { VerificationRepository } from './verification.repository.js';
import { VerificationService } from './verification.service.js';

export { DOCUMENTS_UPLOAD_PATH };
export type { DocumentLink, DocumentViewer } from './verification.service.js';
export { VerificationService };

/** The module's two namespaces of the user surface (T056, T057), mounted under `teacher` by `app.router.ts`. */
export { applicationRouter } from './application.router.js';
export { credentialsRouter } from './credentials.router.js';

/** What the module's routers call, carried by every request in `AppServices.verification`. */
export interface VerificationServices {
  readonly application: Pick<
    ApplicationService,
    'get' | 'submit' | 'resubmit' | 'reapply' | 'markApprovedShown'
  >;
  readonly credentials: Pick<
    CredentialsService,
    'list' | 'add' | 'replaceDocument' | 'documentLink'
  >;
}

/** What the module's services are built over, bound once by `main.ts`. */
export interface VerificationServiceDependencies {
  readonly database: Database;
  readonly storage: Pick<StoragePort, 'temporaryLink'>;
  readonly cipher: Pick<ColumnCipher, 'decrypt'>;
  readonly settings: SettingsReader;
  /** The kernel's keyed transactions, for `teacher.application.submit` (FR-106). */
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'run'>;
}

/** The application and the credentials services over the owners' entries (T056, T057, R-121). */
export function createVerificationServices({
  database,
  storage,
  cipher,
  settings,
  idempotency,
}: VerificationServiceDependencies): VerificationServices {
  const stores = createVerificationStores(database);
  return {
    application: new ApplicationService({ stores, idempotency }),
    credentials: new CredentialsService({
      stores,
      links: new VerificationService({ storage, cipher, settings }),
    }),
  };
}

/**
 * `POST /uploads/documents`, over this module's repository (T024) and its count of the uploader's
 * unreferenced documents, read through the other modules' pointers handed in (T093).
 */
export function createDocumentsUploadRoute({
  database,
  references,
  cipher,
  ...dependencies
}: Omit<DocumentsUploadDependencies, 'documents' | 'cipher'> & {
  readonly database: Database;
  readonly cipher: Pick<ColumnCipher, 'encrypt' | 'decrypt'>;
  readonly references: readonly DocumentReferences[];
}): NodeHandler {
  const repository = new VerificationRepository(database);
  const unreferenced = new UnreferencedDocuments({ database, cipher, references });
  return documentsUploadRoute({
    ...dependencies,
    cipher,
    documents: {
      createDocument: (row) => repository.createDocument(row),
      countUnreferencedOf: (userId) => unreferenced.countOf(userId),
    },
  });
}

export {
  type DocumentReferences,
  type UnreferencedDocument,
  UnreferencedDocuments,
} from './unreferenced-documents.js';

/**
 * The documents nothing points at (T093): the `purge-unreferenced-documents` sweep's store and the
 * uploads route's per-user count, over the other modules' pointers the composition hands in.
 */
export function createUnreferencedDocuments(
  dependencies: UnreferencedDocumentsDependencies,
): UnreferencedDocuments {
  return new UnreferencedDocuments(dependencies);
}

/** The verification module's `_encrypted` column, for the `reencrypt-columns` job (T155, R-API-6). */
export function createEncryptedColumns(
  database: Pick<Database, 'verificationDocument'>,
): readonly EncryptedColumn[] {
  return [new VerificationRepository(database).documentStorageKeys()];
}
