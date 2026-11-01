// An empty database of a spec's own, for the seed specs (T072, T073). The seed and the migration
// history are proven on a database nothing else writes to: the shared one the API and the other
// specs use may hold rows of theirs, and "applies to an empty database" needs one that is empty.
//
// HOW. `DATABASE_URL_OWNER` names the server and a role that may CREATE DATABASE (the owner; in
// development it is the image's superuser, docker-compose.yml). A database named
// `ijazah_seed_<random>` is created beside the one that URL names, migrated by the Prisma CLI exactly
// as `pnpm db:migrate` does (one `prisma migrate deploy`, as the owner), and dropped after with
// FORCE. The application role's URL for it is `DATABASE_URL` with the database name replaced: the
// seed and the checksum run as the application role, as the running system does (research R-5).
//
// T124: both URLs come from the environment only, never from `.env` (the owner's decision of
// 2026-11-01), and only once IJAZAH_DB_SPECS=1; without it nothing here connects.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import pg from 'pg';

import {
  assertDatabaseSpecs,
  specDatabaseUrl,
} from '../../apps/api/src/platform/db/spec-database.fixtures';

const root = join(__dirname, '..', '..');
const prismaCli = join(root, 'node_modules', 'prisma', 'build', 'index.js');

/** Long enough for a cold Prisma CLI to apply the whole history on a slow machine. */
export const MIGRATE_TIMEOUT_MILLISECONDS = 120_000;

function required(name: 'DATABASE_URL' | 'DATABASE_URL_OWNER'): string {
  const value = specDatabaseUrl(name);
  if (!URL.canParse(value)) {
    throw new Error(
      `${name} is not set to a connection string: the seed specs need one (quickstart §1)`,
    );
  }
  return value;
}

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

async function asOwner<T>(work: (db: pg.Client) => Promise<T>): Promise<T> {
  const db = new pg.Client({
    connectionString: required('DATABASE_URL_OWNER'),
    connectionTimeoutMillis: 5_000,
  });
  await db.connect();
  try {
    return await work(db);
  } finally {
    await db.end();
  }
}

export interface FreshDatabase {
  readonly name: string;
  /** The owner's URL for this database: what the migrations run as. */
  readonly ownerUrl: string;
  /** The application role's URL for this database: what the seed and the checksum run as. */
  readonly applicationUrl: string;
  drop(): Promise<void>;
}

/** Creates an empty database of the caller's own. Drop it after. */
export async function createEmptyDatabase(): Promise<FreshDatabase> {
  const applicationBase = required('DATABASE_URL');
  const ownerBase = required('DATABASE_URL_OWNER');
  const name = `ijazah_seed_${randomBytes(6).toString('hex')}`;
  await asOwner((db) => db.query(`CREATE DATABASE ${pg.escapeIdentifier(name)}`));
  return {
    name,
    ownerUrl: withDatabase(ownerBase, name),
    applicationUrl: withDatabase(applicationBase, name),
    drop: async () => {
      await asOwner((db) =>
        db.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(name)} WITH (FORCE)`),
      );
    },
  };
}

export interface MigrateResult {
  readonly exitCode: number | null;
  readonly output: string;
}

/** Runs `prisma migrate deploy` once against `database`, as the owner. */
export function migrate(database: FreshDatabase): Promise<MigrateResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      cwd: root,
      env: { ...process.env, DATABASE_URL_OWNER: database.ownerUrl },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    const timer = setTimeout(() => child.kill(), MIGRATE_TIMEOUT_MILLISECONDS);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, output });
    });
  });
}

/** A client connected to `url`, its session in `timeZone` when one is given. End it after. */
export async function connect(url: string, timeZone?: string): Promise<pg.Client> {
  assertDatabaseSpecs();
  const db = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: 5_000,
    ...(timeZone === undefined ? {} : { options: `-c TimeZone=${timeZone}` }),
  });
  await db.connect();
  return db;
}
