// T074 — what the seed plants, and nothing else (FR-038, data-model.md §10, note under T074).
//
// An empty database of this file's own is migrated and seeded as the application role. The seed
// plants five subjects in both languages, the settings of SRS §3.14 with their defaults plus the
// four rate-limit rows (owner's decision 2026-10-10, shared with T103) and the two budget rows
// (T170), the twenty-six Phase 1 rows of specs/002-identity/data-model.md §4 (T002), the three rows
// that give the administrator's sign-in and the provider nonce limits of their own (T133), the five
// Phase 2 rows of specs/003-booking/data-model.md §4 (T002), the seventeen Phase 3 rows of
// specs/004-sessions/data-model.md §4 (T001; `teacher_no_show_threshold` no longer planted), the
// two rows of the room's close in the same table (T067), the seven rows of a ban's lift, a held
// slot's release, the kept data and an administrator's deletion (T069, with the restore window's
// default 14, SRS DEC-66), the one of an administrator's direct end (T082), Phase 4's six rate limits
// (005:T001, data-model.md «Settings»), the two of a notification queued again (005:T017, SRS DEC-74),
// the programme's (006:T002, research R-515)
// and one administrator, each with a fixed identifier and a fixed instant;
// every other table stays empty.
//
// THE ADMINISTRATOR'S CREDENTIAL. No secret is committed (R-SEC-1), so the seed knows no password:
// it stores the Argon2id hash of a random one it discards at once (T069) and a random MFA secret
// encrypted under the run's ENCRYPTION_KEY (T068). Nobody can sign in with it; the phase that builds
// administrator sign-in sets a real credential. A second run leaves the credential alone, as it
// leaves every row it finds, so a seed never rewrites a setting an administrator has changed
// (R-PROC-11).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ColumnCipher } from '../../apps/api/src/platform/crypto/encryption.js';
import { verifyPassword } from '../../apps/api/src/platform/crypto/hashing.js';
import { rateLimitSetting } from '../../apps/api/src/platform/guards/rate-limit.guard.js';
import { seed } from '../../prisma/seed';
import {
  MIGRATE_TIMEOUT_MILLISECONDS,
  connect,
  createEmptyDatabase,
  migrate,
  type FreshDatabase,
} from './fresh-database';

const ADMINISTRATOR_ID = '01a1231c-0000-7000-8000-000000000001';

const SUBJECTS = [
  ['01a1231c-0000-7000-8000-000000000101', 'القرآن الكريم', "Qur'an"],
  ['01a1231c-0000-7000-8000-000000000102', 'التجويد', 'Tajweed'],
  ['01a1231c-0000-7000-8000-000000000103', 'الفقه', 'Fiqh'],
  ['01a1231c-0000-7000-8000-000000000104', 'العقيدة', 'Aqeedah'],
  ['01a1231c-0000-7000-8000-000000000105', 'الحديث', 'Hadith'],
] as const;

