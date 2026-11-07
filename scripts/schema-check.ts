// T070: the schema check (FR-024, SC-014). It reads the live catalogue of the `public` schema and
// names every column, type, index or grant that breaks a convention of ERD §0, as data-model.md §2
// and §3 list them. T071 runs it in the pipeline after the migrations.
//
//   timestamp-without-zone     a `timestamp without time zone` column (R-TIME-4)
//   timestamp-suffix           a `timestamptz` not ending `_at`, or an `_at` that is not `timestamptz` (R-TIME-5)
//   piasters-type              an `_piasters` column that is not an integer type (R-MONEY-1)
//   local-time                 an `_local` column that is not a date or a time, or has no `timezone` beside it (R-TIME-3)
//   secret-column              a name holding a secret word, not ending `_hash` or `_encrypted` (R-DB-7, R-DB-8),
//                              outside the declared list of names that hold a word but no secret (T013)
//   hash-type                  an `_hash` column that is not text
//   encrypted-type             an `_encrypted` column that is not `bytea`, or a `bytea` not ending `_encrypted`
//   enum-duplicate             an enum whose labels, in order, repeat another enum's (enums declared once)
//   users-partial-index        `users.phone` or `users.email` without its unique index WHERE deleted_at IS NULL
//   reviews-enrollment-unique  `reviews.enrollment_id` without a plain unique index, or with a partial one (ADR 0006)
//   derived-value              a name holding an aggregate word, outside the declared list (R-DB-4)
//   declared-cache             one of the six declared caches missing or of another type (SC-014)
//   soft-delete-privilege      a table with `deleted_at` that grants DELETE to the application role (note under T070)
//
// Names are split on `_` and matched word by word, so `qualification_summary` holds no `sum`.
// `checkSchema` takes a connected client and returns what it found, so a test can run it inside the
// transaction that made a violation. Run as a command, it connects with DATABASE_URL, takes the
// application role from that URL's user, prints one line per violation and exits 1, or 2 when it
// cannot connect or read; a clean schema exits 0.
import { config as readDotenv } from 'dotenv';
import { basename } from 'node:path';
import pg from 'pg';

// Only DATABASE_URL is taken from `.env`, into a scratch object, and only when the environment does
// not carry it: a spec imports this file (tests/db-integrity/schema-check.spec.ts), and loading the
// whole file would bring back a provider key the test setup removed (T114, PR #49 review m1).
const fromDotenv: Record<string, string> = {};
readDotenv({ processEnv: fromDotenv, quiet: true });
for (const key of ['DATABASE_URL'] as const) {
  const value = fromDotenv[key];
  if (process.env[key] === undefined && value !== undefined) process.env[key] = value;
}

export interface Violation {
  readonly rule: string;
  readonly table: string;
  readonly column?: string;
  readonly detail: string;
}

export interface Queryable {
  query<Row extends pg.QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<pg.QueryResult<Row>>;
}

export interface CheckOptions {
  /** The role the runtime connects as, which must hold no DELETE on a soft-deleted table. */
  readonly applicationRole: string;
}

const SCHEMA = 'public';

// Words naming a secret (data-model.md §2: token, secret, password, code; R-DB-7 and R-DB-8 add
// one-time codes, MFA, payout accounts and national identifiers). A phrase is matched as
// consecutive words.
const SECRET_PHRASES: readonly (readonly string[])[] = [
  ['token'],
  ['secret'],
  ['password'],
  ['code'],
  ['otp'],
  ['mfa'],
  ['payout', 'account'],
  ['national', 'id'],
];

// Columns whose name holds a secret word and that hold no secret: an instant, or a counter, about
// the secret, never its material (Phase 1, T013; specs/002-identity/data-model.md §2). Each is
// named here with why, as the aggregate list below names its exceptions, so the rule stays on by
// default and the list is reviewed.
const SECRET_NAMES_ALLOWED: ReadonlyMap<string, string> = new Map([
  ['admin_users.mfa_last_accepted_step', 'the last TOTP step accepted, a counter (RFC 6238 §5.2)'],
  ['admin_users.mfa_enrolled_at', 'the instant the second factor was confirmed at setup'],
  ['admin_users.password_set_at', 'the instant the password was set'],
  ['admin_sessions.mfa_verified_at', 'the instant the second factor passed on the session'],
]);

