// T060 of specs/004-sessions/tasks.md — `cases.decideComplaint`'s rules over a recorded store (FR-453,
// FR-495; research R-322, «The decision»; contracts/admin-surface.md, `cases.decideComplaint`;
// contracts/kernel.md, the rows «a complaint decided (a)», «(b)» and «(c)»). What the database holds
// is `tests/db-integrity/absence-complaint.spec.ts`'.
//
// Each decision's locks in its row's order and the complaint read again under them (rule 1): (a)
// the enrollment `terminated_no_show`, its remaining sessions cancelled and its open remedies
// handed to the new `absence_termination` case through T004's hand-off, the complaint `resolved`
// `enrollment_ended`; (b) `party_*`'s locks through `lockForStanding` (no session), then
// `StandingService.suspend`, the complaint `resolved` `party_suspended`; (c) the enrollment, then the
// complaint `dismissed`. One `complaint_decided` event each and one info line of ids and the
// decision. Refusals, each writing nothing, in one line marked «logged»: anything but an open
// complaint NOT_FOUND (also when closed under the lock); (a) on an enrollment not `confirmed`
// CONFLICT `enrollment_not_confirmed`; (b) the standing's own refusal. T066: (a) sends `enrollment`
// to both parties through the administrator kind's list bound to the call's transaction, once it
// commits; (b) sends nothing of its own (the standing's subscriber does), (c) nothing.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { isRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { LiveMessage } from '../../platform/live/live-bus.js';
import { bindToTransaction, RequestLive } from '../../platform/live/live-publisher.js';
import type { CaseRecord } from '../moderation/index.js';
import {
  type ComplaintDecisionStore,
  createComplaintDecision,
} from './complaint-decision.service.js';
import type { EnrollmentStatus, EnrollmentTerms } from './enrollment-side.port.js';

const ADMIN = '0199d0a0-0000-7000-8000-00000000a001';
const STUDENT = '0199d0a0-0000-7000-8000-00000000a002';
const TEACHER = '0199d0a0-0000-7000-8000-00000000a003';
const COMPLAINT = '0199d0a0-0000-7000-8000-00000000a0c1';
const NEW_CASE = '0199d0a0-0000-7000-8000-00000000a0c2';
const ENROLLMENT = '0199d0a0-0000-7000-8000-00000000a0e5';
const OTHER_ENROLLMENT = '0199d0a0-0000-7000-8000-00000000a0e1';
const HELD_ENROLLMENT = '0199d0a0-0000-7000-8000-00000000a0e9';
const SESSION = '0199d0a0-0000-7000-8000-00000000a051';
const REMEDY = '0199d0a0-0000-7000-8000-00000000a0r1';
const AT = new Date('2026-11-11T09:00:00Z');
const NOTE = 'ثبت غياب المعلم من سجل الحضور';

function record(overrides: Partial<CaseRecord> = {}): CaseRecord {
  return {
    caseId: COMPLAINT,
    kind: 'absence_complaint',
    enrollmentId: ENROLLMENT,
    reason: 'غاب المعلم',
    status: 'open',
    resolution: null,
    resolutionNotes: null,
    createdAt: new Date('2026-11-10T09:00:00Z'),
    resolvedAt: null,
    ...overrides,
  };
}

function terms(status: EnrollmentStatus): EnrollmentTerms {
  return {
    id: ENROLLMENT,
    status,
    slotId: '0199d0a0-0000-7000-8000-00000000a0s1',
    track: 'recitation',
    timezone: 'Africa/Cairo',
    durationMinutes: 60,
    sessionCount: 4,
    studentUserId: STUDENT,
    teacherUserId: TEACHER,
  };
}

interface Given {
  /** The complaint as the first and the second read answer it. */
  readonly records?: readonly (CaseRecord | null)[];
  /** The enrollment's status as each read answers it. */
  readonly statuses?: readonly EnrollmentStatus[];
  readonly suspendFails?: DomainError;
}

