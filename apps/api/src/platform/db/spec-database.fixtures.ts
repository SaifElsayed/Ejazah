// T124: no spec writes to a database unless `IJAZAH_DB_SPECS=1` says so, for the specs' use and
// nothing a request ever runs. B19b's local run, with `.env` sourced, wrote spec rows to the
// development database `ijazah`, and a run with nothing sourced did too, since the integrity harness
// and the API's fixtures read the two database URLs from `.env` by themselves. The variable is set on
// purpose, in CI's steps that have a database and in the local run on `ijazah_integrity`; the
// database's name decides nothing, since CI's is also named `ijazah`.
//
// TWO LINES, ONE RULE. (1) Every database spec carries the Vitest tag `database`, a file by a
// `@module-tag` comment and a single describe by `{ tags: ['database'] }`, defined by `databaseTag`
// in `vitest.config.ts` and `apps/api/vitest.config.ts`: without the variable each of its cases is
// skipped, visibly, and a file whose cases are all skipped runs none of its hooks, so nothing
// connects. (2) The URL readers and the connection openers the specs share refuse while the
// variable is off, so a database spec that forgot its tag fails loudly rather than writing. Once it
// is on, the two URLs come from the environment only, never from `.env` (the owner's decision of
// 2026-11-01), and a URL a spec needs that the environment lacks refuses the run, naming it.

export const DATABASE_SPECS_VARIABLE = 'IJAZAH_DB_SPECS';
export const DATABASE_TAG = 'database';

type Environment = Readonly<Record<string, string | undefined>>;
export type DatabaseUrlKey = 'DATABASE_URL' | 'DATABASE_URL_OWNER';

/** Whether the database specs may run: the variable is exactly `1`, and nothing else decides. */
export function databaseSpecsEnabled(env: Environment = process.env): boolean {
  return env[DATABASE_SPECS_VARIABLE] === '1';
}

/** The tag's definition for a Vitest configuration's `test.tags`. */
export function databaseTag(env: Environment = process.env) {
  return {
    name: DATABASE_TAG,
    description: `Writes to a database; skipped unless ${DATABASE_SPECS_VARIABLE}=1 (T124)`,
    skip: !databaseSpecsEnabled(env),
  };
}

export class DatabaseSpecsOff extends Error {
  constructor() {
    super(
      `database specs are off: set ${DATABASE_SPECS_VARIABLE}=1 to let a spec connect (T124), and only against a database meant for specs`,
    );
    this.name = 'DatabaseSpecsOff';
  }
}

/** Throws unless the variable is on: the first statement of anything that connects. */
export function assertDatabaseSpecs(env: Environment = process.env): void {
  if (!databaseSpecsEnabled(env)) throw new DatabaseSpecsOff();
}

/**
 * A database URL for a spec, from the environment only. Refused while the variable is off, and when
 * the environment lacks it; the refusal names the variable, never a URL.
 */
export function specDatabaseUrl(key: DatabaseUrlKey, env: Environment = process.env): string {
  assertDatabaseSpecs(env);
  const url = env[key];
  if (url === undefined || url === '') {
    throw new Error(
      `${key} is not set in the environment: with ${DATABASE_SPECS_VARIABLE}=1 the specs take it from the environment only, never from .env (T124); source the ijazah_integrity environment first`,
    );
  }
  return url;
}

/**
 * `open()`'s connection while the variable is on. While it is off, `open` is never called and a
 * stand-in is returned that refuses every use, so a spec file may open its database at module scope
 * and still load, its cases skipped by the tag.
 */
export function whenDatabaseSpecs<T extends object>(
  open: () => T,
  env: Environment = process.env,
): T {
  if (databaseSpecsEnabled(env)) return open();
  return new Proxy({} as T, {
    get() {
      throw new DatabaseSpecsOff();
    },
  });
}
