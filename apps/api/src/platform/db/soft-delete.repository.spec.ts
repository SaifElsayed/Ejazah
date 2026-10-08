// T148 — the soft-deletion extension without a database. The behaviour against Postgres, as the
// application role, is T053 (`tests/db-integrity/soft-delete.spec.ts`), which reaches the four
// soft-deleted tables; a kernel spec may not (R-API-6, `api/table-ownership`). This spec holds what
// needs no connection: how the condition joins the caller's `where`, the refusal's message, and a
// delete on the kernel's own table passing the extension.
import { afterAll, describe, expect, it } from 'vitest';
import { closeDatabase, openDatabase } from './prisma.repository.js';
import { HardDeleteRefusedError, liveRowsOnly } from './soft-delete.repository.js';

const database = openDatabase('postgresql://ijazah_app:app@127.0.0.1:1/ijazah');

afterAll(async () => {
  await closeDatabase(database);
});

describe('the soft-deletion condition (T148)', () => {
  it('is added to a read with no where', () => {
    expect(liveRowsOnly(undefined)).toEqual({ AND: [{ deletedAt: null }] });
  });

  it('joins the caller’s conditions without overwriting them, a unique field included', () => {
    expect(liveRowsOnly({ id: 'u1', deletedAt: { not: null } })).toEqual({
      id: 'u1',
      deletedAt: { not: null },
      AND: [{ deletedAt: null }],
    });
  });

  it('keeps the caller’s own AND, as one condition or a list', () => {
    expect(liveRowsOnly({ AND: { gender: 'male' } })).toEqual({
      AND: [{ gender: 'male' }, { deletedAt: null }],
    });
    expect(liveRowsOnly({ AND: [{ gender: 'male' }] })).toEqual({
      AND: [{ gender: 'male' }, { deletedAt: null }],
    });
  });
});

describe('a hard delete (T148, PR #41 review n1)', () => {
  it('is refused with an error that names soft deletion and the way to remove a row', () => {
    const refusal = new HardDeleteRefusedError('Enrollment', 'deleteMany');
    expect(refusal.message.startsWith('Hard delete refused on Enrollment (deleteMany)')).toBe(true);
    expect(refusal.message).toContain('soft deletion, an update that sets deletedAt');
  });

  it('stays possible through the client on a table that is not soft-deleted', async () => {
    // The kernel's idempotency sweep deletes rows (T102): the call passes the extension and fails
    // at the connection, since nothing listens. The refusal itself is probed against Postgres, on
    // the four tables the kernel does not own, by T053.
    await expect(database.idempotencyKey.deleteMany({})).rejects.not.toBeInstanceOf(
      HardDeleteRefusedError,
    );
  });
});
