// T093: the catalog module's `teacher_credentials` rows as the verification module's unreferenced
// documents read them (R-API-6): which of a set of documents a credential points at. Queries only.
// It returns no teacher, only document ids, so it is excepted from the gender suite gate by name
// (`apps/api/src/modules/catalog/credentials*`, `scripts/suite-gate.paths.ts`); the credentials'
// own reads and writes join it with their tasks.
import type { Database } from '../../platform/db/prisma.repository.js';

type Client = Pick<Database, 'teacherCredential'>;

export class CredentialsRepository {
  readonly #database: Client;

  constructor(database: Client) {
    this.#database = database;
  }

  /** Of `documentIds`, those a credential points at. */
  async documentsAmong(documentIds: readonly string[]): Promise<ReadonlySet<string>> {
    const rows = await this.#database.teacherCredential.findMany({
      where: { documentId: { in: [...documentIds] } },
      select: { documentId: true },
    });
    return new Set(rows.map(({ documentId }) => documentId));
  }
}