const SETTINGS: Record<string, unknown> = {
  attendance_threshold_pct: 70,
  join_window_minutes: 10,
  minimum_connection_seconds: 60,
  early_join_lead_minutes: 15,
  dispute_window_hours: 72,
  slot_hold_ttl_minutes: 10,
  slot_hold_grace_minutes: 5,
  checkout_confirmation_timeout_seconds: 15,
  idempotency_key_ttl_hours: 24,
  slot_release_buffer_weeks: 0,
  reminder_offsets_minutes: [1440, 15],
  // Phase 3 (T001): 30 on a new database (the owner's decision of 2026-11-05; was 0).
  chat_retention_days: 30,
  rate_limit_authentication: { limit: 10, window_seconds: 900 },
  rate_limit_one_time_code: { limit: 5, window_seconds: 600 },
  rate_limit_search: { limit: 60, window_seconds: 60 },
  rate_limit_payment_initiation: { limit: 10, window_seconds: 600 },
  rate_limit_one_time_code_budget: { limit: 300, window_seconds: 3600 },
  rate_limit_authentication_budget: { limit: 1000, window_seconds: 900 },
  // Phase 1 (T002): data-model.md §4 of specs/002-identity, in its order.
  admin_lockout_attempts: 5,
  admin_lockout_minutes: 15,
  makeup_choice_window_days: 7,
  otp_code_ttl_minutes: 10,
  otp_max_attempts: 5,
  otp_purge_after_hours: 24,
  onboarding_token_ttl_minutes: 15,
  session_access_ttl_minutes: 15,
  session_refresh_ttl_days: 30,
  session_refresh_grace_seconds: 30,
  session_purge_after_days: 30,
  admin_session_idle_minutes: 60,
  admin_session_max_hours: 12,
  admin_invite_ttl_hours: 48,
  push_token_stale_days: 90,
  terms_version: '2026-10',
  upload_max_bytes: 10_485_760,
  rate_limit_public_page: { limit: 60, window_seconds: 60 },
  rate_limit_upload: { limit: 20, window_seconds: 600 },
  admin_recovery_code_count: 10,
  admin_home_latest_actions: 7,
  admin_list_page_size: 25,
  provider_nonce_ttl_minutes: 10,
  document_link_ttl_seconds: 300,
  rate_limit_token_refresh: { limit: 30, window_seconds: 60 },
  rate_limit_provider_nonce: { limit: 20, window_seconds: 60 },
  // T093: how long an upload waits for its submission, and how many unsubmitted ones a person holds.
  document_unreferenced_purge_after_hours: 72,
  document_unreferenced_max_per_user: 30,
  // T133: the administrator's sign-in and the provider nonce stop sharing the app's sign-in limits,
  // each at the value the shared key holds.
  rate_limit_admin_authentication: { limit: 10, window_seconds: 900 },
  rate_limit_admin_authentication_budget: { limit: 1000, window_seconds: 900 },
  rate_limit_provider_nonce_budget: { limit: 1000, window_seconds: 900 },
  // Phase 2 (T002): data-model.md §4 of specs/003-booking, in its order.
  first_session_lead_hours: 24,
  checkout_processing_poll_seconds: 2,
  checkout_confirming_poll_seconds: 30,
  checkout_confirming_poll_window_minutes: 10,
  discovery_page_size: 20,
  // T104 (ADR 0025 D1, SRS DEC-80, §3.14): the teacher's share of each gateway order, whole percent.
  teacher_share_percent: 70,
  // 003:T113 (rule d).
  price_average_min_teachers: 3,
  // 003:T105 (ADR 0025 D2, SRS DEC-81, §3.14): the ijazah track's half, percent of the teacher's share.
  ijazah_half_release_percent: 25,
  // 003:T105: the payout mark's limit, per administrator.
  rate_limit_payout_mark: { limit: 10, window_seconds: 60 },
  // 003:T112 (SRS §3.14, DEC-86, DEC-90): the postponement's notice and interval.
  postponement_notice_hours: 12,
  postponement_interval_weeks: 4,
  // 006:T002 (research R-515; SRS §3.14, DEC-92, DEC-93, DEC-94): the programme's eight, the switch
  // off and the fee unset.
  programme_enabled: 0,
  assessment_price_piasters: 0,
  assessment_duration_minutes: 30,
  programme_offer_hours: 24,
  programme_pay_rest_hours: 48,
  programme_stop_request_days: 7,
  programme_renew_early_days: 3,
  programme_charge_retry_days: [1, 3, 5, 7],
  // Phase 3 (T001): data-model.md §4 of specs/004-sessions, in its order; `teacher_no_show_threshold`
  // is no longer planted. The default's, the four administrator limits' and the live channel's two
  // are the rows T062's and T063's specs read.
  session_evaluation_delay_minutes: 2,
  rate_limit_chat_message: { limit: 30, window_seconds: 60 },
  makeup_counter_answer_hours: 72,
  chat_page_size: 50,
  cancellation_requests_recent_days: 30,
  video_empty_timeout_seconds: 300,
  video_departure_timeout_seconds: 20,
  repeated_absence_flag_count: 5,
  // T069 (SRS DEC-66): 14 on a new database (was 7); an existing one moves by the migration's step.
  enrollment_restore_window_days: 14,
  rate_limit_absence_complaint: { limit: 5, window_seconds: 3600 },
  rate_limit_signed_in_default: { limit: 150, window_seconds: 60 },
  rate_limit_dispute_revision: { limit: 10, window_seconds: 60 },
  rate_limit_enrollment_restore: { limit: 10, window_seconds: 60 },
  rate_limit_manual_compensation_case: { limit: 10, window_seconds: 60 },
  rate_limit_outcome_correction: { limit: 10, window_seconds: 60 },
  rate_limit_live_channel: { limit: 10, window_seconds: 60 },
  live_channel_max_connections_per_user: 3,
  // T067: the room's close at the scheduled end, its grace and its retries (SRS §3.14, FR-SESS-21,
  // DEC-64, DEC-65).
  room_close_grace_minutes: 0,
  room_close_retry_minutes: 10,
  // T069 (SRS DEC-66, DEC-67, §3.14): the ban restore window and the six administrator limits.
  ban_restore_window_days: 14,
  rate_limit_ban_lift: { limit: 10, window_seconds: 60 },
  rate_limit_slot_release: { limit: 10, window_seconds: 60 },
  rate_limit_kept_data_erase_date: { limit: 10, window_seconds: 60 },
  rate_limit_kept_data_erase_now: { limit: 10, window_seconds: 60 },
  rate_limit_kept_document_link: { limit: 10, window_seconds: 60 },
  rate_limit_admin_user_delete: { limit: 10, window_seconds: 60 },
  // 004:T082 (SRS DEC-68, §3.14): an administrator's direct end of an enrollment.
  rate_limit_enrollment_end: { limit: 10, window_seconds: 60 },
  // 005:T001 (data-model.md «Settings»; SRS §3.14, DEC-71, DEC-73): Phase 4's six rate limits.
  rate_limit_user_report: { limit: 5, window_seconds: 86400 },
  rate_limit_gender_flag: { limit: 3, window_seconds: 86400 },
  rate_limit_ijazah_request: { limit: 10, window_seconds: 3600 },
  rate_limit_ijazah_decision: { limit: 10, window_seconds: 60 },
  rate_limit_gender_decision: { limit: 10, window_seconds: 60 },
  rate_limit_settings_update: { limit: 10, window_seconds: 60 },
  // 005:T017 (SRS DEC-74, §3.14): a notification whose push was not queued after its commit.
  notification_requeue_after_minutes: 5,
  notification_requeue_max_age_minutes: 30,
};

