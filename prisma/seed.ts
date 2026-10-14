// T074: deterministic seed. Identical on every machine and safe to run twice (FR-038).
// Fixed identifiers; no dependence on the machine clock or timezone. Content is confined to what has no
// user-facing behaviour: subjects in both languages, settings keys with defaults, one administrator.
// No teachers, students, enrollments or money. Those belong to the phases that give them meaning.
//
// FIXED IDENTIFIERS AND INSTANTS (data-model.md §10). Identifiers are UUID v7 literals whose
// timestamp is SEEDED_AT, so they sort like any other v7 and encode no machine's clock; every
// `created_at` and `updated_at` is SEEDED_AT, written explicitly, never left to the server's
// `now()`. Instants are passed as UTC text, so neither the process zone nor the session zone is read.
//
// SAFE TO RUN TWICE. One transaction; every row is inserted only where its key is absent
// (`ON CONFLICT DO NOTHING`). A second run changes nothing, and a seed never rewrites a setting an
// administrator has changed: settings change in the admin panel, never from code (R-PROC-11).
//
// THE ADMINISTRATOR'S CREDENTIAL. No secret is committed (R-SEC-1) and no configuration key is
// added, so the seed knows no password. On the run that inserts the administrator it stores the
// Argon2id hash of 32 random bytes it discards at once (T069) and a random 20-byte MFA secret
// encrypted under ENCRYPTION_KEY (T068), the one secret every machine already generates
// (quickstart §1). Nobody can sign in as this administrator; the phase that builds administrator
// sign-in gives it a real credential. These two columns are the only values that differ between
// machines, and the seed checksum leaves exactly them out (T075). The administrator exists because
// every setting names the administrator who last changed it (`settings.updated_by_admin_id`).
//
// Run as the APPLICATION role (`DATABASE_URL`), which may insert these rows; the owner only migrates
// (research R-5). `pnpm db:seed`, or `prisma migrate reset`, which runs it after the migrations.
import { randomBytes } from 'node:crypto';
import { basename } from 'node:path';
import { config as readDotenv } from 'dotenv';
import pg from 'pg';
import { ColumnCipher } from '../apps/api/src/platform/crypto/encryption.js';
import { hashPassword } from '../apps/api/src/platform/crypto/hashing.js';

// Only the two values the seed needs are taken from `.env`, into a scratch object, and only when the
// environment does not carry them: a spec imports this file, and loading the whole file would bring
// back a provider key the test setup removed (T114).
const fromDotenv: Record<string, string> = {};
readDotenv({ processEnv: fromDotenv, quiet: true });
for (const key of ['DATABASE_URL', 'ENCRYPTION_KEY'] as const) {
  const value = fromDotenv[key];
  if (process.env[key] === undefined && value !== undefined) process.env[key] = value;
}

export interface Queryable {
  query<Row extends pg.QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<pg.QueryResult<Row>>;
}

export interface SeedOptions {
  /** ENCRYPTION_KEY: base64 of 32 bytes. Encrypts the administrator's MFA secret. */
  readonly encryptionKey: string;
}

/** The one instant every seeded row carries, and the timestamp inside every seeded identifier. */
const SEEDED_AT = '2026-10-10T00:00:00Z';

const ADMINISTRATOR = {
  id: '01a1231c-0000-7000-8000-000000000001',
  email: 'admin@ijazah.invalid',
  displayName: 'Administrator',
} as const;

/** The subjects SRS §1.1 names, in Arabic and English (FR-LOC-1). */
const SUBJECTS = [
  { id: '01a1231c-0000-7000-8000-000000000101', nameAr: 'القرآن الكريم', nameEn: "Qur'an" },
  { id: '01a1231c-0000-7000-8000-000000000102', nameAr: 'التجويد', nameEn: 'Tajweed' },
  { id: '01a1231c-0000-7000-8000-000000000103', nameAr: 'الفقه', nameEn: 'Fiqh' },
  { id: '01a1231c-0000-7000-8000-000000000104', nameAr: 'العقيدة', nameEn: 'Aqeedah' },
  { id: '01a1231c-0000-7000-8000-000000000105', nameAr: 'الحديث', nameEn: 'Hadith' },
] as const;

/**
 * SRS §3.14, every numeric setting at its default, each key naming its unit; the four rate limits
 * of NFR-SEC-10 (owner's decision 2026-10-10, shared with T103); and the two platform-wide budgets
 * beside the one-time-code and authentication limits (T170), counted under one subject for every
 * caller, each owner-adjustable in the admin panel. The table of record is the note under T074 in
 * specs/001-foundations/tasks.md.
 */
