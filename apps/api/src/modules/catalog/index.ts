// PUBLIC ENTRY of the catalog module (T017). Other modules import this file and nothing below it (R-API-3).
import type { Database } from '../../platform/db/prisma.repository.js';
import { SubjectsRepository } from './subjects.repository.js';
import { type SubjectsReader, SubjectsService } from './subjects.service.js';

/** The subjects list's router, mounted under `catalog.subjects` by `app.router.ts` (T038). */
export { subjectsRouter } from './subjects.router.js';
export type { SubjectsReader } from './subjects.service.js';

/** The subjects read the user surface's context carries (T038, FR-182). */
export function createSubjectsService(database: Pick<Database, 'subject'>): SubjectsReader {
  return new SubjectsService(new SubjectsRepository(database));
}
