// T002 of specs/004-sessions (contracts/kernel.md, "Locks and refusals"; FR-422): the instant a
// case or a dispute closes is the database's clock when the closing update runs,
// `clock_timestamp()`, never the transaction's `now()`, which is the instant the transaction began:
// a closing that waited on the enrollment's lock is later than its transaction's start, and the
// covering rule compares a paid order with it (ERD §10, `disputes.resolved_at`). Raw SQL, so it
// lives in the kernel (R-API-6).
import type { Transaction } from './prisma.repository.js';

/** The database's clock now, `SELECT clock_timestamp()`, on the caller's transaction. */
export async function clockTimestamp(tx: Transaction): Promise<Date> {
  const [row] = await tx.$queryRaw<{ at: Date }[]>`SELECT clock_timestamp() AS at`;
  if (row === undefined) throw new Error('clock_timestamp() answered no row');
  return row.at;
}
