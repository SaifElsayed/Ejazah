// T110: the readiness probe's database query (FR-051). One round trip on the process's client,
// as the application role: the cheapest question that proves a connection can be taken from the
// pool and the database answers. Raw SQL lives only in `platform/db/` (R-API-6), and this query
// names no table. A database that is not there fails within the client's connection timeout
// (prisma.repository.ts), so the probe answers 503 rather than hanging.
import type { Database } from './prisma.repository.js';

export class ReadinessRepository {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  async databaseReachable(): Promise<void> {
    await this.#database.$queryRaw`SELECT 1 AS reachable`;
  }
}
