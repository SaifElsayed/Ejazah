// T050 — the application role cannot destroy a protected row (SC-004, FR-025/026, ERD §15.10).
//
// For each of the five tables the database refuses DELETE to the application role, ten times out
// of ten (SC-004), with SQLSTATE 42501. The statement deletes nothing even if it were allowed
// (`WHERE false`), so a probe never depends on rows existing; privilege is checked before any row
// is read. TRUNCATE is refused too: it removes every row without a DELETE, so a role that kept it
// would have the door the revocation closes (T065 revokes both). Removal of a user, session,
// enrollment or ijazah is a soft deletion instead, proved by T053; an audit row has no removal path
// at all, proved by T054.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SQLSTATE, attempt, connectAsApplication, inRollback, type Db } from './harness';

const protectedTables = ['users', 'sessions', 'enrollments', 'ijazahs', 'audit_logs'] as const;

let db: Db;

beforeAll(async () => {
  db = await connectAsApplication();
});

afterAll(async () => {
  await db?.end();
});

describe('DELETE is refused to the application role (T050, SC-004)', () => {
  it.each(protectedTables)('%s: DELETE refused ten times out of ten', async (table) => {
    await inRollback(db, async () => {
      for (let round = 0; round < 10; round += 1) {
        expect(await attempt(db, `DELETE FROM "${table}" WHERE false`)).toBe(
          SQLSTATE.insufficientPrivilege,
        );
      }
    });
  });

  it.each(protectedTables)('%s: TRUNCATE refused', async (table) => {
    await inRollback(db, async () => {
      expect(await attempt(db, `TRUNCATE "${table}"`)).toBe(SQLSTATE.insufficientPrivilege);
    });
  });

  // The control is a table whose DELETE is a feature: stale push tokens are pruned (ERD section 2).
  // A table merely left unprotected today could be revoked by a later migration and fail this
  // control for a reason that is not a dead connection.
  it('the role can still read and delete where deletion is a feature, so the refusals are not a dead connection', async () => {
    await inRollback(db, async () => {
      expect(await attempt(db, 'SELECT count(*) FROM "device_push_tokens"')).toBeNull();
      expect(await attempt(db, 'DELETE FROM "device_push_tokens" WHERE false')).toBeNull();
    });
  });
});
