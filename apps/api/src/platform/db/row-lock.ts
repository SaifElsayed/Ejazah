// T126: the row lock a read-then-write move takes at the start of its transaction, so a concurrent
// move on the same row waits until this one commits and then reads what it left (FR-166's identity
// request against a reinstatement; the audit's `before` of T116 read under the lock of the row it
// describes). It is raw SQL, so it lives in the kernel (R-API-6), and a module reaches it only from
// the repository that owns the table, on the transaction it already holds.
//
// The table is one of a closed union, each with its own tagged statement, so no table name is ever
// built from a string; Phase 2 adds `enrollments` and `availability_slots` with the moves that lock
// them (`specs/003-booking/contracts/kernel.md`). The rows are locked in id order, so two callers
// locking the same set take the locks in the same order and cannot deadlock on each other.
import type { Transaction } from './prisma.repository.js';

/** The tables a move locks rows of. */
export type LockedTable = 'users' | 'teacher_profiles';

/** Locks the rows of `table` whose id is in `ids`, FOR UPDATE, until the transaction ends. */
export async function lockRows(
  tx: Transaction,
  table: LockedTable,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  switch (table) {
    case 'users':
      await tx.$queryRaw`SELECT 1 FROM users WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
      return;
    case 'teacher_profiles':
      await tx.$queryRaw`SELECT 1 FROM teacher_profiles WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
      return;
  }
}
