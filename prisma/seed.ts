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

export const ADMINISTRATOR = {
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
 *
 * Phase 1 (T002, specs/002-identity/data-model.md §4, R-MONEY-12): the twenty-six rows an identity
 * or admin flow reads, from `admin_lockout_attempts` on, each at its default and named with its
 * unit. The limits a person changes are in SRS §3.14; the purge windows and the refresh grace are
 * operational and listed under it as such.
 *
 * Phase 2 (T002, specs/003-booking/data-model.md §4, FR-412): the five rows booking, checkout and
 * discovery read, from `first_session_lead_hours` on, listed in SRS §3.14.
 *
 * Phase 3 (T001, specs/004-sessions/data-model.md §4): the seventeen rows the sessions, chat, live
 * channel and administrator flows read, from `session_evaluation_delay_minutes` on, in that table's
 * order. `teacher_no_show_threshold` is no longer written (the threshold is removed, R-322, ADR 0023;
 * the migration `20261108120000_sessions_pass` deletes its row), and `chat_retention_days` defaults
 * to 30 (the owner's decision of 2026-11-05): a database already seeded keeps its row, since the
 * seed inserts only what is missing (R-PROC-11).
 *
 * T067 (specs/004-sessions/data-model.md §4; SRS §3.14, FR-SESS-21, DEC-64, DEC-65): the two rows of
 * the room's close at the scheduled end, its grace and its retries, inserted only where missing as
 * every row is.
 *
 * T069 (specs/004-sessions/data-model.md §4; SRS DEC-66, DEC-67): `ban_restore_window_days` and six
 * administrator rate limits, and `enrollment_restore_window_days` at 14. A database already seeded
 * keeps its row, as every row is kept; the migration `20261113120000_ban_restorable_and_kept_data`
 * moves that one to 14 only while it still holds 7 (Q6 (b)).
 *
 * Phase 4 (T001 of specs/005-certification, data-model.md «Settings»; SRS DEC-71, DEC-73): the six
 * rate limits of the reports, the gender flags, the ijazah requests and the administrators'
 * decisions, in a block at the list's end (tracks-coordination.md §1), inserted only where missing.
 */
const SETTINGS: readonly (readonly [string, unknown])[] = [
  ['attendance_threshold_pct', 70],
  ['join_window_minutes', 10],
  ['minimum_connection_seconds', 60],
  ['early_join_lead_minutes', 15],
  ['dispute_window_hours', 72],
  ['slot_hold_ttl_minutes', 10],
  ['slot_hold_grace_minutes', 5],
  ['checkout_confirmation_timeout_seconds', 15],
  ['idempotency_key_ttl_hours', 24],
  ['slot_release_buffer_weeks', 0],
  ['reminder_offsets_minutes', [1440, 15]],
  ['chat_retention_days', 30],
  ['rate_limit_authentication', { limit: 10, window_seconds: 900 }],
  ['rate_limit_one_time_code', { limit: 5, window_seconds: 600 }],
  ['rate_limit_search', { limit: 60, window_seconds: 60 }],
  ['rate_limit_payment_initiation', { limit: 10, window_seconds: 600 }],
  ['rate_limit_one_time_code_budget', { limit: 300, window_seconds: 3600 }],
  ['rate_limit_authentication_budget', { limit: 1000, window_seconds: 900 }],
  ['admin_lockout_attempts', 5],
  ['admin_lockout_minutes', 15],
  ['makeup_choice_window_days', 7],
  ['otp_code_ttl_minutes', 10],
  ['otp_max_attempts', 5],
  ['otp_purge_after_hours', 24],
  ['onboarding_token_ttl_minutes', 15],
  ['session_access_ttl_minutes', 15],
  ['session_refresh_ttl_days', 30],
  ['session_refresh_grace_seconds', 30],
  ['session_purge_after_days', 30],
  ['admin_session_idle_minutes', 60],
  ['admin_session_max_hours', 12],
  ['admin_invite_ttl_hours', 48],
  ['push_token_stale_days', 90],
  ['terms_version', '2026-10'],
  ['upload_max_bytes', 10_485_760],
  ['rate_limit_public_page', { limit: 60, window_seconds: 60 }],
  ['rate_limit_upload', { limit: 20, window_seconds: 600 }],
  ['admin_recovery_code_count', 10],
  ['admin_home_latest_actions', 7],
  ['admin_list_page_size', 25],
  ['provider_nonce_ttl_minutes', 10],
  ['document_link_ttl_seconds', 300],
  ['rate_limit_token_refresh', { limit: 30, window_seconds: 60 }],
  ['rate_limit_provider_nonce', { limit: 20, window_seconds: 60 }],
  ['document_unreferenced_purge_after_hours', 72],
  ['document_unreferenced_max_per_user', 30],
  // T133: the administrator's sign-in counts under a subject key and a budget of its own, and the
  // provider nonce under a budget of its own, each at the value the shared key holds.
  ['rate_limit_admin_authentication', { limit: 10, window_seconds: 900 }],
  ['rate_limit_admin_authentication_budget', { limit: 1000, window_seconds: 900 }],
  ['rate_limit_provider_nonce_budget', { limit: 1000, window_seconds: 900 }],
  // T002 (Phase 2, specs/003-booking/data-model.md §4): the first session's lead, the three numbers
  // the phone polls a checkout by (FR-383), and the discovery page's size.
  ['first_session_lead_hours', 24],
  ['checkout_processing_poll_seconds', 2],
  ['checkout_confirming_poll_seconds', 30],
  ['checkout_confirming_poll_window_minutes', 10],
  ['discovery_page_size', 20],
  // T001 (Phase 3, specs/004-sessions/data-model.md §4).
  ['session_evaluation_delay_minutes', 2],
  ['rate_limit_chat_message', { limit: 30, window_seconds: 60 }],
  ['makeup_counter_answer_hours', 72],
  ['chat_page_size', 50],
  ['cancellation_requests_recent_days', 30],
  ['video_empty_timeout_seconds', 300],
  ['video_departure_timeout_seconds', 20],
  ['repeated_absence_flag_count', 5],
  // T069 (SRS DEC-66): 14 days, was 7; the migration `20261113120000_ban_restorable_and_kept_data`
  // moves a row still holding 7.
  ['enrollment_restore_window_days', 14],
  ['rate_limit_absence_complaint', { limit: 5, window_seconds: 3600 }],
  ['rate_limit_signed_in_default', { limit: 150, window_seconds: 60 }],
  ['rate_limit_dispute_revision', { limit: 10, window_seconds: 60 }],
  ['rate_limit_enrollment_restore', { limit: 10, window_seconds: 60 }],
  ['rate_limit_manual_compensation_case', { limit: 10, window_seconds: 60 }],
  ['rate_limit_outcome_correction', { limit: 10, window_seconds: 60 }],
  ['rate_limit_live_channel', { limit: 10, window_seconds: 60 }],
  ['live_channel_max_connections_per_user', 3],
  // T067: minutes after the scheduled end before the room is closed, and the minutes after that
  // during which the close is asked again, a positive whole number of minutes.
  ['room_close_grace_minutes', 0],
  ['room_close_retry_minutes', 10],
  // T069 (SRS DEC-66, DEC-67, §3.14; specs/004-sessions/data-model.md §4): the days a ban's or a
  // revocation's closing holds its slot, and the six administrator limits, each the administrator
  // as subject: a ban's or a revocation's lift (T072), a held slot's release (T070), the kept data's
  // erasure date, its erasure now and a kept document's link (T077), and an account's deletion at
  // its owner's request (T081).
  ['ban_restore_window_days', 14],
  ['rate_limit_ban_lift', { limit: 10, window_seconds: 60 }],
  ['rate_limit_slot_release', { limit: 10, window_seconds: 60 }],
  ['rate_limit_kept_data_erase_date', { limit: 10, window_seconds: 60 }],
  ['rate_limit_kept_data_erase_now', { limit: 10, window_seconds: 60 }],
  ['rate_limit_kept_document_link', { limit: 10, window_seconds: 60 }],
  ['rate_limit_admin_user_delete', { limit: 10, window_seconds: 60 }],
  // T082 (SRS DEC-68, §3.14; specs/004-sessions/data-model.md §4): an administrator's direct end of
  // an enrollment (`sessions.endEnrollment`), the administrator as subject.
  ['rate_limit_enrollment_end', { limit: 10, window_seconds: 60 }],
  // T001 of specs/005-certification (data-model.md «Settings»; SRS §3.14, DEC-71, DEC-73): a user's
  // reports and gender flags, the user as subject (DEC-71); a teacher's ijazah requests, the teacher
  // as subject; and the administrators' ijazah decisions (approve, reject, sign off, re-render,
  // revoke, bar), gender decisions and settings changes, each the administrator as subject (DEC-73).
  ['rate_limit_user_report', { limit: 5, window_seconds: 86400 }],
  ['rate_limit_gender_flag', { limit: 3, window_seconds: 86400 }],
  ['rate_limit_ijazah_request', { limit: 10, window_seconds: 3600 }],
  ['rate_limit_ijazah_decision', { limit: 10, window_seconds: 60 }],
  ['rate_limit_gender_decision', { limit: 10, window_seconds: 60 }],
  ['rate_limit_settings_update', { limit: 10, window_seconds: 60 }],
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