const SETTINGS: readonly (readonly [string, unknown])[] = [
  ['attendance_threshold_pct', 70],
  ['join_window_minutes', 10],
  ['minimum_connection_seconds', 60],
  ['early_join_lead_minutes', 15],
  ['teacher_no_show_threshold', 2],
  ['dispute_window_hours', 72],
  ['slot_hold_ttl_minutes', 10],
  ['slot_hold_grace_minutes', 5],
  ['checkout_confirmation_timeout_seconds', 15],
  ['idempotency_key_ttl_hours', 24],
  ['slot_release_buffer_weeks', 0],
  ['reminder_offsets_minutes', [1440, 15]],
  ['chat_retention_days', 0],
  ['rate_limit_authentication', { limit: 10, window_seconds: 900 }],
  ['rate_limit_one_time_code', { limit: 5, window_seconds: 600 }],
  ['rate_limit_search', { limit: 60, window_seconds: 60 }],
  ['rate_limit_payment_initiation', { limit: 10, window_seconds: 600 }],
  ['rate_limit_one_time_code_budget', { limit: 300, window_seconds: 3600 }],
  ['rate_limit_authentication_budget', { limit: 1000, window_seconds: 900 }],
];

const MFA_SECRET_COLUMN = 'admin_users.mfa_secret_encrypted';

async function plantAdministrator(db: Queryable, encryptionKey: string): Promise<void> {
  const { rows } = await db.query('SELECT 1 FROM admin_users WHERE id = $1', [ADMINISTRATOR.id]);
  if (rows.length > 0) return;
  const passwordHash = await hashPassword(randomBytes(32).toString('base64url'));
  // Bound to the column and to the administrator's row (T172).
  const mfaSecret = new ColumnCipher(encryptionKey).encrypt(
    randomBytes(20).toString('base64url'),
    MFA_SECRET_COLUMN,
    ADMINISTRATOR.id,
  );
  await db.query(
    `INSERT INTO admin_users
       (id, email, password_hash, mfa_secret_encrypted, display_name, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, true, $6::timestamptz, $6::timestamptz)
     ON CONFLICT (id) DO NOTHING`,
    [
      ADMINISTRATOR.id,
      ADMINISTRATOR.email,
      passwordHash,
      mfaSecret,
      ADMINISTRATOR.displayName,
      SEEDED_AT,
    ],
  );
}

/** Plants the seed dataset into a migrated database, in one transaction. */
export async function seed(db: Queryable, options: SeedOptions): Promise<void> {
  await db.query('BEGIN');
  try {
    await plantAdministrator(db, options.encryptionKey);
    for (const subject of SUBJECTS) {
      await db.query(
        `INSERT INTO subjects (id, name_ar, name_en, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, true, $4::timestamptz, $4::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        [subject.id, subject.nameAr, subject.nameEn, SEEDED_AT],
      );
    }
    for (const [key, value] of SETTINGS) {
      await db.query(
        `INSERT INTO settings (key, value, updated_by_admin_id, created_at, updated_at)
         VALUES ($1, $2::jsonb, $3, $4::timestamptz, $4::timestamptz)
         ON CONFLICT (key) DO NOTHING`,
        [key, JSON.stringify(value), ADMINISTRATOR.id, SEEDED_AT],
      );
    }
    await db.query('COMMIT');
  } catch (error: unknown) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

function encryptionKeyFromEnvironment(): string | undefined {
  const key = process.env['ENCRYPTION_KEY'];
  if (key === undefined || !/^[A-Za-z0-9+/]+={0,2}$/.test(key)) return undefined;
  return Buffer.from(key, 'base64').byteLength === 32 ? key : undefined;
}

async function main(): Promise<number> {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '' || !URL.canParse(url)) {
    process.stderr.write('seed: DATABASE_URL is not set to a connection string\n');
    return 1;
  }
  const encryptionKey = encryptionKeyFromEnvironment();
  if (encryptionKey === undefined) {
    process.stderr.write(
      'seed: ENCRYPTION_KEY must be base64 of 32 bytes (openssl rand -base64 32; quickstart §1)\n',
    );
    return 1;
  }
  const db = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  try {
    await db.connect();
    await seed(db, { encryptionKey });
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : 'unknown failure';
    process.stderr.write(`seed: ${reason}\n`);
    return 1;
  } finally {
    await db.end().catch(() => undefined);
  }
  process.stdout.write(
    `seed: ${SUBJECTS.length} subjects, ${SETTINGS.length} settings and 1 administrator, each inserted where absent\n`,
  );
  return 0;
}

// Run as a command (tsx), never when a spec imports `seed`. tsx compiles this file as CommonJS, so
// neither top-level await nor `import.meta` is available.
if (basename(process.argv[1] ?? '') === 'seed.ts') {
  void main().then((code) => {
    process.exitCode = code;
  });
}
