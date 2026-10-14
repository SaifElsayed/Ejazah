// T074 — what the seed plants, and nothing else (FR-038, data-model.md §10, note under T074).
//
// An empty database of this file's own is migrated and seeded as the application role. The seed
// plants five subjects in both languages, the settings of SRS §3.14 with their defaults plus the
// four rate-limit rows (owner's decision 2026-10-10, shared with T103) and the two budget rows
// (T170), and one administrator, each with a fixed identifier and a fixed instant; every other
// table stays empty.
//
// THE ADMINISTRATOR'S CREDENTIAL. No secret is committed (R-SEC-1), so the seed knows no password:
// it stores the Argon2id hash of a random one it discards at once (T069) and a random MFA secret
// encrypted under the run's ENCRYPTION_KEY (T068). Nobody can sign in with it; the phase that builds
// administrator sign-in sets a real credential. A second run leaves the credential alone, as it
// leaves every row it finds, so a seed never rewrites a setting an administrator has changed
// (R-PROC-11).
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ColumnCipher } from '../../apps/api/src/platform/crypto/encryption.js';
import { verifyPassword } from '../../apps/api/src/platform/crypto/hashing.js';
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
  teacher_no_show_threshold: 2,
  dispute_window_hours: 72,
  slot_hold_ttl_minutes: 10,
  slot_hold_grace_minutes: 5,
  checkout_confirmation_timeout_seconds: 15,
  idempotency_key_ttl_hours: 24,
  slot_release_buffer_weeks: 0,
  reminder_offsets_minutes: [1440, 15],
  chat_retention_days: 0,
  rate_limit_authentication: { limit: 10, window_seconds: 900 },
  rate_limit_one_time_code: { limit: 5, window_seconds: 600 },
  rate_limit_search: { limit: 60, window_seconds: 60 },
  rate_limit_payment_initiation: { limit: 10, window_seconds: 600 },
  rate_limit_one_time_code_budget: { limit: 300, window_seconds: 3600 },
  rate_limit_authentication_budget: { limit: 1000, window_seconds: 900 },
};

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
    expect(others).toHaveLength(30);
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
    expect(counts).toEqual([{ subjects: '5', settings: '19', admins: '1' }]);
  });
});
