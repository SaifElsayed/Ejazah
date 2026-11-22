// PUBLIC ENTRY of the catalog module (T017). Other modules import this file and nothing below it (R-API-3).
import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Database, Transaction } from '../../platform/db/prisma.repository.js';
import { transactionsOver } from '../../platform/db/transaction.repository.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { StoragePort } from '../../platform/ports/storage/storage.port.js';
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
  type OpenRequestsRefreeze,
} from './credential-review.service.js';
import { foldedTexts } from '../../platform/db/folded-name.js';
import {
  accountTimezone,
  decideApplication,
  isApprovedTeacher,
  isPublishedTeacher,
  lockAccount,
  lockApplication,
  visibleTeacherPage,
  visibleTeachers,
} from '../identity/index.js';
import {
  activeOfferings,
  approvedRiwayas,
  cardPackages,
  cardSubjects,
  profilePackages,
} from './discovery.repository.js';
import {
  type DiscoveryCatalog,
  DiscoveryService,
  type DiscoveryStore,
} from './discovery.service.js';
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
  deactivatePreProgrammeIjazah,
  lockProgrammeSwitch,
  holdsSubject,
  insertPackage,
  lockPackageOwners,
  packageOf,
  packagesOf,
  peerPackagesOf,
  preProgrammeIjazahOwners,
} from './packages.repository.js';
import {
  PackagesService,
  type PackagesStore,
  type PreProgrammeRetirementStore,
  retirePreProgrammeIjazahPackages as retireOver,
} from './packages.service.js';
import { SubjectsRepository } from './subjects.repository.js';
import { type SubjectsReader, SubjectsService } from './subjects.service.js';
import { signatureOf, writeSignature } from './teacher-signature.repository.js';
import {
  type TeacherSignatureStore,
  TeacherSignatureService,
} from './teacher-signature.service.js';

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
  /** T006 of specs/005-certification: the correction's re-freeze, bound to certification's entry. */
  readonly openRequestsRefreeze: OpenRequestsRefreeze;
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
  readonly packages: Pick<PackagesService, 'list' | 'create' | 'update' | 'averagePrice'>;
  /** `teacher.slots.*` (T019). */
  readonly slots: TeacherSlots;
  /**
   * `teacher.signature.get` (T003 of specs/005-certification), built apart by
   * `createTeacherSignatureService`, since it needs the storage port, and composed by `main.ts`.
   */
  readonly signature: Pick<TeacherSignatureService, 'get'>;
}

/** What the catalog module's user-surface services are built over, bound once by `main.ts` (T020). */
export interface CatalogServiceDependencies {
  /** Booking's answers to whether a slot or a package is in use (R-207). */
  readonly use: CatalogUse;
  /** The process's client, which the packages and the slots read and write through (T018, T019). */
  readonly database: Database;
  /** The kernel's idempotency, keying `teacher.packages.create` and `teacher.slots.create`. */
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'run'>;
  /** 003:T113: the settings `teacher.packages.averagePrice` reads (`price_average_min_teachers`). */
  readonly settings: SettingsReader;
}

/**
 * The slots' store: this module's rows and locks, and the account's lock and zone and whether the
 * teacher is published through identity's entry (T019, T069, R-121).
 */
function slotsStoreOver(database: Database): SlotsStore {
  return {
    run: transactionsOver(database).run,
    lockAccount,
    lockTeacherSlots,
    lockSlot,
    isPublished: isPublishedTeacher,
    accountTimezone,
    ownsSlot,
    readSlot,
    slotsOf,
    activeSlotsOf,
    insertSlot,
    updateSlot,
  };
}

/**
 * The catalog module's user-surface services (T020); T018 and T019 build theirs over `use`. The
 * signature's is `createTeacherSignatureService`'s (T003 of specs/005-certification).
 */
