// T108: how a kernel part opens a transaction over the process's one client without holding the
// client itself (R-API-2, R-API-6). The administrator caller kind runs each call in one of these, so
// the action's writes and its audit row commit or roll back together (FR-049).
//
// It is Prisma's interactive transaction: everything `work` writes through `tx` is committed when
// `work` resolves and rolled back when it throws. Writes made through anything other than `tx` are
// outside it, which is why the caller kind hands `tx` to the handler.
import type { Database, Transaction } from './prisma.repository.js';

export interface Transactions {
  /** Runs `work` in one transaction: committed if it resolves, rolled back if it throws. */
  run<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
}

/** The transactions of the process's client. */
export function transactionsOver(database: Database): Transactions {
  return { run: (work) => database.$transaction(work) };
}