// Words naming a value computed from other rows or columns.
const AGGREGATE_WORDS: ReadonlySet<string> = new Set([
  'average',
  'avg',
  'total',
  'sum',
  'count',
  'remaining',
  'balance',
]);

// Columns whose name holds an aggregate word and that are stored on purpose. The first two are
// caches R-DB-4 declares; the others are not derived at all.
const AGGREGATE_NAMES_ALLOWED: ReadonlyMap<string, string> = new Map([
  ['teacher_profiles.average_rating', 'a cache R-DB-4 declares'],
  ['teacher_profiles.review_count', 'a cache R-DB-4 declares'],
  ['enrollments.snapshot_session_count', "the package's count when booked, a snapshot"],
  // Phase 2 (T036, the owner's decision of 2026-11-03): the count the hold's overlap check covered.
  ['slot_holds.session_count', "the package's count when held, a snapshot"],
  ['packages.session_count', "a package's own property, set by the teacher"],
  ['otp_codes.attempt_count', 'the state of a code, counted as attempts happen'],
  // Phase 1 (T013, ADR 0019 D3): the lockout pair's count, counted as attempts fail.
  ['admin_users.failed_sign_in_count', 'the state of the lockout, counted as sign-ins fail'],
]);

// Prisma's own bookkeeping table: its columns are Prisma's, not this schema's.
const TABLES_NOT_CHECKED_FOR_AGGREGATES: ReadonlySet<string> = new Set(['_prisma_migrations']);

// The caches R-DB-4 declares (data-model.md §3), with the type each must keep: the six of Phase 0,
// and `sessions.simultaneous_connected_seconds`, written once by the evaluation as the figure its
// outcome was decided on (R-DB-4 as constitution 2.5.0 amends it, ADR 0022; Phase 3's T001). The
// five on `sessions` cannot be recognised by name, so the check asserts they exist as declared.
const DECLARED_CACHES: ReadonlyMap<string, string> = new Map([
  ['teacher_profiles.average_rating', 'numeric(3,2)'],
  ['teacher_profiles.review_count', 'integer'],
  ['sessions.scheduled_start_at', 'timestamp(6) with time zone'],
  ['sessions.scheduled_end_at', 'timestamp(6) with time zone'],
  ['sessions.teacher_user_id', 'uuid'],
  ['sessions.student_user_id', 'uuid'],
  ['sessions.simultaneous_connected_seconds', 'integer'],
]);

const INTEGER_TYPES: ReadonlySet<string> = new Set(['int2', 'int4', 'int8']);
const TEXT_TYPES: ReadonlySet<string> = new Set(['text', 'varchar', 'citext']);

interface ColumnRow {
  readonly table_name: string;
  readonly column_name: string;
  readonly type_name: string;
  readonly formatted: string;
}

function words(name: string): string[] {
  return name.split('_').filter((word) => word !== '');
}

function holdsPhrase(name: string, phrase: readonly string[]): boolean {
  const all = words(name);
  return all.some((_, start) => phrase.every((word, offset) => all[start + offset] === word));
}

/** Each table's zone columns: `timezone`, and every `<p>_timezone`. */
function zoneColumnsByTable(columns: readonly ColumnRow[]): Map<string, string[]> {
  const zones = new Map<string, string[]>();
  for (const { table_name: table, column_name: column } of columns) {
    if (column !== 'timezone' && !column.endsWith('_timezone')) continue;
    zones.set(table, [...(zones.get(table) ?? []), column]);
  }
  return zones;
}

/**
 * Whether a `_local` column has a zone beside it (R-TIME-3, R-TIME-5 as constitution 2.6.2 words
 * them, the owner's decision of 2026-11-06 on Phase 3's T001): a `timezone` column, or a
 * `<p>_timezone` column when the `_local` column's name starts with `<p>_`, as
 * `counter_start_time_local` beside `counter_timezone`. A zone of another prefix does not count.
 */
function isZoned(column: string, zones: readonly string[]): boolean {
  return zones.some(
    (zone) => zone === 'timezone' || column.startsWith(zone.slice(0, -'timezone'.length)),
  );
}

