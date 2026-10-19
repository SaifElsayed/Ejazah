// T021 — the audit writer renders the target label itself, before the insert, and refuses an
// empty, unknown or over-long one so the action rolls back (FR-180, ADR 0021 D2, research R-108).
//
// The repository is run over a transaction whose `audit_logs` insert is recorded, never sent: what
// is under test is what the writer puts in the row and when it refuses, not Postgres (the column's
// NOT NULL and check are probed in tests/db-integrity/phase1-rules.spec.ts, rule 29).
import { describe, expect, it } from 'vitest';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { AuditRepository } from './audit.repository.js';
import { TargetLabelError } from './labels/target-label.js';

const ADMIN = '0199d0a0-0000-7000-8000-000000000001';
const TARGET = '0199d0a0-0000-7000-8000-000000000007';

function transaction() {
  const inserts: Array<Record<string, unknown>> = [];
  const tx = {
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        inserts.push(data);
        return { id: 'entry-1' };
      },
    },
  } as unknown as Transaction;
  return { tx, inserts };
}

const writer = new AuditRepository();

describe('the audit writer and the target label (T021, FR-180)', () => {
  it('writes the label it rendered from the type and the id, beside the record', async () => {
    const { tx, inserts } = transaction();
    await writer.write(tx, {
      adminId: ADMIN,
      action: 'admin.disable',
      targetType: 'admin',
      targetId: TARGET,
      reason: 'left the team',
    });
    expect(inserts).toEqual([
      {
        adminId: ADMIN,
        action: 'admin.disable',
        targetType: 'admin',
        targetId: TARGET,
        targetLabel: `مشرف · ${TARGET}`,
        reason: 'left the team',
      },
    ]);
  });

  it('refuses an empty identifier, an unknown type and an over-long label before any insert', async () => {
    const { tx, inserts } = transaction();
    const base = { adminId: ADMIN, action: 'admin.disable' };
    await expect(
      writer.write(tx, { ...base, targetType: 'admin', targetId: '' }),
    ).rejects.toBeInstanceOf(TargetLabelError);
    await expect(
      writer.write(tx, { ...base, targetType: 'teacher_profile', targetId: TARGET }),
    ).rejects.toBeInstanceOf(TargetLabelError);
    await expect(
      writer.write(tx, { ...base, targetType: 'setting', targetId: 'k'.repeat(200) }),
    ).rejects.toBeInstanceOf(TargetLabelError);
    expect(inserts).toEqual([]);
  });
});
