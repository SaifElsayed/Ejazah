// The integrity-probe harness (T049, US2). Connects as the APPLICATION role, never the owner: a
// probe run as the owner tests a role nobody uses, and the owner may do everything the probes
// prove impossible (research R-5, FR-025).
//
// HOW IT KNOWS THE ROLE. The connection string is `DATABASE_URL` from the environment or the
// repository's `.env` (quickstart §1), the same value the API uses. After connecting, the harness
// refuses to go on unless the session role is not a superuser, owns no relation in the `public`
// schema, and is neither the role `DATABASE_URL_OWNER` names nor a member of it (a member inherits
// the owner's rights). A misconfigured `.env` that points the probes at the owner therefore fails
// every probe instead of passing them all for the wrong reason. Without `DATABASE_URL_OWNER` the
// last two checks cannot run, so the harness says so once on stderr.
//
// HOW A PROBE LEAVES NO TRACE. Every probe runs inside one transaction that is always rolled back
// (`inRollback`), and a statement expected to fail runs under a savepoint (`attempt`), so the
// transaction stays usable after the refusal and the probe can go on to the next statement. A
// refusal is identified by its SQLSTATE, never by message text: 42501 insufficient privilege,
// 23514 check violation, 23505 unique violation, 23502 not-null violation, 23P01 exclusion
// violation, 42703 undefined column.
//
// HOW ROWS ARE BUILT. `insertRow` writes one row by column name and returns its id. Columns are the
// ERD's (docs/ERD.md), snake_case as in the database. A Prisma `@updatedAt` column has no database
// default, so when the table has an `updated_at` without a default and the probe gave none, the
// harness sets it to `now()`; a required amount column (`*_piasters`) the probe left out is set to
// 0, so a probe of a gateway order never names its amount. Any other omitted column is the
// database's to refuse. The builders below create the smallest valid parent rows a probe
// needs; tables a later schema task models (T057–T061) are written from the ERD and meet the real
// columns once those tasks land — until then, and until the migrations of T064–T066 exist, every
// probe is red by design (batch plan: red from S3a until S4).
import { config as readDotenv } from 'dotenv';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

// `.env` is read into a scratch object, and only the two database URLs are taken from it, each only
// when the environment does not already carry it. Loading the whole file into `process.env` would
// bring back a provider key the test setup removed (tests/support/no-provider-keys.setup.ts; T114,
// PR #49 review m1, SC-005).
const fromDotenv: Record<string, string> = {};
readDotenv({ processEnv: fromDotenv, quiet: true });
for (const key of ['DATABASE_URL', 'DATABASE_URL_OWNER'] as const) {
  const value = fromDotenv[key];
  if (process.env[key] === undefined && value !== undefined) process.env[key] = value;
}

export type Db = pg.Client;

export const SQLSTATE = {
  insufficientPrivilege: '42501',
  checkViolation: '23514',
  uniqueViolation: '23505',
  notNullViolation: '23502',
  exclusionViolation: '23P01',
  undefinedColumn: '42703',
} as const;

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `${name} is not set: the probes need it in the environment or in .env (quickstart §1)`,
    );
  }
  return value;
}

function roleOf(url: string): string {
  return decodeURIComponent(new URL(url).username);
}

let warnedOwnerUnset = false;

/** A client connected as the application role, after proving it is not the owner. */
export async function connectAsApplication(): Promise<Db> {
  // A database that is not there fails the suite in seconds rather than at the test timeout.
  const db = new pg.Client({
    connectionString: required('DATABASE_URL'),
    connectionTimeoutMillis: 5_000,
  });
  await db.connect();
  try {
    const { rows } = await db.query<{ role: string; superuser: boolean; owned: string }>(
      `SELECT current_user AS role,
              (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser,
              (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND pg_get_userbyid(c.relowner) = current_user)::text AS owned`,
    );
    const [session] = rows;
    if (session === undefined) throw new Error('could not read the session role');
    if (session.superuser)
      throw new Error(`the probes are connected as a superuser (${session.role})`);
    if (session.owned !== '0') {
      throw new Error(
        `the probes are connected as ${session.role}, which owns ${session.owned} relations`,
      );
    }
    const owner = process.env['DATABASE_URL_OWNER'];
    if (owner === undefined || owner === '') {
      if (!warnedOwnerUnset) {
        warnedOwnerUnset = true;
        process.stderr.write(
          'DATABASE_URL_OWNER is not set: the probes cannot prove they are not the owner role\n',
        );
      }
      return db;
    }
    const ownerRole = roleOf(owner);
    if (ownerRole === session.role) {
      throw new Error(`the probes are connected as the owner role ${session.role}`);
    }
    const membership = await db.query<{ member: boolean }>(
      // CASE, not AND: pg_has_role raises on an unknown role, and AND does not promise its order.
      `SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1)
                   THEN pg_has_role(current_user, $1, 'MEMBER') ELSE false END AS member`,
      [ownerRole],
    );
    if (membership.rows[0]?.member === true) {
      throw new Error(`the probes are connected as ${session.role}, a member of the owner role`);
    }
    return db;
  } catch (error: unknown) {
    await db.end();
    throw error;
  }
}