function checkColumns(columns: readonly ColumnRow[], violations: Violation[]): void {
  const zonesByTable = zoneColumnsByTable(columns);
  for (const row of columns) {
    const { table_name: table, column_name: column, type_name: type } = row;
    const at = (rule: string, detail: string): void => {
      violations.push({ rule, table, column, detail });
    };
    const qualified = `${table}.${column}`;

    if (type === 'timestamp') at('timestamp-without-zone', 'a timestamp without a time zone');
    if (type === 'timestamptz' && !column.endsWith('_at')) {
      at('timestamp-suffix', 'a timestamptz whose name does not end _at');
    }
    if (column.endsWith('_at') && type !== 'timestamptz') {
      at('timestamp-suffix', `ends _at but is ${row.formatted}`);
    }
    if (column.endsWith('_piasters') && !INTEGER_TYPES.has(type)) {
      at('piasters-type', `money is integer piasters, not ${row.formatted}`);
    }
    if (column.endsWith('_local')) {
      if (type !== 'date' && type !== 'time') at('local-time', `a local value of ${row.formatted}`);
      else if (!isZoned(column, zonesByTable.get(table) ?? [])) {
        at('local-time', 'no timezone column beside it');
      }
    }
    const secured = column.endsWith('_hash') || column.endsWith('_encrypted');
    if (
      !secured &&
      !SECRET_NAMES_ALLOWED.has(qualified) &&
      SECRET_PHRASES.some((phrase) => holdsPhrase(column, phrase))
    ) {
      at('secret-column', 'a secret stored bare; hash it (_hash) or encrypt it (_encrypted)');
    }
    if (column.endsWith('_hash') && !TEXT_TYPES.has(type)) {
      at('hash-type', `a hash is text, not ${row.formatted}`);
    }
    if (column.endsWith('_encrypted') && type !== 'bytea') {
      at('encrypted-type', `an encrypted value is bytea, not ${row.formatted}`);
    }
    if (type === 'bytea' && !column.endsWith('_encrypted')) {
      at('encrypted-type', 'a bytea whose name does not end _encrypted');
    }
    if (
      !TABLES_NOT_CHECKED_FOR_AGGREGATES.has(table) &&
      !AGGREGATE_NAMES_ALLOWED.has(qualified) &&
      words(column).some((word) => AGGREGATE_WORDS.has(word))
    ) {
      at('derived-value', 'a derived value outside the caches R-DB-4 declares');
    }
  }

  const byName = new Map(columns.map((row) => [`${row.table_name}.${row.column_name}`, row]));
  for (const [qualified, expected] of DECLARED_CACHES) {
    const [table = '', column = ''] = qualified.split('.');
    const found = byName.get(qualified);
    if (found === undefined) {
      violations.push({ rule: 'declared-cache', table, column, detail: 'missing' });
    } else if (found.formatted !== expected) {
      violations.push({
        rule: 'declared-cache',
        table,
        column,
        detail: `declared ${expected}, found ${found.formatted}`,
      });
    }
  }
}

async function checkEnums(db: Queryable, violations: Violation[]): Promise<void> {
  const { rows } = await db.query<{ type_name: string; labels: string }>(
    `SELECT t.typname AS type_name,
            string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS labels
       FROM pg_type t
       JOIN pg_enum e ON e.enumtypid = t.oid
       JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = $1
      GROUP BY t.typname
      ORDER BY t.typname`,
    [SCHEMA],
  );
  const first = new Map<string, string>();
  for (const { type_name: name, labels } of rows) {
    const earlier = first.get(labels);
    if (earlier === undefined) first.set(labels, name);
    else {
      violations.push({
        rule: 'enum-duplicate',
        table: name,
        detail: `the same labels as ${earlier}; declare an enum once`,
      });
    }
  }
}

interface IndexRow {
  readonly table_name: string;
  readonly columns: string;
  readonly is_unique: boolean;
  readonly predicate: string | null;
}

