// T075 — the seed checksum (FR-038, SC-002, quickstart §1).
//
// One empty database of this file's own is migrated and seeded. The checksum is a function of the
// rows of every table in `public` but the migration tool's own, with exactly the administrator's
// two credential columns left out (note under T074). Each change below is made inside a transaction
// that is rolled back, and the checksum is read inside it. T072 proves two seeds agree; this file
// proves what the checksum reads and what it does not.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed } from '../../prisma/seed';
import { seedChecksum } from '../../scripts/seed-checksum';
import {
  MIGRATE_TIMEOUT_MILLISECONDS,
  connect,
  createEmptyDatabase,
  migrate,
  type FreshDatabase,
} from './fresh-database';

const root = join(__dirname, '..', '..');
const tsxCli = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');

/** Runs `pnpm db:seed:checksum`'s command against `url`; resolves with its exit code and output. */
function runCommand(url: string): Promise<{ exitCode: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxCli, 'scripts/seed-checksum.ts'], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: url },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.once('error', reject);
    child.once('close', (exitCode) => resolve({ exitCode, stdout }));
  });
}

describe('the seed checksum (T075)', () => {
  let database: FreshDatabase;
  let db: pg.Client;
  let seeded: string;

  beforeAll(async () => {
    database = await createEmptyDatabase();
    const result = await migrate(database);
    if (result.exitCode !== 0) throw new Error(`the migrations did not apply:\n${result.output}`);
    db = await connect(database.applicationUrl);
    await seed(db, { encryptionKey: randomBytes(32).toString('base64') });
    seeded = await seedChecksum(db);
  }, MIGRATE_TIMEOUT_MILLISECONDS);

  afterAll(async () => {
    await db?.end();
    await database?.drop();
  });

  async function inRollback(change: string): Promise<string> {
    await db.query('BEGIN');
    try {
      await db.query(change);
      return await seedChecksum(db);
    } finally {
      await db.query('ROLLBACK');
    }
  }

  it('is a SHA-256, in lower-case hex', () => {
    expect(seeded).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not depend on the zone of the session that reads it', async () => {
    const elsewhere = await connect(database.applicationUrl, 'America/Los_Angeles');
    try {
      expect(await seedChecksum(elsewhere)).toBe(seeded);
    } finally {
      await elsewhere.end();
    }
  });

  it('reads every seeded column but the credential, and every other table', async () => {
    expect(await inRollback(`UPDATE admin_users SET display_name = 'Someone else'`)).not.toBe(
      seeded,
    );
    expect(
      await inRollback(`UPDATE subjects SET updated_at = updated_at + interval '1 second'`),
    ).not.toBe(seeded);
    expect(
      await inRollback(
        `INSERT INTO idempotency_keys (scope, actor_id, key, request_hash, status, created_at, updated_at, expires_at)
         VALUES ('probe', 'probe-actor', 'probe-key-0000000000', 'hash', 'completed', now(), now(), now())`,
      ),
    ).not.toBe(seeded);
  });

  it('leaves out exactly the administrator credential, which differs on every machine', async () => {
    expect(
      await inRollback(
        `UPDATE admin_users SET password_hash = 'another', mfa_secret_encrypted = '\\x00'::bytea`,
      ),
    ).toBe(seeded);
  });

  it('is what `pnpm db:seed:checksum` prints', async () => {
    const { exitCode, stdout } = await runCommand(database.applicationUrl);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(seeded);
  });
});