/** T069: the six limits' keys, and the two windows (the restore window's default moved to 14). */
const T069_RATE_LIMITS = [
  'rate_limit_admin_user_delete',
  'rate_limit_ban_lift',
  'rate_limit_kept_data_erase_date',
  'rate_limit_kept_data_erase_now',
  'rate_limit_kept_document_link',
  'rate_limit_slot_release',
] as const;
const T069_WINDOWS = ['ban_restore_window_days', 'enrollment_restore_window_days'] as const;

/** 005:T001: Phase 4's six limits and the values data-model.md «Settings» gives them. */
const PHASE_4_RATE_LIMITS = {
  rate_limit_user_report: { limit: 5, window_seconds: 86400 },
  rate_limit_gender_flag: { limit: 3, window_seconds: 86400 },
  rate_limit_ijazah_request: { limit: 10, window_seconds: 3600 },
  rate_limit_ijazah_decision: { limit: 10, window_seconds: 60 },
  rate_limit_gender_decision: { limit: 10, window_seconds: 60 },
  rate_limit_settings_update: { limit: 10, window_seconds: 60 },
} as const;

const SEEDED_TABLES = new Set(['subjects', 'settings', 'admin_users']);

interface AdministratorRow {
  id: string;
  email: string;
  password_hash: string;
  mfa_secret_encrypted: Buffer;
  display_name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

describe('the seed (T074)', () => {
  let database: FreshDatabase;
  let db: pg.Client;
  const encryptionKey = randomBytes(32).toString('base64');

  beforeAll(async () => {
    database = await createEmptyDatabase();
    const result = await migrate(database);
    if (result.exitCode !== 0) throw new Error(`the migrations did not apply:\n${result.output}`);
    db = await connect(database.applicationUrl, 'UTC');
    await seed(db, { encryptionKey });
  }, MIGRATE_TIMEOUT_MILLISECONDS);

  afterAll(async () => {
    await db?.end();
    await database?.drop();
  });

  async function administrator(): Promise<AdministratorRow> {
    const { rows } = await db.query<AdministratorRow>(
      `SELECT id, email, password_hash, mfa_secret_encrypted, display_name, is_active,
              to_json(created_at)#>>'{}' AS created_at, to_json(updated_at)#>>'{}' AS updated_at
         FROM admin_users`,
    );
    expect(rows).toHaveLength(1);
    return rows[0] as AdministratorRow;
  }

  it('plants the five subjects in both languages, under fixed identifiers', async () => {
    const { rows } = await db.query<{ id: string; name_ar: string; name_en: string }>(
      `SELECT id, name_ar, name_en FROM subjects WHERE is_active ORDER BY id`,
    );
    expect(rows.map(({ id, name_ar, name_en }) => [id, name_ar, name_en])).toEqual(SUBJECTS);
    const { rows: all } = await db.query('SELECT 1 FROM subjects');
    expect(all).toHaveLength(SUBJECTS.length);
  });

  it('plants every setting with its default, as changed by the one administrator', async () => {
    const { rows } = await db.query<{ key: string; value: unknown; updated_by_admin_id: string }>(
      'SELECT key, value, updated_by_admin_id FROM settings',
    );
    expect(Object.fromEntries(rows.map(({ key, value }) => [key, value]))).toEqual(SETTINGS);
    expect(new Set(rows.map((row) => row.updated_by_admin_id))).toEqual(
      new Set([ADMINISTRATOR_ID]),
    );
  });

  // T062 (FR-470; research R-321, item 7): the rows the signed-in limits read. A missing one fails
  // closed: the default refuses every signed-in call, a declared limit its own procedure.
  it('plants the signed-in default at 150 per 60 s and the four administrator limits (T062)', async () => {
    const { rows } = await db.query<{ key: string; value: unknown }>(
      `SELECT key, value FROM settings WHERE key = ANY($1::text[]) ORDER BY key`,
      [
        [
          'rate_limit_signed_in_default',
          'rate_limit_dispute_revision',
          'rate_limit_enrollment_restore',
          'rate_limit_manual_compensation_case',
          'rate_limit_outcome_correction',
        ],
      ],
    );
    expect(rows).toEqual([
      { key: 'rate_limit_dispute_revision', value: { limit: 10, window_seconds: 60 } },
      { key: 'rate_limit_enrollment_restore', value: { limit: 10, window_seconds: 60 } },
      { key: 'rate_limit_manual_compensation_case', value: { limit: 10, window_seconds: 60 } },
      { key: 'rate_limit_outcome_correction', value: { limit: 10, window_seconds: 60 } },
      { key: 'rate_limit_signed_in_default', value: { limit: 150, window_seconds: 60 } },
    ]);
  });

  // T069 (SRS DEC-66, DEC-67): each new row parses as its reader will read it, a limit through the
  // rate-limit guard's own schema (a malformed one fails the procedure closed) and a window as the
  // positive whole number of days `restore-window.ts`' callers read (JSON 14, never "14" or 14.5).
  it('plants the six T069 limits at 10 per 60 s and the two windows at 14 days, each parsing (T069)', async () => {
    const { rows } = await db.query<{ key: string; value: unknown }>(
      `SELECT key, value FROM settings WHERE key = ANY($1::text[]) ORDER BY key`,
      [[...T069_RATE_LIMITS, ...T069_WINDOWS]],
    );
    const values = new Map(rows.map(({ key, value }) => [key, value]));
    for (const key of T069_RATE_LIMITS) {
      expect(rateLimitSetting.safeParse(values.get(key)), key).toEqual({
        success: true,
        data: { limit: 10, window_seconds: 60 },
      });
    }
    for (const key of T069_WINDOWS) {
      const value = values.get(key);
      expect(Number.isInteger(value) && (value as number) > 0, key).toBe(true);
      expect(value, key).toBe(14);
    }
  });

  it('plants Phase 4’s six rate limits, each parsing as a limit (005:T001)', async () => {
    const { rows } = await db.query<{ key: string; value: unknown }>(
      `SELECT key, value FROM settings WHERE key = ANY($1::text[]) ORDER BY key`,
      [Object.keys(PHASE_4_RATE_LIMITS)],
    );
    const values = new Map(rows.map(({ key, value }) => [key, value]));
    for (const [key, expected] of Object.entries(PHASE_4_RATE_LIMITS)) {
      expect(rateLimitSetting.safeParse(values.get(key)), key).toEqual({
        success: true,
        data: expected,
      });
    }
  });

  it('plants one administrator, active, whose credential nobody holds', async () => {
    const admin = await administrator();
    expect(admin).toMatchObject({
      id: ADMINISTRATOR_ID,
      email: 'admin@ijazah.invalid',
      display_name: 'Administrator',
      is_active: true,
    });
    expect(admin.password_hash).toMatch(/^\$argon2id\$v=19\$/);
    expect((await verifyPassword('', admin.password_hash)).valid).toBe(false);
    const secret = new ColumnCipher(encryptionKey).decrypt(
      admin.mfa_secret_encrypted,
      'admin_users.mfa_secret_encrypted',
      ADMINISTRATOR_ID,
    );
    expect(secret.length).toBeGreaterThan(0);
  });

  it('dates every row it plants at one fixed instant, never the clock', async () => {
    const { rows } = await db.query<{ instant: string }>(
      `SELECT DISTINCT to_json(instant)#>>'{}' AS instant FROM (
         SELECT created_at AS instant FROM subjects UNION ALL SELECT updated_at FROM subjects
         UNION ALL SELECT created_at FROM settings UNION ALL SELECT updated_at FROM settings
         UNION ALL SELECT created_at FROM admin_users UNION ALL SELECT updated_at FROM admin_users
       ) planted`,
    );
    expect(rows.map((row) => row.instant)).toEqual(['2026-10-10T00:00:00+00:00']);
  });

  it('plants nothing else', async () => {
    const { rows } = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
          AND table_name <> '_prisma_migrations'`,
    );
    const others = rows.map((row) => row.table_name).filter((name) => !SEEDED_TABLES.has(name));
    // 51 tables (T003, T094, T097, Phase 2's T004, Phase 3's T001, Phase 4's T001, 003:T105, 003:T112, 006:T001) less the three seeded ones.
    expect(others).toHaveLength(48);
    for (const table of others) {
      const { rows: present } = await db.query(
        `SELECT 1 FROM ${pg.escapeIdentifier(table)} LIMIT 1`,
      );
      expect(present, table).toEqual([]);
    }
  });

  it('leaves what it finds on a second run: the credential, and a setting an administrator changed', async () => {
    const before = await administrator();
    await db.query(
      `UPDATE settings SET value = '48'::jsonb WHERE key = 'idempotency_key_ttl_hours'`,
    );
    await seed(db, { encryptionKey: randomBytes(32).toString('base64') });
    const after = await administrator();
    expect(after.password_hash).toBe(before.password_hash);
    expect(after.mfa_secret_encrypted).toEqual(before.mfa_secret_encrypted);
    const { rows } = await db.query<{ value: unknown }>(
      `SELECT value FROM settings WHERE key = 'idempotency_key_ttl_hours'`,
    );
    expect(rows).toEqual([{ value: 48 }]);
    const { rows: counts } = await db.query<{ subjects: string; settings: string; admins: string }>(
      `SELECT (SELECT count(*) FROM subjects)::text AS subjects,
              (SELECT count(*) FROM settings)::text AS settings,
              (SELECT count(*) FROM admin_users)::text AS admins`,
    );
    // 003:T105 (rule d): + ijazah_half_release_percent + rate_limit_payout_mark; with B48 (005:T017)'s two
    // re-enqueue settings, merged from develop: 89 + 2 + 2; 003:T112 (rule d): + the postponement's two;
    // 006:T002: + the programme's eight (95 + 8).
    expect(counts).toEqual([{ subjects: '5', settings: '103', admins: '1' }]);
  });
});
