// T036 of specs/004-sessions/tasks.md (FR-449, FR-462, FR-486; research R-312, R-313; plan.md
// decision 1; contracts/kernel.md, the row «a `student_suspended` case closed»; the three B39 notes
// under T036) — `createSuspensionCase` over a recorded store, `EnrollmentSide` and offer:
//
//   - cleared (`cases.resolve`): `users` (both, one call, from the sessions' own copies), the
//     teacher's `lockKey('teacher-slots')`, the enrollment, the sessions the suspension cancelled
//     (one call, id order), their remedies, then the case closed; refused `STUDENT_SUSPENDED` only
//     while the account is `suspended`, read under its lock (Q4 (b): `verification_required` and
//     `banned` pass); each session offered through T028's `offerLocked` with `clearedSuspension`, in
//     id order; a null offer refuses the whole call `CONFLICT` `no_free_week`, the case left open
//     (Q5 (a)); each offer's `offeredLine` written on the transaction, after the closing (F8);
//   - on an enrollment no longer `confirmed` (U2): nothing offered, the case closed, one line;
//   - the fault confirmed (`cases.dismiss`): the enrollment, then `EnrollmentSide.cancel(…, 'admin')`,
//     then `cancelRemainingSessions` whose `caseOf` opens the new `student_fault_confirmed` case,
//     the open and `frozen` remedies handed to it, then the dismissed case closed, one line; on an
//     enrollment no longer `confirmed` (U2): nothing cancelled, no case opened, the case closed;
//   - a case no longer open, read again under the locks, refused `CONFLICT` `not_open`, nothing
//     written; every refusal logged once with ids and its reason, marked «logged».
//
// Over the real tables, quickstart.md §6's two paths at the API included:
// `tests/db-integrity/suspension-case.spec.ts`.
//
// T066: the fault confirmed sends `enrollment` to both parties, read under the enrollment's lock,
// through the administrator kind's list bound to the call's transaction, once it commits; cleared,
// and a closing on an enrollment that ended another way, send nothing (no enrollment closed here).
import type { LocalDate } from '@ijazah/time';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { isRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { LiveMessage } from '../../platform/live/live-bus.js';
import {
  bindToTransaction,
  type LivePublisher,
  RequestLive,
} from '../../platform/live/live-publisher.js';
import type { CaseClosing, CaseRecord } from '../moderation/index.js';
import type { EnrollmentSide, EnrollmentStatus } from './enrollment-side.port.js';
import type { Offered, OfferOptions } from './remedy-offer.service.js';
import type { CaseOf, EnrollmentsEnded } from './remaining-sessions.service.js';
import { createSuspensionCase, type SuspensionCaseStore } from './suspension-case.service.js';

const tx = {} as Transaction;
const id = (n: number) => `0199d0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const ADMIN = id(1);
const CASE = id(500);
const FAULT_CASE = id(501);
const END_CASE = id(502);
const ENROLLMENT = id(800);
const STUDENT = id(902);
const TEACHER = id(901);
const NOW = new Date('2026-11-11T09:00:00Z');
const CLOSED_AT = new Date('2026-11-11T09:00:00.120Z');
const TARGET = { caseId: CASE, enrollmentId: ENROLLMENT };

interface World {
  readonly status?: EnrollmentStatus;
  readonly caseStatus?: CaseRecord['status'];
  readonly accountStatus?: string;
  readonly cancelledSessions?: readonly string[];
  /** The sessions whose offer answers null (no free week). */
  readonly noFreeWeek?: readonly string[];
  /** The case of the enrollment's end; null for an end that opened none. */
  readonly endCase?: string | null;
}

function suspensionOver(world: World = {}) {
  const calls: unknown[][] = [];
  const lines: [string, unknown][] = [];
  const record: CaseRecord = {
    caseId: CASE,
    kind: 'compensation_case',
    enrollmentId: ENROLLMENT,
    reason: 'student_suspended',
    status: world.caseStatus ?? 'open',
    resolution: null,
    resolutionNotes: null,
    createdAt: new Date('2026-11-01T10:00:00Z'),
    resolvedAt: null,
  };
  const store: SuspensionCaseStore = {
    partiesOf: async (_tx, enrollmentId) => {
      calls.push(['partiesOf', enrollmentId]);
      return { studentUserId: STUDENT, teacherUserId: TEACHER };
    },
    lockAccounts: async (_tx, ids) => void calls.push(['lockAccounts', ids]),
    lockTeacherSlots: async (_tx, teacher) => void calls.push(['lockTeacherSlots', teacher]),
    lockSessions: async (_tx, ids) => void calls.push(['lockSessions', ids]),
    lockRemediesOfSessions: async (_tx, ids) => void calls.push(['lockRemediesOfSessions', ids]),
    caseRecordOf: async () => {
      calls.push(['caseRecordOf']);
      return record;
    },
    accountStatusOf: async (_tx, userId) => {
      calls.push(['accountStatusOf', userId]);
      return world.accountStatus ?? 'active';
    },
    sessionsToOffer: async (_tx, caseId) => {
      calls.push(['sessionsToOffer', caseId]);
      return world.cancelledSessions ?? [id(12), id(11)];
    },
    closeCase: async (_tx, caseId, closing: CaseClosing) => {
      calls.push(['closeCase', caseId, closing]);
      return CLOSED_AT;
    },
    openFaultCase: async (_tx, enrollmentId) => {
      calls.push(['openFaultCase', enrollmentId]);
      return { caseId: FAULT_CASE, opened: true };
    },
    endCaseOf: async (_tx, enrollmentId, afterCaseId) => {
      calls.push(['endCaseOf', enrollmentId, afterCaseId]);
      return world.endCase === undefined ? END_CASE : world.endCase;
    },
    cancelRemaining: async (_tx, enrollmentIds, now, caseOf: CaseOf): Promise<EnrollmentsEnded> => {
      calls.push(['cancelRemaining', enrollmentIds, now]);
      const caseId = await caseOf(ENROLLMENT);
      return {
        cancelledSessionIds: [id(31)],
        handedRemedyIds: [id(41), id(42)],
        lapsedRemedyIds: [],
        caseOf: new Map([[ENROLLMENT, caseId]]),
      };
    },
  };
  const enrollments: Pick<EnrollmentSide, 'enrollmentFor' | 'lockEnrollments' | 'cancel'> = {
    enrollmentFor: async (_tx, enrollmentId) => {
      calls.push(['enrollmentFor', enrollmentId]);
      return {
        id: enrollmentId,
        status: world.status ?? 'confirmed',
        slotId: id(700),
        track: 'recitation',
        timezone: 'Africa/Cairo',
        durationMinutes: 60,
        sessionCount: 8,
        studentUserId: STUDENT,
        teacherUserId: TEACHER,
      };
    },
    lockEnrollments: async (_tx, ids) => void calls.push(['lockEnrollments', ids]),
    cancel: async (_tx, enrollmentId, reason) => {
      calls.push(['cancel', enrollmentId, reason]);
      return true;
    },
  };
  const offers = {
    offerLocked: async (
      _tx: Transaction,
      sessionId: string,
      options?: OfferOptions,
    ): Promise<Offered | null> => {
      calls.push(['offerLocked', sessionId, options]);
      if (world.noFreeWeek?.includes(sessionId)) return null;
      return {
        remedyId: `${sessionId.slice(0, -3)}9${sessionId.slice(-2)}`,
        sessionId,
        enrollmentId: ENROLLMENT,
        status: 'awaiting_choice',
        proposedDate: '2026-12-06' as LocalDate,
        reoffered: false,
      };
    },
  };
  const log = {
    info: (fields: unknown, message?: string) => {
      calls.push(['log', message]);
      lines.push([message ?? '', fields]);
    },
  };
  const service = createSuspensionCase({
    enrollments,
    offers,
    log,
    clock: async () => NOW,
    store,
  });
  return { service, calls, lines };
}

async function refusalOf(call: Promise<unknown>): Promise<DomainError> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof DomainError)) throw new Error('expected a DomainError');
  return thrown;
}

const RESOLVED: CaseClosing = {
  status: 'resolved',
  resolution: 'compensation_ordered',
  note: 'بُرّئ الطالب',
  adminId: ADMIN,
};
const DISMISSED: CaseClosing = { status: 'dismissed', resolution: null, note: 'ثبت الخطأ', adminId: ADMIN };

describe('cleared: cases.resolve on a student_suspended case (FR-486; R-313)', () => {
  it('takes the cleared row’s locks in order, offers each cancelled session in id order, then closes', async () => {
    const { service, calls } = suspensionOver();
    await service.clear(tx, ADMIN, TARGET, RESOLVED.note);
    const order = calls.filter(([name]) => name !== 'log');
    expect(order).toEqual([
      ['partiesOf', ENROLLMENT],
      ['lockAccounts', [TEACHER, STUDENT]],
      ['lockTeacherSlots', TEACHER],
      ['lockEnrollments', [ENROLLMENT]],
      ['caseRecordOf'],
      ['accountStatusOf', STUDENT],
      ['enrollmentFor', ENROLLMENT],
      ['sessionsToOffer', CASE],
      ['lockSessions', [id(11), id(12)]],
      ['lockRemediesOfSessions', [id(11), id(12)]],
      ['offerLocked', id(11), { clearedSuspension: true }],
      ['offerLocked', id(12), { clearedSuspension: true }],
      ['closeCase', CASE, RESOLVED],
    ]);
  });

  it('writes each offer’s line on the transaction, after the closing (F8)', async () => {
    const { service, calls, lines } = suspensionOver();
    await service.clear(tx, ADMIN, TARGET, RESOLVED.note);
    expect(calls.findIndex(([name]) => name === 'log')).toBeGreaterThan(
      calls.findIndex(([name]) => name === 'closeCase'),
    );
    expect(lines.map(([message, fields]) => [message, fields])).toEqual([
      [
        'Remedy offered',
        { remedyId: `${id(11).slice(0, -3)}911`, sessionId: id(11), enrollmentId: ENROLLMENT, action: 'offered' },
      ],
      [
        'Remedy offered',
        { remedyId: `${id(12).slice(0, -3)}912`, sessionId: id(12), enrollmentId: ENROLLMENT, action: 'offered' },
      ],
    ]);
  });

  it('refuses STUDENT_SUSPENDED while the account is suspended, read under its lock, closing nothing', async () => {
    const { service, calls, lines } = suspensionOver({ accountStatus: 'suspended' });
    const refusal = await refusalOf(service.clear(tx, ADMIN, TARGET, RESOLVED.note));
    expect(refusal.code).toBe('STUDENT_SUSPENDED');
    expect(isRefusalLogged(refusal)).toBe(true);
    expect(calls.findIndex(([name]) => name === 'accountStatusOf')).toBeGreaterThan(
      calls.findIndex(([name]) => name === 'lockAccounts'),
    );
    expect(calls.some(([name]) => name === 'offerLocked' || name === 'closeCase')).toBe(false);
    expect(lines).toEqual([
      [
        'A suspension case closing was refused',
        {
          adminId: ADMIN,
          caseId: CASE,
          enrollmentId: ENROLLMENT,
          errorCode: 'STUDENT_SUSPENDED',
          reason: 'student_suspended',
        },
      ],
    ]);
  });

  it.each(['verification_required', 'banned', 'active'])(
    'admits an account %s (Q4 (b))',
    async (accountStatus) => {
      const { service, calls } = suspensionOver({ accountStatus });
      await service.clear(tx, ADMIN, TARGET, RESOLVED.note);
      expect(calls.some(([name]) => name === 'closeCase')).toBe(true);
    },
  );

  it('refuses the whole resolve CONFLICT no_free_week when an offer finds no free week, closing nothing (Q5 (a))', async () => {
    const { service, calls, lines } = suspensionOver({ noFreeWeek: [id(12)] });
    const refusal = await refusalOf(service.clear(tx, ADMIN, TARGET, RESOLVED.note));
    expect(refusal.code).toBe('CONFLICT');
    expect(refusal.details).toEqual([{ path: 'cause', code: 'no_free_week' }]);
    expect(isRefusalLogged(refusal)).toBe(true);
    expect(calls.some(([name]) => name === 'closeCase')).toBe(false);
    expect(lines).toEqual([
      [
        'A suspension case closing was refused',
        {
          adminId: ADMIN,
          caseId: CASE,
          enrollmentId: ENROLLMENT,
          sessionId: id(12),
          errorCode: 'CONFLICT',
          reason: 'no_free_week',
        },
      ],
    ]);
  });

  it.each(['cancelled', 'terminated_no_show', 'completed'] as const)(
    'offers nothing on an enrollment %s meanwhile and closes the case naming the end’s case (U2; the note under T036)',
    async (status) => {
      const { service, calls, lines } = suspensionOver({ status });
      await service.clear(tx, ADMIN, TARGET, RESOLVED.note);
      expect(calls.some(([name]) => name === 'sessionsToOffer' || name === 'offerLocked')).toBe(false);
      expect(calls.filter(([name]) => name === 'endCaseOf' || name === 'closeCase')).toEqual([
        // Only an end case opened after the suspension case (PR #133's review, round 2, Minor).
        ['endCaseOf', ENROLLMENT, CASE],
        ['closeCase', CASE, { ...RESOLVED, coveredBy: END_CASE }],
      ]);
      expect(lines).toEqual([
        [
          'A suspension case closed on an enrollment that ended another way',
          {
            adminId: ADMIN,
            caseId: CASE,
            enrollmentId: ENROLLMENT,
            enrollmentStatus: status,
            closing: 'resolved',
            // PR #133's review, round 2, nit 4: the link written.
            coveredByCaseId: END_CASE,
          },
        ],
      ]);
    },
  );

  it('closes the case with no link on an enrollment whose end opened no case (a deletion)', async () => {
    const { service, calls } = suspensionOver({ status: 'cancelled', endCase: null });
    await service.clear(tx, ADMIN, TARGET, RESOLVED.note);
    expect(calls.filter(([name]) => name === 'closeCase')).toEqual([['closeCase', CASE, RESOLVED]]);
  });

  it('reads no end’s case on a confirmed enrollment, whose sessions it offers', async () => {
    const { service, calls } = suspensionOver();
    await service.clear(tx, ADMIN, TARGET, RESOLVED.note);
    expect(calls.some(([name]) => name === 'endCaseOf')).toBe(false);
  });

  it('refuses a case no longer open, read again under the locks, CONFLICT not_open, offering nothing', async () => {
    const { service, calls } = suspensionOver({ caseStatus: 'dismissed' });
    const refusal = await refusalOf(service.clear(tx, ADMIN, TARGET, RESOLVED.note));
    expect(refusal.code).toBe('CONFLICT');
    expect(refusal.details).toEqual([{ path: 'cause', code: 'not_open' }]);
    expect(calls.findIndex(([name]) => name === 'caseRecordOf')).toBeGreaterThan(
      calls.findIndex(([name]) => name === 'lockEnrollments'),
    );
    expect(calls.some(([name]) => name === 'offerLocked' || name === 'closeCase')).toBe(false);
  });
});

describe('the fault confirmed: cases.dismiss on a student_suspended case (R-313; C1, U1)', () => {
  it('locks the enrollment, cancels it admin, ends what remains into a new fault case, then closes the case dismissed naming it (the note under T036)', async () => {
    const { service, calls, lines } = suspensionOver();
    await service.confirmFault(tx, ADMIN, TARGET, DISMISSED.note);
    expect(calls.filter(([name]) => name !== 'log')).toEqual([
      ['lockEnrollments', [ENROLLMENT]],
      ['caseRecordOf'],
      ['enrollmentFor', ENROLLMENT],
      ['cancel', ENROLLMENT, 'admin'],
      ['cancelRemaining', [ENROLLMENT], NOW],
      ['openFaultCase', ENROLLMENT],
      ['closeCase', CASE, { ...DISMISSED, coveredBy: FAULT_CASE }],
    ]);
    expect(lines).toEqual([
      [
        'A suspended student’s fault was confirmed',
        {
          adminId: ADMIN,
          caseId: CASE,
          enrollmentId: ENROLLMENT,
          faultCaseId: FAULT_CASE,
          cancelledSessions: 1,
          handedRemedies: 2,
        },
      ],
    ]);
  });

  it.each(['cancelled', 'terminated_no_show'] as const)(
    'on an enrollment %s meanwhile cancels nothing, opens no case and closes the case (U2)',
    async (status) => {
      const { service, calls } = suspensionOver({ status });
      await service.confirmFault(tx, ADMIN, TARGET, DISMISSED.note);
      expect(calls.filter(([name]) => name !== 'log')).toEqual([
        ['lockEnrollments', [ENROLLMENT]],
        ['caseRecordOf'],
        ['enrollmentFor', ENROLLMENT],
        ['closeCase', CASE, DISMISSED],
      ]);
    },
  );

  it('refuses a case no longer open CONFLICT not_open, cancelling nothing', async () => {
    const { service, calls } = suspensionOver({ caseStatus: 'resolved' });
    const refusal = await refusalOf(service.confirmFault(tx, ADMIN, TARGET, DISMISSED.note));
    expect(refusal.details).toEqual([{ path: 'cause', code: 'not_open' }]);
    expect(calls.some(([name]) => name === 'cancel' || name === 'closeCase')).toBe(false);
  });
});

/**
 * The administrator kind's after-commit point as `procedures.ts` runs it: the request's list bound to
 * the call's transaction while it runs, flushed once it has committed, dropped on a rollback.
 * What the call added to the list, sent or not, is kept in `added`.
 */
let added: LiveMessage[] = [];

async function asAdministratorKind(
  work: (call: Transaction) => Promise<unknown>,
  commitFails = false,
): Promise<LiveMessage[]> {
  const published: LiveMessage[] = [];
  const live = new RequestLive(
    { publish: (message) => void published.push(message) },
    { warn: () => undefined },
  );
  const call = {} as Transaction;
  added = [];
  const recording: LivePublisher = {
    afterCommit: (to, event, scope) => {
      added.push({ to: [...to], event });
      live.afterCommit(to, event, scope);
    },
  };
  const unbind = bindToTransaction(call, recording);
  try {
    await work(call);
    if (commitFails) throw new Error('the audit write failed');
    live.flush();
  } catch {
    live.drop();
  } finally {
    unbind();
  }
  return published;
}

describe('the live event of a suspended student’s case closed (T066)', () => {
  it('the fault confirmed sends enrollment to both parties once, after the commit', async () => {
    const { service } = suspensionOver();
    expect(
      await asAdministratorKind((call) =>
        service.confirmFault(call, ADMIN, TARGET, DISMISSED.note),
      ),
    ).toEqual([
      { to: [STUDENT, TEACHER], event: { type: 'enrollment', enrollmentId: ENROLLMENT } },
    ]);
  });

  it('the fault confirmed sends nothing when the call rolls back, the case is no longer open, or the enrollment ended another way', async () => {
    const rolledBack = suspensionOver();
    expect(
      await asAdministratorKind(
        (call) => rolledBack.service.confirmFault(call, ADMIN, TARGET, DISMISSED.note),
        true,
      ),
    ).toEqual([]);
    const notOpen = suspensionOver({ caseStatus: 'resolved' });
    expect(
      await asAdministratorKind((call) =>
        notOpen.service.confirmFault(call, ADMIN, TARGET, DISMISSED.note),
      ),
    ).toEqual([]);
    expect(added).toEqual([]);
    const ended = suspensionOver({ status: 'cancelled' });
    expect(
      await asAdministratorKind((call) =>
        ended.service.confirmFault(call, ADMIN, TARGET, DISMISSED.note),
      ),
    ).toEqual([]);
    expect(added).toEqual([]);
  });

  it('cleared sends nothing of its own', async () => {
    const { service } = suspensionOver();
    expect(
      await asAdministratorKind((call) => service.clear(call, ADMIN, TARGET, RESOLVED.note)),
    ).toEqual([]);
    expect(added).toEqual([]);
  });
});
