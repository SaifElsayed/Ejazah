// 005:T007 of B46 — the admin module's composition of `ijazahRequests` (FR-628; Q10 (a), Q-C4 (a),
// the owner's word and the review's ruling of 2026-11-17).
//
// - `get` answers the teacher's standing with the reason of the newest standing entry of the audit
//   log on the teacher, and ONLY when that entry's action agrees with the status now: a suspension
//   with `suspended`, a ban (`teacher.ban`, `application.ban`) with `banned`, a revocation with
//   `revoked`, a reinstatement or a lift with `active`. Otherwise no reason, and one info line
//   `standing_reason_unmatched` of the ids, the status and the action, never the reason's text: a
//   standing set by a case ruling (`complaint.decided`, `dispute.resolved`, which target the
//   dispute, not the user) leaves an older entry newest, whose reason would be stale.
// - `latestStandingReasonOf` reads the newest entry targeting the user among the standing actions,
//   another user's entries and other actions left out (on ijazah_integrity, rolled back).
import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { closeDatabase, type Transaction } from '../../platform/db/prisma.repository.js';
import type { RequestDetail } from '../certification/index.js';
import { openSpecDatabase, rolledBack } from './__fixtures__/admin.js';
import { latestStandingReasonOf } from './audit.repository.js';
import {
  composeIjazahRequests,
  type IjazahRequestsComposition,
  type StandingEntry,
} from './index.js';

const ADMIN = '0199d0a0-0000-7000-8000-0000000000ad';
const TEACHER = '0199d0a0-0000-7000-8000-0000000000a2';
const REQUEST = '0199d0a0-0000-7000-8000-0000000000f1';
const TX = {} as Transaction;

function detailWith(status: RequestDetail['teacherStanding']['status']): RequestDetail {
  return {
    requestId: REQUEST,
    enrollmentId: '0199d0a0-0000-7000-8000-0000000000e1',
    teacher: { userId: TEACHER, displayName: 'عمر' },
    student: { userId: '0199d0a0-0000-7000-8000-0000000000a1', displayName: 'مريم' },
    subject: { id: '0199d0a0-0000-7000-8000-0000000000c1', nameAr: 'ق', nameEn: 'Q' },
    status: 'pending',
    sentAt: '2026-11-17T09:00:00.000Z',
    teacherStanding: { status },
    teacherUserId: TEACHER,
    completionDate: '2026-11-10',
    language: 'ar',
    chain: [['عمر بن فاروق']],
    teacherNamePrinted: 'عمر بن فاروق',
    studentName: 'مريم بنت أحمد',
    riwaya: 'حفص عن عاصم',
    tariq: null,
    signatureLink: null,
  };
}

function composed(status: RequestDetail['teacherStanding']['status'], entry: StandingEntry | null) {
  const lines: { fields: Record<string, unknown>; message: string }[] = [];
  const read: string[] = [];
  const unused = () => Promise.reject(new Error('not reached'));
  const services = composeIjazahRequests({
    decisions: {
      list: unused,
      approve: unused,
      reject: unused,
      detail: async () => detailWith(status),
    },
    standingReasonOf: async (_tx, userId) => {
      read.push(userId);
      return entry;
    },
    log: {
      info: (fields: Record<string, unknown>, message: string) => {
        lines.push({ fields: { ...fields }, message });
      },
      warn: () => undefined,
    } as unknown as IjazahRequestsComposition['log'],
  });
  return { services, lines, read };
}

describe("ijazahRequests.get's standing reason (FR-628, Q-C4 (a))", () => {
  it.each([
    ['teacher.suspend', 'suspended'],
    ['teacher.ban', 'banned'],
    ['application.ban', 'banned'],
    ['teacher.revoke', 'revoked'],
    ['teacher.reinstate', 'active'],
    ['teacher.ban_lifted', 'active'],
    ['teacher.revocation_lifted', 'active'],
    // The review's ruling (2026-11-17): a reinstatement lands on `verification_required` while an
    // identity request is open (identity's standing.service.ts:9), and `user.require_identity` sets it.
    ['user.require_identity', 'verification_required'],
    ['teacher.reinstate', 'verification_required'],
  ] as const)('answers the reason of %s while the teacher is %s', async (action, status) => {
    const { services, lines, read } = composed(status, { action, reason: 'سبب القيد' });
    const answer = await services.get(TX, ADMIN, { requestId: REQUEST });
    expect(answer.teacherStanding).toEqual({ status, reason: 'سبب القيد' });
    expect(answer).not.toHaveProperty('teacherUserId');
    expect(read).toEqual([TEACHER]);
    expect(lines).toEqual([]);
  });

  it('answers no stale reinstate reason for a suspended teacher, logged unmatched without its text', async () => {
    const { services, lines } = composed('suspended', {
      action: 'teacher.reinstate',
      reason: 'أعيد بعد المراجعة',
    });
    const answer = await services.get(TX, ADMIN, { requestId: REQUEST });
    expect(answer.teacherStanding).toEqual({ status: 'suspended' });
    expect(lines).toEqual([
      {
        fields: {
          teacherUserId: TEACHER,
          requestId: REQUEST,
          status: 'suspended',
          action: 'teacher.reinstate',
          reason: 'standing_reason_unmatched',
        },
        message: "A teacher's standing reason was not shown",
      },
    ]);
    expect(JSON.stringify(lines)).not.toContain('أعيد');
  });

  it('answers a suspension by a case ruling with its status and no reason (the ruling targets the dispute)', async () => {
    // The newest user-targeted entry is the lift before the case's suspension.
    const { services, lines } = composed('suspended', {
      action: 'teacher.ban_lifted',
      reason: 'رفع الحظر',
    });
    const answer = await services.get(TX, ADMIN, { requestId: REQUEST });
    expect(answer.teacherStanding).toEqual({ status: 'suspended' });
    expect(lines[0]?.fields).toMatchObject({ reason: 'standing_reason_unmatched' });
  });

  it('answers no reason and logs nothing for an active teacher with no standing entry', async () => {
    const { services, lines } = composed('active', null);
    expect((await services.get(TX, ADMIN, { requestId: REQUEST })).teacherStanding).toEqual({
      status: 'active',
    });
    expect(lines).toEqual([]);
  });

  it('logs unmatched for a teacher not active whose standing has no entry', async () => {
    const { services, lines } = composed('banned', null);
    expect((await services.get(TX, ADMIN, { requestId: REQUEST })).teacherStanding).toEqual({
      status: 'banned',
    });
    expect(lines[0]?.fields).toEqual({
      teacherUserId: TEACHER,
      requestId: REQUEST,
      status: 'banned',
      action: null,
      reason: 'standing_reason_unmatched',
    });
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

  it('answers null for a user with no standing entry', async () => {
    const answer = await rolledBack(database, async (tx) =>
      latestStandingReasonOf(tx, randomUUID()),
    );
    expect(answer).toBeNull();
  });
});