function world(given: Given = {}) {
  const calls: unknown[][] = [];
  const lines: Record<string, unknown>[] = [];
  const records = [...(given.records ?? [record(), record()])];
  const statuses = [...(given.statuses ?? ['confirmed', 'terminated_no_show'])];
  const store: ComplaintDecisionStore = {
    caseRecordOf: async (_tx, caseId) => {
      calls.push(['caseRecordOf', caseId]);
      return records.shift() ?? null;
    },
    lockAccount: async (_tx, userId) => void calls.push(['lockAccount', userId]),
    lockApplication: async (_tx, userId) => void calls.push(['lockApplication', userId]),
    lockTeacherSlots: async (_tx, userId) => void calls.push(['lockTeacherSlots', userId]),
    scheduledSessionsOf: async (_tx, ids) => {
      calls.push(['scheduledSessionsOf', ids]);
      return [{ id: SESSION, enrollmentId: OTHER_ENROLLMENT }];
    },
    openRemediesOf: async (_tx, ids) => {
      calls.push(['openRemediesOf', ids]);
      return [{ id: REMEDY, sessionId: SESSION, enrollmentId: OTHER_ENROLLMENT }];
    },
    lockRows: async (_tx, table, ids) => void calls.push(['lockRows', table, ids]),
    openTerminationCase: async (_tx, enrollmentId) => {
      calls.push(['openTerminationCase', enrollmentId]);
      return { caseId: NEW_CASE, opened: true };
    },
    cancelRemaining: async (_tx, enrollmentIds, now, caseOf) => {
      calls.push(['cancelRemaining', enrollmentIds, now]);
      const caseId = await caseOf(ENROLLMENT);
      return {
        cancelledSessionIds: [SESSION],
        handedRemedyIds: [REMEDY],
        lapsedRemedyIds: [],
        caseOf: new Map([[ENROLLMENT, caseId]]),
      };
    },
    closeCase: async (_tx, caseId, closing) => {
      calls.push(['closeCase', caseId, closing]);
      return AT;
    },
    recordEvents: async (_tx, events) => void calls.push(['recordEvents', events]),
  };
  const decisions = createComplaintDecision({
    enrollments: {
      enrollmentFor: async (_tx, id) => {
        calls.push(['enrollmentFor', id]);
        return terms(statuses.shift() ?? 'confirmed');
      },
      lockEnrollments: async (_tx, ids) => void calls.push(['lockEnrollments', ids]),
      terminateNoShow: async (_tx, id) => {
        calls.push(['terminateNoShow', id]);
        return true;
      },
      enrollmentPage: async (_tx, filter) => {
        calls.push(['enrollmentPage', filter]);
        return {
          items: [
            {
              enrollmentId: OTHER_ENROLLMENT,
              studentUserId: STUDENT,
              teacherUserId: TEACHER,
              status: 'confirmed',
              track: 'recitation',
              sessionCount: 4,
            },
          ],
        };
      },
    },
    standing: {
      suspend: async (_tx, adminId, userId) => {
        calls.push(['suspend', adminId, userId]);
        if (given.suspendFails !== undefined) throw given.suspendFails;
        return { before: { accountStatus: 'active' }, after: { accountStatus: 'suspended' } };
      },
    },
    lockActiveHolds: async (_tx, userId) => {
      calls.push(['lockActiveHolds', userId]);
      return { holdIds: ['h'], enrollmentIds: [HELD_ENROLLMENT] };
    },
    log: {
      info: ((fields: object, msg: string) => void lines.push({ ...fields, msg })) as never,
    },
    clock: async () => {
      calls.push(['clock']);
      return AT;
    },
    store,
  });
  const decide = (
    decision: 'end_enrollment' | 'suspend_teacher' | 'close',
    tx: Transaction = {} as Transaction,
  ) => decisions.decideComplaint(tx, ADMIN, { caseId: COMPLAINT, decision, note: NOTE });
  const writes = () =>
    calls.filter(([name]) =>
      [
        'terminateNoShow',
        'cancelRemaining',
        'openTerminationCase',
        'suspend',
        'closeCase',
        'recordEvents',
      ].includes(String(name)),
    );
  return { calls, lines, decide, writes };
}

const decided = (decision: string) => [
  'recordEvents',
  [
    {
      enrollmentId: ENROLLMENT,
      sessionId: null,
      kind: 'complaint_decided',
      caseId: COMPLAINT,
      occurredAt: AT,
    },
  ],
  decision,
];

async function refusalOf(attempt: Promise<unknown>) {
  const thrown: unknown = await attempt.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof DomainError)) throw new Error(`expected a refusal, got ${String(thrown)}`);
  return { code: thrown.code, details: thrown.details, logged: isRefusalLogged(thrown) };
}

