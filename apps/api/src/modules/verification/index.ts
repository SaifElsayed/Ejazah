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
import { ApplicationReviewService, type ApplicantBan } from './application-review.service.js';
import {
  createApplicationReviewStore,
  createIdentityRequestStore,
  createVerificationStores,
} from './stores.js';
import {
  type IdentityStanding,
  IdentityVerificationService,
  VerificationRequestService,
} from './verification-request.service.js';
import { VerificationRepository } from './verification.repository.js';
import { VerificationService } from './verification.service.js';
import { DocumentErasure, type DocumentErasureDependencies } from './document-erasure.js';
// T077 of specs/004-sessions: the kept data's reads for `users.get`.
import { keptDataReads } from './kept-data.service.js';
// T058 of specs/004-sessions: the user directory's readers, through identity's and sessions' entries.
import { idsWithFoldedNamePrefix } from '../../platform/db/folded-name.js';
import type { Logger } from '../../platform/logging/logger.js';
import { displayNamesOf, userDirectoryPage, userRecordOf } from '../identity/index.js';
import {
  createCancellationRequestCounts,
  createMarkedEnrollments,
  createRepeatedAbsence,
  type EnrollmentSide,
} from '../sessions/index.js';
import {
  createUserDirectoryService,
  // T072 of specs/004-sessions: the hold's end, sessions' read handed in.
  type SlotHolds,
  type UserDirectory,
} from './user-directory.service.js';

export { DOCUMENTS_UPLOAD_PATH };
export type { DocumentLink, DocumentViewer } from './verification.service.js';
export { VerificationService };

/** The module's two namespaces of the user surface (T056, T057), mounted under `teacher` by `app.router.ts`. */
export { applicationRouter } from './application.router.js';
export { credentialsRouter } from './credentials.router.js';

/** `account.identityVerification` (T068), merged under `account` by `app.router.ts` (R-121). */
export { identityVerificationRouter } from './identity-verification.router.js';

/** The administrator surface's `applications`, `documents` and `users` namespaces (T068), mounted by `admin.router.ts`. */
export { applicationsRouter } from './applications.router.js';
export { documentsRouter, usersRouter } from './documents.router.js';
export type { ApplicationReviewService, VerificationRequestService };

/** The review's and the requests' stores, for the probe of their queries (`tests/db-integrity/application-review.spec.ts`). */
export { createApplicationReviewStore, createIdentityRequestStore } from './stores.js';

/** The person's open identity request, for identity's reinstatement (T113), composed by the admin module. */
export { openRequestOf } from './verification-requests.repository.js';

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
  /** The person's side of an identity request (T068, FR-166). */
  readonly identityVerification: Pick<IdentityVerificationService, 'get' | 'submit'>;
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
    identityVerification: new IdentityVerificationService({
      store: createIdentityRequestStore(database),
    }),
  };
}

/**
 * The application review and the identity requests (T068) for the administrator surface, which the
 * admin module composes: the standing is identity's, handed in, so one consequences registry serves
 * every action that ends an account.
 */
