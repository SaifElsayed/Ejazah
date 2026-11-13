// T108: how a kernel part opens a transaction over the process's one client without holding the
// client itself (R-API-2, R-API-6). The administrator caller kind runs each call in one of these, so
// the action's writes and its audit row commit or roll back together (FR-049).
//
// It is Prisma's interactive transaction: everything `work` writes through `tx` is committed when
// `work` resolves and rolled back when it throws. Writes made through anything other than `tx` are
// outside it, which is why the caller kind hands `tx` to the handler.
//
// T002 of specs/004-sessions (the owner's decision of 2026-11-06 on the sixth analysis, L5;
// contracts/kernel.md, "Locks and refusals"; research R-321): `runRetryingDeadlockOnce`, for a
// make-up's booking and an administrator's restore, which can meet `reresolve-session-instants`'
// deferred overlap check at its commit. A deadlock rolled the transaction back, so the work runs
// once more in a new one; a second deadlock is the caller's refusal, never a third attempt. Every
// deadlock is logged with the operation and the closed ids only, never the error's text or the
// statement (R-SEC-2): a remedy's, an enrollment's, or the account a lift names (T072).
import { isDeadlock } from './db-errors.js';
import type { Database, Transaction } from './prisma.repository.js';

export interface Transactions {
  /** Runs `work` in one transaction: committed if it resolves, rolled back if it throws. */
  run<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
}

/** The transactions of the process's client. */
export function transactionsOver(database: Database): Transactions {
  return { run: (work) => database.$transaction(work) };
}

/**
 * The ids a deadlock's log line carries: a remedy's, an enrollment's, or the account a lift names
 * (T072 of specs/004-sessions; the owner's word on B42a lane D's Q-D2, 2026-11-13).
 */
export type DeadlockIds =
  { readonly remedyId: string } | { readonly enrollmentId: string } | { readonly userId: string };

/** What a deadlock is logged with: the calling procedure's name and its closed ids. */
export interface DeadlockTrace {
  readonly log: { warn(fields: object, message: string): void };
  /** The calling procedure, as `sessions.remedy.accept`, `sessions.restore`. */
  readonly operation: string;
  readonly ids: DeadlockIds;
}

/** Only the closed ids, whatever else the object carries at run time. */
function closedIds(ids: DeadlockIds): DeadlockIds {
  if ('remedyId' in ids) return { remedyId: ids.remedyId };
  return 'enrollmentId' in ids ? { enrollmentId: ids.enrollmentId } : { userId: ids.userId };
}

/**
 * Runs `work` in one transaction; when that transaction ends in a deadlock, once more in a new one;
 * a second deadlock throws `refusal()`. Any other failure is rethrown unchanged. Each deadlock
 * writes one `warn` line, `{ operation, attempt, ...ids }`, and the refusal one more,
 * `{ operation, attempts: 2, ...ids }`.
 */
export async function runRetryingDeadlockOnce<T>(
  transactions: Transactions,
  work: (tx: Transaction) => Promise<T>,
  refusal: () => Error,
  trace: DeadlockTrace,
): Promise<T> {
  const ids = closedIds(trace.ids);
  for (const attempt of [1, 2] as const) {
    try {
      return await transactions.run(work);
    } catch (error: unknown) {
      if (!isDeadlock(error)) throw error;
      trace.log.warn({ operation: trace.operation, attempt, ...ids }, 'Transaction deadlocked');
    }
  }
  trace.log.warn(
    { operation: trace.operation, attempts: 2, ...ids },
    'Refused after a second deadlock',
  );
  throw refusal();
}