describe('cases.decideComplaint (a) end_enrollment', () => {
  it('locks the enrollment, reads the complaint again, ends the enrollment, cancels its sessions into the new absence_termination case and resolves the complaint enrollment_ended', async () => {
    const one = world();
    expect(await one.decide('end_enrollment')).toEqual({
      caseId: COMPLAINT,
      status: 'resolved',
      enrollmentStatus: 'terminated_no_show',
      newCaseId: NEW_CASE,
    });
    const [event] = decided('end_enrollment');
    expect(one.calls).toEqual([
      ['caseRecordOf', COMPLAINT],
      ['lockEnrollments', [ENROLLMENT]],
      ['caseRecordOf', COMPLAINT],
      ['enrollmentFor', ENROLLMENT],
      ['terminateNoShow', ENROLLMENT],
      ['clock'],
      ['cancelRemaining', [ENROLLMENT], AT],
      ['openTerminationCase', ENROLLMENT],
      [
        'closeCase',
        COMPLAINT,
        { status: 'resolved', resolution: 'enrollment_ended', note: NOTE, adminId: ADMIN },
      ],
      [event, decided('')[1]],
      ['enrollmentFor', ENROLLMENT],
    ]);
    expect(one.lines).toEqual([
      {
        adminId: ADMIN,
        caseId: COMPLAINT,
        enrollmentId: ENROLLMENT,
        decision: 'end_enrollment',
        newCaseId: NEW_CASE,
        msg: 'A complaint of the teacher’s absence was decided',
      },
    ]);
  });

  it.each(['pending_payment', 'completed', 'terminated_no_show', 'cancelled'] as const)(
    'refuses a %s enrollment CONFLICT enrollment_not_confirmed, read under the lock, writing nothing',
    async (status) => {
      const one = world({ statuses: [status] });
      expect(await refusalOf(one.decide('end_enrollment'))).toEqual({
        code: 'CONFLICT',
        details: [{ path: 'cause', code: 'enrollment_not_confirmed' }],
        logged: true,
      });
      expect(one.writes()).toEqual([]);
      expect(one.lines).toEqual([
        {
          adminId: ADMIN,
          caseId: COMPLAINT,
          enrollmentId: ENROLLMENT,
          errorCode: 'CONFLICT',
          cause: 'enrollment_not_confirmed',
          msg: 'A complaint decision was refused',
        },
      ]);
    },
  );
});

describe('cases.decideComplaint (b) suspend_teacher', () => {
  it('takes the party_* locks for the teacher with no session, then suspends the teacher and resolves the complaint party_suspended', async () => {
    const one = world({ statuses: ['confirmed', 'confirmed', 'cancelled'] });
    expect(await one.decide('suspend_teacher')).toEqual({
      caseId: COMPLAINT,
      status: 'resolved',
      enrollmentStatus: 'cancelled',
    });
    expect(one.calls).toEqual([
      ['caseRecordOf', COMPLAINT],
      ['enrollmentFor', ENROLLMENT],
      ['lockAccount', TEACHER],
      ['enrollmentPage', { status: 'confirmed', teacherUserIds: [TEACHER] }],
      ['lockTeacherSlots', TEACHER],
      ['lockActiveHolds', TEACHER],
      ['lockEnrollments', [OTHER_ENROLLMENT, ENROLLMENT, HELD_ENROLLMENT]],
      ['scheduledSessionsOf', [OTHER_ENROLLMENT]],
      ['lockRows', 'sessions', [SESSION]],
      ['openRemediesOf', [OTHER_ENROLLMENT]],
      ['lockRows', 'session_remedies', [REMEDY]],
      ['caseRecordOf', COMPLAINT],
      ['enrollmentFor', ENROLLMENT],
      ['suspend', ADMIN, TEACHER],
      [
        'closeCase',
        COMPLAINT,
        { status: 'resolved', resolution: 'party_suspended', note: NOTE, adminId: ADMIN },
      ],
      ['clock'],
      decided('').slice(0, 2),
      ['enrollmentFor', ENROLLMENT],
    ]);
    expect(one.lines.map(({ decision }) => decision)).toEqual(['suspend_teacher']);
  });

  it('suspends the teacher of an enrollment that ended another way', async () => {
    const one = world({ statuses: ['cancelled', 'cancelled', 'cancelled'] });
    expect((await one.decide('suspend_teacher')).status).toBe('resolved');
  });

  it('refuses with the standing’s own refusal, in one line, closing nothing', async () => {
    const one = world({ suspendFails: new DomainError('CONFLICT') });
    expect((await refusalOf(one.decide('suspend_teacher'))).code).toBe('CONFLICT');
    expect(one.writes()).toEqual([['suspend', ADMIN, TEACHER]]);
    expect(one.lines).toEqual([
      {
        adminId: ADMIN,
        caseId: COMPLAINT,
        enrollmentId: ENROLLMENT,
        errorCode: 'CONFLICT',
        cause: 'standing_refused',
        msg: 'A complaint decision was refused',
      },
    ]);
  });
});

