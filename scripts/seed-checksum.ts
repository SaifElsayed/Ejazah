// T075: the seed checksum (FR-038, SC-002). Two engineers compare it to prove their datasets are
// identical (quickstart §1): `pnpm db:seed:checksum` prints one SHA-256, in lower-case hex.
//
// WHAT IT READS. Every row of every table in `public` but `_prisma_migrations`, the migration tool's
// own record, whose timestamps are when each machine migrated. So a row the seed did not plant, in
// any table, changes the checksum too: it compares datasets, not only the seed's three tables.
// Exactly two columns are left out: `admin_users.password_hash` and
// `admin_users.mfa_secret_encrypted`, the administrator's credential, which is random on every
// machine by design (note under T074). Nothing else is excluded; a new value that differs between
// machines makes the checksum differ, which is the point.
//
// HOW IT IS CANONICAL. Tables in byte order of their names; each row as `to_jsonb`, whose keys
// PostgreSQL orders itself, the left-out columns removed; rows in byte order of that text
// (`COLLATE "C"`, never the server's locale). The session's TimeZone is set to UTC and
// `bytea_output` to hex first, the two settings that change how a value here is rendered; neither is
// reset, and a caller inside a transaction gets its own back on ROLLBACK. The hash is over `table\n`
// and then `row\n` for each row.
//
// Run as the APPLICATION role (`DATABASE_URL`), which may read every table but the migrations
// record. Exits 0 printing the checksum, 1 when it cannot connect or read.
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { config as readDotenv } from 'dotenv';
import pg from 'pg';

// Only DATABASE_URL is taken from `.env`, into a scratch object, and only when the environment does
// not carry it: specs import this file, and loading the whole file would bring back a provider key
// the test setup removed (T114).
const fromDotenv: Record<string, string> = {};
readDotenv({ processEnv: fromDotenv, quiet: true });
for (const key of ['DATABASE_URL'] as const) {
  const value = fromDotenv[key];
  if (process.env[key] === undefined && value !== undefined) process.env[key] = value;
}

export interface Queryable {
  query<Row extends pg.QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<pg.QueryResult<Row>>;
}

const MIGRATIONS_TABLE = '_prisma_migrations';

/** The administrator's credential: random on every machine, so never compared (note under T074). */
const LEFT_OUT: Readonly<Record<string, readonly string[]>> = {
  admin_users: ['password_hash', 'mfa_secret_encrypted'],
};

/** The checksum of the dataset `db` is connected to. Sets the session's TimeZone and bytea_output. */
export async function seedChecksum(db: Queryable): Promise<string> {
  await db.query(`SET TIME ZONE 'UTC'`);
  await db.query(`SET bytea_output = 'hex'`);
  const { rows: tables } = await db.query<{ table_name: string }>(
    `SELECT c.relname AS table_name
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> $1
      ORDER BY c.relname COLLATE "C"`,
    [MIGRATIONS_TABLE],
  );
  const hash = createHash('sha256');
  for (const { table_name: table } of tables) {
    const { rows } = await db.query<{ row: string }>(
      `SELECT (to_jsonb(t) - $1::text[])::text AS row
         FROM ${pg.escapeIdentifier(table)} t
        ORDER BY (to_jsonb(t) - $1::text[])::text COLLATE "C"`,
      [LEFT_OUT[table] ?? []],
    );
    hash.update(`${table}\n`);
    for (const { row } of rows) hash.update(`${row}\n`);
  }
  return hash.digest('hex');
}

async function main(): Promise<number> {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '' || !URL.canParse(url)) {
    process.stderr.write('seed checksum: DATABASE_URL is not set to a connection string\n');
    return 1;
  }
  const db = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  try {
    await db.connect();
    process.stdout.write(`${await seedChecksum(db)}\n`);
    return 0;
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : 'unknown failure';
    process.stderr.write(`seed checksum: could not read the dataset: ${reason}\n`);
    return 1;
  } finally {
    await db.end().catch(() => undefined);
  }
}

// Run as a command (`pnpm db:seed:checksum`, tsx), never when a spec imports `seedChecksum`. tsx
// compiles this file as CommonJS, so neither top-level await nor `import.meta` is available.
if (basename(process.argv[1] ?? '') === 'seed-checksum.ts') {
  void main().then((code) => {
    process.exitCode = code;
  });
}
