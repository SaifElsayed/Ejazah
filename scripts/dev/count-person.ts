// T087 (SC-103, SC-111; quickstart §2 and §5): the rows of one person across every table, by
// address or by user id.
//
//   pnpm exec tsx scripts/dev/count-person.ts --email <address>
//   pnpm exec tsx scripts/dev/count-person.ts --user <id>
//
// THE TABLES ARE THE DATABASE'S OWN. Every table in the schema holding a single-column foreign key
// to `users(id)` is counted, by each such column, beside `users` itself; a table a later phase adds
// is counted with no edit here. A table reached only through another table (`user_session_retired_tokens`
// through `user_sessions`) is not a row of the person and is not listed.
//
// THE ADDRESS is looked up as the identity module stores and compares it: trimmed and in lower
// case (`normalizeEmail`, identity's `one-time-codes.ts`, which its public entry does not export),
// against `users.email`, a `citext` column. A deleted account's address is erased (FR-141), so a
// deleted person is counted by `--user`.
//
// IT ONLY READS, ONLY ON THIS MACHINE (note under T087): the guard of `local-only.ts` refuses before
// the database is opened, and the session is read-only, so the database refuses any write. It
// prints the ids the address matched and table and count, never a personal value.
import { basename } from 'node:path';
import { parseArgs } from 'node:util';

import pg from 'pg';

import {
  connectReadOnly,
  type Connection,
  type Env,
  environment,
  lineWriter,
  localOnlyRefusal,
} from './local-only';

const USAGE = 'usage: count-person.ts --email <address> | --user <id>';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USERS = 'users';

export type CountArguments = { readonly email: string } | { readonly user: string };

/** The arguments, or the usage line saying what is wrong with them. */
export function parseArguments(argv: readonly string[]): CountArguments | string {
  let values: { email?: string; user?: string };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: { email: { type: 'string' }, user: { type: 'string' } },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    return USAGE;
  }
  const { email, user } = values;
  if ((email === undefined) === (user === undefined)) {
    return `${USAGE}\n  one of --email and --user`;
  }
  if (user !== undefined) return UUID.test(user) ? { user } : `${USAGE}\n  --user is a uuid`;
  if (email === undefined || email.trim() === '') return `${USAGE}\n  --email is an address`;
  return { email };
}

/** An address as the identity module stores and compares it: trimmed, lower case. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Every single-column foreign key in this schema to `users(id)`: the table and the column. Read
 * from the catalogue, so the list is the database's, never this file's.
 */
export const REFERENCES_TO_USERS = `
  SELECT referencing.relname AS "table", referencing_column.attname AS "column"
    FROM pg_constraint fk
    JOIN pg_class referencing ON referencing.oid = fk.conrelid
    JOIN pg_namespace schema ON schema.oid = referencing.relnamespace
    JOIN pg_attribute referencing_column
      ON referencing_column.attrelid = fk.conrelid AND referencing_column.attnum = fk.conkey[1]
    JOIN pg_attribute referenced_column
      ON referenced_column.attrelid = fk.confrelid AND referenced_column.attnum = fk.confkey[1]
   WHERE fk.contype = 'f'
     AND fk.confrelid = to_regclass('${USERS}')
     AND cardinality(fk.conkey) = 1
     AND referenced_column.attname = 'id'
     AND schema.nspname = current_schema()
   ORDER BY 1, 2`;

export interface Reference {
  readonly table: string;
  readonly column: string;
}

/** One count per table, `users` among them, each over every column that names the person. */
export function countStatements(
  references: readonly Reference[],
): { readonly table: string; readonly text: string }[] {
  const columnsOf = new Map<string, string[]>([[USERS, ['id']]]);
  for (const { table, column } of references) {
    columnsOf.set(table, [...(columnsOf.get(table) ?? []), column]);
  }
  return [...columnsOf.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([table, columns]) => ({
      table,
      text: `SELECT count(*)::int AS rows FROM ${pg.escapeIdentifier(table)} WHERE ${columns
        .map((column) => `${pg.escapeIdentifier(column)} = ANY($1::uuid[])`)
        .join(' OR ')}`,
    }));
}

export interface TableCount {
  readonly table: string;
  readonly rows: number;
}

/** The ids matched, then each table and its count, aligned, then the total. */
export function formatCounts(userIds: readonly string[], counts: readonly TableCount[]): string[] {
  const sorted = [...counts].sort((left, right) => left.table.localeCompare(right.table));
  const total = sorted.reduce((sum, { rows }) => sum + rows, 0);
  const width = Math.max('total'.length, ...sorted.map(({ table }) => table.length));
  const line = (name: string, rows: number) => `${name.padEnd(width)}  ${rows}`;
  const matched = `users matched: ${userIds.length}`;
  return [
    userIds.length === 0 ? matched : `${matched} (${userIds.join(', ')})`,
    ...sorted.map(({ table, rows }) => line(table, rows)),
    line('total', total),
  ];
}

export interface RunDependencies {
  readonly connect: (url: string) => Promise<Connection>;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

async function userIdsOf(db: Connection, parsed: CountArguments): Promise<string[]> {
  if ('user' in parsed) return [parsed.user];
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM ${USERS} WHERE email = $1 ORDER BY id`,
    [normalizeEmail(parsed.email)],
  );
  return rows.map(({ id }) => id);
}

async function countsOf(db: Connection, userIds: readonly string[]): Promise<TableCount[]> {
  const { rows: references } = await db.query<{ table: string; column: string }>(
    REFERENCES_TO_USERS,
  );
  const counts: TableCount[] = [];
  // One client runs one query at a time, so the counts are read one after another.
  for (const { table, text } of countStatements(references)) {
    const { rows } = await db.query<{ rows: number }>(text, [userIds]);
    counts.push({ table, rows: rows[0]?.rows ?? 0 });
  }
  return counts;
}

/** Counts the person's rows; the process's exit code. */
export async function run(
  argv: readonly string[],
  env: Env,
  deps: RunDependencies,
): Promise<number> {
  const say = (line: string): void => deps.err(`count-person: ${line}`);
  const parsed = parseArguments(argv);
  if (typeof parsed === 'string') {
    say(parsed);
    return 2;
  }
  const refusal = localOnlyRefusal(env);
  if (refusal !== null) {
    say(refusal);
    return 1;
  }
  const db = await deps.connect(env['DATABASE_URL'] ?? '');
  try {
    const userIds = await userIdsOf(db, parsed);
    for (const line of formatCounts(userIds, await countsOf(db, userIds))) deps.out(line);
  } finally {
    await db.end().catch(() => undefined);
  }
  return 0;
}

// Run as a command (tsx), never when a spec imports it; tsx compiles this file as CommonJS.
if (basename(process.argv[1] ?? '') === 'count-person.ts') {
  void run(process.argv.slice(2), environment(), {
    connect: connectReadOnly,
    out: lineWriter(process.stdout),
    err: lineWriter(process.stderr),
  }).then((code) => {
    process.exitCode = code;
  });
}
