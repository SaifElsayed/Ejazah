// T104 of specs/003-booking/tasks.md (B-M1; ADR 0025 D1, SRS DEC-80) — the migration
// `20261117013200_payments_teacher_share` on this database: `payments.teacher_share_rate_percent`
// (smallint, nullable) and `payments.teacher_share_piasters` (bigint, nullable), and ERD §15 rule 52
// in three checks: the rate a whole percent from 0 to 100, the share from 0 to the order's gross, and
// both or neither (an order created before the commission keeps neither).
//
// As enrollment-admin-end-reason.spec.ts: each probe first writes the rows the rule admits, so a
// refusal is the rule and not a broken row, then each forbidden one, expecting its SQLSTATE; a
// catalogue case holds each check by name; every probe runs as the application role in a
// transaction that is rolled back.
//
// Observed red: the columns and the catalogue against the database before the migration; each check
// case against a mutant of the migration that adds the columns without its check, restored and
// `cmp`-checked.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  SQLSTATE,
  attempt,
  connectAsApplication,
  inRollback,
  makeEnrollment,
  type Db,
} from './harness';

let db: Db;

beforeAll(async () => {
  db = await connectAsApplication();
});

afterAll(async () => {
  await db?.end();
});

const GROSS = 10_000;

/**
 * The SQLSTATE an order of gross 10 000 piasters with `rate` and `share` is refused with, or null
 * when accepted. Written in SQL, as the other payments probes are: the amount's name lives only in
 * the payments module (R-MONEY-6), never as a key here.
 */
async function tryOrder(share: { rate?: number; share?: number }): Promise<string | null> {
  const { enrollmentId } = await makeEnrollment(db);
  return attempt(
    db,
    `INSERT INTO payments (enrollment_id, gateway, gateway_order_id, gross_piasters, currency, status,
                           expires_at, teacher_share_rate_percent, teacher_share_piasters, updated_at)
     VALUES ($1, 'fake', $2, ${String(GROSS)}, 'EGP', 'created', '2026-11-17T10:00:00Z', $3, $4, now())
     RETURNING id`,
    [enrollmentId, `probe_${randomUUID()}`, share.rate ?? null, share.share ?? null],
  );
}

const CHECKS = [
  'payments_teacher_share_rate_check',
  'payments_teacher_share_piasters_check',
  'payments_teacher_share_both_check',
];

describe('the migration on ijazah_integrity_b: payments.teacher_share_* (T104)', () => {
  it('adds the rate, smallint and nullable, and the share, bigint and nullable', async () => {
    const { rows } = await db.query<{ column: string; type: string; nullable: string }>(
      `SELECT column_name AS column, udt_name AS type, is_nullable AS nullable
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'payments'
          AND column_name IN ('teacher_share_rate_percent', 'teacher_share_piasters')
        ORDER BY column_name`,
    );
    expect(rows).toEqual([
      { column: 'teacher_share_piasters', type: 'int8', nullable: 'YES' },
      { column: 'teacher_share_rate_percent', type: 'int2', nullable: 'YES' },
    ]);
  });

  it('holds rule 52 by name, in its three checks', async () => {
    const { rows } = await db.query<{ name: string }>(
      `SELECT conname AS name FROM pg_constraint
        WHERE contype = 'c' AND conrelid = 'payments'::regclass AND conname = ANY($1)
        ORDER BY conname`,
      [CHECKS],
    );
    expect(rows.map(({ name }) => name)).toEqual([...CHECKS].sort());
  });
});

describe('ERD §15 rule 52: the rate a whole percent, the share within the gross, both or neither (T104)', () => {
  it('admits neither, and a rate with its share from 0% to 100% of the gross', async () => {
    await inRollback(db, async () => {
      expect(await tryOrder({})).toBeNull();
      expect(
        await tryOrder({ rate: 70, share: 7_000 }),
      ).toBeNull();
      expect(await tryOrder({ rate: 0, share: 0 })).toBeNull();
      expect(
        await tryOrder({ rate: 100, share: GROSS }),
      ).toBeNull();
    });
  });

  it('refuses a rate below 0 or above 100', async () => {
    await inRollback(db, async () => {
      expect(await tryOrder({ rate: -1, share: 0 })).toBe(
        SQLSTATE.checkViolation,
      );
      expect(
        await tryOrder({ rate: 101, share: 7_000 }),
      ).toBe(SQLSTATE.checkViolation);
    });
  });

  it('refuses a share below 0 or above the gross', async () => {
    await inRollback(db, async () => {
      expect(await tryOrder({ rate: 70, share: -1 })).toBe(
        SQLSTATE.checkViolation,
      );
      expect(
        await tryOrder({ rate: 100, share: GROSS + 1 }),
      ).toBe(SQLSTATE.checkViolation);
    });
  });

  it('refuses a rate without its share, and a share without its rate', async () => {
    await inRollback(db, async () => {
      expect(await tryOrder({ rate: 70 })).toBe(SQLSTATE.checkViolation);
      expect(await tryOrder({ share: 7_000 })).toBe(SQLSTATE.checkViolation);
    });
  });
});
