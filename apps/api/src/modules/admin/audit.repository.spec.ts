// T021 — the audit writer renders the target label itself, before the insert, and refuses an
// empty, unknown or over-long one so the action rolls back (FR-180, ADR 0021 D2, research R-108).
//
// The repository is run over a transaction whose `audit_logs` insert is recorded, never sent: what
// is under test is what the writer puts in the row and when it refuses, not Postgres (the column's
// NOT NULL and check are probed in tests/db-integrity/phase1-rules.spec.ts, rule 29).
//
// 005:T007 of B46 (Q-C4 (a)): `latestStandingReasonOf` reads the newest entry targeting the user
// among the standing actions, another user's entries and other actions left out (on
// ijazah_integrity, rolled back). Moved here from `ijazah-requests.spec.ts`, since only admin's
// repository files may write `admin_users` and `audit_logs` (R-API-6; #146's CI).
import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';
import { closeDatabase, type Transaction } from '../../platform/db/prisma.repository.js';
import { openSpecDatabase, rolledBack } from './__fixtures__/admin.js';
import { AuditRepository, latestStandingReasonOf } from './audit.repository.js';
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

describe('latestStandingReasonOf over audit_logs (Q-C4 (a))', { tags: ['database'] }, () => {
  const database = openSpecDatabase();
  afterAll(() => closeDatabase(database));

  async function administrator(tx: Transaction): Promise<string> {
    const { id } = await tx.adminUser.create({
      data: {
        email: `probe-${randomUUID()}@example.invalid`,
        mfaSecretEncrypted: Buffer.from('probe'),
        displayName: 'Probe',
        isActive: true,
      },
      select: { id: true },
    });
    return id;
  }

  async function entry(
    tx: Transaction,
    adminId: string,
    action: string,
    targetType: string,
    targetId: string,
    reason: string | null,
  ): Promise<void> {
    await tx.auditLog.create({
      data: { adminId, action, targetType, targetId, targetLabel: `probe · ${targetId}`, reason },
    });
  }

  it('answers the newest standing entry on the user, with its action and reason', async () => {
    const teacher = randomUUID();
    const answer = await rolledBack(database, async (tx) => {
      const adminId = await administrator(tx);
      await entry(tx, adminId, 'teacher.suspend', 'user', teacher, 'أول');
      await entry(tx, adminId, 'teacher.reinstate', 'user', teacher, 'ثان');
      await entry(tx, adminId, 'user.viewed', 'user', teacher, null);
      await entry(tx, adminId, 'dispute.resolved', 'dispute', randomUUID(), 'حكم');
      await entry(tx, adminId, 'teacher.ban', 'user', randomUUID(), 'غيره');
      return latestStandingReasonOf(tx, teacher);
    });
    expect(answer).toEqual({ action: 'teacher.reinstate', reason: 'ثان' });
  });

  // 005:T015 of B47 (the owner's word of 2026-11-18): the fraud ban is a standing action, so the
  // teacher's standing reason reads it (`ijazahRequests.get`, T007).
  it('answers a fraud ban as the newest standing entry, with its reason', async () => {
    const teacher = randomUUID();
    const answer = await rolledBack(database, async (tx) => {
      const adminId = await administrator(tx);
      await entry(tx, adminId, 'teacher.suspend', 'user', teacher, 'أول');
      await entry(tx, adminId, 'gender.fraud_banned', 'user', teacher, 'تزوير');
      return latestStandingReasonOf(tx, teacher);
    });
    expect(answer).toEqual({ action: 'gender.fraud_banned', reason: 'تزوير' });
  });

  it('answers null for a user with no standing entry', async () => {
    const answer = await rolledBack(database, async (tx) =>
      latestStandingReasonOf(tx, randomUUID()),
    );
    expect(answer).toBeNull();
  });
});
