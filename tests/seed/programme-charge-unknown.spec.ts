// 006:T014 of specs/006-programme/tasks.md (SRS DEC-113; ERD changelog row 80, §15 rule 80 as
// amended; lane b's Q-b2 (a)): `20261124105820_programme_charge_unknown` on an empty database of
// this file's own, migrated by one `prisma migrate deploy` as `migrate-from-empty.spec.ts` migrates
// it: `programme_request_kind` ends with `charge_unknown`, and rule 80's check admits `extended` on
// it beside `no_offer` and `pay_blocked` (the value committed first, 55P04). Rule 80's rows are tried
// on `ijazah_integrity_b` by `tests/db-integrity/ijazah-programme.spec.ts`.
//
// Observed red under a mutant migration whose check leaves `charge_unknown` out (`R/lane-b`, MM1).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
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

describe('the charge_unknown migration on an empty database (006:T014)', () => {
  let database: FreshDatabase;
  let owner: pg.Client;
  let result: MigrateResult;

  beforeAll(async () => {
    database = await createEmptyDatabase();
    owner = await connect(database.ownerUrl);
    result = await migrate(database);
  }, MIGRATE_TIMEOUT_MILLISECONDS);

  afterAll(async () => {
    await owner?.end();
    await database?.drop();
  });

  it('applies in the one run', () => {
    expect(result.exitCode, result.output).toBe(0);
  });

  it('appends charge_unknown to programme_request_kind', async () => {
    const { rows } = await owner.query<{ label: string }>(
      `SELECT e.enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'programme_request_kind' ORDER BY e.enumsortorder`,
    );
    expect(rows.map(({ label }) => label)).toEqual([
      'stop',
      'refusal',
      'no_offer',
      'pay_blocked',
      'charge_unknown',
    ]);
  });

  it('extends rule 80: extended only on no_offer, pay_blocked and charge_unknown', async () => {
    const { rows } = await owner.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
        WHERE conname = 'programme_requests_extended_check'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.definition).toBe(
      "CHECK (((status <> 'extended'::programme_request_status) OR (kind = ANY (ARRAY['no_offer'::programme_request_kind, 'pay_blocked'::programme_request_kind, 'charge_unknown'::programme_request_kind]))))",
    );
  });
});
