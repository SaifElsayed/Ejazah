// T069 of specs/004-sessions/tasks.md (B42a; SRS DEC-66; Q6 (b)) — the migration
// `20261113120000_ban_restorable_and_kept_data` moves `enrollment_restore_window_days` from 7 to 14
// only where its row still holds 7, and leaves any other value, and every other row, alone.
//
// HOW. The step only means something on a database that already holds the row, so each case has an
// empty database of its own (tests/seed/fresh-database.ts), given, as the owner, every migration
// before this one in name order, each file's text sent whole as `prisma migrate deploy` sends it
// (one script, one implicit transaction, the enum values' COMMIT included). The ledger table those
// migrations name (`20261007000100_roles_and_privileges` revokes it) is created first, empty: the
// ledger is the tool's, not the model's. Then the settings rows are planted, and this migration's
// file is sent the same way, read from disk, so the spec runs the text that ships.
//
// Observed red against two mutants of the migration, each restored and `cmp`-checked: the step
// without its `"value" = '7'` guard (another value moved to 14), and no step at all (7 left as 7).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MIGRATE_TIMEOUT_MILLISECONDS,
  connect,
  createEmptyDatabase,
  type FreshDatabase,
} from './fresh-database';

const root = join(__dirname, '..', '..');
const migrations = join(root, 'prisma', 'migrations');
const THIS_MIGRATION = '20261113120000_ban_restorable_and_kept_data';
const ADMINISTRATOR_ID = '01a1231c-0000-7000-8000-000000000001';
const PLANTED_AT = '2026-10-10T00:00:00+00:00';

function scriptOf(directory: string): string {
  return readFileSync(join(migrations, directory, 'migration.sql'), 'utf8');
}

/** Every migration directory that sorts before this one. */
function earlierMigrations(): string[] {
  return readdirSync(migrations, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name < THIS_MIGRATION)
    .map((entry) => entry.name)
    .sort();
}

interface SettingRow {
  key: string;
  value: unknown;
  updated_by_admin_id: string;
  updated_at: string;
}

/**
 * An empty database holding the history before this migration and the settings rows given, then
 * this migration; answers its settings rows after it, by key.
 */
async function migratedOver(
  planted: Readonly<Record<string, unknown>>,
): Promise<{ database: FreshDatabase; rows: SettingRow[] }> {
  const database = await createEmptyDatabase();
  const owner = await connect(database.ownerUrl, 'UTC');
  try {
    await owner.query('CREATE TABLE "_prisma_migrations" (id varchar(36) PRIMARY KEY)');
    for (const directory of earlierMigrations()) await owner.query(scriptOf(directory));
    await owner.query(
      `INSERT INTO admin_users
         (id, email, password_hash, mfa_secret_encrypted, display_name, is_active, created_at, updated_at)
       VALUES ($1, 'admin@ijazah.invalid', 'probe-hash', '\\x00'::bytea, 'Administrator', true, $2, $2)`,
      [ADMINISTRATOR_ID, PLANTED_AT],
    );
    for (const [key, value] of Object.entries(planted)) {
      await owner.query(
        `INSERT INTO settings (key, value, updated_by_admin_id, created_at, updated_at)
         VALUES ($1, $2::jsonb, $3, $4, $4)`,
        [key, JSON.stringify(value), ADMINISTRATOR_ID, PLANTED_AT],
      );
    }
    await owner.query(scriptOf(THIS_MIGRATION));
    return { database, rows: await settingsOf(owner) };
  } catch (error: unknown) {
    await database.drop().catch(() => undefined);
    throw error;
  } finally {
    await owner.end();
  }
}

async function settingsOf(db: pg.Client): Promise<SettingRow[]> {
  const { rows } = await db.query<SettingRow>(
    `SELECT key, value, updated_by_admin_id, to_json(updated_at)#>>'{}' AS updated_at
       FROM settings ORDER BY key`,
  );
  return rows;
}

function planted(key: string, value: unknown): SettingRow {
  return { key, value, updated_by_admin_id: ADMINISTRATOR_ID, updated_at: PLANTED_AT };
}

describe('the restore window’s 7 → 14 step (T069, Q6 (b))', () => {
  const databases: FreshDatabase[] = [];

  afterAll(async () => {
    for (const database of databases) await database.drop();
  });

  describe('a row still holding the old default', () => {
    let rows: SettingRow[];

    beforeAll(async () => {
      const result = await migratedOver({
        enrollment_restore_window_days: 7,
        makeup_choice_window_days: 7,
      });
      databases.push(result.database);
      rows = result.rows;
    }, MIGRATE_TIMEOUT_MILLISECONDS);

    it('moves it to 14, and leaves another row holding 7 alone', () => {
      expect(rows).toEqual([
        planted('enrollment_restore_window_days', 14),
        planted('makeup_choice_window_days', 7),
      ]);
    });
  });

  describe('a row an administrator changed', () => {
    let rows: SettingRow[];

    beforeAll(async () => {
      const result = await migratedOver({ enrollment_restore_window_days: 10 });
      databases.push(result.database);
      rows = result.rows;
    }, MIGRATE_TIMEOUT_MILLISECONDS);

    it('leaves its value alone', () => {
      expect(rows).toEqual([planted('enrollment_restore_window_days', 10)]);
    });
  });
});
