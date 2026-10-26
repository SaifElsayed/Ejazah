// T073 — the full migration history applies to an empty database in one run (SC-006; US2 scenario
// 14; quickstart §2).
//
// An empty database of this file's own (tests/seed/fresh-database.ts) is migrated by one
// `prisma migrate deploy`, as `pnpm db:migrate` runs it, with no step before or after. The run must
// exit 0, every migration directory under prisma/migrations must be recorded as applied and none
// rolled back, and the tables in `public` must be exactly the model's: the 39 of
// packages/config/module-tables.json (ERD §1; the six of Phase 1 by T003, created by the
// migrations of T009 to T012), plus `_prisma_migrations`, the migration tool's own record of what it
// applied, which is not a table of the model.
//
// Observed red before commit by two mutations, each since removed: a migration creating a table
// outside the model failed the last case, and a migration that does not parse failed the first two.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MIGRATE_TIMEOUT_MILLISECONDS,
  connect,
  createEmptyDatabase,
  migrate,
  type FreshDatabase,
  type MigrateResult,
} from './fresh-database';

const root = join(__dirname, '..', '..');
const MIGRATION_TABLE = '_prisma_migrations';

/** The model's tables, from the manifest every owner of a table is read from (ERD §1, R-API-6). */
function modelTables(): string[] {
  const manifest = JSON.parse(
    readFileSync(join(root, 'packages', 'config', 'module-tables.json'), 'utf8'),
  ) as Record<string, unknown>;
  return Object.entries(manifest)
    .filter(([owner]) => owner !== '$comment')
    .flatMap(([, tables]) => tables as string[])
    .sort();
}

function migrationDirectories(): string[] {
  return readdirSync(join(root, 'prisma', 'migrations'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

describe('the migration history applied to an empty database (T073)', () => {
  let database: FreshDatabase;
  let owner: pg.Client;
  let result: MigrateResult;

  beforeAll(async () => {
    database = await createEmptyDatabase();
    owner = await connect(database.ownerUrl);
    const { rows } = await owner.query<{ tables: string }>(
      `SELECT count(*)::text AS tables FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')`,
    );
    if (rows[0]?.tables !== '0') throw new Error(`${database.name} is not empty`);
    result = await migrate(database);
  }, MIGRATE_TIMEOUT_MILLISECONDS);

  afterAll(async () => {
    await owner?.end();
    await database?.drop();
  });

  it('completes in one run', () => {
    expect(result.exitCode, result.output).toBe(0);
  });

  it('applies every migration in the history, and rolls none back', async () => {
    const { rows } = await owner.query<{ migration_name: string }>(
      `SELECT migration_name FROM ${MIGRATION_TABLE}
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
        ORDER BY migration_name`,
    );
    const { rows: unfinished } = await owner.query(
      `SELECT 1 FROM ${MIGRATION_TABLE} WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL`,
    );
    expect(rows.map((row) => row.migration_name)).toEqual(migrationDirectories());
    expect(unfinished).toEqual([]);
  });

  it('yields every table in the model and none outside it', async () => {
    const { rows } = await owner.query<{ table_name: string }>(
      `SELECT c.relname AS table_name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> $1`,
      [MIGRATION_TABLE],
    );
    const tables = rows.map((row) => row.table_name).sort();
    expect(modelTables()).toHaveLength(41);
    expect(tables).toEqual(modelTables());
  });
});