/**
 * Runs `probe` inside a transaction that is always rolled back. When the probe failed and the
 * ROLLBACK fails too, the probe's error is the one reported: it is the cause.
 */
export async function inRollback<T>(db: Db, probe: (db: Db) => Promise<T>): Promise<T> {
  await db.query('BEGIN');
  let result: T;
  try {
    result = await probe(db);
  } catch (error: unknown) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
  await db.query('ROLLBACK');
  return result;
}

/**
 * Runs one statement under a savepoint. Returns `null` when it succeeded, or the SQLSTATE it was
 * refused with; the transaction stays usable either way.
 */
export async function attempt(
  db: Db,
  sql: string,
  params: readonly unknown[] = [],
): Promise<string | null> {
  await db.query('SAVEPOINT probe');
  try {
    await db.query(sql, [...params]);
    await db.query('RELEASE SAVEPOINT probe');
    return null;
  } catch (error: unknown) {
    await db.query('ROLLBACK TO SAVEPOINT probe');
    const code = (error as { code?: unknown }).code;
    if (typeof code !== 'string') throw error;
    return code;
  }
}

/** Per table, the columns the harness fills when a probe leaves them out. */
interface Fillable {
  /** An `updated_at` with no database default (Prisma's `@updatedAt`). */
  readonly updatedAt: boolean;
  /** NOT NULL amount columns (`*_piasters`) with no default. */
  readonly amounts: readonly string[];
}

const fillableByTable = new Map<string, Fillable>();

async function fillableOf(db: Db, table: string): Promise<Fillable> {
  const known = fillableByTable.get(table);
  if (known !== undefined) return known;
  const { rows } = await db.query<{ column_name: string; is_nullable: string }>(
    `SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_default IS NULL`,
    [table],
  );
  const fillable: Fillable = {
    updatedAt: rows.some((row) => row.column_name === 'updated_at'),
    // Only the amount suffix: an omitted `sequence_number`, `rating` or `position` must fail
    // loudly, not pass as 0 (review of PR #40, m2).
    amounts: rows
      .filter((row) => row.is_nullable === 'NO' && row.column_name.endsWith('_piasters'))
      .map((row) => row.column_name),
  };
  fillableByTable.set(table, fillable);
  return fillable;
}

/**
 * The INSERT statement and parameters for one row. `updated_at` is set to `now()` when the table
 * needs it, and a required amount column the probe left out is set to 0: a probe of a gateway
 * order never names its amount, which R-MONEY-6 confines to the payments module and the payment
 * port. Identifiers are quoted by `pg.escapeIdentifier`, never by hand.
 */
export async function insertStatement(
  db: Db,
  table: string,
  values: Readonly<Record<string, unknown>>,
): Promise<{ sql: string; params: unknown[] }> {
  const row: Record<string, unknown> = { ...values };
  const columns = Object.keys(row);
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  const fillable = await fillableOf(db, table);
  if (!('updated_at' in row) && fillable.updatedAt) {
    columns.push('updated_at');
    placeholders.push('now()');
  }
  for (const column of fillable.amounts) {
    if (column in row) continue;
    columns.push(column);
    placeholders.push('0');
  }
  const quoted = columns.map((column) => pg.escapeIdentifier(column)).join(', ');
  return {
    sql: `INSERT INTO ${pg.escapeIdentifier(table)} (${quoted}) VALUES (${placeholders.join(', ')}) RETURNING id`,
    params: Object.values(row),
  };
}

