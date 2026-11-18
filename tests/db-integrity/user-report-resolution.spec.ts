// B47 (specs/005-certification/tasks.md, the note under T011; the owner's Q-R3 (a) of 2026-11-18) —
// the migration `20261118062524_user_report_resolution` on this database (data-model.md; ERD
// changelog row 53, §15 rule 59): `user_reports.resolution_notes`, the note `reports.resolve` takes
// (FR-612, contracts/admin-surface.md), and the check that a report's status, resolution instant and
// administrator agree: an open report has neither, a resolved one (`actioned`, `dismissed`) both.
//
// As certification-printed-riwaya-tariq.spec.ts: each probe writes the rows the rule admits, then each
// forbidden one, expecting its SQLSTATE; a catalogue case holds the column and the check by name;
// every probe runs as the application role in a transaction that is rolled back.
//
// Observed red: every case against the database before the migration (no column, no check).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  SQLSTATE,
  attempt,
  connectAsApplication,
  inRollback,
  insertStatement,
  makeAdmin,
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

const RESOLVED_AT = '2026-11-18T09:00:00Z';

/** The SQLSTATE a profile report of `values` (on two fresh users) is refused with, or null. */
async function tryReport(values: Readonly<Record<string, unknown>>): Promise<string | null> {
  const { sql, params } = await insertStatement(db, 'user_reports', {
    reporter_user_id: await makeUser(db),
    reported_user_id: await makeUser(db),
    context: 'profile',
    reason: 'سبب البلاغ',
    status: 'open',
    ...values,
  });
  return attempt(db, sql, params);
}

describe('the migration on ijazah_integrity: the catalogue (005:T011, Q-R3 (a))', () => {
  it('adds user_reports.resolution_notes, text and nullable', async () => {
    const { rows } = await db.query<{ name: string; type: string; nullable: string }>(
      `SELECT column_name AS name, udt_name AS type, is_nullable AS nullable
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'user_reports'
          AND column_name = 'resolution_notes'`,
    );
    expect(rows.map(({ name, type, nullable }) => `${name} ${type} ${nullable}`)).toEqual([
      'resolution_notes text YES',
    ]);
  });

  it('holds rule 59 by name, validated', async () => {
    const { rows } = await db.query<{ validated: boolean; definition: string }>(
      `SELECT convalidated AS validated, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conrelid = 'user_reports'::regclass AND conname = 'user_reports_resolved_check'`,
    );
    expect(rows).toEqual([
      {
        validated: true,
        definition:
          "CHECK ((((status = 'open'::user_report_status) = (resolved_at IS NULL)) AND ((resolved_at IS NULL) = (resolved_by_admin_id IS NULL))))",
      },
    ]);
  });
});

describe('ERD §15 rule 59: a report’s status, resolution instant and administrator agree (005:T011, Q-R3 (a))', () => {
  it('admits an open report with no resolution and no note', async () => {
    await inRollback(db, async () => {
      expect(await tryReport({ resolution_notes: null })).toBeNull();
    });
  });

  it('admits an actioned report with its administrator, instant and note', async () => {
    await inRollback(db, async () => {
      expect(
        await tryReport({
          status: 'actioned',
          resolved_by_admin_id: await makeAdmin(db),
          resolved_at: RESOLVED_AT,
          resolution_notes: 'تم التنبيه',
        }),
      ).toBeNull();
    });
  });

  it('admits a dismissed report with its administrator and instant and no note', async () => {
    await inRollback(db, async () => {
      expect(
        await tryReport({
          status: 'dismissed',
          resolved_by_admin_id: await makeAdmin(db),
          resolved_at: RESOLVED_AT,
          resolution_notes: null,
        }),
      ).toBeNull();
    });
  });

  it('refuses a resolved report without its instant', async () => {
    await inRollback(db, async () => {
      expect(
        await tryReport({ status: 'dismissed', resolved_by_admin_id: await makeAdmin(db) }),
      ).toBe(SQLSTATE.checkViolation);
    });
  });

  it('refuses a resolved report without its administrator', async () => {
    await inRollback(db, async () => {
      expect(await tryReport({ status: 'actioned', resolved_at: RESOLVED_AT })).toBe(
        SQLSTATE.checkViolation,
      );
    });
  });

  it('refuses a resolved report with neither its instant nor its administrator', async () => {
    await inRollback(db, async () => {
      expect(await tryReport({ status: 'dismissed' })).toBe(SQLSTATE.checkViolation);
    });
  });

  it('refuses an open report with a resolution instant', async () => {
    await inRollback(db, async () => {
      expect(await tryReport({ resolved_at: RESOLVED_AT })).toBe(SQLSTATE.checkViolation);
    });
  });

  it('refuses an open report with a resolving administrator', async () => {
    await inRollback(db, async () => {
      expect(await tryReport({ resolved_by_admin_id: await makeAdmin(db) })).toBe(
        SQLSTATE.checkViolation,
      );
    });
  });
});
