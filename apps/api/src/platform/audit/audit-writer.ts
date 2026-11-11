// T108: how the administrator caller kind writes the audit record of every administrative action
// (FR-049, R-API-12, R-API-4, R-API-6; contracts/kernel.md "Caller kinds", ERD §12 `audit_logs`).
//
// `audit_logs` is the admin module's table, and the kernel may not import `modules/admin` (R-API-4),
// so the kernel declares only this contract: the admin module implements it over its table
// (`modules/admin/audit.repository.ts`), and `main.ts` binds that implementation. There is no empty
// or default writer, and the process refuses to start without one (`requireAuditWriter`), so no
// administrative route exists around it.
//
// THE WRITE JOINS THE ACTION'S TRANSACTION. The caller kind opens one transaction per call, hands it
// to the handler, and writes the records the handler described through this writer on that same
// transaction before it commits, so the action's writes and its audit rows commit or roll back
// together (OWASP Logging Cheat Sheet: the application is the source of the event; the same
// transaction is what makes "no action without its record" hold when both live in one database).
//
// The handler DESCRIBES, the caller kind WRITES: only the handler knows what it touched, so it
// records the action, target, reason and snapshots on `ctx.audit`; the actor is taken from the
// server-held administrator session, never from the handler or the input. A call that described no
// record is refused and rolled back, unless the handler marked it the replay of a keyed call
// (`replayed()`, B39, the note under T059), whose first call's entry is the record.
//
// Snapshots go to the database as written: a handler puts no secret in `before` or `after`
// (R-SEC-2), as it would log none.
//
// THE TARGET LABEL IS THE WRITER'S (T021, FR-180, ADR 0021 D2): the admin module's implementation
// renders `target_label` itself from `targetType` and `targetId` (`modules/admin/labels/`) and
// refuses an empty or over-long one by throwing before the insert, so the kind rolls the action
// back. `AuditEntry` cannot carry a label: the field is typed `never`, so a handler that tries to
// pass one does not compile, and the invariant "never a name, never typed text" holds by
// construction rather than by review.
import type { Transaction } from '../db/prisma.repository.js';

/** A JSON value, as a snapshot column stores it. */
export type AuditJson =
  string | number | boolean | null | readonly AuditJson[] | { readonly [key: string]: AuditJson };

/** A state snapshot: the fields of the target the action changed, before or after it. */
export type AuditSnapshot = { readonly [key: string]: AuditJson };

/** What a handler records about one thing its action touched (ERD §12 `audit_logs`). */
export interface AuditEntry {
  /** A stable machine string naming the action, such as `teacher.approve`. */
  readonly action: string;
  /** What kind of row was touched; with `targetId`, a polymorphic reference. */
  readonly targetType: string;
  /** The touched row's identifier: a UUID, or a settings key, since settings are keyed by text (T172). */
  readonly targetId: string;
  /** Why; mandatory for a destructive action, which each action's task enforces. */
  readonly reason?: string;
  readonly before?: AuditSnapshot;
  readonly after?: AuditSnapshot;
  /** Never set by a handler: the writer renders the label from the type and the id (T021). */
  readonly targetLabel?: never;
}

/** One audit row: an entry and the administrator who acted, from the session. */
export interface AuditRecord extends AuditEntry {
  readonly adminId: string;
}

/** Where a handler records what its action did; the caller kind writes it before committing. */
export interface AuditTrail {
  record(entry: AuditEntry): void;
  /**
   * Marks the call a replay of a keyed call answered from its idempotency key's row (B39, the note
   * under T059): the kind then admits it with no entry, the first call's entry being the record.
   */
  replayed(): void;
}

export interface AuditWriter {
  /** Inserts `record` inside `tx`, the action's own transaction. */
  write(tx: Transaction, record: AuditRecord): Promise<void>;
}

export class AuditWriterUnboundError extends Error {
  constructor() {
    super('No AuditWriter is bound; refusing to start (FR-049, R-API-12)');
    this.name = 'AuditWriterUnboundError';
  }
}

/** The bound writer, or the refusal that stops the process before it serves anything. */
export function requireAuditWriter(writer: AuditWriter | undefined): AuditWriter {
  if (writer === undefined) throw new AuditWriterUnboundError();
  return writer;
}