/** Inserts one row and returns its id. */
export async function insertRow(
  db: Db,
  table: string,
  values: Readonly<Record<string, unknown>>,
): Promise<string> {
  const { sql, params } = await insertStatement(db, table, values);
  const { rows } = await db.query<{ id: string }>(sql, params);
  const [row] = rows;
  if (row === undefined) throw new Error(`insert into ${table} returned no row`);
  return row.id;
}

/** A unique stand-in phone number, E.164 shaped. Never a real person's. */
function phone(): string {
  return `+2010${String(Number.parseInt(randomUUID().slice(0, 8), 16) % 100_000_000).padStart(8, '0')}`;
}

export function makeUser(db: Db, values: Readonly<Record<string, unknown>> = {}): Promise<string> {
  return insertRow(db, 'users', {
    phone: phone(),
    gender: 'male',
    date_of_birth: '1990-01-01',
    display_name: 'Probe user',
    preferred_language: 'ar',
    timezone: 'Africa/Cairo',
    account_status: 'active',
    ...values,
  });
}

export function makeAdmin(db: Db): Promise<string> {
  return insertRow(db, 'admin_users', {
    email: `probe-${randomUUID()}@example.invalid`,
    password_hash: 'probe-hash',
    mfa_secret_encrypted: Buffer.from('probe'),
    display_name: 'Probe administrator',
    is_active: true,
  });
}

export function makeSubject(db: Db): Promise<string> {
  return insertRow(db, 'subjects', { name_ar: 'مادة', name_en: 'Subject', is_active: true });
}

/** A teacher with a subject, a package and a weekly slot: what an enrollment snapshots. */
export async function makeOffer(db: Db): Promise<{
  teacherId: string;
  subjectId: string;
  packageId: string;
  slotId: string;
}> {
  const teacherId = await makeUser(db);
  const subjectId = await makeSubject(db);
  const packageId = await insertRow(db, 'packages', {
    teacher_user_id: teacherId,
    subject_id: subjectId,
    session_count: 4,
    session_duration_minutes: 60,
    price_piasters: 100_000,
    is_active: true,
  });
  const slotId = await insertRow(db, 'availability_slots', {
    teacher_user_id: teacherId,
    day_of_week: 0,
    start_time_local: '09:00:00',
    duration_minutes: 60,
    timezone: 'Africa/Cairo',
    is_active: true,
  });
  return { teacherId, subjectId, packageId, slotId };
}

/** The columns of one enrollment between `studentId` and the offer's teacher (ERD §5). */
export function enrollmentValues(
  offer: Awaited<ReturnType<typeof makeOffer>>,
  studentId: string,
): Record<string, unknown> {
  return {
    student_user_id: studentId,
    teacher_user_id: offer.teacherId,
    package_id: offer.packageId,
    slot_id: offer.slotId,
    snapshot_price_piasters: 100_000,
    snapshot_session_count: 4,
    snapshot_duration_minutes: 60,
    snapshot_subject_id: offer.subjectId,
    snapshot_slot_timezone: 'Africa/Cairo',
    status: 'pending_payment',
    purchased_at: '2026-10-04T07:00:00Z',
  };
}

/** A student, a teacher's offer and one enrollment between them. */
export async function makeEnrollment(db: Db): Promise<{
  enrollmentId: string;
  studentId: string;
  teacherId: string;
}> {
  const offer = await makeOffer(db);
  const studentId = await makeUser(db, { gender: 'male' });
  const enrollmentId = await insertRow(db, 'enrollments', enrollmentValues(offer, studentId));
  return { enrollmentId, studentId, teacherId: offer.teacherId };
}

/** One scheduled session of a fresh enrollment (ERD §5). */
export async function makeSession(db: Db): Promise<{
  sessionId: string;
  enrollmentId: string;
  studentId: string;
  teacherId: string;
}> {
  const enrollment = await makeEnrollment(db);
  const sessionId = await insertRow(db, 'sessions', {
    enrollment_id: enrollment.enrollmentId,
    teacher_user_id: enrollment.teacherId,
    student_user_id: enrollment.studentId,
    sequence_number: 1,
    scheduled_date_local: '2026-10-04',
    scheduled_start_time_local: '09:00:00',
    timezone: 'Africa/Cairo',
    scheduled_start_at: '2026-10-04T06:00:00Z',
    scheduled_end_at: '2026-10-04T07:00:00Z',
    status: 'scheduled',
  });
  return { sessionId, ...enrollment };
}
