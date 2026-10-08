// T102: the process's one database client (note under T036; research R-5).
//
// Prisma 7 reaches Postgres only through a driver adapter, so the client is built here over
// `@prisma/adapter-pg` and a pg pool opened on DATABASE_URL: the APPLICATION role's connection
// string. The owner's never reaches this file; config.module.ts strips it from the configuration.
//
// ONE PER PROCESS. Each entrypoint (main.ts, worker.ts) opens one client at start and closes it at
// stop, and hands it to every repository it builds, so the process holds one pool. The pool keeps
// pg's own default size until a configuration value names another.
//
// This file is a `*.repository.ts` because only such a file may name the client (R-API-2). The
// client's `$` members other than `$transaction` are refused outside `platform/db/` (R-API-6), which
// is why closing the client is a function here rather than a call in the entrypoints.
import { PrismaPg } from '@prisma/adapter-pg';
import { type Prisma, PrismaClient } from '@prisma/client';

export type Database = PrismaClient;

/** The client inside an interactive transaction: what a repository receives to write in one. */
export type Transaction = Prisma.TransactionClient;

// A database that is not there fails a query, or the readiness probe, in seconds rather than at
// the operating system's socket timeout.
const CONNECTION_TIMEOUT_MILLISECONDS = 5_000;

export function openDatabase(url: string): Database {
  const adapter = new PrismaPg({
    connectionString: url,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MILLISECONDS,
  });
  return new PrismaClient({ adapter });
}

export async function closeDatabase(database: Database): Promise<void> {
  await database.$disconnect();
}
