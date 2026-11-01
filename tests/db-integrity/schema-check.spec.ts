// T070 — the schema check (FR-024, SC-014, R-DB-4, R-DB-7, R-DB-8, R-TIME-4, R-TIME-5; data-model.md
// §2 and §3; ADR 0006, ADR 0009, ADR 0010).
//
// `checkSchema` is a function of a connected client, so it is tested on two catalogues. The
// migrated schema, read as the application role, has no violation. Then, as the owner and inside
// one transaction that is always rolled back, one violation of every rule is made and the check,
// run on that same transaction, must name each one: a catalogue change that is not committed is
// visible only to the session that made it.
//
// The second half needs `DATABASE_URL_OWNER` as well as `DATABASE_URL`, as the concurrency probes do.
//
// T013 (Phase 1): the migrated schema now holds four columns named with a secret word that hold no
// secret (`mfa_last_accepted_step`, `mfa_enrolled_at`, `password_set_at`, `mfa_verified_at`) and one
// more counter (`failed_sign_in_count`); each is on its declared list, so the first case holds.
// The violation case gains a lookalike on neither list, so the lists admit what they name and
// nothing more.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkSchema, type Violation } from '../../scripts/schema-check';
import { connectAsApplication, inRollback, type Db } from './harness';

function roleOf(url: string): string {
  return decodeURIComponent(new URL(url).username);
}

function named(violations: readonly Violation[]): string[] {
  return violations.map(({ rule, table, column }) =>
    column === undefined ? `${rule} ${table}` : `${rule} ${table}.${column}`,
  );
}

describe('the migrated schema passes the check (T070)', () => {
  let db: Db;
  beforeAll(async () => {
    db = await connectAsApplication();
  });
  afterAll(async () => {
    await db.end();
  });

  it('reports no violation, read as the application role', async () => {
    const { rows } = await db.query<{ role: string }>('SELECT current_user AS role');
    const violations = await checkSchema(db, { applicationRole: rows[0]?.role ?? '' });
    expect(named(violations)).toEqual([]);
  });
});

describe('the check names every kind of violation (T070)', () => {
  let owner: pg.Client;
  let applicationRole: string;

  beforeAll(async () => {
    const ownerUrl = process.env['DATABASE_URL_OWNER'];
    const applicationUrl = process.env['DATABASE_URL'];
    if (ownerUrl === undefined || ownerUrl === '' || applicationUrl === undefined) {
      throw new Error(
        'DATABASE_URL_OWNER and DATABASE_URL must be set: violations are made as the owner, in a transaction rolled back',
      );
    }
    applicationRole = roleOf(applicationUrl);
    owner = new pg.Client({ connectionString: ownerUrl, connectionTimeoutMillis: 5_000 });
    await owner.connect();
  });
  afterAll(async () => {
    await owner.end();
  });

  it('names each one by rule, table and column, in the transaction that made it', async () => {
    const found = await inRollback(owner, async (db) => {
      await db.query(`
        CREATE TABLE probe_violations (
          id uuid PRIMARY KEY,
          created timestamp,
          starts timestamptz,
          ends_at text,
          price_piasters numeric(12, 2),
          lesson_local date,
          api_token text,
          reset_code text,
          mfa_recovered_at timestamptz,
          code_hash integer,
          note_encrypted text,
          blob bytea,
          deleted_at timestamptz,
          total_score integer,
          lesson_count integer,
          created_at timestamptz NOT NULL
        )`);
      await db.query(`CREATE TYPE probe_gender AS ENUM ('male', 'female')`);
      await db.query('DROP INDEX users_email_key');
      await db.query('DROP INDEX reviews_enrollment_id_key');
      await db.query(
        'CREATE UNIQUE INDEX probe_reviews_enrollment ON reviews (enrollment_id) WHERE moderated_by_admin_id IS NULL',
      );
      await db.query('ALTER TABLE teacher_profiles ALTER COLUMN review_count TYPE bigint');
      return named(await checkSchema(db, { applicationRole }));
    });

    expect(found).toEqual(
      expect.arrayContaining([
        'timestamp-without-zone probe_violations.created',
        'timestamp-suffix probe_violations.starts',
        'timestamp-suffix probe_violations.ends_at',
        'piasters-type probe_violations.price_piasters',
        'local-time probe_violations.lesson_local',
        'secret-column probe_violations.api_token',
        'secret-column probe_violations.reset_code',
        'secret-column probe_violations.mfa_recovered_at',
        'hash-type probe_violations.code_hash',
        'encrypted-type probe_violations.note_encrypted',
        'encrypted-type probe_violations.blob',
        'soft-delete-privilege probe_violations',
        'derived-value probe_violations.total_score',
        'derived-value probe_violations.lesson_count',
        'enum-duplicate probe_gender',
        'users-partial-index users.email',
        'reviews-enrollment-unique reviews.enrollment_id',
        'declared-cache teacher_profiles.review_count',
      ]),
    );
    expect(found).toHaveLength(18);
  });
});
