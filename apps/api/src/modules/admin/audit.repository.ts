// T108: the admin module's implementation of the kernel's `AuditWriter` over `audit_logs` (FR-049,
// R-API-6, R-API-12). It only inserts: the table is append-only, and the application role holds no
// UPDATE, DELETE or TRUNCATE on it (T065, T147).
//
// The insert runs on the transaction it is handed, the action's own, never on the process's client,
// so it commits or rolls back with the action. `occurred_at` and `created_at` take the database's
// default, the transaction's own time.
import type { AuditRecord, AuditWriter } from '../../platform/audit/audit-writer.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';

export class AuditRepository implements AuditWriter {
  async write(tx: Transaction, record: AuditRecord): Promise<void> {
    await tx.auditLog.create({
      data: {
        adminId: record.adminId,
        action: record.action,
        targetType: record.targetType,
        targetId: record.targetId,
        reason: record.reason ?? null,
        // An absent snapshot is SQL NULL: the field is left out rather than sent as JSON null.
        ...(record.before === undefined ? {} : { before: record.before }),
        ...(record.after === undefined ? {} : { after: record.after }),
      },
    });
  }
}
