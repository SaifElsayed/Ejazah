// PUBLIC ENTRY of the catalog module (T017). Other modules import this file and nothing below it (R-API-3).
import type { Database } from '../../platform/db/prisma.repository.js';
import { CredentialsRepository } from './credentials.repository.js';
import { SubjectsRepository } from './subjects.repository.js';
import { type SubjectsReader, SubjectsService } from './subjects.service.js';

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
 * approval's (admin-surface `credentials.approve`).
 */
export {
  addCredential,
  type CredentialRow,
  grantSubjects,
  listCredentials,
  type NewCredentialRow,
  replaceCredentialDocument,
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
