// PUBLIC ENTRY of the catalog module (T017). Other modules import this file and nothing below it (R-API-3).
import type { Database } from '../../platform/db/prisma.repository.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
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
import { isApprovedTeacher } from '../identity/index.js';
import { SubjectsRepository } from './subjects.repository.js';
import { type SubjectsReader, SubjectsService } from './subjects.service.js';

/** The administrator surface's `credentials` namespace, mounted by `admin.router.ts` (T069). */
export { credentialsAdminRouter } from './credentials-admin.router.js';
export type { CredentialReviewService };

/**
 * The credential review's store: this module's rows, the teacher's standing read through identity's
 * entry (R-121). Exported for the probe of its queries (`tests/db-integrity/credential-review.spec.ts`).
 */
export const credentialReviewStore: CredentialReviewStore = {
  page: reviewPage,
  count: reviewCount,
  read: readForReview,
  hasApproved: hasApprovedCredential,
  approve: approveCredential,
  decide: decideCredential,
  correct: correctCredential,
  isApprovedTeacher,
  grantSubjects,
};

/** The credential review (T069, FR-163, FR-164); the admin module composes it into the surface's services. */
export function createCredentialReviewService(dependencies: {
  readonly settings: SettingsReader;
  readonly now?: () => Date;
}): CredentialReviewService {
  return new CredentialReviewService({ ...dependencies, store: credentialReviewStore });
}

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