export function createCatalogServices({
  use,
  database,
  idempotency,
  settings,
}: CatalogServiceDependencies): Omit<CatalogServices, 'signature'> {
  return {
    packages: new PackagesService({
      transactions: transactionsOver(database),
      store: packagesStore,
      use,
      idempotency,
      settings,
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
  // 006:T004 (Q-D1 (a)): the programme switch's advisory key.
  lockProgrammeSwitch,
  lockAccount,
  lockApplication,
  isPublished: isPublishedTeacher,
  holdsSubject,
  packagesOf,
  packageOf,
  insert: insertPackage,
  change: changePackage,
  // 003:T113: the average-price hint's pool, and identity's predicate over its teachers.
  peerPackages: peerPackagesOf,
  visibleTeacherIds: async (tx, requester, teacherIds) =>
    (await visibleTeachers(tx, requester, { purpose: 'discover', teacherIds })).map(({ id }) => id),
};
export { PackagesService };

/**
 * 006:T002 (SRS DEC-110; the note under T002, Q-3 (a)(a)): the programme's switch turned on
 * deactivates every old-style ijazah-track package (`is_programme = false`), on the setting
 * change's transaction `tx`, the owners' accounts locked first; answers how many. The admin
 * module's `settings.update` calls it on the turn from 0 to 1 and records the count.
 */
export const preProgrammeRetirementStore: PreProgrammeRetirementStore = {
  preProgrammeIjazahOwners,
  lockAccounts: lockPackageOwners,
  deactivatePreProgrammeIjazah,
};
export function retirePreProgrammeIjazahPackages(tx: Transaction): Promise<number> {
  return retireOver(preProgrammeRetirementStore, tx);
}
/** 006:T002: the switch's key, which `teacher.packages.update` and the admin module read. */
export { PROGRAMME_ENABLED_SETTING } from './packages.service.js';
/**
 * 006:T004 (SRS DEC-110, Q-D1 (a)): the programme switch's advisory key, on the caller's
 * transaction until it ends; `settings.update` of `programme_enabled` takes it before it writes the
 * value, ahead of every row lock (kernel.md, the 006:T004 row).
 */
export { lockProgrammeSwitch } from './packages.repository.js';

/** The `teacher.packages` router, mounted under `teacher.packages` by `app.router.ts` (T018). */
export { packagesRouter } from './packages.router.js';
/** The `teacher.slots` namespace, mounted by `app.router.ts` (T019). */
export { slotsRouter } from './slots.router.js';
/**
 * The active slots of the lengths of each teacher's active packages, on the caller's transaction:
 * what booking's discovery read decides is free (T026, R-205). 006:T004: a programme package's
 * teacher's slots at least the third argument long (the assessment's length, named only while the
 * programme is open); none named, a programme package offers nothing.
 */
export { type OfferedSlot, offeredSlotsOf } from './slots.repository.js';
/**
 * A slot by its id, active or not, on the caller's transaction: the weekday and local start the
 * confirm job generates an enrollment's sessions on, read under the slot's lock (T039, T034's note).
 * A slot in use keeps its day, time and length (R-207), so they are the enrollment's. `checkout.pay`
 * reads the held slot the same way, its zone the snapshot's (T036).
 */
export { readSlot } from './slots.repository.js';
/**
 * A teacher's slots' advisory lock (R-206) and every slot of the teacher, active or not, each on the
 * caller's transaction: booking's release of the holds on them when the teacher's account ends
 * (T041, R-219), taken after the account's lock and before the holds' (T005).
 */
export { lockTeacherSlots, slotsOf as teacherSlotsOf } from './slots.repository.js';
export type { SlotRow } from './slots.service.js';
/**
 * An active package's teacher and terms by its id alone, for booking's sheet (T032, FR-350).
 * 006:T004 (R-503): a union on `isProgramme`: a count and a length, or a programme package's three
 * prices; `priceForLength` reads one of them.
 */
export {
  type BookablePackage,
  bookablePackageOf,
  type FixedBookablePackage,
  type FixedTerms,
  priceForLength,
  type ProgrammeBookablePackage,
  type ProgrammePriceRow,
  type ProgrammeTerms,
} from './packages.repository.js';
/**
 * 006:T004 (R-503, R-515; Q-5 (a)): whether a programme package may be shown and booked now (the
 * switch on and the assessment's price above 0), with the assessment's price and length; closed,
 * the refusal a start answers. Read at each request through the settings reader.
 */
export {
  ASSESSMENT_DURATION_SETTING,
  ASSESSMENT_PRICE_SETTING,
  type ProgrammeAvailability,
  programmeAvailabilityOf,
} from './packages.service.js';
/**
 * A teacher's package by its id, with its subject, track and price, on the caller's transaction:
 * the checkout's payment summary (T036, FR-358). Null for an unknown id and for another teacher's.
 */
export {
  packageOwnerOf,
  packageOf as teacherPackageOf,
  type PackageRow,
} from './packages.repository.js';
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
/** Subjects by id, active or not, with both names: an enrollment's snapshot subject (T037, FR-358). */
export { subjectSummariesOf } from './subjects.repository.js';

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

/**
 * Discovery's store (T025, T027): this module's rows, the kernel's fold and identity's predicate and
 * page through its entry (R-201, R-204). Every read is on the caller's transaction and takes no lock.
 */
export const discoveryStore: DiscoveryStore = {
  offerings: activeOfferings,
  riwayas: approvedRiwayas,
  subjectsOf: cardSubjects,
  packagesOf: cardPackages,
  profilePackagesOf: profilePackages,
  activeSubjects: (tx) => new SubjectsRepository(tx).listActive(),
  fold: foldedTexts,
  visibleTeachers,
  visibleTeacherPage,
};

/**
 * Discovery's cards, subject tabs and riwaya values (T025, FR-332 to FR-335), and the teacher's
 * profile with its photo as the storage port's signed link (T027, FR-336), for booking's
 * `discovery` router (T026), which adds each card's nearest free slot and the search rate limit.
 * Each call takes the caller's transaction and the session's gender (R-GENDER-4, R-GENDER-5).
 */
export function createDiscoveryCatalog(
  settings: SettingsReader,
  storage: Pick<StoragePort, 'temporaryLink'>,
): DiscoveryCatalog {
  return new DiscoveryService({ settings, storage, store: discoveryStore });
}
export type { DiscoveryCatalog };

// ---------------------------------------------------------------------------------------------
// T003 of specs/005-certification: the teacher's signature (FR-601, SRS FR-IJAZAH-12; research
// R-411): `POST /uploads/signature` and `teacher.signature.get`, over `teacher_signatures`.

/** The signature's store: this module's rows, and the account's lock through identity's entry. */
export const teacherSignatureStore: TeacherSignatureStore = {
  lockAccount,
  current: signatureOf,
  write: writeSignature,
};

/** What the signature service is built over, bound once by `main.ts`. */
export interface TeacherSignatureServiceDependencies {
  readonly database: Database;
  readonly storage: Pick<StoragePort, 'put' | 'remove' | 'temporaryLink'>;
  readonly settings: SettingsReader;
  readonly log: Logger;
}

/**
 * The signature's service: the upload route's `replace` and `teacher.signature.get`'s `get`.
 * `main.ts` builds it once, hands it to the route, and composes it into `CatalogServices`.
 */
export function createTeacherSignatureService({
  database,
  storage,
  settings,
  log,
}: TeacherSignatureServiceDependencies): TeacherSignatureService {
  return new TeacherSignatureService({
    transactions: transactionsOver(database),
    store: teacherSignatureStore,
    storage,
    settings,
    log,
    clock: clockTimestamp,
  });
}
export type { TeacherSignatureService };

/** `POST /uploads/signature`, registered by `main.ts` among the upload routes. */
export {
  createSignatureUploadRoute,
  SIGNATURE_UPLOAD_PATH,
  type SignatureUploadDependencies,
} from './signature-upload.controller.js';

/** The `teacher.signature` namespace, mounted under `teacher.signature` by `app.router.ts`. */
export { teacherSignatureRouter } from './teacher-signature.router.js';

// ---------------------------------------------------------------------------------------------
// T006 of specs/005-certification (FR-627; research R-403; the note under T006, Q1 (a), Q-A1 (a),
// Q-A4 (a)): what the ijazah request reads of catalog, on the caller's transaction. The approved
// credential of the teacher's subject (rule 23) with its holder name, riwaya, tariq and chain origin
// first, read plain for the preview, locked FOR UPDATE then read for the send (the kernel row:
// `users` → `enrollments` → `teacher_credentials` → `ijazah_requests` → `ijazahs`), and by its id
// for the correction's re-freeze, whose conditional write already holds the row. The teacher's
// current signature row (`signatureOf`), whose file the send copies. The correction's port
// `OpenRequestsRefreeze`, which `main.ts` binds to certification's entry.
export {
  approvedCredentialChainById,
  approvedCredentialChainOf,
  type CredentialChain,
  lockedCredentialChainOf,
} from './credential-review.repository.js';
export { signatureOf as teacherSignatureOf } from './teacher-signature.repository.js';
export type { OpenRequestsRefreeze };

// ---------------------------------------------------------------------------------------------
// 005:T031 of specs/005-certification (FR-631; R-411; the note under T031, Q-D3 (a), Q-D4 (a)): the
// kept signature's erasure reads this module's `teacher_signatures` a page at a time and deletes a
// row once its file is gone, where the row still holds that key; verification's
// `createKeptSignatureErasure` composes them with identity's `signatureErasableOwnersAmong`.
export {
  deleteSignatureHolding,
  type SignatureFileRow,
  signaturesPage,
} from './teacher-signature.repository.js';
