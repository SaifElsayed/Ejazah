// PUBLIC ENTRY of the catalog module (T017). Other modules import this file and nothing below it (R-API-3).
import type { Database, Transaction } from '../../platform/db/prisma.repository.js';
import { transactionsOver } from '../../platform/db/transaction.repository.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { CatalogUse, PackageEnrollmentCounts } from './catalog-use.port.js';
import { grantSubjects } from './credentials.repository.js';
import { CredentialsRepository } from './credentials.repository.js';
import {
  approveCredential,
  correctCredential,
  decideCredential,
  hasApprovedCredential,
  readForReview,
  reviewCount,
  reviewPage,
} from './credential-review.repository.js';
import {
  CredentialReviewService,
  type CredentialReviewStore,
} from './credential-review.service.js';
import {
  accountTimezone,
  decideApplication,
  isApprovedTeacher,
  isPublishedTeacher,
  lockAccount,
  lockApplication,
} from '../identity/index.js';
import {
  activeSlotsOf,
  insertSlot,
  lockSlot,
  lockTeacherSlots,
  ownsSlot,
  readSlot,
  slotsOf,
  updateSlot,
} from './slots.repository.js';
import { SlotsService, type SlotsStore, type TeacherSlots } from './slots.service.js';
import {
  changePackage,
  holdsSubject,
  insertPackage,
  packageOf,
  packagesOf,
} from './packages.repository.js';
import { PackagesService, type PackagesStore } from './packages.service.js';
import { SubjectsRepository } from './subjects.repository.js';
import { type SubjectsReader, SubjectsService } from './subjects.service.js';

/** The administrator surface's `credentials` namespace, mounted by `admin.router.ts` (T069). */
export { credentialsAdminRouter } from './credentials-admin.router.js';
export type { CredentialReviewService };

/**
 * The credential review's store: this module's rows, the teacher's standing read, the application
 * set waiting on the applicant (T155), its row's lock (T161) and the account's (T142) through
 * identity's entry (R-121).
 * Exported for the probe of its queries (`tests/db-integrity/credential-review.spec.ts`).
 */
export const credentialReviewStore: CredentialReviewStore = {
  page: reviewPage,
  count: reviewCount,
  read: readForReview,
  hasApproved: hasApprovedCredential,
  approve: approveCredential,
  decide: decideCredential,
  correct: correctCredential,
  lockAccount,
  lockApplication,
  isApprovedTeacher,
  requestApplicationDocument: (tx, userId, request) =>
    decideApplication(tx, userId, { kind: 'request_info', ...request }),
  grantSubjects,
};

/** The credential review (T069, FR-163, FR-164); the admin module composes it into the surface's services. */
export function createCredentialReviewService(dependencies: {
  readonly settings: SettingsReader;
  readonly now?: () => Date;
}): CredentialReviewService {
  return new CredentialReviewService({ ...dependencies, store: credentialReviewStore });
}

/** What catalog asks booking about a slot or a package in use, bound by `main.ts` (T020, R-207). */
export type { CatalogUse, PackageEnrollmentCounts };

/**
 * The catalog module's services on the user surface (T020; contracts/kernel.md "The composition
 * root"). Packages (T018) and slots (T019) join here, each built over `use`.
 */
export interface CatalogServices {
  /** `teacher.packages.*` (T018). */
  readonly packages: Pick<PackagesService, 'list' | 'create' | 'update'>;
  /** `teacher.slots.*` (T019). */
  readonly slots: TeacherSlots;
}

/** What the catalog module's user-surface services are built over, bound once by `main.ts` (T020). */
export interface CatalogServiceDependencies {
  /** Booking's answers to whether a slot or a package is in use (R-207). */
  readonly use: CatalogUse;
  /** The process's client, which the packages and the slots read and write through (T018, T019). */
  readonly database: Database;
  /** The kernel's idempotency, keying `teacher.packages.create` and `teacher.slots.create`. */
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'run'>;
}

/**
 * The slots' store: this module's rows and locks, and the account's lock and zone through
 * identity's entry (T019, R-121).
 */
function slotsStoreOver(database: Database): SlotsStore {
  return {
    run: transactionsOver(database).run,
    lockAccount,
    lockTeacherSlots,
    lockSlot,
    accountTimezone,
    ownsSlot,
    readSlot,
    slotsOf,
    activeSlotsOf,
    insertSlot,
    updateSlot,
  };
}

/** The catalog module's user-surface services (T020); T018 and T019 build theirs over `use`. */
export function createCatalogServices({
  use,
  database,
  idempotency,
}: CatalogServiceDependencies): CatalogServices {
  return {
    packages: new PackagesService({
      transactions: transactionsOver(database),
      store: packagesStore,
      use,
      idempotency,
    }),
    slots: new SlotsService({ store: slotsStoreOver(database), use, idempotency }),
  };
}

/**
 * The packages' store (T018): this module's rows, and the account's and the application's locks
 * through identity's entry (T005's rule 2, R-121). Exported with the service for the probe of its
 * queries and locks (`tests/db-integrity/packages.spec.ts`).
 */
export const packagesStore: PackagesStore = {
  lockAccount,
  lockApplication,
  isPublished: isPublishedTeacher,
  holdsSubject,
  packagesOf,
  packageOf,
  insert: insertPackage,
  change: changePackage,
};
export { PackagesService };

/** The `teacher.packages` router, mounted under `teacher.packages` by `app.router.ts` (T018). */
export { packagesRouter } from './packages.router.js';
/** The `teacher.slots` namespace, mounted by `app.router.ts` (T019). */
export { slotsRouter } from './slots.router.js';
/**
 * The active slots of the lengths of each teacher's active packages, on the caller's transaction:
 * what booking's discovery read decides is free (T026, R-205).
 */
export { type OfferedSlot, offeredSlotsOf } from './slots.repository.js';
export type { TeacherSlots };

/** The subjects list's router, mounted under `catalog.subjects` by `app.router.ts` (T038). */
export { subjectsRouter } from './subjects.router.js';
export type { SubjectsReader } from './subjects.service.js';

/** The subjects read the user surface's context carries (T038, FR-182). */
export function createSubjectsService(database: Pick<Database, 'subject'>): SubjectsReader {
  return new SubjectsService(new SubjectsRepository(database));
}

/**
 * The credential rows and the subjects as the verification module's application and credentials
 * read and write them, each on the caller's transaction (T056, T057, R-121); `grantSubjects` is the
 * approval's (admin-surface `credentials.approve`); `readCredentialQueue` is the admin home's card (T065);
 * `credentialsOfTeachers` the applications queue's and `revokeSubjects` a revoked approval's (T068);
 * `closeUndecidedCredentials` a rejected application's undecided credentials (T122).
 */
export {
  addCredential,
  type CredentialClosure,
  closeUndecidedCredentials,
  type CredentialRow,
  credentialsOfTeachers,
  grantSubjects,
  listCredentials,
  type NewCredentialRow,
  readCredentialQueue,
  replaceCredentialDocument,
  revokeSubjects,
} from './credentials.repository.js';
export { activeSubjectsAmong } from './subjects.repository.js';

/**
 * The documents this module's rows point at, `teacher_credentials.document_id`, for the
 * verification module's unreferenced documents (T093, R-API-6).
 */
export function createDocumentReferences(database: Pick<Database, 'teacherCredential'>): {
  referencedAmong(documentIds: readonly string[]): Promise<ReadonlySet<string>>;
} {
  const credentials = new CredentialsRepository(database);
  return { referencedAmong: (documentIds) => credentials.documentsAmong(documentIds) };
}