async function checkIndexes(db: Queryable, violations: Violation[]): Promise<void> {
  const { rows } = await db.query<IndexRow>(
    `SELECT c.relname AS table_name,
            (SELECT string_agg(a.attname, ',' ORDER BY k.position)
               FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, position)
               JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum) AS columns,
            i.indisunique AS is_unique,
            pg_get_expr(i.indpred, i.indrelid) AS predicate
       FROM pg_index i
       JOIN pg_class c ON c.oid = i.indrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname IN ('users', 'reviews')`,
    [SCHEMA],
  );
  const unique = (table: string, column: string): IndexRow[] =>
    rows.filter((row) => row.table_name === table && row.columns === column && row.is_unique);

  for (const column of ['phone', 'email']) {
    const partial = unique('users', column).some((row) => row.predicate === '(deleted_at IS NULL)');
    if (!partial) {
      violations.push({
        rule: 'users-partial-index',
        table: 'users',
        column,
        detail: 'needs its unique index WHERE deleted_at IS NULL (data-model.md §4)',
      });
    }
  }

  const reviews = unique('reviews', 'enrollment_id');
  if (
    !reviews.some((row) => row.predicate === null) ||
    reviews.some((row) => row.predicate !== null)
  ) {
    violations.push({
      rule: 'reviews-enrollment-unique',
      table: 'reviews',
      column: 'enrollment_id',
      detail: 'one review per enrollment is a plain unique index, never partial (ADR 0006 D3)',
    });
  }
}

async function checkSoftDeletePrivilege(
  db: Queryable,
  applicationRole: string,
  violations: Violation[],
): Promise<void> {
  const { rows } = await db.query<{ table_name: string }>(
    `SELECT c.relname AS table_name
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'deleted_at' AND NOT a.attisdropped
      WHERE n.nspname = $1 AND c.relkind IN ('r', 'p')
        AND has_table_privilege($2, c.oid, 'DELETE')
      ORDER BY c.relname`,
    [SCHEMA, applicationRole],
  );
  for (const { table_name: table } of rows) {
    violations.push({
      rule: 'soft-delete-privilege',
      table,
      detail: `has deleted_at but grants DELETE to ${applicationRole}; revoke it in its migration`,
    });
  }
}

/** Every violation the catalogue holds, in a stable order. */
export async function checkSchema(db: Queryable, options: CheckOptions): Promise<Violation[]> {
  const violations: Violation[] = [];
  const { rows: columns } = await db.query<ColumnRow>(
    `SELECT c.relname AS table_name,
            a.attname AS column_name,
            t.typname AS type_name,
            format_type(a.atttypid, a.atttypmod) AS formatted
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_type t ON t.oid = a.atttypid
      WHERE n.nspname = $1 AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY c.relname, a.attnum`,
    [SCHEMA],
  );
  checkColumns(columns, violations);
  await checkEnums(db, violations);
  await checkIndexes(db, violations);
  await checkSoftDeletePrivilege(db, options.applicationRole, violations);
  return violations;
}

async function main(): Promise<number> {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '' || !URL.canParse(url)) {
    process.stderr.write('schema check: DATABASE_URL is not set to a connection string\n');
    return 2;
  }
  const applicationRole = decodeURIComponent(new URL(url).username);
  const db = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  let violations: Violation[];
  try {
    await db.connect();
    violations = await checkSchema(db, { applicationRole });
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : 'unknown failure';
    process.stderr.write(`schema check: could not read the catalogue: ${reason}\n`);
    return 2;
  } finally {
    await db.end().catch(() => undefined);
  }
  for (const { rule, table, column, detail } of violations) {
    const where = column === undefined ? table : `${table}.${column}`;
    process.stdout.write(`${rule}  ${where}  ${detail}\n`);
  }
  process.stdout.write(
    violations.length === 0
      ? 'schema check: no violation\n'
      : `schema check: ${violations.length} violation(s)\n`,
  );
  return violations.length === 0 ? 0 : 1;
}

// Run as a command (`pnpm db:schema:check`, tsx), never when a test imports `checkSchema`. tsx
// compiles this file as CommonJS, so neither top-level await nor `import.meta` is available.
if (basename(process.argv[1] ?? '') === 'schema-check.ts') {
  void main().then((code) => {
    process.exitCode = code;
  });
}
