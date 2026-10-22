// T108: the admin module's implementation of the kernel's `AuditWriter` over `audit_logs` (FR-049,
// R-API-6, R-API-12). It only inserts and reads: the table is append-only, and the application role
// holds no UPDATE, DELETE or TRUNCATE on it (T065, T147).
//
// The insert runs on the transaction it is handed, the action's own, never on the process's client,
// so it commits or rolls back with the action. `occurred_at` and `created_at` take the database's
// default, the transaction's own time.
//
// The target label is rendered here, once, from the record's type and id (T021, FR-180, ADR 0021
// D2): `targetLabel` throws for an empty, unknown or over-long result before the insert, and the
// administrator caller kind rolls the action back with it. The column is NOT NULL and checked to
// 200 characters (ERD §15 rule 29), so a row without a sound label cannot exist either way.
import type { Prisma } from '@prisma/client';

import type { AuditRecord, AuditWriter } from '../../platform/audit/audit-writer.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { targetLabel } from './labels/target-label.js';
import { likeLiteral } from '../../platform/db/like-literal.js';

/** What the admin pages filter the log by (T065); every bound optional. */
export interface AuditFilter {
  readonly search?: string;
  readonly targetType?: string;
  readonly targetId?: string;
  /** The first instant admitted. */
  readonly from?: Date;
  /** The first instant no longer admitted. */
  readonly until?: Date;
}

/** The suffix of a read's action: audited, never listed (owner's decision 2026-10-21, T065). */
export const READ_ACTION_SUFFIX = '.read';

function whereOf(filter: AuditFilter): Prisma.AuditLogWhereInput {
  const search = filter.search === undefined ? undefined : likeLiteral(filter.search);
  const occurredAt = {
    ...(filter.from === undefined ? {} : { gte: filter.from }),
    ...(filter.until === undefined ? {} : { lt: filter.until }),
  };
  return {
    NOT: { action: { endsWith: READ_ACTION_SUFFIX } },
    ...(filter.targetType === undefined ? {} : { targetType: filter.targetType }),
    ...(filter.targetId === undefined ? {} : { targetId: filter.targetId }),
    ...(Object.keys(occurredAt).length === 0 ? {} : { occurredAt }),
    ...(search === undefined
      ? {}
      : {
          OR: [
            { targetLabel: { contains: search, mode: 'insensitive' } },
            { reason: { contains: search, mode: 'insensitive' } },
          ],
        }),
  };
}

/** One entry as the pages read it, with the acting administrator's name. */
export interface AuditEntryRow {
  readonly id: string;
  readonly occurredAt: Date;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly targetLabel: string;
  readonly reason: string | null;
  readonly before: Prisma.JsonValue;
  readonly after: Prisma.JsonValue;
  readonly admin: { readonly displayName: string };
}

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

  /** One page of the entries `filter` admits, newest first, reads left out. */
  page(tx: Transaction, filter: AuditFilter, skip: number, take: number): Promise<AuditEntryRow[]> {
    return tx.auditLog.findMany({
      where: whereOf(filter),
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      skip,
      take,
      select: {
        id: true,
        occurredAt: true,
        action: true,
        targetType: true,
        targetId: true,
        targetLabel: true,
        reason: true,
        before: true,
        after: true,
        admin: { select: { displayName: true } },
      },
    });
  }

  /** How many entries `filter` admits, reads left out. */
  count(tx: Transaction, filter: AuditFilter): Promise<number> {
    return tx.auditLog.count({ where: whereOf(filter) });
  }

  /** One entry by its id, or null. */
  entry(tx: Transaction, id: string): Promise<AuditEntryRow | null> {
    return tx.auditLog.findUnique({
      where: { id },
      select: {
        id: true,
        occurredAt: true,
        action: true,
        targetType: true,
        targetId: true,
        targetLabel: true,
        reason: true,
        before: true,
        after: true,
        admin: { select: { displayName: true } },
      },
    });
  }
}
