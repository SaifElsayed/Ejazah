// T108: the admin module's implementation of the kernel's `AuditWriter` over `audit_logs` (FR-049,
// R-API-6, R-API-12). It only inserts: the table is append-only, and the application role holds no
// UPDATE, DELETE or TRUNCATE on it (T065, T147).
//
// The insert runs on the transaction it is handed, the action's own, never on the process's client,
// so it commits or rolls back with the action. `occurred_at` and `created_at` take the database's
// default, the transaction's own time.
//
// The target label is rendered here, once, from the record's type and id (T021, FR-180, ADR 0021
// D2): `targetLabel` throws for an empty, unknown or over-long result before the insert, and the
// administrator caller kind rolls the action back with it. The column is NOT NULL and checked to
// 200 characters (ERD §15 rule 29), so a row without a sound label cannot exist either way.
import type { AuditRecord, AuditWriter } from '../../platform/audit/audit-writer.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { targetLabel } from './labels/target-label.js';

export class AuditRepository implements AuditWriter {
  async write(tx: Transaction, record: AuditRecord): Promise<void> {
    // Rendered before the insert: a refusal here leaves the transaction with nothing to commit.
    const label = targetLabel(record.targetType, record.targetId);
    await tx.auditLog.create({
      data: {
        adminId: record.adminId,
        action: record.action,
        targetType: record.targetType,
        targetId: record.targetId,
        targetLabel: label,
        reason: record.reason ?? null,
        // An absent snapshot is SQL NULL: the field is left out rather than sent as JSON null.
        ...(record.before === undefined ? {} : { before: record.before }),
        ...(record.after === undefined ? {} : { after: record.after }),
      },
    });
  }
}
