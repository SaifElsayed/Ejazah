// T102 — the process's one database client loads the generated client and reaches Postgres through
// the driver adapter (note under T036, research R-5).
//
// No database is needed. A client built over an address nothing listens on proves the two things
// that can go wrong before any query is right: the generated client is the real one, not the empty
// stand-in a package manager leaves when `prisma generate` wrote to another copy of
// `@prisma/client` (the empty one throws as it is built), and a query fails at the connection, in
// seconds, rather than hanging.
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabase, type Database, openDatabase } from './prisma.repository.js';

const nobodyListens = 'postgresql://ijazah_app:app@127.0.0.1:1/ijazah';

let database: Database | undefined;

afterEach(async () => {
  if (database !== undefined) await closeDatabase(database);
  database = undefined;
});

describe('the database client (T102)', () => {
  it('is the generated client, with a delegate for every table of the schema', () => {
    database = openDatabase(nobodyListens);
    expect(typeof database.idempotencyKey.findUnique).toBe('function');
  });

  it('fails a query at the connection, within the connection timeout', async () => {
    database = openDatabase(nobodyListens);
    const started = performance.now();
    await expect(database.$queryRaw`SELECT 1`).rejects.toThrow();
    expect(performance.now() - started).toBeLessThan(10_000);
  });
});
