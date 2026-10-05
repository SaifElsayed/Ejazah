// T021 fixture — VIOLATION of R-API-2: a service holds the database client. Services decide;
// repositories fetch, and the database client is a name only a `*.repository.ts` file may know.
// The import alone is the violation. The fixture carries no query on purpose: a query on a table
// from a file that is not a repository file is also refused by api/table-ownership (R-API-6), and
// this file must be refused by one rule only (note under T047, 2026-10-05).
// Refused by api/no-orm-outside-repository.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export function databaseClient(): PrismaClient {
  return prisma;
}
