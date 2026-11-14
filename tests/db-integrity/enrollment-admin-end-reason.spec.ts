// T082 of specs/004-sessions/tasks.md (B42c) — the migration `20261114120000_enrollment_admin_end_reason`
// on this database: `enrollments.admin_end_reason`, text, nullable, and ERD §15 rule 51 (check
// `enrollments_admin_end_reason_check`, Q-R14 (a)): the reason both parties are shown of an
// administrator's direct end, 1 to 500 characters, only on an enrollment `cancelled` with the
// reason `admin` (SRS FR-CANCEL-10, DEC-68; data-model.md §2.14).
//
// As ban-restorable-kept-data.spec.ts: each probe first writes the rows the rule admits, so a
// refusal is the rule and not a broken row, then each forbidden one, expecting its SQLSTATE; a
// catalogue case holds the check by name; every probe runs as the application role in a
// transaction that is rolled back.
//
// Observed red: the column and the catalogue against the database before the migration; each check
// case against a mutant of the migration that adds the column without the check (T069's N8
// precedent), restored and `cmp`-checked.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  SQLSTATE,
  attempt,
  connectAsApplication,
  enrollmentValues,
  inRollback,
  insertStatement,
  makeOffer,
  makeUser,
  type Db,
} from './harness';

let db: Db;

beforeAll(async () => {
  db = await connectAsApplication();
});

afterAll(async () => {
  await db?.end();
});

/** The SQLSTATE an enrollment of `values` is refused with, or null when accepted. */
async function tryEnrollment(values: Record<string, unknown>): Promise<string | null> {
  const offer = await makeOffer(db);
  const studentId = await makeUser(db);
  const { sql, params } = await insertStatement(db, 'enrollments', {
    ...enrollmentValues(offer, studentId),
    confirmed_at: '2026-10-04T07:05:00Z',
    ...values,
  });
  return attempt(db, sql, params);
}

const ENDED = { status: 'cancelled', cancellation_reason: 'admin' };

describe('the migration on ijazah_integrity: enrollments.admin_end_reason (T082)', () => {
  it('adds the column, text and nullable', async () => {
    const { rows } = await db.query<{ type: string; nullable: string }>(
      `SELECT udt_name AS type, is_nullable AS nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'enrollments'
          AND column_name = 'admin_end_reason'`,
    );
    expect(rows).toEqual([{ type: 'text', nullable: 'YES' }]);
  });

  it('holds rule 51 by name, enrollments_admin_end_reason_check', async () => {
    const { rows } = await db.query<{ name: string }>(
      `SELECT conname AS name FROM pg_constraint
        WHERE contype = 'c' AND conrelid = 'enrollments'::regclass
          AND conname = 'enrollments_admin_end_reason_check'`,
    );
    expect(rows).toEqual([{ name: 'enrollments_admin_end_reason_check' }]);
  });
});

describe('ERD §15 rule 51: the direct end’s reason only on a cancelled admin enrollment, 1 to 500 characters (T082)', () => {
  it('admits a reason of 1 and of 500 characters on a cancelled admin enrollment, and none on every row', async () => {
    await inRollback(db, async () => {
      expect(await tryEnrollment({ ...ENDED, admin_end_reason: 'x' })).toBeNull();
      expect(await tryEnrollment({ ...ENDED, admin_end_reason: 'ر'.repeat(500) })).toBeNull();
      expect(await tryEnrollment(ENDED)).toBeNull();
      expect(await tryEnrollment({ status: 'confirmed' })).toBeNull();
      expect(
        await tryEnrollment({ status: 'cancelled', cancellation_reason: 'teacher_suspended' }),
      ).toBeNull();
    });
  });

  it('refuses an empty reason and one over 500 characters', async () => {
    await inRollback(db, async () => {
      expect(await tryEnrollment({ ...ENDED, admin_end_reason: '' })).toBe(SQLSTATE.checkViolation);
      expect(await tryEnrollment({ ...ENDED, admin_end_reason: 'ر'.repeat(501) })).toBe(
        SQLSTATE.checkViolation,
      );
    });
  });

  it('refuses a reason on any other status or cancellation reason, and a restore that leaves it behind', async () => {
    await inRollback(db, async () => {
      for (const values of [
        { status: 'confirmed' },
        { status: 'terminated_no_show' },
        { status: 'completed' },
        { status: 'cancelled', cancellation_reason: 'teacher_suspended' },
        { status: 'cancelled', cancellation_reason: 'account_deleted' },
      ]) {
        expect(
          await tryEnrollment({ ...values, admin_end_reason: 'انتهى' }),
          JSON.stringify(values),
        ).toBe(SQLSTATE.checkViolation);
      }
      const offer = await makeOffer(db);
      const studentId = await makeUser(db);
      const { sql, params } = await insertStatement(db, 'enrollments', {
        ...enrollmentValues(offer, studentId),
        confirmed_at: '2026-10-04T07:05:00Z',
        ...ENDED,
        admin_end_reason: 'انتهى',
      });
      const { rows } = await db.query<{ id: string }>(sql, params);
      expect(
        await attempt(
          db,
          `UPDATE enrollments SET status = 'confirmed', cancellation_reason = NULL WHERE id = $1`,
          [rows[0]?.id],
        ),
      ).toBe(SQLSTATE.checkViolation);
    });
  });
});
