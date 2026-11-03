// T036 (the note under T036 of 2026-11-03): a row's id drawn before the row is written, when a call
// outside the row's transaction must name it first: `checkout.pay` hands the enrollment's id to the
// gateway's `createCheckout`, which runs outside any transaction (ARCHITECTURE §8.1), and only then
// writes the enrollment with it; an order's id binds its encrypted address to its row (R-DB-8).
// The database draws it with `uuidv7()`, every table's own default, so a drawn id sorts among the
// others as a default one does (PostgreSQL 18). Raw SQL stays in this folder (R-API-6).
import type { Database, Transaction } from './prisma.repository.js';

/** One new UUIDv7, drawn by the database. */
export async function drawRowId(
  database: Pick<Database, '$queryRaw'> | Pick<Transaction, '$queryRaw'>,
): Promise<string> {
  const [row] = await database.$queryRaw<{ id: string }[]>`SELECT uuidv7()::text AS id`;
  if (row === undefined) throw new Error('uuidv7() answered no row');
  return row.id;
}