export function createVerificationAdminServices({
  database,
  storage,
  cipher,
  settings,
  standing,
  now,
}: Pick<VerificationServiceDependencies, 'database' | 'storage' | 'cipher' | 'settings'> & {
  readonly standing: ApplicantBan & IdentityStanding;
  readonly now?: () => Date;
}): {
  readonly applications: ApplicationReviewService;
  readonly documents: VerificationRequestService;
} {
  const clock = now === undefined ? {} : { now };
  return {
    applications: new ApplicationReviewService({
      store: createApplicationReviewStore(),
      standing,
      settings,
      ...clock,
    }),
    documents: new VerificationRequestService({
      store: createIdentityRequestStore(database),
      standing,
      links: new VerificationService({ storage, cipher, settings }),
      ...clock,
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

/**
 * A deleted person's documents (B16, decision 1): the subscriber `main.ts` adds to the consequences
 * registry, which marks them erased on the deletion's transaction, and the erasure that removes their
 * files after the commit, handed to the identity module's deletion by `main.ts` and to the
 * `erase-deleted-files` sweep by `worker.ts`.
 */
export {
  DocumentErasure,
  type DocumentErasureDependencies,
  documentErasureConsequence,
  type ErasedFile,
} from './document-erasure.js';

/** The erasure of deleted people's documents over the process's database, cipher and storage. */
export function createDocumentErasure(dependencies: DocumentErasureDependencies): DocumentErasure {
  return new DocumentErasure(dependencies);
}

/** The verification module's `_encrypted` column, for the `reencrypt-columns` job (T155, R-API-6). */
export function createEncryptedColumns(
  database: Pick<Database, 'verificationDocument'>,
): readonly EncryptedColumn[] {
  return [new VerificationRepository(database).documentStorageKeys()];
}

/**
 * T040 of specs/004-sessions (spec FR-487; research R-327, «The administrator's read»): the binding
 * of sessions' `DisputeHeldFiles` port, which `main.ts` hands the administrator's services: a
 * deleted party's held documents and photo, read only inside an open matter.
 */
export {
  createDisputeHeldFiles,
  type DisputeHeldFilesDependencies,
  type HeldFilesStore,
} from './dispute-held-files.js';

/**
 * T058 of specs/004-sessions (FR-481, FR-459, FR-451; SRS FR-ADMIN-4; research R-301, R-318): the
 * user directory, `users.list` and `users.get` of the administrator surface's `users` namespace,
 * which the admin module composes: identity's readers (deleted users through `includeDeleted`, the
 * note under T058, Q8) and its names, the kernel's folded prefix (R-203), and sessions' counts
 * (T025) and marked enrollments (T015, Q7) over the bound `EnrollmentSide`.
 */
export function createUserDirectory({
  database,
  settings,
  enrollments,
  log,
  slotHeldUntilOf,
}: {
  readonly database: Pick<Database, 'includeDeleted'>;
  readonly settings: SettingsReader;
  readonly enrollments: Pick<EnrollmentSide, 'enrollmentPage'>;
  readonly log: Pick<Logger, 'info'>;
  /**
   * T072 of specs/004-sessions (Q9 (a)): `users.get`'s `enrollmentsSlotHeldUntil`, sessions'
   * `createBanLift`'s read, handed in by the admin module.
   */
  readonly slotHeldUntilOf: SlotHolds['slotHeldUntilOf'];
}): UserDirectory {
  return createUserDirectoryService({
    store: {
      usersPage: (after, limit) => userDirectoryPage(database, after, limit),
      userRecord: (userId) => userRecordOf(database, userId),
      namePrefixMatches: idsWithFoldedNamePrefix,
      namesOf: displayNamesOf,
    },
    settings,
    counts: createCancellationRequestCounts({ settings }),
    marked: createMarkedEnrollments({
      absence: createRepeatedAbsence({ settings }),
      enrollments,
    }),
    log,
    // T072 (Q9 (a)).
    held: { slotHeldUntilOf },
    // T077 of specs/004-sessions (N3): a deleted teacher's kept data and a live teacher's payout
    // match, read on the call's transaction through identity's entry and this module's rows.
    kept: keptDataReads(),
  });
}
export type { UserDirectory, UserDirectoryStore } from './user-directory.service.js';

/**
 * T077 of specs/004-sessions (FR-509; SRS FR-ADMIN-21, DEC-67; the note under T077, Q-R3 (a)): an
 * administrator's control of a deleted teacher's kept data, `teachers.keptData.*`, composed by the
 * admin module into the surface's `teachers`; and the `erase-kept-data` sweep ⚠️, which
 * `worker.ts` builds through the job (`jobs/erase-kept-data.ts`).
 */
export {
  createKeptData,
  type KeptData,
  type KeptDataDependencies,
  type KeptEraseDateChange,
  type KeptEraseWallClock,
  type KeptErasure,
} from './kept-data.service.js';
export {
  createKeptDataErasureSweep,
  type KeptDataErasureDependencies,
  type KeptDataErasureRun,
  type KeptDataErasureSweep,
} from './kept-data.sweep.js';

/**
 * R1a (002:T176; SRS §3.14, DEC-100, DEC-67; the note under T176, Q-3 (a)): the daily sweep ⚠️ that
 * marks an identity document on a live account erased once its retention has passed since its
 * decision, a teacher once approved excepted; `worker.ts` builds it through the job
 * (`jobs/erase-identity-documents.ts`), and `erase-deleted-files` then removes the file.
 */
export {
  createIdentityRetentionSweep,
  type IdentityRetentionDependencies,
  type IdentityRetentionRun,
  type IdentityRetentionStore,
  type IdentityRetentionSweep,
  identityRetentionStore,
} from './identity-retention.sweep.js';

// ---------------------------------------------------------------------------------------------
// 005:T031 of specs/005-certification (FR-631; R-411; the note under T031, Q-D2 (a) to Q-D4 (a)): a
// deleted teacher's kept signature, listed by `users.get` and opened by
// `teachers.keptData.signatureLink` (the kept-data service above), and erased once it is no longer
// kept: `main.ts` adds `createKeptSignatureErasure` to the deletion's `fileErasures` (a teacher never
// approved has it erased at the deletion) and `worker.ts` to `erase-deleted-files`' stores (an
// approved teacher's, once the kept data is erased at its date or «now»), file first, then the row.
export {
  createKeptSignatureErasure,
  type KeptSignatureErasure,
  type KeptSignatureErasureDependencies,
} from './kept-data.signatures.js';
