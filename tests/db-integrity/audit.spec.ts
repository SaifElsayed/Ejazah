// T054 — the audit log is append-only, with no removal path at all (FR-049, ERD §15.10,
// data-model.md §4).
//
// Two halves. DELETE and TRUNCATE are refused to the application role (42501), and there is no
// column that would let a removal happen as an update instead: `audit_logs` has no `deleted_at`,
// so setting one fails as an undefined column (42703), and no column of the table names a removal.
// A row can still be written, so the refusal is the rule and not a dead table.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SQLSTATE,
  attempt,
  connectAsApplication,
  inRollback,
  insertRow,
  makeAdmin,
  type Db,
} from './harness';

let db: Db;

beforeAll(async () => {
  db = await connectAsApplication();
});

afterAll(async () => {
  await db?.end();
});

describe('audit_logs is append-only (T054)', () => {
  it('a row is written, and then cannot be deleted or truncated', async () => {
    await inRollback(db, async () => {
      const adminId = await makeAdmin(db);
      const auditId = await insertRow(db, 'audit_logs', {
        admin_id: adminId,
        action: 'probe.recorded',
        target_type: 'probe',
        target_id: adminId,
        target_label: `مشرف · ${adminId}`,
      });

      expect(await attempt(db, 'DELETE FROM "audit_logs" WHERE id = $1', [auditId])).toBe(
        SQLSTATE.insufficientPrivilege,
      );
      expect(await attempt(db, 'TRUNCATE "audit_logs"')).toBe(SQLSTATE.insufficientPrivilege);
    });
  });

  it('has no deletion column to set instead', async () => {
    await inRollback(db, async () => {
      const { rows } = await db.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'audit_logs'`,
      );
      const columns = rows.map((row) => row.column_name);

      expect(columns).toContain('occurred_at');
      expect(columns.filter((column) => /delet|remov|archiv|purg/.test(column))).toEqual([]);
      expect(await attempt(db, 'UPDATE "audit_logs" SET "deleted_at" = now() WHERE false')).toBe(
        SQLSTATE.undefinedColumn,
      );
    });
  });
});
