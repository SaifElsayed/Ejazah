// T087 (note under T087, the owner's approval of 2026-10-27): the one guard of quickstart's three
// dev scripts, `count-person.ts`, `audit-tail.ts` and `admin-lockout-probe.ts`. Each refuses, before
// it opens the database or sends anything, unless `NODE_ENV` is `development` or `test`,
// `DATABASE_URL` names a database on this machine (`localhost`, `127.0.0.1` or `::1`, with no
// `host` or `hostaddr` parameter pointing elsewhere), and any API it calls is on this machine too.
// These are the conditions of `emit-recipient-event.ts` (the owner's condition 3 at B15), which
// keeps its own copy by the owner's decision. A refusal names the key, never the value.
//
// The two readers connect through `connectReadOnly`: every transaction of the session is read-only
// (`default_transaction_read_only`), so the database itself refuses them a write.
//
// Nothing under `scripts/` is in an application's build: `apps/api/tsconfig.json` includes `src`
// only, and no image copies this folder.
import { config as readDotenv } from 'dotenv';
import pg from 'pg';

export type Env = Readonly<Record<string, string | undefined>>;

const DEVELOPMENT_MODES: ReadonlySet<string> = new Set(['development', 'test']);
const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);
const DEFAULT_PORT = '3000';
const CONNECT_TIMEOUT_MILLISECONDS = 5_000;

function isLocalDatabase(url: string | undefined): boolean {
  if (url === undefined || !URL.canParse(url)) return false;
  const parsed = new URL(url);
  // libpq and pg read a `host` or `hostaddr` parameter over the URL's host.
  if (parsed.searchParams.has('host') || parsed.searchParams.has('hostaddr')) return false;
  return (
    (parsed.protocol === 'postgresql:' || parsed.protocol === 'postgres:') &&
    LOCAL_HOSTS.has(parsed.hostname)
  );
}

function isLocalApi(origin: string): boolean {
  if (!URL.canParse(origin)) return false;
  const parsed = new URL(origin);
  return (
    (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
    LOCAL_HOSTS.has(parsed.hostname)
  );
}

/** Why the script will not run here, or null when it may; `apiOrigin` only for a script that calls one. */
export function localOnlyRefusal(env: Env, apiOrigin?: string): string | null {
  if (!DEVELOPMENT_MODES.has(env['NODE_ENV'] ?? '')) {
    return 'runs only where NODE_ENV is development or test';
  }
  if (!isLocalDatabase(env['DATABASE_URL'])) {
    return 'runs only against a database on this machine: the host of DATABASE_URL must be localhost, 127.0.0.1 or ::1';
  }
  if (apiOrigin !== undefined && !isLocalApi(apiOrigin)) {
    return 'runs only against an API on this machine: --api (or localhost on PORT) must be http(s)://localhost, 127.0.0.1 or [::1]';
  }
  return null;
}

/** The API's origin: the one given, or localhost on `PORT`, the API's own default port without one. */
export function apiOriginOf(env: Env, given?: string): string {
  return given ?? `http://localhost:${env['PORT'] || DEFAULT_PORT}`;
}

/** The process's environment over `.env`, read into a scratch object so nothing is overwritten. */
export function environment(): Env {
  const fromDotenv: Record<string, string> = {};
  readDotenv({ processEnv: fromDotenv, quiet: true });
  return { ...fromDotenv, ...process.env };
}

/** What a script reads the database through. */
export interface Connection {
  query<Row extends pg.QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<pg.QueryResult<Row>>;
  end(): Promise<void>;
}

/** A session whose every transaction is read-only, so the database refuses any write. */
export async function connectReadOnly(url: string): Promise<Connection> {
  const db = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MILLISECONDS,
    options: '-c default_transaction_read_only=on',
  });
  await db.connect();
  return db;
}

/** Writes each line to a stream, for `main`. */
export function lineWriter(stream: NodeJS.WritableStream): (line: string) => void {
  return (line) => void stream.write(`${line}\n`);
}
