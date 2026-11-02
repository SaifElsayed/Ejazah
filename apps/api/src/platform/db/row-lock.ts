// T126: the row lock a read-then-write move takes at the start of its transaction, so a concurrent
// move on the same row waits until this one commits and then reads what it left (FR-166's identity
// request against a reinstatement; the audit's `before` of T116 read under the lock of the row it
// describes). It is raw SQL, so it lives in the kernel (R-API-6), and a module reaches it from the
// repository that owns the table, on the transaction it already holds. A module may also lock a row
// of another module's table that its own row references by a foreign key, through `lockRows` only
// and reading or writing no column of that table (the owner's decision of 2026-11-02). T035's
// `openCompensationCase` locks booking's `enrollments` row this way before it reads the open case
// its `disputes` row would join: a lock taken through booking would be a cycle, since booking calls
// moderation when a payment arrives late (FR-362, FR-375).
//
// The table is one of a closed union, each with its own tagged statement, so no table name is ever
// built from a string; T005 adds `availability_slots` and `enrollments` for Phase 2's moves
// (`specs/003-booking/contracts/kernel.md`). The rows are locked in id order, so two callers
// locking the same set take the locks in the same order and cannot deadlock on each other. T005
// adds `lockKey`, the transaction-scoped advisory lock of a scope and an id, for a decision over
// rows that may not exist yet, such as a teacher's slots before a new one is saved (R-206).
//
// THE TWO RULES OF PHASE 2 (the owner's decision of 2026-11-01, the note under T005). The lock stays
// FOR UPDATE.
//
// (1) Lock, then read. A path that decides on a row's state (a slot, a hold, an application, an
// account) locks the row with `lockRows` first and reads its state again under the lock. It never
// relies on a foreign key making its insert wait (an insert referencing a row locked FOR UPDATE
// waits on its key-share check), since the waiting path then goes on with what it read before the
// lock.
//
// (2) One lock order. `users`, then `teacher_profiles`, then the slot (`availability_slots`, or
// `lockKey('teacher-slots', …)`), then the hold, the enrollment and the payment. A path that inserts
// a row referencing `users` (a hold, an enrollment) locks that account with identity's
// `lockAccount` first; a row referencing several accounts (an enrollment: the student and the
// teacher) locks every one of them first, in id order, in one `lockRows(tx, 'users', ids)` call.
// `lockKey('teacher-slots', …)` comes before any `availability_slots` row. Rows of one table are
// taken in id order in every table, holds, enrollments and payments included, in one statement
// where it can. A termination path writes no row referencing an account it did not lock first.
// `LockedTable` lists its tables in this order; nothing here enforces it, so a transaction taking
// two of them takes them in the order they are listed.
import type { Transaction } from './prisma.repository.js';

/** The tables a move locks rows of, listed in the one lock order (rule 2 above). */
export type LockedTable = 'users' | 'teacher_profiles' | 'availability_slots' | 'enrollments';

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
    case 'availability_slots':
      await tx.$queryRaw`SELECT 1 FROM availability_slots WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
      return;
    case 'enrollments':
      await tx.$queryRaw`SELECT 1 FROM enrollments WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
      return;
  }
}

/**
 * What an advisory lock is taken over: `'teacher-slots'`, a teacher's slots by the teacher's user
 * id, taken in rule 2's place of the slot (R-206).
 */
export type LockScope = 'teacher-slots';

/**
 * Takes the advisory lock of `scope` and `id` until the transaction ends, at commit or rollback; a
 * second caller of the same pair waits until then (R-206).
 */
export async function lockKey(tx: Transaction, scope: LockScope, id: string): Promise<void> {
  // `$executeRaw`: the function answers a `void` column, which `$queryRaw` refuses to read.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scope}), hashtext(${id}))`;
}