describe('cases.decideComplaint (c) close', () => {
  it('locks the enrollment, reads the complaint again and dismisses it with the note, nothing else', async () => {
    const one = world({ statuses: ['confirmed', 'confirmed'] });
    expect(await one.decide('close')).toEqual({
      caseId: COMPLAINT,
      status: 'dismissed',
      enrollmentStatus: 'confirmed',
    });
    expect(one.calls).toEqual([
      ['caseRecordOf', COMPLAINT],
      ['lockEnrollments', [ENROLLMENT]],
      ['caseRecordOf', COMPLAINT],
      ['enrollmentFor', ENROLLMENT],
      [
        'closeCase',
        COMPLAINT,
        { status: 'dismissed', resolution: null, note: NOTE, adminId: ADMIN },
      ],
      ['clock'],
      decided('').slice(0, 2),
      ['enrollmentFor', ENROLLMENT],
    ]);
  });
});

describe('cases.decideComplaint refusals', () => {
  it.each([
    ['no such case', [null]],
    ['a compensation case', [record({ kind: 'compensation_case' })]],
    ['a session dispute', [record({ kind: 'session_dispute' })]],
    ['a closed complaint', [record({ status: 'dismissed' })]],
  ] as const)('answers %s NOT_FOUND before any lock, writing nothing', async (_name, records) => {
    for (const decision of ['end_enrollment', 'suspend_teacher', 'close'] as const) {
      const one = world({ records });
      expect(await refusalOf(one.decide(decision))).toEqual({
        code: 'NOT_FOUND',
        details: undefined,
        logged: true,
      });
      expect(one.calls).toEqual([['caseRecordOf', COMPLAINT]]);
      expect(one.lines).toEqual([
        {
          adminId: ADMIN,
          caseId: COMPLAINT,
          errorCode: 'NOT_FOUND',
          cause: 'not_found',
          msg: 'A complaint decision was refused',
        },
      ]);
    }
  });

  it('answers a complaint closed while the lock was awaited NOT_FOUND, writing nothing', async () => {
    for (const decision of ['end_enrollment', 'suspend_teacher', 'close'] as const) {
      const one = world({ records: [record(), record({ status: 'resolved' })] });
      expect((await refusalOf(one.decide(decision))).code).toBe('NOT_FOUND');
      expect(one.writes()).toEqual([]);
    }
  });
});

/**
 * The administrator kind's after-commit point as `procedures.ts` runs it: the request's list bound to
 * the call's transaction while it runs, flushed once it has committed, dropped on a rollback.
 */
async function asAdministratorKind(
  work: (tx: Transaction) => Promise<unknown>,
  commitFails = false,
): Promise<LiveMessage[]> {
  const published: LiveMessage[] = [];
  const live = new RequestLive(
    { publish: (message) => void published.push(message) },
    { warn: () => undefined },
  );
  const tx = {} as Transaction;
  const unbind = bindToTransaction(tx, live);
  try {
    await work(tx);
    if (commitFails) throw new Error('the audit write failed');
    live.flush();
  } catch {
    live.drop();
  } finally {
    unbind();
  }
  return published;
}

describe('cases.decideComplaint: the live event (T066)', () => {
  it('(a) sends enrollment to both parties once, after the commit', async () => {
    const { decide } = world();
    expect(await asAdministratorKind((tx) => decide('end_enrollment', tx))).toEqual([
      { to: [STUDENT, TEACHER], event: { type: 'enrollment', enrollmentId: ENROLLMENT } },
    ]);
  });

  it('(a) sends nothing when the enrollment is not confirmed (CONFLICT) or the call rolls back', async () => {
    const refused = world({ statuses: ['completed'] });
    expect(await asAdministratorKind((tx) => refused.decide('end_enrollment', tx))).toEqual([]);
    const rolledBack = world();
    expect(
      await asAdministratorKind((tx) => rolledBack.decide('end_enrollment', tx), true),
    ).toEqual([]);
  });

  it('(b) and (c) add nothing of their own', async () => {
    expect(await asAdministratorKind((tx) => world().decide('suspend_teacher', tx))).toEqual([]);
    expect(await asAdministratorKind((tx) => world().decide('close', tx))).toEqual([]);
  });

  it('a complaint closed meanwhile (NOT_FOUND) sends nothing', async () => {
    const { decide } = world({ records: [record(), record({ status: 'resolved' })] });
    expect(await asAdministratorKind((tx) => decide('end_enrollment', tx))).toEqual([]);
  });
});
